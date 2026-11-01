# Set Up the Homelab from Scratch

This guide builds the whole homelab on a new server, from an empty disk to automatic deploys. It puts every step in order, including the steps that only you can do (accounts, secrets, router, web UIs).

Other docs have the details. This guide tells you when to do each step and links to them:

- [README](../README.md): services, variables, common commands.
- [docs/\<service\>.md](.): settings for each app.
- [remote-access/MANUAL-STEPS.md](remote-access/MANUAL-STEPS.md): Tailscale and deploy tasks. It was written for a server that already ran the stack, so this guide says which of its tasks to skip.
- [deploy.md](deploy.md): how automatic deploys work.

**Time:** about half a day. Most of it is app configuration and waiting for downloads.

---

## 0. Inventory: what you need and what you make

### Accounts

| Account | Used for | Needed? |
| --- | --- | --- |
| GitHub (with 2FA) | The repository, CI, the Rack image on GHCR, deploys | Yes |
| Plex | Plex server, Seerr sign-in | Yes |
| NordVPN | VPN for qBittorrent (gluetun) | Yes, or qBittorrent does not start |
| Tailscale (with 2FA) | Remote access, push deploys | Only for remote access |
| Indexer accounts | Prowlarr | Yes, for downloads |

### In the repository (nothing to make)

| Path | What it is |
| --- | --- |
| `compose.yml` | Every service. Source of truth for ports and appdata paths |
| `.env.example` | Template for `.env` |
| `setup.sh` | Makes the folders, sets owners and modes, writes a default `rack.yml` |
| `rack/` | The Rack dashboard (built by CI into `ghcr.io/gascon1/homelab-rack`) |
| `caddy/Caddyfile`, `caddy/family/` | HTTPS proxy and the family homepage (remote profile) |
| `deploy-hook/` | Push-deploy receiver (push profile) |
| `deploy/` | systemd units and `install.sh` for automatic deploys |
| `scripts/deploy.sh` | The deploy script, with health gate and rollback |
| `scripts/check-exposure.sh` | Lists published ports. Fails if a risky port is on all interfaces |
| `docs/remote-access/tailscale-policy.example.hujson` | Tailscale access policy to paste |
| `.github/workflows/` | `ci.yml` (checks on PRs) and `release.yml` (image build and deploy doorbell) |

### Not in the repository (you make these, keep them safe)

Git does not hold these files and settings. Note where each one lives. Back up the files marked **Backup**.

| Item | Where | Made in step | Backup |
| --- | --- | --- | --- |
| `.env` | repo root (mode 600) | 3 | **Yes**. It holds `DB_PASSWORD`; Immich cannot read its database without it |
| NordVPN WireGuard key | `${APPDATA}/gluetun/wireguard_private_key` (mode 600) | 4 | No, you can make it again |
| `rack.yml` | `${APPDATA}/rack/rack.yml` | 3 (by `setup.sh`) | If you customized it |
| App configs and databases | `${APPDATA}/` | 6 | **Yes** |
| Immich database | `${DB_DATA_LOCATION}` | 6 | **Yes** |
| Photos and videos | `${UPLOAD_LOCATION}` | 6 | **Critical** |
| Tailscale node state | `${APPDATA}/tailscale` | 8 | No, join again with a new key |
| `deploy/deploy.env` | repo (gitignored) | 9 | Only if you changed it |
| Deploy SSH key (private repo only) | `~/.ssh/homelab-deploy` | 9 | No |
| Router settings | router | 1 | Write them down |
| Tailscale policy, keys, federated identity | Tailscale admin console | 8, 9 | The policy is in the repo |
| GitHub secrets, variable, branch rules, package visibility | GitHub settings | 9 | Names are listed in step 9 |

---

## 1. Prepare the server and the network

1. Install a 64-bit Linux server (Ubuntu or Debian). The Rack image is built for `linux/amd64` only.
2. Install the tools.

```bash
sudo apt update && sudo apt install -y git curl jq openssl
```

3. Install Docker Engine with the Compose plugin. Follow <https://docs.docker.com/engine/install/>.
4. Add your user to the `docker` group. Sign out and in again after this.

```bash
sudo usermod -aG docker "$USER"
```

5. Check Docker and your IDs. Write down the `uid` and `gid`. They are `PUID` and `PGID`.

```bash
docker compose version && id
```

