# Netdata

Netdata is a real-time performance and health monitoring solution for systems and applications with beautiful dashboards.

## Official Documentation

- [Netdata Website](https://www.netdata.cloud/)
- [Netdata Documentation](https://learn.netdata.cloud/)
- [Netdata GitHub](https://github.com/netdata/netdata)

## Ports

| Port  | Protocol | Description |
| ----- | -------- | ----------- |
| 19999 | TCP      | Web UI      |

## Volumes

| Container Path         | Description                            |
| ---------------------- | -------------------------------------- |
| `/etc/netdata`         | Configuration files                    |
| `/var/lib/netdata`     | Database and state                     |
| `/var/cache/netdata`   | Cache                                  |
| `/host/*`              | Host system mounts (read-only)         |
| `/var/run/docker.sock` | Docker socket for container monitoring |

## Configuration

### Initial Setup

1. Access Netdata at `http://<server-ip>:19999`
2. No login required by default (configure if exposing externally)

### Capabilities

The container requires special capabilities for full system monitoring:

- `SYS_PTRACE`: Process monitoring
- `SYS_ADMIN`: System-level metrics
- `pid: host`: Host process visibility

### Cloud Connection (Optional)

To connect to Netdata Cloud for remote access:

1. Create account at [netdata.cloud](https://app.netdata.cloud/)
2. Get claiming token
3. Run claim command inside container

### Custom Dashboards

Configure custom dashboards in `/etc/netdata/netdata.conf`:

- Adjust data retention
- Configure alerts
- Add custom charts

## What It Monitors

- **System**: CPU, memory, disk, network
- **Docker**: Container metrics
- **Applications**: Per-process resource usage
- **Services**: Web servers, databases, etc.

## Data Directories

```
${APPDATA}/netdata/config/  # Configuration
${APPDATA}/netdata/lib/     # Database
${APPDATA}/netdata/cache/   # Cache
```

## Alerts

Configure alerts in `/etc/netdata/health.d/`:

- CPU usage thresholds
- Disk space warnings
- Memory pressure alerts

## Tips

- The web UI is read-only by default
- Historical data is stored locally
- Consider connecting to Netdata Cloud for remote access
- Docker container metrics require the Docker socket mount
