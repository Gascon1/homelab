#!/usr/bin/env bash
# =============================================================================
# Homelab pull-based deployer
# =============================================================================
# Runs on the server (from a systemd timer, see deploy/ and docs/deploy.md).
# Deploys origin/<BRANCH> only when the GitHub check run "release" for that
# commit has finished with conclusion "success". Rolls back if the new stack
# does not become healthy, and does not retry a bad commit until main moves.
#
# Usage: scripts/deploy.sh [--dry-run] [--force] [--help]
#
# Config (first file found; values in the file win over the environment):
#   $DEPLOY_ENV, else /etc/homelab-deploy.env, else <repo>/deploy/deploy.env
#   REPO_DIR       repo checkout (default: parent of scripts/)
#   BRANCH         branch to follow (default: main)
#   REMOTE         git remote (default: origin)
#   GITHUB_REPO    owner/name for the gate check (default: Gascon1/homelab)
#   GITHUB_TOKEN   optional, raises the API rate limit
#   COMPOSE_PROFILES  optional override. Leave it unset: docker compose then
#                  reads COMPOSE_PROFILES from <repo>/.env (e.g. remote)
#   STATE_DIR      skip file and lock (default: <repo>/.deploy-state)
#   RACK_SOURCE    registry (default): pull the rack image from GHCR;
#                  build: build it on this host (for a private repo/image)
#   PRUNE          1 (default) prunes old rack images after a good deploy
#   TRIGGER_FILE   file the push doorbell touches (default: <APPDATA>/deploy-hook/trigger,
#                  APPDATA from .env, default <repo>/appdata). If it changes during
#                  a run, the run is repeated once so that trigger is not lost
#   PULL_ALL       0 (default): pull only rack, plus all images when a
#                  compose*.yml file changed; 1: pull every image each deploy
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="${REPO_DIR:-$(dirname "$SCRIPT_DIR")}"

DRY_RUN=0
FORCE=0
LOG_SHA=""