6. In your router, do [MANUAL-STEPS Task 5](remote-access/MANUAL-STEPS.md#task-5-set-the-router): UPnP and NAT-PMP off, no port forwards, inbound IPv6 blocked, a DHCP reservation for the server. Write down the reserved address. It is `<SERVER-LAN-IP>` below.

**Result:** `docker compose version` works without `sudo`. The server always gets the same LAN address.

---

## 2. Mount the storage and get the code

1. Mount the media drive at `/srv/data` (or another path; it becomes `DATA_DIR`).

```bash
sudo blkid
```

```bash
echo "UUID=<your-uuid>  /srv/data  ext4  defaults,nofail  0  2" | sudo tee -a /etc/fstab
```

```bash
sudo mkdir -p /srv/data && sudo mount -a && df -h /srv/data
```

2. Clone the repository on `main` into your home folder.

```bash
git clone https://github.com/Gascon1/homelab.git ~/homelab
```

```bash
cd ~/homelab && git status
```

> **NOTE**
> Keep this checkout clean and on `main`. The deploy script (step 9) refuses to run on another branch or with local changes. Your own files (`.env`, `appdata/`, `deploy/deploy.env`) are gitignored, so they do not count.

> **NOTE**
> If you fork the repository to another account, change `Gascon1/gascon1` in `compose.yml` (Rack image), `deploy/deploy.env` (`GITHUB_REPO`), `scripts/deploy.sh` (image name and label), `rack/Dockerfile` and `.github/workflows/release.yml`, and use your repo in the Tailscale OIDC subject (MANUAL-STEPS Task 32).

---

## 3. Write `.env` and make the folders

Do this before the first `docker compose up`. Some values cannot change later.

1. Copy the template.

```bash
cp .env.example .env
```

2. Make a database password.

```bash
openssl rand -hex 24
```

3. Open `.env` in a text editor. Set these values:

| Variable | Value |
| --- | --- |
| `PUID`, `PGID` | From `id` in step 1 |
| `TZ` | Your time zone, for example `America/Toronto` |
| `DATA_DIR` | The mount from step 2, for example `/srv/data` |
| `UPLOAD_LOCATION` | `${DATA_DIR}/media/photos` written out, for example `/srv/data/media/photos` |
| `BIND_ADDR` | `<SERVER-LAN-IP>`. Set it now, not later (Docker ports bypass `ufw`) |
| `DB_PASSWORD` | The output of step 2 |
| `VPN_SERVER_COUNTRIES` | Optional. Default `Canada` |

Leave the `RACK_*`, `TS_*` and `DEPLOY_HOOK_SECRET` values empty for now. Leave `COMPOSE_PROFILES` commented out.

> **WARNING**
> `DB_PASSWORD` is fixed at the first start of Immich. If you change it later, Immich cannot open its database. Use letters and digits only.

4. Run the setup script. Use `sudo` if it says it cannot set ownership.

```bash
./setup.sh
```

**Result:** `appdata/` has a folder for each app, `appdata/rack/rack.yml` exists, and `${DATA_DIR}` has `media/movies`, `media/series` and `torrents/incomplete`. `.env` has mode 600. The script warns that the WireGuard key is missing; you add it in the next step.

---

## 4. Add the NordVPN WireGuard key

qBittorrent runs inside the `gluetun` VPN container. gluetun does not start without this key, and qBittorrent does not start without gluetun.

1. Make an access token at <https://my.nordaccount.com/dashboard/nordvpn/access-tokens/>.
2. Get the key. Replace `<ACCESS_TOKEN>`.

```bash
curl -s -u 'token:<ACCESS_TOKEN>' https://api.nordvpn.com/v1/users/services/credentials | jq -r .nordlynx_private_key
```

3. Remove any `\` from the key. It has 44 characters.
4. Write it to the file. Replace `<KEY>`. Use your `APPDATA` path if it is not `./appdata`.

```bash
(umask 077 && printf '%s' '<KEY>' > appdata/gluetun/wireguard_private_key)
```

```bash
chmod 600 appdata/gluetun/wireguard_private_key
```

Details and gotchas: [qbittorrent.md, VPN section](qbittorrent.md#vpn-gluetun--nordvpn).

> **WARNING**
> Do not put the key in `.env`. Anything with the Docker socket can read container variables.

---

## 5. First start (LAN only)

1. Start the stack. The Rack image is pulled from GHCR.

```bash
docker compose up -d
```

If the Rack image cannot be pulled (a fork, or a private package), build it on the server instead:

```bash
docker compose up -d --build
```

2. Wait two minutes. Examine the status. All containers must be running, and the ones with a health check must be healthy.

```bash
docker compose ps
```

3. Make sure the VPN works. The first two commands must show a NordVPN address. The third must show your ISP address.

```bash
docker exec gluetun wget -qO- https://ipinfo.io/ip
```

```bash
docker exec qbittorrent curl -s https://ipinfo.io/ip
```

```bash
curl -s https://ipinfo.io/ip
```

4. Run the exposure check.

```bash
./scripts/check-exposure.sh
```

**Result:** All containers run. qBittorrent uses the VPN. The exposure check ends with no warning. For the full leak and kill-switch tests, see [qbittorrent.md](qbittorrent.md#leak-and-kill-switch-tests).

---

## 6. Configure the apps

Do the apps in this order. Each one needs values from the one before. Open each at `http://<SERVER-LAN-IP>:<port>`. Inside the stack, apps reach each other by container name (`http://radarr:7878`), never `localhost`.

> **WARNING**
> Set a login on every app before you start remote access (step 8). Behind Caddy every request looks local, so "Disabled for Local Addresses" and qBittorrent's localhost bypass would let every tailnet user in.

### 6.1 qBittorrent (port 8080)

1. Get the temporary password: `docker logs qbittorrent`. Sign in as `admin`.
2. Tools > Options > Web UI: set a new user name and a strong password. Make sure both "Bypass authentication" options and "Enable reverse proxy support" are **off**.
3. Downloads: default save path `/data/torrents`, incomplete path `/data/torrents/incomplete`.
4. Connection: proxy None, UPnP / NAT-PMP off.
5. Add the categories `radarr` (`/data/torrents/movies`) and `sonarr` (`/data/torrents/series`).
6. Write the user name and password in `.env` as `RACK_QBITTORRENT_USERNAME` and `RACK_QBITTORRENT_PASSWORD`.

Details: [qbittorrent.md](qbittorrent.md).

### 6.2 Radarr (7878) and Sonarr (8989)

In each app:

1. Settings > General > Security: Authentication **Forms**, Authentication Required **Enabled**. Set a user and a strong password (a different one per app).
2. Settings > Media Management: root folder `/data/media/movies` (Radarr) or `/data/media/series` (Sonarr).
3. Settings > Download Clients: add qBittorrent. Host `qbittorrent`, port `8080`, the login from 6.1, category `radarr` or `sonarr`. Click Test.
4. Copy the API key from Settings > General. You need it in 6.3 and 6.5.

Details: [radarr.md](radarr.md), [sonarr.md](sonarr.md). For quality profiles see the [TRaSH Guides](https://trash-guides.info/).

### 6.3 Prowlarr (9696)

1. Settings > General > Security: same as 6.2 step 1.
2. Settings > Indexers: add a FlareSolverr proxy with host `http://flaresolverr:8191` and a tag (for example `flaresolverr`). Give this tag only to indexers that need it.
3. Indexers > Add Indexer: add your indexers.
4. Settings > Apps: add Radarr (`http://radarr:7878`) and Sonarr (`http://sonarr:8989`) with their API keys. The Prowlarr server is `http://prowlarr:9696`.

**Result:** Radarr and Sonarr list the indexers under Settings > Indexers.

Details: [prowlarr.md](prowlarr.md).

### 6.4 Plex (32400)

1. Open `http://<SERVER-LAN-IP>:32400/web` and sign in.
2. If Plex does not offer to claim the server, open it through an SSH tunnel from your computer, then open `http://localhost:32400/web`:

```bash
ssh -L 32400:localhost:32400 <user>@<SERVER-LAN-IP>
```

3. Add the libraries: Movies `/data/media/movies`, TV Shows `/data/media/series`.
4. Settings > Network: make sure "List of IP addresses and networks that are allowed without auth" is **empty**.

Details: [plex.md](plex.md).

### 6.5 Seerr (5055)

1. Sign in with Plex. Select the server and sync the Movies and TV libraries.
2. Settings > Services: add Radarr (host `radarr`, port `7878`, root `/data/media/movies`) and Sonarr (host `sonarr`, port `8989`, root `/data/media/series`) with their API keys.
3. Settings > Users: allow only people you know.

Details: [seerr.md](seerr.md).

### 6.6 Immich (2283)

1. Create the admin account. Enable 2FA in Account Settings if you want.
2. Account Settings > API Keys > New API Key. Write it in `.env` as `RACK_IMMICH_API_KEY`.
3. On your phone, install the Immich app. Set the server to `http://<SERVER-LAN-IP>:2283` for now (step 8 changes it). Enable backup.

Details: [immich.md](immich.md).

### 6.7 Rack (4000) and Netdata (19999)

1. Restart Rack so it reads the new `RACK_*` values. Rack finds the Plex, Sonarr, Radarr, Prowlarr and Seerr keys by itself.

```bash
docker compose up -d rack
```

2. Open Rack at `http://<SERVER-LAN-IP>:4000`. Each app must show stats.
3. Optional: edit `appdata/rack/rack.yml` (groups, bookmarks, disks). See [rack.md](rack.md).
4. Netdata needs no setup. It has no login, so never expose port 19999. See [netdata.md](netdata.md).

**Result:** Every app asks for a login in a private browser window (except Rack and Netdata, which stay LAN and admin only). Rack shows data for every app.

---

## 7. Test downloads end to end

1. In Seerr, request a small, free movie.
2. Make sure Radarr sends it to qBittorrent with the category `radarr`.
3. Make sure it lands in `/srv/data/media/movies` and Plex shows it.

If a file is copied instead of moved, see [Hardlinks and Instant Moves](https://trash-guides.info/Hardlinks/Hardlinks-and-Instant-Moves/). All apps see the same `/data` path, so hardlinks work.

---

## 8. Remote access with Tailscale (optional)

Do [MANUAL-STEPS](remote-access/MANUAL-STEPS.md) Tasks 7 to 21.

- **Skip Tasks 1 to 6.** They are for a server that ran an older version. This guide already did the same work: no File Browser (Task 1), logins (Tasks 2 to 4, step 6 here), router (Task 5, step 1 here), `BIND_ADDR` (Task 6, step 3 here).
- In Task 11, uncomment `COMPOSE_PROFILES=remote` in `.env`. The deploys in step 9 read only this line.
- Task 17 changes the Immich phone app to `https://homelab.<YOUR-TAILNET>:2283`.
- Task 18 is the security test. Do not skip it.

Background: [security-report.md](remote-access/security-report.md).

---

## 9. GitHub and automatic deploys (optional)

Do [MANUAL-STEPS](remote-access/MANUAL-STEPS.md) Tasks 23 to 36 (Part D). Read [deploy.md](deploy.md) first.

- Tasks 23 to 29 give the hourly deploy timer. They do not need Tailscale.
- Tasks 30 to 35 add the push doorbell. They need step 8.
- Task 37 only if the repository is private.

The settings you make outside the server:

| Where | Name | Task |
| --- | --- | --- |
| GHCR package `homelab-rack` | Visibility Public | 23 |
| GitHub branch rules on `main` | PR required, checks `compose`, `shell`, `hook`, `rack`, `image`, no force push | 24 |
| GitHub repository secret | `DEPLOY_HOOK_SECRET` (same value as in `.env`) | 30 |
| GitHub repository secret | `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE` | 32 |
| GitHub repository variable | `TS_HOST` = `homelab.<YOUR-TAILNET>` | 33 |
| Tailscale trust credential | OIDC, subject `repo:Gascon1/homelab:ref:refs/heads/main`, `auth_keys` write, `tag:ci` | 32 |

**Result:** A merged pull request deploys within a minute (or within an hour with the timer only). `journalctl -u homelab-deploy -n 50` shows `DEPLOYED`.

---

## 10. Keep it running

- **Updates:** apps on `:latest` update only when you pull them. See [MANUAL-STEPS Task 22](remote-access/MANUAL-STEPS.md#task-22-update-the-containers-each-week).

```bash
docker compose pull && docker compose up -d
```

- **Backups:** copy the items marked **Backup** in section 0 to another disk or place. Stop Immich (or use `pg_dump`) before you copy its database folder. See [immich.md](immich.md#backup).
- **Exposure:** run `./scripts/check-exposure.sh` after each change to ports.
- **New service:** see "Adding a new service" in the [README](../README.md#adding-a-new-service).

## Rebuild from a backup

To move to a new server with your old data:

1. Do steps 1 and 2.
2. Restore `.env` (with its old `DB_PASSWORD`), `appdata/`, `${DB_DATA_LOCATION}`, `${UPLOAD_LOCATION}` and the media drive. Keep the owners and modes (`cp -a` or `rsync -a`, as root).
3. If `PUID`, `PGID` or the LAN IP changed, update `.env` (`BIND_ADDR`).
4. Run `./setup.sh`. Do step 4 if the WireGuard key file is missing.
5. Start with `docker compose up -d` and check as in step 5. The apps keep their settings, so step 6 is not needed.
6. For remote access, delete the old `homelab` machine in the Tailscale console, delete `appdata/tailscale`, and do MANUAL-STEPS Tasks 10 to 14 again.
7. For deploys, do MANUAL-STEPS Tasks 25 to 29 and 34 again on the new server.
