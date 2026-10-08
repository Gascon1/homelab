# Rack

Rack is the dashboard for this stack. It is built for this repo (source in `rack/`). It lists your containers, checks that each one is responding, shows live stats for the media apps, and shows host CPU, memory, load and disk usage.

## Ports

| Port | Protocol | Description |
| ---- | -------- | ----------- |
| 4000 | TCP      | Web UI      |

## Volumes

| Container Path                                 | Description                                                 |
| ---------------------------------------------- | ----------------------------------------------------------- |
| `/config`                                      | `rack.yml` and the icon cache (`${APPDATA}/rack`)           |
| `/var/run/docker.sock`                         | Docker socket to list containers (read-only mount)          |
| `/appdata/{sonarr,radarr,prowlarr,seerr,plex}` | Other apps' config dirs, to find their API keys (read-only) |
| `/mnt/data`                                    | `${DATA_DIR}` for disk usage (read-only)                    |

## Building

Rack is built locally from `rack/` rather than pulled from a registry:

```bash
docker compose up -d --build
```

Run the same command after updating the repo to rebuild Rack.

## Configuration

### Initial Setup

1. Run `./setup.sh` (creates `${APPDATA}/rack/rack.yml` with `title: Homelab`)
2. Start the stack with `docker compose up -d --build`
3. Access Rack at `http://<server-ip>:4000`

### Service Discovery

Rack lists a container only if it has the label `rack.enable=true`. For known apps (Plex, Seerr, Sonarr, Radarr, Prowlarr, qBittorrent, FlareSolverr, Immich, File Browser, Netdata) that label alone is enough: the name, group, icon, widget and path come from a built-in catalog.

```yaml
labels:
  - rack.enable=true
```

All labels except `rack.enable` are optional:

| Label              | Description                                                                                     |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| `rack.enable=true` | Include this container                                                                          |
| `rack.name`        | Display name                                                                                    |
| `rack.group`       | Group name                                                                                      |
| `rack.port`        | Published (host) port for the link. Default: lowest published TCP port                          |
| `rack.path`        | Path appended to the link, e.g. `/web`                                                          |
| `rack.url`         | Full link URL, overrides port and path                                                          |
| `rack.internal`    | URL Rack uses for health checks. Default: container name and private port                       |
| `rack.icon`        | Icon slug from [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons), or a full URL |
| `rack.widget`      | Widget type, or `none`                                                                          |
| `rack.description` | One short line                                                                                  |
| `rack.order`       | Number to sort by within the group                                                              |

Unknown apps get a title-cased name, the group `Other`, an icon matching the service name, and no widget.

Links are built in your browser from the address you are visiting, so they work from any hostname or IP without configuration. If an app publishes several TCP ports and the lowest is not the web UI, set `rack.port` (qBittorrent does this because it also publishes 6881).

Settings are applied in this order: `rack.yml`, then labels, then the catalog.

### Configuration File

`${APPDATA}/rack/rack.yml` is optional. Without it everything uses defaults. It reloads when the file changes; if it has an error, Rack keeps the last working config and shows a warning.

```yaml
title: Homelab
groups: [Watch, Fetch, Keep, Machine] # display order

services: # keyed by service id
  plex:
    name: Plex
    group: Watch
    description: Films and TV
    icon: plex
    url: http://plex.lan
    port: 32400
    path: /web
    internal: http://plex:32400
    widget: plex
    order: 1
    hidden: false
  nas: # an id with no container is a static entry
    name: NAS
    group: Machine
    url: http://10.0.0.5:5000

bookmarks:
  - { name: Router, url: http://10.0.0.1, group: Network }

disks:
  - { path: /mnt/data, label: media }
```

## Live Stats

Widgets show a few live numbers per service (for example streams in Plex, download speed in qBittorrent, queue size in Sonarr). Each needs a credential:

| Service     | Credential                                  | Source              |
| ----------- | ------------------------------------------- | ------------------- |
| Plex        | Token                                       | Found automatically |
| Sonarr      | API key                                     | Found automatically |
| Radarr      | API key                                     | Found automatically |
| Prowlarr    | API key                                     | Found automatically |
| Seerr       | API key                                     | Found automatically |
| Immich      | `RACK_IMMICH_API_KEY`                       | Set in `.env`       |
| qBittorrent | `RACK_QBITTORRENT_USERNAME` and `_PASSWORD` | Set in `.env`       |

The first five are read from the read-only config mounts. To override one, set `RACK_PLEX_TOKEN`, `RACK_SONARR_API_KEY`, `RACK_RADARR_API_KEY`, `RACK_PROWLARR_API_KEY` or `RACK_SEERR_API_KEY` in `.env`.

### Immich API Key

1. Open Immich and click your avatar, then **Account Settings**
2. Open **API Keys** and click **New API Key**
3. Copy the key into `.env` as `RACK_IMMICH_API_KEY`

### qBittorrent Login

Use the Web UI username and password from qBittorrent (**Tools > Options > Web UI > Authentication**). Put them in `.env` as `RACK_QBITTORRENT_USERNAME` and `RACK_QBITTORRENT_PASSWORD`.

After editing `.env`, run `docker compose up -d` to apply the change.

## Keyboard

- Press `/` or just start typing to filter services
- Press `Enter` to open the top match

## Data Directories

```
${APPDATA}/rack/rack.yml  # Optional configuration
${APPDATA}/rack/icons/    # Icon cache
```

## Troubleshooting

### A Service Shows No Stats

The widget shows what is missing. For Immich and qBittorrent set the credentials in `.env` and run `docker compose up -d`. For the others, check that the app's config directory exists under `${APPDATA}`, or set the matching `RACK_*` variable.

### A Container Does Not Appear

Check that it has the label `rack.enable=true`, then recreate it with `docker compose up -d`. Rack refreshes its container list every 10 seconds.

### A Link Opens the Wrong Port

Rack uses the lowest published TCP port. Add `rack.port=<web UI port>` to the container's labels.

## Security

- Rack has no login. Anyone who can reach port 4000 can see your dashboard.
- The Docker socket is mounted so Rack can list containers. Rack only reads from it, but a `:ro` mount does not by itself restrict the Docker API, so a compromised Rack could still control Docker.
- Do not expose port 4000 beyond your LAN.

## Tips

- Use [Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) slugs for `rack.icon`
- The source lives in `rack/` if you want to change the dashboard
