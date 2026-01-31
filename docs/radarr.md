# Radarr

Radarr is a movie collection manager that automates downloading, organizing, and managing your movie library.

## Official Documentation

- [Radarr Website](https://radarr.video/)
- [Radarr Wiki](https://wiki.servarr.com/radarr)
- [LinuxServer Radarr Image](https://docs.linuxserver.io/images/docker-radarr/)

## Ports

| Port | Protocol | Description |
| ---- | -------- | ----------- |
| 7878 | TCP      | Web UI      |

## Volumes

| Container Path | Description                       |
| -------------- | --------------------------------- |
| `/config`      | Radarr configuration and database |
| `/data`        | Root path for media and downloads |

## Configuration

### Initial Setup

1. Access Radarr at `http://<server-ip>:7878`
2. Set up authentication (Settings → General → Security)
3. Configure root folder: `/data/media/movies`

### Download Client

1. Go to Settings → Download Clients
2. Add qBittorrent:
   - Host: `qbittorrent`
   - Port: `8080`
   - Username/Password: as configured in qBittorrent

### Indexers

Indexers are managed through Prowlarr. Once Prowlarr is configured, it syncs indexers automatically.

### Quality Profiles

Configure quality profiles based on your preferences (Settings → Profiles). Common profiles:

- **HD-1080p**: Prefer 1080p Bluray
- **Ultra-HD**: Prefer 4K when available

## Integration with Other Services

- **Prowlarr**: Provides indexer management
- **qBittorrent**: Downloads movies
- **Plex**: Media server for streaming
- **Overseerr**: Request portal for users

## Data Directories

```
${APPDATA}/radarr/        # Config and database
${DATA_DIR}/media/movies/ # Movie library (root folder)
${DATA_DIR}/torrents/     # Download location
```
