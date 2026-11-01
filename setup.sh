#!/usr/bin/env bash
#
# Homelab Setup Script
# Creates all required directories for the Docker Compose stack
#

set -euo pipefail

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

# Get script directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Relative paths in .env (APPDATA=./appdata) are relative to the repo, like docker compose
cd "${SCRIPT_DIR}"

# Read KEY=VALUE lines from an env file without executing it as shell code
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

# Load environment variables if .env exists
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    log_info "Loading environment from .env"
    load_env "${SCRIPT_DIR}/.env"
    chmod 600 "${SCRIPT_DIR}/.env" 2>/dev/null || log_warn "Could not restrict permissions on .env"
else
    log_warn ".env file not found. Using default values."
    log_warn "Copy .env.example to .env and configure before running docker compose."
fi

# Default values (can be overridden by .env)
APPDATA="${APPDATA:-${SCRIPT_DIR}/appdata}"
DATA_DIR="${DATA_DIR:-/srv/data}"
UPLOAD_LOCATION="${UPLOAD_LOCATION:-${DATA_DIR}/media/photos}"
DB_DATA_LOCATION="${DB_DATA_LOCATION:-${APPDATA}/immich/postgres}"
PUID="${PUID:-1000}"
PGID="${PGID:-1000}"

log_info "Creating directory structure..."
log_info "APPDATA: ${APPDATA}"
log_info "DATA_DIR: ${DATA_DIR}"

# =============================================================================
# APPDATA directories (container configurations)
# =============================================================================

APPDATA_DIRS=(
    # Media stack
    "${APPDATA}/plex"
    "${APPDATA}/qbittorrent"
    "${APPDATA}/gluetun"
    "${APPDATA}/radarr"
    "${APPDATA}/sonarr"
    "${APPDATA}/prowlarr"
    "${APPDATA}/seerr"

    # Dashboard
    "${APPDATA}/rack"

    # Monitoring
    "${APPDATA}/netdata/config"
    "${APPDATA}/netdata/lib"
    "${APPDATA}/netdata/cache"

    # Remote access (only used with the 'remote' compose profile)
    "${APPDATA}/tailscale"
    "${APPDATA}/caddy/data"
    "${APPDATA}/caddy/config"
    # Push-deploy doorbell (only used with the 'push' compose profile)
    "${APPDATA}/deploy-hook"

    # Immich database
    "${DB_DATA_LOCATION}"
)

for dir in "${APPDATA_DIRS[@]}"; do
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        log_info "Created: $dir"
    else
        log_info "Exists:  $dir"
    fi
done

# =============================================================================
# DATA directories (media and downloads)
# =============================================================================

DATA_DIRS=(
    "${DATA_DIR}/media/movies"
    "${DATA_DIR}/media/series"
    "${DATA_DIR}/torrents"
    "${DATA_DIR}/torrents/incomplete"
)

for dir in "${DATA_DIRS[@]}"; do
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        log_info "Created: $dir"
    else
        log_info "Exists:  $dir"
    fi
done

# =============================================================================
# Immich upload location
# =============================================================================

if [[ ! -d "${UPLOAD_LOCATION}" ]]; then
    mkdir -p "${UPLOAD_LOCATION}"
    log_info "Created: ${UPLOAD_LOCATION}"
else
    log_info "Exists:  ${UPLOAD_LOCATION}"
fi

# =============================================================================
# Create default Rack config if not exists
# =============================================================================

RACK_CONFIG="${APPDATA}/rack/rack.yml"
if [[ ! -f "${RACK_CONFIG}" && ! -w "${APPDATA}/rack" ]]; then
    # Docker creates a missing bind-mount folder as root, so a folder made by an
    # earlier `docker compose up` is not writable here. Rack runs without the file.
    log_warn "Skipped ${RACK_CONFIG}: ${APPDATA}/rack belongs to another user (Docker made it)."
    log_warn "To create it, run: sudo chown \"\$(id -u):\$(id -g)\" ${APPDATA}/rack && ./setup.sh"
