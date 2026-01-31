# Overseerr

Overseerr is a request management and media discovery tool that integrates with Plex, Radarr, and Sonarr to allow users to request new content.

## Official Documentation

- [Overseerr Website](https://overseerr.dev/)
- [Overseerr Documentation](https://docs.overseerr.dev/)
- [LinuxServer Overseerr Image](https://docs.linuxserver.io/images/docker-overseerr/)

## Ports

| Port | Protocol | Description |
| ---- | -------- | ----------- |
| 5055 | TCP      | Web UI      |

## Volumes

| Container Path | Description                          |
| -------------- | ------------------------------------ |
| `/config`      | Overseerr configuration and database |

## Configuration

### Initial Setup

1. Access Overseerr at `http://<server-ip>:5055`
2. Sign in with your Plex account
3. Select your Plex server
4. Sync libraries (Movies and TV Shows)

### Connecting to Radarr

1. Go to Settings → Services → Radarr
2. Add server:
   - Default Server: Enable
   - Server Name: Radarr
   - Hostname: `radarr`
   - Port: `7878`
   - API Key: (from Radarr Settings → General)
   - Quality Profile: Select preferred
   - Root Folder: `/data/media/movies`

### Connecting to Sonarr

1. Go to Settings → Services → Sonarr
2. Add server:
   - Default Server: Enable
   - Server Name: Sonarr
   - Hostname: `sonarr`
   - Port: `8989`
   - API Key: (from Sonarr Settings → General)
   - Quality Profile: Select preferred
   - Root Folder: `/data/media/series`

### User Management

- Users can sign in with Plex accounts
- Configure permissions per user (request limits, auto-approve, etc.)
- Set up notifications for request status updates

## Integration with Other Services

- **Plex**: Authentication and library sync
- **Radarr**: Movie requests
- **Sonarr**: TV show requests

## Data Directories

```
${APPDATA}/overseerr/  # Config and database
```
