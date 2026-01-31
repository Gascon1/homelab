# Prowlarr

Prowlarr is an indexer manager/proxy that integrates with Radarr, Sonarr, and other \*arr applications to provide centralized indexer management.

## Official Documentation

- [Prowlarr Wiki](https://wiki.servarr.com/prowlarr)
- [LinuxServer Prowlarr Image](https://docs.linuxserver.io/images/docker-prowlarr/)

## TRaSH Guides

- [Prowlarr - How to Set Up Proxy for Certain Indexers](https://trash-guides.info/Prowlarr/prowlarr-setup-proxy/) - Proxy configuration
- [Prowlarr - Indexers with Limited API](https://trash-guides.info/Prowlarr/prowlarr-setup-limited-api/) - Handle API rate limits

## Ports

| Port | Protocol | Description |
| ---- | -------- | ----------- |
| 9696 | TCP      | Web UI      |

## Volumes

| Container Path | Description                         |
| -------------- | ----------------------------------- |
| `/config`      | Prowlarr configuration and database |

## Configuration

### Initial Setup

1. Access Prowlarr at `http://<server-ip>:9696`
2. Set up authentication (Settings → General → Security)

### Adding Indexers

1. Go to Indexers → Add Indexer
2. Search for your preferred indexers
3. Configure credentials and settings for each

### Connecting to Radarr/Sonarr

1. Go to Settings → Apps
2. Add Radarr:
   - Prowlarr Server: `http://prowlarr:9696`
   - Radarr Server: `http://radarr:7878`
   - API Key: (from Radarr Settings → General)
3. Add Sonarr:
   - Prowlarr Server: `http://prowlarr:9696`
   - Sonarr Server: `http://sonarr:8989`
   - API Key: (from Sonarr Settings → General)

## Integration with Other Services

- **Radarr**: Syncs movie indexers
- **Sonarr**: Syncs TV show indexers

## Data Directories

```
${APPDATA}/prowlarr/  # Config and database
```
