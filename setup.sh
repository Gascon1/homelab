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

# Load environment variables if .env exists
if [[ -f "${SCRIPT_DIR}/.env" ]]; then
    log_info "Loading environment from .env"
    set -a
    source "${SCRIPT_DIR}/.env"
    set +a
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
    "${APPDATA}/radarr"
    "${APPDATA}/sonarr"
    "${APPDATA}/prowlarr"
    "${APPDATA}/overseerr"

    # Dashboard
    "${APPDATA}/dashy"
    "${APPDATA}/dashy/assets"

    # Monitoring
    "${APPDATA}/netdata/config"
    "${APPDATA}/netdata/lib"
    "${APPDATA}/netdata/cache"

    # File management
    "${APPDATA}/filebrowser/config"
    "${APPDATA}/filebrowser/database"

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
# Create default Dashy config if not exists
# =============================================================================

DASHY_CONFIG="${APPDATA}/dashy/conf.yml"
if [[ ! -f "${DASHY_CONFIG}" ]]; then
    log_info "Creating default Dashy configuration..."
    cat > "${DASHY_CONFIG}" << 'EOF'
pageInfo:
  title: Homelab
  description: Home Server Dashboard
  navLinks: []

appConfig:
  theme: nord-frost
  layout: auto
  iconSize: medium
  language: en

sections:
  - name: Docker Apps
    displayData:
      collapsed: false
      rows: 2
    items: []
EOF
    log_info "Created: ${DASHY_CONFIG}"
fi

# =============================================================================
# Set ownership
# =============================================================================

log_info "Setting ownership to ${PUID}:${PGID}..."

# Only set ownership on directories we created (avoid changing external mounts)
chown -R "${PUID}:${PGID}" "${APPDATA}" 2>/dev/null || log_warn "Could not set ownership on ${APPDATA} (may need sudo)"

if [[ -d "${DATA_DIR}" ]]; then
    chown -R "${PUID}:${PGID}" "${DATA_DIR}" 2>/dev/null || log_warn "Could not set ownership on ${DATA_DIR} (may need sudo)"
fi

if [[ -d "${UPLOAD_LOCATION}" ]]; then
    chown -R "${PUID}:${PGID}" "${UPLOAD_LOCATION}" 2>/dev/null || log_warn "Could not set ownership on ${UPLOAD_LOCATION} (may need sudo)"
fi

# =============================================================================
# Create .env.example if not exists
# =============================================================================

ENV_EXAMPLE="${SCRIPT_DIR}/.env.example"
if [[ ! -f "${ENV_EXAMPLE}" ]]; then
    log_info "Creating .env.example template..."
    cat > "${ENV_EXAMPLE}" << 'EOF'
# User/Group IDs (run `id` to find yours)
PUID=1000
PGID=1000

# Timezone
TZ=America/Montreal

# Paths
APPDATA=./appdata
DATA_DIR=/srv/data
HOST_ADDR=10.0.0.100

# Immich
IMMICH_VERSION=release
UPLOAD_LOCATION=/srv/data/media/photos
DB_DATA_LOCATION=./appdata/immich/postgres
DB_PASSWORD=change-me-to-a-secure-password
DB_USERNAME=postgres
DB_DATABASE_NAME=immich
EOF
    log_info "Created: ${ENV_EXAMPLE}"
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
echo "  3. Run: docker compose up -d"
echo ""