elif [[ ! -f "${RACK_CONFIG}" ]]; then
    log_info "Creating default Rack configuration..."
    cat > "${RACK_CONFIG}" << 'EOF'
title: Homelab

# groups: [Media, Downloads, Photos, System] # display order
#
# services:                               # keyed by service id
#   plex:
#     name: Plex
#     group: Media
#     description: Films and TV
#     icon: plex
#     url: http://plex.lan
#     port: 32400
#     path: /web
#     order: 1
#     hidden: false
#   nas:                                  # an id with no container = static entry
#     name: NAS
#     group: System
#     url: http://10.0.0.5:5000
#
# bookmarks:
#   - { name: Router, url: http://10.0.0.1, group: Network }
#
# disks:
#   - { path: /mnt/data, label: media }
EOF
    log_info "Created: ${RACK_CONFIG}"
fi

# =============================================================================
# Set ownership
# =============================================================================

log_info "Setting ownership to ${PUID}:${PGID}..."

# Only the folders of containers that run as PUID:PGID. Never chown all of APPDATA:
# Postgres (DB_DATA_LOCATION) refuses to start if its data folder changes owner,
# Netdata uses its own user, and Rack, Tailscale and Caddy run as root.
PUID_DIRS=(
    "${APPDATA}/plex"
    "${APPDATA}/qbittorrent"
    "${APPDATA}/radarr"
    "${APPDATA}/sonarr"
    "${APPDATA}/prowlarr"
    "${APPDATA}/seerr"
    "${APPDATA}/deploy-hook"
)
for dir in "${PUID_DIRS[@]}"; do
    chown -R "${PUID}:${PGID}" "$dir" 2>/dev/null || log_warn "Could not set ownership on $dir (may need sudo)"
done
# gluetun runs as root; its folder holds the NordVPN WireGuard key
chmod 700 "${APPDATA}/gluetun" 2>/dev/null || log_warn "Could not restrict permissions on ${APPDATA}/gluetun"
if [[ ! -f "${APPDATA}/gluetun/wireguard_private_key" ]]; then
    log_warn "Missing ${APPDATA}/gluetun/wireguard_private_key: gluetun and qBittorrent will not start. See docs/qbittorrent.md"
fi
# Tailscale state holds the node's private key
chmod 700 "${APPDATA}/tailscale" 2>/dev/null || log_warn "Could not restrict permissions on ${APPDATA}/tailscale"

if [[ -d "${DATA_DIR}" ]]; then
    chown -R "${PUID}:${PGID}" "${DATA_DIR}" 2>/dev/null || log_warn "Could not set ownership on ${DATA_DIR} (may need sudo)"
fi

if [[ -d "${UPLOAD_LOCATION}" ]]; then
    chown -R "${PUID}:${PGID}" "${UPLOAD_LOCATION}" 2>/dev/null || log_warn "Could not set ownership on ${UPLOAD_LOCATION} (may need sudo)"
fi

# =============================================================================
# Check .env.example (the only template; do not keep a second copy in this script)
# =============================================================================

if [[ ! -f "${SCRIPT_DIR}/.env.example" ]]; then
    log_warn ".env.example is missing. Restore it with: git checkout .env.example"
    if git -C "${SCRIPT_DIR}" show HEAD:.env.example > "${SCRIPT_DIR}/.env.example" 2>/dev/null; then
        log_info "Restored .env.example from git"
    else
        rm -f "${SCRIPT_DIR}/.env.example"
        log_warn "Could not restore it automatically (not a git checkout?)"
    fi
fi

# =============================================================================
# Summary
# =============================================================================

echo ""
log_info "Directory structure created successfully!"
echo ""
echo "Next steps:"
echo "  1. Copy .env.example to .env and configure values"
echo "  2. Review and adjust paths in .env"
echo "  3. Run: docker compose up -d --build"
echo ""
