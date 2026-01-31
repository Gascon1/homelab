# Plex

Plex is a media server that organizes and streams your personal media collection (movies, TV shows, music, photos) to any device.

## Official Documentation

- [Plex Website](https://www.plex.tv/)
- [Plex Support](https://support.plex.tv/)
- [LinuxServer Plex Image](https://docs.linuxserver.io/images/docker-plex/)

## TRaSH Guides

- [Plex - Suggested Media Server Settings](https://trash-guides.info/Plex/Tips/Plex-media-server/) - Optimal server configuration
- [Plex - Optimal Client Settings](https://trash-guides.info/Plex/Tips/Plex-Clients/) - Best client settings
- [Plex - Stop 4K Transcoding](https://trash-guides.info/Plex/Tips/Plex-4k-transcoding/) - Prevent unnecessary transcoding

## Ports

| Port        | Protocol | Description    |
| ----------- | -------- | -------------- |
| 32400       | TCP      | Web UI and API |
| 1900        | UDP      | SSDP discovery |
| 32410-32414 | UDP      | GDM discovery  |
| 32469       | TCP      | DLNA           |

## Volumes

| Container Path | Description                             |
| -------------- | --------------------------------------- |
| `/config`      | Plex configuration and library database |
| `/data`        | Media files (movies, series, etc.)      |

## Configuration

### Initial Setup

1. Access Plex at `http://<server-ip>:32400/web`
2. Sign in with your Plex account
3. Name your server
4. Add libraries pointing to:
   - Movies: `/data/media/movies`
   - TV Shows: `/data/media/series`

### Claiming the Server

On first run, you may need to claim the server. You can either:

- Access the web UI from the server's local network
- Set `PLEX_CLAIM` environment variable with a claim token from [plex.tv/claim](https://www.plex.tv/claim/)

### Remote Access

Configure remote access in Settings → Remote Access. The `ADVERTISE_IP` environment variable helps clients discover the correct address.

## Integration with Other Services

- **Radarr/Sonarr**: Automatically scans for new media when downloads complete
- **Overseerr**: Users can request media that gets automatically added

## Data Directories

```
${APPDATA}/plex/          # Config and database
${DATA_DIR}/media/movies/ # Movie library
${DATA_DIR}/media/series/ # TV series library
```
