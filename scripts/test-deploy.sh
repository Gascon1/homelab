#!/usr/bin/env bash
# =============================================================================
# Local test for scripts/deploy.sh
# =============================================================================
# Builds a throwaway bare "origin" and a "host" clone, puts stub `docker` and
# `curl` on PATH, and runs deploy.sh through its main scenarios. No network, no
# real Docker. Usage: scripts/test-deploy.sh
set -euo pipefail
unset GITHUB_TOKEN COMPOSE_PROFILES RACK_TAG RACK_SOURCE

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT

ORIGIN="$T/origin.git"
DEV="$T/dev"
HOST="$T/host"
BIN="$T/bin"
CALLS="$T/calls.log"
mkdir -p "$BIN"
: > "$CALLS"
: > "$T/deploy.env"

PASS=0
FAIL=0
ok() { PASS=$((PASS + 1)); echo "  ok   $*"; }
bad() { FAIL=$((FAIL + 1)); echo "  FAIL $*"; }
check() { # check <description> <command...>
    local desc="$1"
    shift
    if "$@"; then ok "$desc"; else bad "$desc"; fi
}
same() { [[ "$1" == "$2" ]]; }
differ() { [[ "$1" != "$2" ]]; }
absent() { [[ ! -e "$1" ]]; }

# ---- stubs -------------------------------------------------------------------
cat > "$BIN/docker" << 'STUB'
#!/usr/bin/env bash
echo "docker $* [RACK_TAG=${RACK_TAG:-}] [PROFILES=${COMPOSE_PROFILES-unset}]" >> "$CALLS_LOG"
if [[ "${1:-}" == "compose" && "${2:-}" == "up" && -n "${FAIL_UP_TAG:-}" && "${RACK_TAG:-}" == "$FAIL_UP_TAG" ]]; then
    echo "stub: unhealthy" >&2
    exit 1
fi
if [[ "${1:-}" == "image" && "${2:-}" == "inspect" && "${NO_LOCAL_IMAGE:-0}" == "1" ]]; then
    exit 1
fi
exit 0
STUB
cat > "$BIN/curl" << 'STUB'
#!/usr/bin/env bash
url="${*: -1}"
echo "curl $url" >> "$CALLS_LOG"
case "${GATE:-success}" in
    success) st=completed; co='"success"' ;;
    failure) st=completed; co='"failure"' ;;
    pending) st=in_progress; co=null ;;
    none) echo '{"total_count":0,"check_runs":[]}'; exit 0 ;;
    # A green "release" check made by another GitHub App, not by GitHub Actions
    fake) echo '{"total_count":1,"check_runs":[{"name":"release","status":"completed","conclusion":"success","started_at":"2026-01-01T00:00:00Z","app":{"slug":"evil-app"}}]}'; exit 0 ;;
    http404) echo "curl: (22) The requested URL returned error: 404" >&2; exit 22 ;;
esac
printf '{"total_count":1,"check_runs":[{"name":"release","status":"%s","conclusion":%s,"started_at":"2026-01-01T00:00:00Z","app":{"slug":"github-actions"}}]}\n' "$st" "$co"
STUB
chmod +x "$BIN/docker" "$BIN/curl"

# ---- repos -------------------------------------------------------------------
git init -q --bare -b main "$ORIGIN"
git clone -q "$ORIGIN" "$DEV" 2> /dev/null
git -C "$DEV" config user.email t@example.com
git -C "$DEV" config user.name Test
mkdir -p "$DEV/scripts"
cp "$SRC_DIR/scripts/deploy.sh" "$DEV/scripts/deploy.sh"
printf '.deploy-state/\n' > "$DEV/.gitignore"
echo v1 > "$DEV/app.txt"
git -C "$DEV" add -A
git -C "$DEV" commit -q -m "initial"
git -C "$DEV" push -q origin HEAD:main 2> /dev/null
git clone -q "$ORIGIN" "$HOST" 2> /dev/null
git -C "$HOST" config user.email t@example.com
git -C "$HOST" config user.name Test

new_commit() { # new_commit <content>
    echo "$1" > "$DEV/app.txt"
    git -C "$DEV" commit -q -am "change $1"
    git -C "$DEV" push -q origin HEAD:main
}
head_of() { git -C "$1" rev-parse HEAD; }

run() { # run <expected rc> <args...>; output in $T/out
    local want="$1" rc=0
    shift
    : > "$CALLS"
    PATH="$BIN:$PATH" CALLS_LOG="$CALLS" DEPLOY_ENV="$T/deploy.env" REPO_DIR="$HOST" \
        bash "$HOST/scripts/deploy.sh" "$@" > "$T/out" 2>&1 || rc=$?
    sed 's/^/       | /' "$T/out"
    check "exit code $rc (want $want)" same "$rc" "$want"
}
expect_out() { check "log has: $1" grep -q -- "$1" "$T/out"; }
expect_call() { check "called: $1" grep -q -- "$1" "$CALLS"; }
not_in() { ! grep -q -- "$1" "$2"; }
expect_no_call() { check "not called: $1" not_in "$1" "$CALLS"; }

