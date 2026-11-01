#!/usr/bin/env bash
# Install (or remove) the nightly photo backup: restic, the script, the service and timer.
#
# Usage: backup/install.sh [--uninstall]
# Run again after changing anything in backup/: it re-copies the script and re-renders the units.
# Config (/etc/homelab-backup.env and .password) is created once and never overwritten.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
UNIT_DIR=/etc/systemd/system
SCRIPT=/usr/local/libexec/homelab-backup/backup.sh
ENV_FILE=/etc/homelab-backup.env
PASSWORD_FILE=/etc/homelab-backup.password

case "${1:-}" in
    "") ;;
    --uninstall)
        sudo systemctl disable --now homelab-backup.timer 2> /dev/null || true
        sudo rm -f "${UNIT_DIR}/homelab-backup.service" "${UNIT_DIR}/homelab-backup.timer" "$SCRIPT"
        sudo systemctl daemon-reload
        echo "Removed homelab-backup. ${ENV_FILE}, ${PASSWORD_FILE} and the backups on the Pi were kept."
        exit 0
        ;;
    -h | --help) sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
esac

# One value from .env (last assignment wins, quotes and inline comments stripped)
env_value() {
    local v=""
    [[ -r "${REPO_DIR}/.env" ]] && v="$(sed -n -E "s/^[[:space:]]*(export[[:space:]]+)?$1=(.*)$/\2/p" "${REPO_DIR}/.env" | tail -n 1)"
    v="${v%%[[:space:]]#*}"
    v="${v%"${v##*[![:space:]]}"}"
    v="${v%\"}"; v="${v#\"}"
    v="${v%\'}"; v="${v#\'}"
    printf '%s' "$v"
}

UPLOAD_LOCATION="$(env_value UPLOAD_LOCATION)"
[[ "$UPLOAD_LOCATION" == /* ]] || { echo "UPLOAD_LOCATION in .env must be an absolute path (got '${UPLOAD_LOCATION}')" >&2; exit 1; }
UPLOAD_LOCATION="$(realpath -m -- "$UPLOAD_LOCATION")"
TZ_NAME="$(env_value TZ)"
TZ_NAME="${TZ_NAME:-UTC}"
[[ -e "/usr/share/zoneinfo/${TZ_NAME}" ]] || { echo "Unknown TZ in .env: ${TZ_NAME}" >&2; exit 1; }

# The values go into sed replacements: reject characters that would break it
for v in "$REPO_DIR" "$UPLOAD_LOCATION" "$TZ_NAME"; do
    [[ "$v" =~ ^[A-Za-z0-9_./@+-]+$ ]] || { echo "Unsupported characters in: ${v}" >&2; exit 1; }
done

command -v restic > /dev/null || sudo apt-get install -y restic

if ! sudo test -f "$ENV_FILE"; then
    sed -e "s|^BACKUP_ROOT=.*|BACKUP_ROOT=${UPLOAD_LOCATION}|" "${SCRIPT_DIR}/backup.env.example" \
        | sudo install -m 600 -o root -g root /dev/stdin "$ENV_FILE"
    echo "Created ${ENV_FILE}. Put the Pi's rest-server user and password in RESTIC_REPOSITORY."
fi
if ! sudo test -f "$PASSWORD_FILE"; then
    # The repository encryption key. Without it the backup cannot be read: save it in a password manager.
    openssl rand -base64 33 | sudo install -m 600 -o root -g root /dev/stdin "$PASSWORD_FILE"
    echo "Created ${PASSWORD_FILE}. Copy it to your password manager now: sudo cat ${PASSWORD_FILE}"
fi

sudo install -D -m 755 -o root -g root "${SCRIPT_DIR}/backup.sh" "$SCRIPT"
render() {
    sed -e "s|@REPO_DIR@|${REPO_DIR}|g" -e "s|@BACKUP_ROOT@|${UPLOAD_LOCATION}|g" \
        -e "s|@SCRIPT@|${SCRIPT}|g" -e "s|@TZ@|${TZ_NAME}|g" "$1"
}
for unit in homelab-backup.service homelab-backup.timer; do
    render "${SCRIPT_DIR}/${unit}" | sudo tee "${UNIT_DIR}/${unit}" > /dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-backup.timer
echo "Installed. Backing up ${UPLOAD_LOCATION} nightly at 04:30 ${TZ_NAME}."
echo "Next: sudo ${SCRIPT} init, then sudo systemctl start --no-block homelab-backup.service (see docs/backup.md)"
