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
| [Seerr](docs/seerr.md)              | 5055  | Media request portal           |
| [Immich](docs/immich.md)            | 2283  | Photo & video management       |
| [Rack](docs/rack.md)                | 4000  | Dashboard for all services     |
| [Netdata](docs/netdata.md)          | 19999 | System monitoring              |

FlareSolverr (8191) is not published on the host; Prowlarr reaches it at `http://flaresolverr:8191` over the `homelab` network. Web UIs are published on `BIND_ADDR` (default all interfaces); Plex and the qBittorrent torrent ports always stay on all interfaces.

## Quick Start

```bash
# Clone the repository
git clone https://github.com/<your-username>/homelab.git
cd homelab

# Configure environment (edit with your values)
cp .env.example .env

# Run setup script to create directories
./setup.sh

# Start services (Rack is built locally, so --build is needed the first time)
docker compose up -d --build
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

# Publish web UIs on this address only (your LAN IP, e.g. 192.168.1.10)
BIND_ADDR=0.0.0.0

# Immich
IMMICH_VERSION=release
UPLOAD_LOCATION=/srv/data/media/photos
DB_DATA_LOCATION=./appdata/immich/postgres
DB_PASSWORD=your-secure-password
DB_USERNAME=postgres
DB_DATABASE_NAME=immich

# Rack (optional, see docs/rack.md)
RACK_IMMICH_API_KEY=
RACK_QBITTORRENT_USERNAME=
RACK_QBITTORRENT_PASSWORD=
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

`DATA_DIR` is a mergerfs pool of one ext4 filesystem per HDD. For how the pool places files and how to add a disk, see [docs/storage.md](docs/storage.md).

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
5. **Seerr**: Connect to Plex, Radarr, and Sonarr
6. **Immich**: Create admin account, configure backup

See individual [service documentation](docs/) for detailed setup instructions.

For advanced configuration, check [TRaSH Guides](https://trash-guides.info/) - comprehensive guides for Radarr, Sonarr, Prowlarr, qBittorrent, and Plex with optimal settings tested by thousands of users.

## Adding a new service

`compose.yml` is the source of truth for ports and appdata paths. `scripts/check-exposure.sh` reads it, so it needs no edit unless the service must never be public. The Caddyfile and the tailnet policy are deliberate allowlists, so they are edited by hand. Touch these files:

1. `compose.yml`: the service, its port (`'${BIND_ADDR:-0.0.0.0}:PORT:PORT'`), `logging: *logging`, and the `rack.enable=true` label if Rack should list it.
2. `setup.sh`: add its appdata directory to `APPDATA_DIRS`.
3. `.env.example`: any new variables (and the README variable list).
4. `caddy/Caddyfile`: a site block, if it should be reachable over the tailnet.
5. `docs/remote-access/tailscale-policy.example.hujson`: only if the family group should reach it (and add a test).
6. `scripts/check-exposure.sh`: add the port to `RISKY_PORTS` if it must never be on all interfaces.
7. `README.md` services table and `docs/<service>.md`.
8. `rack/`: only if Rack needs a custom integration (the catalog entry).

Check with `docker compose config -q` and `scripts/check-exposure.sh`.

## Common Commands

```bash
# Start all services
docker compose up -d --build

# Stop all services
docker compose down

# View logs
docker compose logs -f

# View logs for specific service
docker compose logs -f radarr

# Restart a service
docker compose restart sonarr

# Update all containers (--build also rebuilds Rack)
docker compose pull && docker compose up -d --build

# Same, including the remote-access containers (not needed if COMPOSE_PROFILES=remote is in .env)
docker compose --profile remote pull && docker compose --profile remote up -d --build

# One-time migration from Dashy: removes the old dashy containers
# (appdata/dashy can be deleted afterwards)
docker compose up -d --build --remove-orphans

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

## Remote Access

Remote access goes through [Tailscale](https://tailscale.com) (a private WireGuard network), not open router ports. Two opt-in containers do this: `tailscale` joins your tailnet and `caddy` serves every app over HTTPS at `https://<TS_HOSTNAME>.<TS_TAILNET>:<usual port>` (the plain `https://<TS_HOSTNAME>.<TS_TAILNET>` is a static family homepage from `caddy/family/`; Rack is admin only on `:4000`). FlareSolverr is never exposed.

Set the `TS_*` variables in `.env`, then:

```bash
docker compose --profile remote up -d
```

Set `COMPOSE_PROFILES=remote` in `.env` to include them in every command. See [docs/remote-access/](docs/remote-access/) for the security report and setup steps.

## Automatic Deploys

A systemd timer on the server can deploy each change merged to `main` once its GitHub `release` check is green, and roll back if the stack does not start. The server pulls from GitHub; nothing connects in. See [docs/deploy.md](docs/deploy.md) and Part D of [MANUAL-STEPS](docs/remote-access/MANUAL-STEPS.md).

## Security Considerations

- Change all default passwords
- Don't expose services directly to the internet
- For access away from home use the Tailscale + Caddy setup (see Remote Access), not router port forwards
- In Radarr, Sonarr and Prowlarr set Authentication Required to "Enabled", not "Disabled for Local Addresses": behind Caddy every request looks local
- Keep containers updated regularly
- Review container capabilities (especially Netdata)
- Set `BIND_ADDR` in `.env` to your LAN IP so web UIs are not published on every interface. Docker-published ports bypass ufw, so a firewall alone does not protect them.
- Run `./scripts/check-exposure.sh` to list listening sockets and published ports; it exits non-zero if Rack, Netdata or FlareSolverr are on all interfaces. `--external <public-ip>` adds an nmap scan (run it from outside your LAN).
- Immich only receives the DB variables it needs, not the whole `.env`, so the `RACK_*` keys stay out of its containers.
- Netdata data now lives under `${APPDATA}/netdata`. With the default `APPDATA=./appdata` nothing changes; if you set a different `APPDATA`, move your old `./appdata/netdata` there.

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
