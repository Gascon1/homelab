# Sonarr

Sonarr is a TV series collection manager that automates downloading, organizing, and managing your TV show library.

## Official Documentation

- [Sonarr Website](https://sonarr.tv/)
- [Sonarr Wiki](https://wiki.servarr.com/sonarr)
- [LinuxServer Sonarr Image](https://docs.linuxserver.io/images/docker-sonarr/)

## Ports

| Port | Protocol | Description |
| ---- | -------- | ----------- |
| 8989 | TCP      | Web UI      |

## Volumes

| Container Path | Description                       |
| -------------- | --------------------------------- |
| `/config`      | Sonarr configuration and database |
| `/data`        | Root path for media and downloads |

## Configuration

### Initial Setup

1. Access Sonarr at `http://<server-ip>:8989`
2. Set up authentication (Settings → General → Security)
3. Configure root folder: `/data/media/series`

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

- **HD-1080p**: Prefer 1080p releases
- **Any**: Accept any quality

## Integration with Other Services

- **Prowlarr**: Provides indexer management
- **qBittorrent**: Downloads TV shows
- **Plex**: Media server for streaming
- **Overseerr**: Request portal for users

## Data Directories

```
${APPDATA}/sonarr/        # Config and database
${DATA_DIR}/media/series/ # TV series library (root folder)
${DATA_DIR}/torrents/     # Download location
```
