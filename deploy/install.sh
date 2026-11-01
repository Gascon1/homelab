#!/usr/bin/env bash
# Install (or remove) the homelab-deploy systemd service, path unit (push doorbell) and timer.
#
# Usage: deploy/install.sh [--repo PATH] [--user USER] [--uninstall]
# Defaults: repo = this repository, user = the user who runs this script.
# Safe to run again: it re-renders the units and reloads systemd.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
DEPLOY_USER="${SUDO_USER:-$(id -un)}"
UNINSTALL=0
UNIT_DIR=/etc/systemd/system

while [[ $# -gt 0 ]]; do
    case "$1" in
        --repo) REPO_DIR="${2:?--repo needs a path}"; shift 2 ;;
        --user) DEPLOY_USER="${2:?--user needs a name}"; shift 2 ;;
        --uninstall) UNINSTALL=1; shift ;;
        -h | --help) sed -n '2,6p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
        *) echo "Unknown option: $1" >&2; exit 2 ;;
    esac
done

if [[ $UNINSTALL -eq 1 ]]; then
    sudo systemctl disable --now homelab-deploy.path homelab-deploy.timer 2> /dev/null || true
    sudo rm -f "${UNIT_DIR}/homelab-deploy.service" "${UNIT_DIR}/homelab-deploy.path" "${UNIT_DIR}/homelab-deploy.timer"
    sudo systemctl daemon-reload
    echo "Removed homelab-deploy. deploy/deploy.env and .deploy-state were kept."
    exit 0
fi

REPO_DIR="$(cd "$REPO_DIR" && pwd)"
[[ -x "${REPO_DIR}/scripts/deploy.sh" ]] || { echo "Not a homelab repo: ${REPO_DIR}" >&2; exit 1; }
id "$DEPLOY_USER" > /dev/null 2>&1 || { echo "No such user: ${DEPLOY_USER}" >&2; exit 1; }
if ! id -nG "$DEPLOY_USER" | tr ' ' '\n' | grep -qx docker; then
    echo "WARNING: ${DEPLOY_USER} is not in the docker group. deploy.sh will fail until you run: sudo usermod -aG docker ${DEPLOY_USER}" >&2
fi
USER_HOME="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"

# APPDATA from .env (relative paths are relative to the repo, like docker compose);
# default <repo>/appdata. The path unit watches ${APPDATA}/deploy-hook/trigger.
APPDATA=""
if [[ -r "${REPO_DIR}/.env" ]]; then
    APPDATA="$(sed -n -E 's/^[[:space:]]*(export[[:space:]]+)?APPDATA=(.*)$/\2/p' "${REPO_DIR}/.env" | tail -n 1)"
    APPDATA="${APPDATA%%[[:space:]]#*}"
    APPDATA="${APPDATA%"${APPDATA##*[![:space:]]}"}"
    APPDATA="${APPDATA%\"}"; APPDATA="${APPDATA#\"}"
    APPDATA="${APPDATA%\'}"; APPDATA="${APPDATA#\'}"
fi
APPDATA="${APPDATA:-./appdata}"
case "$APPDATA" in
    /*) ;;
    *) APPDATA="${REPO_DIR}/${APPDATA#./}" ;;
esac
# systemd refuses a path that is not normalized (.., //, trailing /) and then
# leaves the path unit with no path, so normalize it (the folder can be missing).
APPDATA="$(realpath -m -- "$APPDATA")"

# The paths go into sed replacements: reject characters that would break it.
for v in "$REPO_DIR" "$DEPLOY_USER" "$USER_HOME" "$APPDATA"; do
    [[ "$v" =~ ^[A-Za-z0-9_./@+-]+$ ]] || { echo "Unsupported characters in: ${v}" >&2; exit 1; }
done

if [[ ! -f "${REPO_DIR}/deploy/deploy.env" ]]; then
    cp "${REPO_DIR}/deploy/deploy.env.example" "${REPO_DIR}/deploy/deploy.env"
    chown "${DEPLOY_USER}:" "${REPO_DIR}/deploy/deploy.env" 2> /dev/null || true
    chmod 600 "${REPO_DIR}/deploy/deploy.env"
    echo "Created deploy/deploy.env from the example. Edit it if you need to."
fi

# The unit makes ~/.docker writable only if it exists when the service starts
sudo -u "$DEPLOY_USER" mkdir -p "${USER_HOME}/.docker"

render() {
    sed -e "s|@REPO_DIR@|${REPO_DIR}|g" -e "s|@DEPLOY_USER@|${DEPLOY_USER}|g" \
        -e "s|@USER_HOME@|${USER_HOME}|g" -e "s|@APPDATA@|${APPDATA}|g" "$1"
}
for unit in homelab-deploy.service homelab-deploy.path homelab-deploy.timer; do
    render "${SCRIPT_DIR}/${unit}" | sudo tee "${UNIT_DIR}/${unit}" > /dev/null
done
sudo systemctl daemon-reload
sudo systemctl enable --now homelab-deploy.path homelab-deploy.timer
echo "Installed. Doorbell watches: ${APPDATA}/deploy-hook/trigger"
echo "Check with: systemctl status homelab-deploy.path; systemctl list-timers homelab-deploy.timer"
