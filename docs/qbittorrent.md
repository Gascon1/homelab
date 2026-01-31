# qBittorrent

qBittorrent is a free, open-source BitTorrent client with a web interface for remote management.

## Official Documentation

- [qBittorrent Website](https://www.qbittorrent.org/)
- [qBittorrent Wiki](https://github.com/qbittorrent/qBittorrent/wiki)
- [LinuxServer qBittorrent Image](https://docs.linuxserver.io/images/docker-qbittorrent/)

## Ports

| Port | Protocol | Description        |
| ---- | -------- | ------------------ |
| 8080 | TCP      | Web UI             |
| 6881 | TCP/UDP  | BitTorrent traffic |

## Volumes

| Container Path   | Description               |
| ---------------- | ------------------------- |
| `/config`        | qBittorrent configuration |
| `/data/torrents` | Download directory        |

## Configuration

### Initial Setup

1. Access qBittorrent at `http://<server-ip>:8080`
2. Default credentials:
   - Username: `admin`
   - Password: Check container logs for temporary password, or set in config
3. Change the default password immediately

### Recommended Settings

#### Downloads

- Default Save Path: `/data/torrents`
- Keep incomplete torrents in: `/data/torrents/incomplete`

#### Connection

- Listening Port: 6881 (ensure port forwarding on router)

#### BitTorrent

- Enable DHT, PeX, and Local Peer Discovery for better connectivity

#### Web UI

- Change default username and password
- Enable HTTPS if exposing externally

### Categories for Automation

Create categories for Radarr and Sonarr:

1. Go to Categories (right-click in sidebar)
2. Add `radarr` category with save path `/data/torrents/movies`
3. Add `sonarr` category with save path `/data/torrents/series`

## Integration with Other Services

- **Radarr**: Sends movie downloads
- **Sonarr**: Sends TV show downloads
- **Prowlarr**: Provides indexer configuration

## Data Directories

```
${APPDATA}/qbittorrent/   # Config
${DATA_DIR}/torrents/     # Download directory
```

## Troubleshooting

### Slow Speeds

- Ensure port 6881 is forwarded on your router
- Check if your ISP throttles BitTorrent traffic
- Verify connection limits aren't too restrictive