# ---- scenarios ---------------------------------------------------------------
echo "1. up-to-date"
run 0
expect_out "up to date"
expect_no_call "compose"

echo "2. new commit, gate pending"
new_commit v2
SHA2="$(head_of "$DEV")"
GATE=pending run 0
expect_out "gate pending"
expect_no_call "compose"
check "host not moved" differ "$(head_of "$HOST")" "$SHA2"

echo "3. gate success, dry run"
GATE=success run 0 --dry-run
expect_out "DRY-RUN would: git merge"
expect_no_call "compose"
check "host not moved" differ "$(head_of "$HOST")" "$SHA2"

echo "4. gate success, compose up ok"
GATE=success run 0
expect_out "DEPLOYED"
expect_call "curl .*commits/${SHA2}/check-runs?check_name=release"
expect_call "docker compose pull rack \[RACK_TAG=sha-${SHA2}\]"
expect_call "docker image inspect ghcr.io/gascon1/homelab-rack:sha-${SHA2}"
expect_call "docker compose up -d --remove-orphans --wait --wait-timeout 300 \[RACK_TAG=sha-${SHA2}\]"
expect_call "docker image prune"
check "host fast-forwarded" same "$(head_of "$HOST")" "$SHA2"

echo "5. compose up fails: rollback and skip"
new_commit v3
SHA3="$(head_of "$DEV")"
GATE=success FAIL_UP_TAG="sha-${SHA3}" run 1
expect_out "ROLLBACK ok"
expect_call "docker compose up .*\[RACK_TAG=sha-${SHA2}\]"
check "host reset to previous commit" same "$(head_of "$HOST")" "$SHA2"
check "skip file has bad sha" same "$(cat "$HOST/.deploy-state/skip-sha")" "$SHA3"
echo "5b. next run skips the same sha"
GATE=success run 0
expect_out "skipping"
expect_no_call "compose"
echo "5c. main moves: skip no longer applies"
new_commit v4
SHA4="$(head_of "$DEV")"
GATE=success run 0
expect_out "DEPLOYED"
check "host at new commit" same "$(head_of "$HOST")" "$SHA4"
check "skip file cleared" absent "$HOST/.deploy-state/skip-sha"

echo "6. dirty tree: refuses"
new_commit v5
echo local-edit >> "$HOST/app.txt"
GATE=success run 1
expect_out "working tree has local changes"
expect_no_call "compose"
git -C "$HOST" checkout -q -- app.txt

echo "7. non-fast-forward: refuses"
echo local > "$HOST/local.txt"
git -C "$HOST" add local.txt
git -C "$HOST" commit -q -m "local only"
GATE=success run 1
expect_out "not a fast-forward"
expect_no_call "compose"
git -C "$HOST" reset -q --hard "$SHA4"

echo "8. gate failed / API error: no deploy"
GATE=failure run 0
expect_out "gate closed"
GATE=http404 run 0
expect_out "repo private? set GITHUB_TOKEN"
expect_no_call "compose"

echo "8b. release check from another app: ignored"
GATE=fake run 0
expect_out "gate pending: no release check run yet"
expect_no_call "compose"

echo "8c. pull leaves no rack image (compose pull only warns for a buildable service): revert, no skip"
GATE=success NO_LOCAL_IMAGE=1 run 1
expect_out "not pulled"
expect_no_call "compose up"
check "host not moved" same "$(head_of "$HOST")" "$SHA4"
check "no skip file" absent "$HOST/.deploy-state/skip-sha"

echo "8d. compose file changed: pull every image; profiles from .env"
printf 'COMPOSE_PROFILES=remote\n' > "$HOST/.env"
printf 'COMPOSE_PROFILES=\n' > "$T/deploy.env"
echo "services: {}" > "$DEV/compose.yml"
git -C "$DEV" add compose.yml
git -C "$DEV" commit -q -m "compose change"
git -C "$DEV" push -q origin HEAD:main
SHA6="$(head_of "$DEV")"
GATE=success run 0
expect_out "DEPLOYED"
expect_out "compose profiles: remote (.env)"
expect_call "docker compose pull \[RACK_TAG=sha-${SHA6}\]"
expect_call "docker compose up .*\[PROFILES=unset\]"
rm -f "$HOST/.env"
: > "$T/deploy.env"
new_commit v7

echo "9. RACK_SOURCE=build"
printf 'RACK_SOURCE=build\nGITHUB_TOKEN=tok\n' > "$T/deploy.env"
GATE=success run 0
SHA5="$(head_of "$DEV")"
expect_call "docker compose build rack \[RACK_TAG=sha-${SHA5}\]"
expect_no_call "docker compose pull"
: > "$T/deploy.env"

echo
echo "passed: ${PASS}, failed: ${FAIL}"
[[ "$FAIL" -eq 0 ]]
