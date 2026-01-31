# qBittorrent

qBittorrent is a free, open-source BitTorrent client with a web interface for remote management.

## Official Documentation

- [qBittorrent Website](https://www.qbittorrent.org/)
- [qBittorrent Wiki](https://github.com/qbittorrent/qBittorrent/wiki)
- [LinuxServer qBittorrent Image](https://docs.linuxserver.io/images/docker-qbittorrent/)

## TRaSH Guides

- [qBittorrent - Basic Setup](https://trash-guides.info/Downloaders/qBittorrent/Basic-Setup/) - Initial configuration
- [qBittorrent - Paths](https://trash-guides.info/Downloaders/qBittorrent/Paths/) - Proper path configuration
- [qBittorrent - How to Add Categories](https://trash-guides.info/Downloaders/qBittorrent/How-to-add-categories/) - Category setup for Radarr/Sonarr
- [qBittorrent - Port Forwarding](https://trash-guides.info/Downloaders/qBittorrent/Port-forwarding/) - Improve connectivity
- [Hardlinks and Instant Moves](https://trash-guides.info/Hardlinks/Hardlinks-and-Instant-Moves/) - Proper folder structure

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

## VPN Recommendation

Using a VPN with qBittorrent is strongly recommended for privacy. Many VPN providers offer SOCKS5 proxy support that can be configured directly in qBittorrent without affecting other services.

**Example: NordVPN**

NordVPN provides SOCKS5 proxy servers that can be configured in qBittorrent:

- [NordVPN proxy setup for qBittorrent](https://support.nordvpn.com/hc/en-us/articles/20195967385745-NordVPN-proxy-setup-for-qBittorrent)

Quick setup:

1. Go to Tools → Options → Connection
2. Set Type: `SOCKS5`
3. Host: `nl.socks.nordhold.net` (or other NordVPN proxy server)
4. Port: `1080`
5. Enable "Use proxy for peer connections"
6. Enter your NordVPN service credentials (from your Nord Account dashboard)

Verify your setup at [ipleak.net](https://ipleak.net/) using the Torrent Address detection feature.
