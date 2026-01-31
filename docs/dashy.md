# Dashy

Dashy is a self-hosted dashboard for your homelab with automatic service discovery and customizable widgets.

## Official Documentation

- [Dashy Website](https://dashy.to/)
- [Dashy Documentation](https://dashy.to/docs/)
- [Dashy GitHub](https://github.com/Lissy93/dashy)

## Ports

| Port | Protocol | Description                         |
| ---- | -------- | ----------------------------------- |
| 4000 | TCP      | Web UI (mapped from container 8080) |

## Volumes

| Container Path            | Description                 |
| ------------------------- | --------------------------- |
| `/app/user-data/conf.yml` | Dashboard configuration     |
| `/app/public`             | Custom assets (icons, etc.) |

## Configuration

### Initial Setup

1. Access Dashy at `http://<server-ip>:4000`
2. Configuration is managed through `conf.yml`

### Configuration File

Create `${APPDATA}/dashy/conf.yml`:

```yaml
pageInfo:
  title: Homelab
  description: My Home Server Dashboard

sections:
  - name: Media
    items:
      - title: Plex
        url: http://server-ip:32400/web
        icon: png/plex.png
      - title: Overseerr
        url: http://server-ip:5055
        icon: png/overseerr.png

  - name: Management
    items:
      - title: Radarr
        url: http://server-ip:7878
        icon: png/radarr.png
      - title: Sonarr
        url: http://server-ip:8989
        icon: png/sonarr.png
```

### Dashy Docker Sync

The `dashy-docker-sync` container automatically discovers Docker containers and adds them to the dashboard based on labels:

```yaml
labels:
  - dashy=include # Include in dashboard
  - dashy.name=Service Name # Display name
  - dashy.port=8080 # Service port
  - dashy.icon=png/icon.png # Icon
  - dashy.url=http://... # Custom URL
  - dashy.ignore=true # Exclude from dashboard
```

## Integration with Other Services

All services with `dashy=include` label are automatically added to the dashboard.

## Data Directories

```
${APPDATA}/dashy/conf.yml  # Configuration file
${APPDATA}/dashy/assets/   # Custom icons and assets
```

## Tips

- Use [Dashboard Icons](https://github.com/walkxcode/dashboard-icons) for consistent service icons
- Configure widgets for status checks and quick actions
- Set up authentication if exposing externally
