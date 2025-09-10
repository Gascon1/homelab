# 🏡 Homelab Media Server

This repository contains the **Docker Compose setup** and supporting file structure for my home server. It runs on Ubuntu Server and provides a complete **media management stack**: Plex, Radarr, Sonarr, Prowlarr, qBittorrent, Overseerr, Homarr, and more.

---

## 📂 Repository Structure

```
homelab/                  # Git repo root
├── compose.yml           # Main Docker Compose stack
├── .env                  # Environment variables (UID, GID, TZ)
├── .gitignore            # Excludes secrets & configs
├── appdata/              # Container config data (not committed to git)
│   ├── plex/             # Plex config + Library DB
│   ├── qbittorrent/      # qBittorrent config
│   ├── radarr/           # Radarr config
│   ├── sonarr/           # Sonarr config
│   ├── prowlarr/         # Prowlarr config
│   ├── overseerr/        # Overseerr config
│   └── homarr/           # Homarr configs, icons, and data
└── README.md             # You are here
```

External storage lives outside the repo:

```
/srv/data1/
├── media/
│   ├── movies/
│   └── series/
└── torrents/
    ├── movies/
    └── series/

/srv/data2/
├── photos/
└── videos/
```

---

## ⚙️ Setup

### 1. Clone the Repo

```bash
git clone https://github.com/<your-username>/homelab.git ~/homelab
cd ~/homelab
```

### 2. Install Requirements

On the server:

```bash
sudo apt update && sudo apt install -y \
  docker.io docker-compose-plugin git curl zsh htop ufw
```

### 3. Configure Storage

Partition/format drives as ext4, then mount persistently in `/etc/fstab`:

```
UUID=<uuid-of-hdd1>  /srv/data1  ext4  defaults  0  2
UUID=<uuid-of-hdd2>  /srv/data2  ext4  defaults  0  2
```

Mount and set ownership so both your user (`mikel`) and Docker containers (PUID=1000) can read/write:

```bash
sudo mount -a
sudo chown -R mikel:mikel /srv/data1 /srv/data2
```

### 4. Environment Variables

Create `.env` in the repo root:

```ini
PUID=1000
PGID=1000
TZ=America/Montreal
```

### 5. Appdata

Create config directories (excluded from git):

```bash
mkdir -p appdata/{plex,qbittorrent,radarr,sonarr,prowlarr,overseerr,homarr/{configs,icons,data}}
```

If migrating from another machine, `rsync` existing configs into these directories before starting.

---

## 🚀 Usage

### Bring Services Up

```bash
docker compose up -d
```

### Stop Services

```bash
docker compose down
```

### Logs

```bash
docker compose logs -f --timestamps
```

### Service Ports

- Plex → **host network** (accessible at `http://server-ip:32400/web`)
- qBittorrent → `http://server-ip:8080`
- Radarr → `http://server-ip:7878`
- Sonarr → `http://server-ip:8989`
- Prowlarr → `http://server-ip:9696`
- Overseerr → `http://server-ip:5055`
- Homarr → `http://server-ip:7575`

---

## 📦 Services Overview

- **Plex** → Media streaming (movies, series, photos, videos). Uses `/srv/data1/media` and `/srv/data2/photos|videos`.
- **qBittorrent** → Torrent client. Downloads into `/srv/data1/torrents`.
- **Radarr** → Movie management. Moves downloads → `/srv/data1/media/movies`.
- **Sonarr** → Series management. Moves downloads → `/srv/data1/media/series`.
- **Prowlarr** → Indexer aggregator. Connects Radarr/Sonarr to torrent indexers.
- **Overseerr** → Media request portal. Requests auto-route to Radarr/Sonarr.
- **Homarr** → Dashboard for all services.

---

## 🔐 Security

- UFW firewall is enabled by default. Open only required ports.
- SSH hardened: root login disabled, key-based login recommended.
- Containers run as `PUID=1000` / `PGID=1000` → matches user `mikel`.

---

## 🔄 Backups

- Backup `~/homelab/appdata/` regularly (contains all service configs, Plex DB, etc.).
- Backup `/srv/data1` and `/srv/data2` according to importance (media can often be redownloaded, photos/videos cannot).

---

## 🛠️ Development Notes

- **Keep `compose.yml` and appdata under version control** → easy rebuilds/migrations.
- **Don’t commit appdata/** or `.env` (secrets, large DBs).
- **Extend with new stacks** by adding YAML files under `stacks/` and including them in `docker compose`.

---

## ✅ Checklist for New Install

1. Install Ubuntu Server, set up SSH.
2. Update system + install Docker & Compose.
3. Partition & mount drives (`/srv/data1`, `/srv/data2`).
4. Clone repo → `~/homelab`.
5. Create `.env` and `appdata/` dirs.
6. Restore configs via rsync (if migrating).
7. `docker compose up -d`.
8. Access services via browser → configure libraries and integrations.