log() { printf '%s sha=%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${LOG_SHA:-none}" "$*"; }
die() { log "ERROR $*"; exit 1; }

usage() {
    # Print the header comment block (lines 2 up to the first non-comment line)
    awk 'NR > 1 { if ($0 !~ /^#/) exit; sub(/^# ?/, ""); if ($0 !~ /^=+$/) print }' "${BASH_SOURCE[0]}"
}

# Read KEY=VALUE lines from an env file without executing it as shell code.
# Copied from setup.sh (load_env); keep both in sync.
load_env() {
    local line key value
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
        if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            key="${BASH_REMATCH[2]}"
            value="${BASH_REMATCH[3]}"
            # Quoted values may be followed by an inline comment (KEY="v" # note), as in compose
            if [[ "$value" =~ ^\"([^\"]*)\"[[:space:]]*(#.*)?$ ]] || [[ "$value" =~ ^\'([^\']*)\'[[:space:]]*(#.*)?$ ]]; then
                value="${BASH_REMATCH[1]}"
            else
                # Unquoted: drop an inline " # comment" and trailing spaces, like docker compose
                value="${value%%[[:space:]]#*}"
                value="${value%"${value##*[![:space:]]}"}"
            fi
            export "${key}=${value}"
        fi
    done < "$1"
}

# Modification time (ns) of the doorbell trigger file; empty if it does not exist.
# TRIGGER_FILE is relative to the repo (cwd) when APPDATA is.
trigger_stamp() { stat -c %.9Y "${TRIGGER_FILE:-/nonexistent}" 2> /dev/null || true; }

# shellcheck disable=SC2329  # invoked through trap
on_exit() {
    local rc=$?
    if [[ $rc -ne 0 ]]; then
        log "EXIT code=${rc}"
    fi
}

# Everything runs inside main() and the file ends with "main; exit": bash has
# then parsed the whole script, so the git merge below can safely replace
# scripts/deploy.sh while it is running.
main() {
    local arg
    for arg in "$@"; do
        case "$arg" in
            --dry-run) DRY_RUN=1 ;;
            --force) FORCE=1 ;;
            -h | --help) usage; return 0 ;;
            *) echo "Unknown option: $arg (try --help)" >&2; return 2 ;;
        esac
    done

    trap on_exit EXIT

    # ---- config -------------------------------------------------------------
    local cfg="${DEPLOY_ENV:-}"
    if [[ -z "$cfg" ]]; then
        if [[ -r /etc/homelab-deploy.env ]]; then
            cfg=/etc/homelab-deploy.env
        elif [[ -r "${REPO_DIR}/deploy/deploy.env" ]]; then
            cfg="${REPO_DIR}/deploy/deploy.env"
        fi
    fi
    if [[ -n "$cfg" ]]; then
        [[ -r "$cfg" ]] || die "config file not readable: ${cfg}"
        load_env "$cfg"
    fi

    BRANCH="${BRANCH:-main}"
    REMOTE="${REMOTE:-origin}"
    GITHUB_REPO="${GITHUB_REPO:-Gascon1/homelab}"
    GITHUB_API="${GITHUB_API:-https://api.github.com}"
    STATE_DIR="${STATE_DIR:-${REPO_DIR}/.deploy-state}"
    PRUNE="${PRUNE:-1}"
    PULL_ALL="${PULL_ALL:-0}"
    RACK_SOURCE="${RACK_SOURCE:-registry}"
    case "$RACK_SOURCE" in registry | build) ;; *) die "RACK_SOURCE must be registry or build, got: ${RACK_SOURCE}" ;; esac
    IMAGE_REPO="ghcr.io/gascon1/homelab-rack"
    IMAGE_SOURCE_LABEL="org.opencontainers.image.source=https://github.com/Gascon1/homelab"

    # An empty COMPOSE_PROFILES in the environment would hide the one in .env
    # (docker compose prefers the environment), and then the remote profile
    # services would not be updated. Unset it so .env is used.
    [[ -z "${COMPOSE_PROFILES:-}" ]] && unset COMPOSE_PROFILES

    [[ -n "$cfg" ]] && log "config: ${cfg}"
    [[ $DRY_RUN -eq 1 ]] && log "DRY-RUN: nothing will be changed"

    # ---- preflight ----------------------------------------------------------
    local tool
    for tool in git curl jq flock docker; do
        command -v "$tool" > /dev/null 2>&1 || die "required tool not found: ${tool} (install it, e.g. sudo apt install jq curl)"
    done
    [[ -d "${REPO_DIR}/.git" ]] || die "REPO_DIR is not a git checkout: ${REPO_DIR}"
    cd "$REPO_DIR"
    mkdir -p "$STATE_DIR"
    local profiles="${COMPOSE_PROFILES:-}" profiles_from="deploy config"
    if [[ -z "$profiles" && -r .env ]]; then
        profiles="$(load_env .env > /dev/null 2>&1; printf '%s' "${COMPOSE_PROFILES:-}")" || profiles=""
        profiles_from=".env"
    fi
    [[ -n "$profiles" ]] || profiles_from="none set"
    if [[ -z "${TRIGGER_FILE:-}" ]]; then
        local appdata="${APPDATA:-}"
        if [[ -z "$appdata" && -r .env ]]; then
            appdata="$(load_env .env > /dev/null 2>&1; printf '%s' "${APPDATA:-}")" || appdata=""
        fi
        TRIGGER_FILE="${appdata:-./appdata}/deploy-hook/trigger"
    fi

    # ---- lock ---------------------------------------------------------------
    # In STATE_DIR (not /tmp), so a manual run and the timer share one lock
    # even though the service uses PrivateTmp.
    local lock="${LOCK_FILE:-${STATE_DIR}/deploy.lock}"
    exec 9> "$lock"
    if ! flock -n 9; then
        log "another deploy is running (lock ${lock}), exiting"
        return 0
    fi
    # Remember the doorbell state: main() callers re-run once if it changed meanwhile
    TRIGGER_AT_START="$(trigger_stamp)"

    # ---- 1. fetch -----------------------------------------------------------
    git fetch --quiet "$REMOTE" "$BRANCH" || die "git fetch ${REMOTE} ${BRANCH} failed"
    local head target prev
    head="$(git rev-parse HEAD)"
    target="$(git rev-parse "${REMOTE}/${BRANCH}")"
    LOG_SHA="${target:0:12}"

    if [[ "$head" == "$target" ]]; then
        log "up to date"
        return 0
    fi
    log "compose profiles: ${profiles:-(none)} (${profiles_from})"

    # ---- 2. safety checks ---------------------------------------------------
    local cur_branch
    cur_branch="$(git rev-parse --abbrev-ref HEAD)"
    if [[ "$cur_branch" != "$BRANCH" ]]; then
        die "refusing: checked out branch is '${cur_branch}', expected '${BRANCH}'"
    fi
    if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
        die "refusing: working tree has local changes (commit, stash or discard them)"
    fi
    if ! git merge-base --is-ancestor "$head" "$target"; then
        die "refusing: ${BRANCH} is not a fast-forward of ${REMOTE}/${BRANCH} (local ${head:0:12} has diverged)"
    fi

    # ---- 3. skip file -------------------------------------------------------
    local skip_file="${STATE_DIR}/skip-sha"
    if [[ $FORCE -eq 0 && -f "$skip_file" && "$(cat "$skip_file")" == "$target" ]]; then
        log "skipping: this commit failed to deploy earlier (waiting for ${BRANCH} to move; --force overrides)"
        return 0
    fi

    # ---- 4. gate ------------------------------------------------------------
    if [[ $FORCE -eq 1 ]]; then
        log "gate skipped (--force)"
    else
        local url="${GITHUB_API}/repos/${GITHUB_REPO}/commits/${target}/check-runs?check_name=release"
        local -a curl_args=(--fail --silent --show-error --max-time 20 -H "Accept: application/vnd.github+json")
        if [[ -n "${GITHUB_TOKEN:-}" ]]; then
            curl_args+=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
        fi
        local body err_file
        err_file="$(mktemp "${STATE_DIR}/curl-err.XXXXXX")"
        if ! body="$(curl "${curl_args[@]}" "$url" 2> "$err_file")"; then
            local err
            err="$(tr '\n' ' ' < "$err_file")"
            rm -f "$err_file"
            if [[ -z "${GITHUB_TOKEN:-}" && "$err" =~ error:\ (401|404) ]]; then
                log "WARN GitHub API returned ${BASH_REMATCH[1]}: repo private? set GITHUB_TOKEN (fine-grained, read-only Checks + Contents + Metadata on this repo)"
            elif [[ "$err" =~ error:\ (401|404) ]]; then
                log "WARN GitHub API returned ${BASH_REMATCH[1]} with GITHUB_TOKEN set: token invalid, expired, or without Checks/Contents/Metadata read access"
            else
                log "WARN cannot read check runs from GitHub (${err}), will retry on the next run"
            fi
            return 0
        fi
        rm -f "$err_file"
        local state
        if ! state="$(jq -r '
            [.check_runs[]? | select(.name == "release" and .app.slug == "github-actions")]
            | if length == 0 then "none"
              else (sort_by(.started_at // "") | last | "\(.status)/\(.conclusion // "none")") end' <<< "$body")"; then
            log "WARN unexpected response from GitHub, will retry on the next run"
            return 0
        fi
        case "$state" in
            completed/success) log "gate ok: release check succeeded" ;;
            none) log "gate pending: no release check run yet"; return 0 ;;
            completed/*) log "gate closed: release check ended as '${state#completed/}', not deploying"; return 0 ;;
            *) log "gate pending: release check is '${state}'"; return 0 ;;
        esac
    fi

    # ---- 5. deploy ----------------------------------------------------------
    prev="$head"
    local new_tag="sha-${target}"
    # Pull every image only when a compose file changed (new tags, new services).
    # Otherwise only rack: the :latest apps update when you choose (MANUAL-STEPS Task 22).
    local pull_all="$PULL_ALL"
    if ! git diff --quiet "$prev" "$target" -- 'compose*.yml' 'compose*.yaml' 'docker-compose*.yml' 'docker-compose*.yaml'; then
        pull_all=1
    fi
    local -a pull_args=(rack)
    [[ "$pull_all" == "1" ]] && pull_args=()
    if [[ $DRY_RUN -eq 1 ]]; then
        log "DRY-RUN would: git merge --ff-only ${target:0:12} (${prev:0:12} -> ${target:0:12})"
        if [[ "$RACK_SOURCE" == "build" ]]; then
            log "DRY-RUN would: RACK_TAG=${new_tag} docker compose build rack"
            [[ "$pull_all" == "1" ]] && log "DRY-RUN would: docker compose pull --ignore-buildable"
        else
            log "DRY-RUN would: RACK_TAG=${new_tag} docker compose pull ${pull_args[*]:-(all services)}"
        fi
        log "DRY-RUN would: RACK_TAG=${new_tag} docker compose up -d --remove-orphans --wait --wait-timeout 300"
        log "DRY-RUN on failure would: git reset --hard ${prev:0:12}, restart with RACK_TAG=sha-${prev}, write skip file"
        [[ "$PRUNE" == "1" ]] && log "DRY-RUN after success would: prune rack images older than 168h"
        return 0
    fi

    log "deploying ${prev:0:12} -> ${target:0:12}"
    # Merge the sha the gate checked, not the remote ref: a parallel git fetch
    # could have moved it since.
    git merge --quiet --ff-only "$target" || die "git merge --ff-only failed (nothing deployed)"
    export RACK_TAG="$new_tag"

    if [[ "$RACK_SOURCE" == "build" ]]; then
        if ! docker compose build rack; then
            git reset --quiet --hard "$prev"
            printf '%s\n' "$target" > "$skip_file"
            die "docker compose build rack failed; reverted to ${prev:0:12}, will not retry this commit"
        fi
        if [[ "$pull_all" == "1" ]] && ! docker compose pull --ignore-buildable; then
            git reset --quiet --hard "$prev"
            die "docker compose pull failed; reverted to ${prev:0:12}, will retry on the next run"
        fi
    else
        if ! docker compose pull "${pull_args[@]}"; then
            git reset --quiet --hard "$prev"
            die "docker compose pull failed; reverted to ${prev:0:12}, will retry on the next run"
        fi
        # rack has a build: section, so compose pull only warns when the image is
        # missing, and compose up would then build it here. Require the CI image.
        if ! docker image inspect "${IMAGE_REPO}:${new_tag}" > /dev/null 2>&1; then
            git reset --quiet --hard "$prev"
            die "image ${IMAGE_REPO}:${new_tag} not pulled (package private or not pushed?); reverted to ${prev:0:12}, will retry on the next run"
        fi
    fi

    if docker compose up -d --remove-orphans --wait --wait-timeout 300; then
        rm -f "$skip_file"
        log "DEPLOYED ${target:0:12} (RACK_TAG=${RACK_TAG})"
        if [[ "$PRUNE" == "1" ]]; then
            docker image prune -a -f --filter "label=${IMAGE_SOURCE_LABEL}" --filter "until=168h" > /dev/null \
                || log "WARN image prune failed (ignored)"
        fi
        return 0
    fi

    # ---- 6. rollback --------------------------------------------------------
    log "ERROR docker compose up failed, rolling back to ${prev:0:12}"
    git reset --quiet --hard "$prev"
    printf '%s\n' "$target" > "$skip_file"
    local rb_tag="sha-${prev}"
    if ! docker image inspect "${IMAGE_REPO}:${rb_tag}" > /dev/null 2>&1; then
        if [[ "$RACK_SOURCE" == "build" ]]; then
            RACK_TAG="$rb_tag" docker compose build rack > /dev/null 2>&1 || true
        else
            RACK_TAG="$rb_tag" docker compose pull rack > /dev/null 2>&1 || true
        fi
        if ! docker image inspect "${IMAGE_REPO}:${rb_tag}" > /dev/null 2>&1; then
            log "WARN previous image ${rb_tag} not available, falling back to tag main"
            rb_tag="main"
        fi
    fi
    export RACK_TAG="$rb_tag"
    if docker compose up -d --remove-orphans --wait --wait-timeout 300; then
        log "ROLLBACK ok: running ${prev:0:12} (RACK_TAG=${RACK_TAG}); ${target:0:12} will not be retried"
        return 1
    fi
    log "ROLLBACK FAILED: stack is not healthy, manual action needed"
    return 2
}

# A doorbell that rings while a run is in progress finds the lock taken and the
# service already active, so systemd drops it. Repeat once if the trigger file
# changed since this run took the lock (bounded: at most one extra run).
main_with_recheck() {
    unset TRIGGER_AT_START
    main "$@" # a failure exits here (set -e), with main's exit code
    if [[ $DRY_RUN -eq 0 && -n "${TRIGGER_AT_START+x}" && "$(trigger_stamp)" != "$TRIGGER_AT_START" ]]; then
        log "trigger arrived during this run, checking once more"
        main "$@"
    fi
}

main_with_recheck "$@"; exit $?
