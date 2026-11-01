# Set Up the Homelab from Scratch

The order to build a new server, from an empty disk to automatic deploys. Each step points to the doc that owns its details and ends on a **Done when** check. Start the next step only when that check passes.

Restoring from a backup instead? Use [SETUP-STATE.md](SETUP-STATE.md#restore-on-a-new-server). It also lists every file and setting that lives outside git.

Two words carry through the guide:

- **LAN-only**: the stack runs with `BIND_ADDR=<SERVER-LAN-IP>`, no `remote` profile, no router port forwards. Steps 1 to 7 stay LAN-only.
- **Locked**: an app asks for its login in a private browser window, with every local-address and localhost bypass off. Behind Caddy all traffic looks local, so a bypass opens the app to the whole tailnet. Every app is locked before step 8.

You need accounts for GitHub (2FA on), Plex, NordVPN, your indexers, and for steps 8 and 9 Tailscale (2FA on).

---

## 1. Server and network

1. Install 64-bit Ubuntu or Debian on `amd64` (the Rack image is built for `linux/amd64` only).
2. Install the tools: `sudo apt install -y git curl jq openssl`.
3. Install Docker Engine with the Compose plugin from <https://docs.docker.com/engine/install/>. Add your user to the `docker` group (`sudo usermod -aG docker "$USER"`), then sign out and in.
4. Set the router as in [MANUAL-STEPS Task 5](remote-access/MANUAL-STEPS.md#task-5-set-the-router), including the DHCP reservation. The reserved address is `<SERVER-LAN-IP>`.

**Done when:** `docker compose version` runs without `sudo`, `id` lists `docker`, and the router shows UPnP off, no port forwards, and a reservation for the server.

## 2. Storage and code

1. Mount the media drive through `/etc/fstab` by UUID (`sudo blkid`). Add `nofail` so a missing drive does not block boot. Its mount point is `DATA_DIR` (default `/srv/data`).
2. Clone on `main`: `git clone https://github.com/Gascon1/homelab.git ~/homelab`. Keep this checkout a **clean main**: the deploy script refuses any other branch or any local change. Your own files (`.env`, `appdata/`, `deploy/deploy.env`) are gitignored and do not count.

On a fork, every hard-coded owner shows with `grep -rni gascon1 --exclude-dir=.git .`. Change each one, and use your repo in the OIDC subject of MANUAL-STEPS Task 32.

**Done when:** `df -h /srv/data` shows the drive after `sudo mount -a`, and `git status` says `On branch main` and `working tree clean`.

## 3. `.env` and folders

1. `cp .env.example .env`, then set each value as its comment says. Two values are fixed at first start and must be right now:
   - `BIND_ADDR=<SERVER-LAN-IP>`. Docker-published ports bypass `ufw`, so this is what keeps the web UIs off other interfaces.
   - `DB_PASSWORD` from `openssl rand -hex 24`. Immich's database keeps the first value; a later change locks Immich out of it.

   Leave `RACK_*`, `TS_*`, `DEPLOY_HOOK_SECRET` empty and `COMPOSE_PROFILES` commented out. Later steps fill them.
2. Run `./setup.sh` (with `sudo` if it says it cannot set ownership).

**Done when:** `setup.sh` prints `Directory structure created successfully!`, its only warning is the missing WireGuard key, and `.env` has no example value left in `BIND_ADDR` or `DB_PASSWORD`.

## 4. NordVPN key

qBittorrent runs inside gluetun, and gluetun needs the NordVPN WireGuard key in a file. Follow [qbittorrent.md, VPN steps 1 and 2](qbittorrent.md#vpn-gluetun--nordvpn).

**Done when:** `stat -c '%a %s' appdata/gluetun/wireguard_private_key` prints `600 44`, and `./setup.sh` runs with no warning.

## 5. First start

1. `docker compose up -d`. This pulls the Rack image from GHCR. If the pull fails (a fork, or a private package), use `docker compose up -d --build` to build it here.
2. Run the VPN leak and kill-switch tests in [qbittorrent.md](qbittorrent.md#leak-and-kill-switch-tests).
3. Run `./scripts/check-exposure.sh`.

**Done when:** `docker compose ps` shows every container running and every health check healthy, gluetun and qBittorrent report a NordVPN IP while the host reports your ISP IP, the kill-switch test says `blocked (good)`, and `check-exposure.sh` exits 0.

## 6. Configure and lock the apps

Configure the apps in this order: each one needs a value (login or API key) from the one before. Apps reach each other by container name (`http://radarr:7878`), as their docs show.

| # | App | Configure with | Lock with |
| --- | --- | --- | --- |
| 1 | qBittorrent (8080) | [qbittorrent.md](qbittorrent.md): paths, connection, categories | [MANUAL-STEPS Task 2](remote-access/MANUAL-STEPS.md#task-2-change-the-qbittorrent-password-and-settings) (steps 1 to 10) |
| 2 | Radarr (7878), Sonarr (8989) | [radarr.md](radarr.md), [sonarr.md](sonarr.md): root folder, download client | [MANUAL-STEPS Task 3](remote-access/MANUAL-STEPS.md#task-3-set-authentication-in-radarr-sonarr-and-prowlarr) |
| 3 | Prowlarr (9696) | [prowlarr.md](prowlarr.md): FlareSolverr, indexers, apps | MANUAL-STEPS Task 3 |
| 4 | Plex (32400) | [plex.md](plex.md): claim, libraries | Keep "allowed without auth" empty ([Task 19](remote-access/MANUAL-STEPS.md#task-19-tell-plex-the-tailnet-address) step 6) |
| 5 | Seerr (5055) | [seerr.md](seerr.md): Plex, Radarr, Sonarr | [MANUAL-STEPS Task 4](remote-access/MANUAL-STEPS.md#task-4-check-immich-and-seerr) steps 8 to 10 |
| 6 | Immich (2283) | [immich.md](immich.md): admin, phone backup | MANUAL-STEPS Task 4 steps 6 and 7 |
| 7 | Rack (4000) | [rack.md](rack.md): Immich API key into `.env`, then `docker compose up -d rack` | Admin-only by design: LAN and ACL, no login |
| 8 | Netdata (19999) | Nothing to set | Admin-only by design, same as Rack |

For quality profiles and qBittorrent tuning, the [TRaSH Guides](https://trash-guides.info/) are the reference.

**Done when:** apps 1 to 6 are locked, Radarr and Sonarr show a green test for qBittorrent and list Prowlarr's indexers, Seerr lists only people you know, and every Rack tile shows stats.

## 7. End-to-end download

Request a small, free movie in Seerr.

**Done when:** it goes Seerr → Radarr → qBittorrent (category `radarr`) → `${DATA_DIR}/media/movies` → Plex, and the file was hardlinked rather than copied (`ls -li` shows the same inode in `torrents/` and `media/`). If it was copied, see [Hardlinks and Instant Moves](https://trash-guides.info/Hardlinks/Hardlinks-and-Instant-Moves/).

## 8. Remote access (optional)

Do [MANUAL-STEPS](remote-access/MANUAL-STEPS.md) Tasks 7 to 21. Tasks 1 to 6 are already done: Task 1 is for a server that ran File Browser, and steps 1, 3, 5 and 6 here covered the rest. In Task 11, uncomment `COMPOSE_PROFILES=remote` in `.env`: the deploys in step 9 read only that line.

**Done when:** every check in Task 18 passes. It is the security test of the whole setup.

## 9. Automatic deploys (optional)

Read [deploy.md](deploy.md), then do [MANUAL-STEPS](remote-access/MANUAL-STEPS.md) Part D. Tasks 23 to 29 give the hourly timer and need no Tailscale. Tasks 30 to 35 add the push doorbell and need step 8. Task 37 applies only to a private repository.

**Done when:** a small merged pull request shows `DEPLOYED` with its commit in `journalctl -u homelab-deploy -n 50` (Task 35), and you have paused and resumed the units once (Task 36).

## 10. Back up the state

Copy everything marked **Backup** in [SETUP-STATE.md](SETUP-STATE.md) to another disk, and write down the settings it lists outside the server.

**Done when:** the backup holds `.env`, `appdata/`, the Immich database and `${UPLOAD_LOCATION}`, and a test restore of one file works.

After setup: update the apps each week ([Task 22](remote-access/MANUAL-STEPS.md#task-22-update-the-containers-each-week)), and add services as in the README's [Adding a new service](../README.md#adding-a-new-service).
