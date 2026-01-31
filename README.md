# Homelab

A Docker Compose stack for running a complete home media server with automated downloads, photo management, and system monitoring.

## Services Overview

| Service                             | Port  | Description                    |
| ----------------------------------- | ----- | ------------------------------ |
| [Plex](docs/plex.md)                | 32400 | Media streaming server         |
| [Radarr](docs/radarr.md)            | 7878  | Movie collection manager       |
| [Sonarr](docs/sonarr.md)            | 8989  | TV series collection manager   |
| [Prowlarr](docs/prowlarr.md)        | 9696  | Indexer manager for \*arr apps |
| [qBittorrent](docs/qbittorrent.md)  | 8080  | Torrent download client        |
| [Overseerr](docs/overseerr.md)      | 5055  | Media request portal           |
| [Immich](docs/immich.md)            | 2283  | Photo & video management       |
| [Dashy](docs/dashy.md)              | 4000  | Dashboard for all services     |
| [Netdata](docs/netdata.md)          | 19999 | System monitoring              |
| [File Browser](docs/filebrowser.md) | 8181  | Web-based file manager         |

## Quick Start

```bash
# Clone the repository
git clone https://github.com/<your-username>/homelab.git
cd homelab

# Configure environment (edit with your values)
cp .env.example .env

# Run setup script to create directories
./setup.sh

# Start services
docker compose up -d
```

## Environment Variables

Create a `.env` file with these variables:

```ini
# User/Group IDs (run `id` to find yours)
PUID=1000
PGID=1000

# Timezone
TZ=America/Toronto

# Paths
APPDATA=./appdata
DATA_DIR=/srv/data
HOST_ADDR=10.0.0.100

# Immich
IMMICH_VERSION=release
UPLOAD_LOCATION=/srv/data/media/photos
DB_DATA_LOCATION=./appdata/immich/postgres
DB_PASSWORD=your-secure-password
DB_USERNAME=postgres
DB_DATABASE_NAME=immich
```

## Data Directory Structure

The stack expects this structure for media storage:

```
${DATA_DIR}/
├── media/
│   ├── movies/           # Radarr moves completed movies here
│   └── series/           # Sonarr moves completed series here
└── torrents/
    └── incomplete/       # Active downloads
```

For photos (Immich):

```
${UPLOAD_LOCATION}/       # Photo and video uploads
```

## Manual Setup Steps

### 1. Storage Configuration

Mount your storage drives persistently:

```bash
# Find drive UUIDs
sudo blkid

# Add to /etc/fstab
echo "UUID=<your-uuid>  /srv/data  ext4  defaults  0  2" | sudo tee -a /etc/fstab

# Mount
sudo mount -a
```

### 2. Initial Directory Setup

```bash
# Run the setup script
chmod +x setup.sh
./setup.sh
```

This creates all required directories under `appdata/` and the data directories.

### 3. Configure Services

After starting the stack, each service needs initial configuration:

1. **Plex**: Sign in with Plex account, add libraries
2. **qBittorrent**: Change default password, configure download paths
3. **Radarr/Sonarr**: Add root folders, connect to qBittorrent
4. **Prowlarr**: Add indexers, connect to Radarr/Sonarr
5. **Overseerr**: Connect to Plex, Radarr, and Sonarr
6. **Immich**: Create admin account, configure backup

See individual [service documentation](docs/) for detailed setup instructions.

For advanced configuration, check [TRaSH Guides](https://trash-guides.info/) - comprehensive guides for Radarr, Sonarr, Prowlarr, qBittorrent, and Plex with optimal settings tested by thousands of users.

## Common Commands

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f radarr

# Restart a service
docker compose restart sonarr

# Update all containers
docker compose pull && docker compose up -d

# Check container status
docker compose ps
```

## Network

All services run on a shared `homelab` Docker network, allowing them to communicate using container names as hostnames (e.g., `http://radarr:7878`).

## Backups

Critical data to backup:

| Data            | Location              | Priority                      |
| --------------- | --------------------- | ----------------------------- |
| Service configs | `./appdata/`          | High                          |
| Immich database | `${DB_DATA_LOCATION}` | High                          |
| Photos/Videos   | `${UPLOAD_LOCATION}`  | Critical                      |
| Media library   | `${DATA_DIR}/media/`  | Medium (can be re-downloaded) |

## Security Considerations

- Change all default passwords
- Don't expose services directly to the internet
- Use a reverse proxy with HTTPS for external access
- Keep containers updated regularly
- Review container capabilities (especially Netdata)

## Troubleshooting

### Permission Issues

Ensure PUID/PGID in `.env` match your user:

```bash
id  # Shows your uid and gid
```

### Container Can't Access Files

Verify ownership:

```bash
ls -la appdata/
ls -la /srv/data/
```

### Service Discovery Issues

Containers communicate via Docker network. Use container names, not `localhost`:

- Correct: `http://radarr:7878`
- Wrong: `http://localhost:7878`
