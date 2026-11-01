#!/usr/bin/env bash
# Back up the Immich library to the restic repository on the backup Pi (docs/backup.md).
#
# Usage: backup.sh [run]            back up, then a partial integrity check once a month
#        backup.sh init             create the repository (once, before the first run)
#        backup.sh restic ARGS...   any restic command: snapshots, restore, check, ...
# Config: /etc/homelab-backup.env and /etc/homelab-backup.password. Under systemd both
# arrive as credentials, because the service runs as a throwaway user that cannot read /etc.
set -euo pipefail

if [[ -n "${CREDENTIALS_DIRECTORY:-}" ]]; then
    ENV_FILE="${CREDENTIALS_DIRECTORY}/env"
    PASSWORD_FILE="${CREDENTIALS_DIRECTORY}/password"
else
    ENV_FILE=/etc/homelab-backup.env
    PASSWORD_FILE=/etc/homelab-backup.password
fi
# Manual runs as root keep their own cache and stamp, so they never write
# root-owned files into the service user's directories.
STATE_DIR="${STATE_DIRECTORY:-/var/lib/homelab-backup-manual}"
[[ -n "${CACHE_DIRECTORY:-}" ]] && export RESTIC_CACHE_DIR="$CACHE_DIRECTORY"

log() { printf '%s %s\n' "$(date -u +%FT%TZ)" "$*"; }
die() { log "ERROR: $*" >&2; exit 1; }

# Read KEY=VALUE lines without executing the file as shell code
load_env() {
    local line key value
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
        [[ "$line" =~ ^[[:space:]]*([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]] || continue
        key="${BASH_REMATCH[1]}"
        value="${BASH_REMATCH[2]}"
        value="${value%\"}"; value="${value#\"}"
        value="${value%\'}"; value="${value#\'}"
        case "$key" in
            RESTIC_REPOSITORY | BACKUP_ROOT | CHECK_EVERY_DAYS | CHECK_SUBSET) export "${key}=${value}" ;;
        esac
    done < "$1"
}

[[ -r "$ENV_FILE" ]] || die "Cannot read ${ENV_FILE}. Run backup/install.sh first."
[[ -r "$PASSWORD_FILE" ]] || die "Cannot read ${PASSWORD_FILE}. Run backup/install.sh first."
load_env "$ENV_FILE"
export RESTIC_PASSWORD_FILE="$PASSWORD_FILE"
[[ -n "${RESTIC_REPOSITORY:-}" ]] || die "RESTIC_REPOSITORY is not set in ${ENV_FILE}"
command -v restic > /dev/null || die "restic is not installed (sudo apt install restic)"

run_backup() {
    [[ -d "${BACKUP_ROOT:-}" ]] || die "BACKUP_ROOT (${BACKUP_ROOT:-unset}) is not a directory"
    # Clears locks left by a run that was killed; live locks are kept
    restic unlock
    log "Backing up ${BACKUP_ROOT}"
    # thumbs/ and encoded-video/ are rebuilt by Immich from the originals.
    # --host keeps snapshots grouped if the server is renamed.
    local rc=0
    restic backup "$BACKUP_ROOT" --host homelab --tag immich \
        --exclude "${BACKUP_ROOT}/thumbs" --exclude "${BACKUP_ROOT}/encoded-video" || rc=$?
    # 3 = snapshot saved but some files could not be read. Fail the unit so it gets noticed.
    [[ $rc -eq 3 ]] && die "Some files could not be read (see the warnings above); the snapshot is incomplete"
    [[ $rc -eq 0 ]] || die "restic backup failed with exit code ${rc}"

    local stamp="${STATE_DIR}/last-check"
    mkdir -p "$STATE_DIR"
    if [[ -z "$(find "$stamp" -mtime "-${CHECK_EVERY_DAYS:-30}" 2> /dev/null)" ]]; then
        # Downloads CHECK_SUBSET of pack data from the Pi and verifies it
        log "Checking the repository (reading ${CHECK_SUBSET:-2G} of data)"
        restic check --read-data-subset "${CHECK_SUBSET:-2G}"
        touch "$stamp"
    fi
    log "Done"
}

case "${1:-run}" in
    run) run_backup ;;
    init) restic init ;;
    restic) shift; exec restic "$@" ;;
    -h | --help) sed -n '2,8p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//' ;;
    *) die "Unknown command: $1 (try --help)" ;;
esac
