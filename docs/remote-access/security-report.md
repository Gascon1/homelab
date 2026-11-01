# Homelab security report: remote access

Date: 2026-11-01. Scope: everything in this repo (`compose.yml`, `.env.example`, `setup.sh`, `rack/`, `docs/`). It does not cover the router, the host OS or anything outside the repo, so a few findings say "check this yourself".

Line numbers (`compose.yml:NN`) point at the file as it was before this branch (commit `HEAD` of `claude/youthful-bell-141aq7` at the time of review). Some lines move after this branch's changes.

---

## 1. Executive summary

**Where you are today.** All twelve web UIs are published on every network interface of the server (`0.0.0.0`, and usually `[::]` for IPv6 too). Five of them have either no login at all (Rack, Netdata, FlareSolverr) or start with a default or optional login (File Browser, qBittorrent, Radarr, Sonarr, Prowlarr). Two of the no-login services (Rack and Netdata) mount the Docker socket, so anyone who takes them over can take over the whole server. Docker writes its own firewall rules, so `ufw` does **not** protect these ports. Today the only thing keeping them off the internet is your home router's NAT. That breaks if you add a port forward, if a device turns on UPnP (Plex and qBittorrent both try to), or if your ISP gives you public IPv6 and the router lets it through. Every device on your Wi-Fi already has full access: phones, smart TVs, guests, IoT gadgets.

**What we recommend.** Do **not** open ports on the router for the admin tools. Use **Tailscale** (a WireGuard-based private network) as the only way in from outside:

- A `tailscale` container (opt-in, compose profile `remote`) joins your tailnet as the machine `homelab`.
- A `caddy` container shares that network and is the single HTTPS front door. It gets a real, trusted certificate for `homelab.<your-tailnet>.ts.net` from Tailscale. Each app keeps its usual port number, so Sonarr is `https://homelab.<tailnet>.ts.net:8989`, Immich is `...:2283`, and so on. Rack's links keep working without changes. Rack itself is on `:4000` only; the bare address `https://homelab.<tailnet>.ts.net` (443) serves a static family homepage (see the update note at the end).
- Devices on the tailnet can only reach the ports Caddy serves. FlareSolverr is never exposed. They cannot reach SSH, Postgres or anything else on the host.
- Tailscale access rules (ACLs) decide who sees what. You get everything. Family members you invite (the free plan allows 6 users) can be limited to Plex, Immich and Seerr.
- On the LAN, nothing changes: `http://<server-ip>:<port>` keeps working.
- Plex is the one exception that may need to be public, for people who will not install Tailscale. Plex has its own Remote Access feature with its own login. Use that and nothing else on the public internet.

**How hard is it?** About **1 to 2 hours** for someone comfortable with `docker compose`, most of it clicking through settings:

| Step | Effort |
| --- | --- |
| Change default passwords, turn on *arr/qBittorrent auth (do this first, whatever else you decide) | 20 min |
| Tailscale account, enable MagicDNS + HTTPS, create auth key, fill `.env` | 15 min |
| `docker compose --profile remote up -d`, install Tailscale on phone/laptop, test | 15 min |
| Paste the ACL policy (only if you invite family) | 10 min |
| Router: turn off UPnP, check there are no port forwards, check IPv6 inbound is blocked | 15 min |
| Set `BIND_ADDR` to the server's LAN IP (optional hardening) | 5 min |

No domain name, no public IP, no certificates to renew by hand, no ports opened on the router.

---

## 2. Threat model

| Attacker | How they get in | What they want | What stops them after the change |
| --- | --- | --- | --- |
| **Internet scanners and bots** (Shodan, Censys, botnets) | Any port reachable from the internet: router forward, UPnP, IPv6 | Default logins, known CVEs in *arr/qBittorrent/Plex/Netdata, open proxies (FlareSolverr), crypto-mining | No admin port is public. The tailnet node only accepts connections from authenticated tailnet devices. Plex, if made public, has plex.tv auth. |
| **Credential stuffing** | Login pages of any public service | Reusing your leaked passwords | Not public. Unique passwords plus 2FA on the Tailscale identity (Google/GitHub/Apple/Microsoft login). |
| **A compromised or untrusted device on your LAN** (smart TV, IoT plug, a guest's laptop, malware on a family PC) | Direct HTTP to `<server-ip>:<port>` | The no-login services. Rack or Netdata give a path to the Docker socket, which means root on the host. File Browser gives read/write access to all media and photos. | `BIND_ADDR` limits ports to the LAN interface only (it does not stop LAN devices). Real logins on every app. Optional: put IoT on a guest VLAN/SSID. Rack and Netdata still have no login on the LAN (residual risk, see section 5). |
| **A compromised device on your tailnet** (lost phone, malware on a laptop) | HTTPS to `homelab.<tailnet>.ts.net:<port>` | Same as above | Device keys can be revoked in the Tailscale admin console. ACLs limit family devices to 3 ports. App logins still apply. Turn on Tailscale device approval. |
| **Malicious content from indexers or torrents** | Files that qBittorrent downloads and the *arr apps import, which Plex then scans | Exploiting media parsers (Plex, ffmpeg, libtorrent), or executables disguised as media; an indexer site trying to use FlareSolverr's browser | Containers run as `PUID`, not root. FlareSolverr has no published port. Keep images updated. Do not run downloaded files on your PC. Optional: route qBittorrent through a VPN (privacy rather than security). |
| **Supply chain** (a compromised or broken image pushed to `:latest`) | `docker compose pull` pulls whatever is newest | Code running inside your containers, some of which have the Docker socket or host mounts | The new network images (Tailscale, Caddy) are pinned to exact versions. App images stay on their vendors' stable tags, but you update deliberately and read release notes for the privileged ones. The vendors are well-known (linuxserver.io, Immich, Netdata). See HL-09. |

---

## 3. Remote access options compared

| | (a) Port-forward + reverse proxy + public TLS | (b) Cloudflare Tunnel (+ Access) | (c) Tailscale mesh VPN + Caddy on the tailnet | (d) Hybrid: (c) for admin, public only for Plex/Immich/Seerr |
| --- | --- | --- | --- | --- |
| Open ports on router | 443 (and 80) | None | None | None, or 32400 for Plex |
| Who can reach the login page | The whole internet | The whole internet, unless Cloudflare Access is in front | Only your tailnet devices | Admin: tailnet only. Shared apps: internet |
| Needs a domain | Yes | Yes (on Cloudflare) | No (`*.ts.net`) | Yes if you publish more than Plex |
| Effort | High: router, DDNS, certs, hardening, fail2ban, CrowdSec | Medium | **Low** | Medium |
| Video streaming | Fine | **Against Cloudflare's terms** for large video on the free/CDN plans (see note) | Fine | Fine, using Plex's own remote access |
| Immich uploads | Fine | **100 MB request limit** on free and Pro plans. Immich sends each photo or video in one request, so large videos fail with error 413 | Fine (no limit) | Fine if Immich is reached via the tailnet or (a) |
| No-login apps (Rack, Netdata) | Would need forward-auth (Authelia, etc.) | Need Cloudflare Access | Protected by tailnet membership and ACLs | Same as (c) |
| Family use | Easy (just a URL) | Easy | They install the Tailscale app and you invite them (6 users free) | Easy for Plex |
| Third party sees your traffic | No | **Yes**: Cloudflare terminates TLS and can see everything | No (end-to-end WireGuard; the coordination server sees metadata only) | Plex relay sees metadata |

**Notes and sources**

- **Cloudflare and video.** Cloudflare's service-specific terms for the CDN say that serving video and other large files needs a paid product such as Stream, unless you are on Enterprise. People still argue about whether this covers Tunnel/Zero Trust traffic that is not cached. Some Cloudflare staff have reportedly said personal use is fine, and others in the community disagree. We could not fetch the terms page from this environment to quote it, so read the current *Service-Specific Terms → CDN* yourself before you put Plex or Immich video behind a tunnel. Either way, it is a grey area we do not need to be in.
- **Immich over Cloudflare.** The free and Pro plans cap request bodies at 100 MB, and this applies through Tunnel too. Immich has no resumable or chunked upload yet (immich-app/immich issue #1674), so phone backups of long videos fail.
- **Plex.** Plex has its own Remote Access, either a direct connection through one forwarded port (32400) or Plex's relay, which is low-bitrate. Since 29 April 2025, remote streaming of personal media needs a Plex Pass on the server owner's account or a Remote Watch Pass on the viewer's account. This was rolled out across client platforms through 2025 and 2026. Plex may count tailnet connections as remote too, so check how your clients behave.
- **Tailscale free plan.** As of 2026 it has up to 6 users, unlimited user devices, and is for non-commercial use. Check tailscale.com/pricing.

**Recommendation: (c), with Plex as the only public exception, i.e. a minimal (d).**

- Owner and household: Tailscale on every phone and laptop, with everything at `https://homelab.<tailnet>.ts.net:<port>`.
- Family who will install an app: invite them to the tailnet and use ACLs to limit them to Plex (32400), Immich (2283) and Seerr (5055).
- Family who will not install anything: Plex Remote Access only. Forward TCP 32400 by hand, keep UPnP off, and keep Plex's login (it cannot be turned off for remote users). Do **not** publish Seerr, Immich or anything else. If you really need public Immich photo sharing later, use option (a) for that one hostname, with a domain and DNS-01 (see the spec's appendix), not Cloudflare Tunnel.

**Why Tailscale in a container rather than on the host.**

- It is declared in the repo and opt-in (`--profile remote`).
- It needs no `NET_ADMIN` and no `/dev/net/tun` (it uses userspace networking).
- Tailnet devices can reach only the ports Caddy listens on, not the host's SSH or other ports. That is least privilege by construction.

The trade-off is that you cannot SSH into the server over Tailscale. If you want that, also install Tailscale on the host. That gives the host its own tailnet IP, where the host-published ports are reachable too, which is why `BIND_ADDR` matters. Name the host node differently (e.g. `homelab-host`).

---

## 4. Findings

Severity is judged for this setup: a home network behind NAT, owner-operated. "This branch" means the changes on `claude/youthful-bell-141aq7`, some already made and some specified in `implementation-spec.md`.

| ID | Sev | Service | Issue | Evidence | Fix | Status |
| --- | --- | --- | --- | --- | --- | --- |
| HL-01 | **High** | All web UIs | Every port is published with no host IP, so on `0.0.0.0` and usually `[::]`. Docker's iptables DNAT rules run before ufw's INPUT chain, so `ufw deny` has no effect. One router forward, a UPnP request or open IPv6 exposes everything. | `compose.yml:31,62,91,128,144,156,167,181,196,241,276` | Add a `BIND_ADDR` variable (default `0.0.0.0`) on every web UI port, and recommend setting it to the LAN IP (this also drops the IPv6 listener). For remote use go through Tailscale/Caddy, which publishes no host ports. Advanced: `DOCKER-USER` iptables rules. Plex 32400 and torrent 6881 stay on all interfaces on purpose. | **Done on this branch** (BIND_ADDR, default unchanged). **Manual**: set `BIND_ADDR` to the LAN IP and give the server a DHCP reservation. |
| HL-02 | **Critical** (until changed) | File Browser | Admin login with read/write on the entire `DATA_DIR` (media, torrents, and Immich photos if `UPLOAD_LOCATION` is under it, which is the default). The repo docs say the default is `admin/admin`. Newer File Browser versions print a random password in the logs on first start instead. Either way, anyone who gets in can delete or encrypt every file. Share links can leak files. | `compose.yml:263-276`, `docs/filebrowser.md` ("Username: admin / Password: admin"), `.env.example:35` (`UPLOAD_LOCATION=/srv/data/media/photos` is inside `DATA_DIR`) | Set a strong password now. Create a non-admin user for daily use. Consider mounting only `${DATA_DIR}/media` rather than all of `DATA_DIR`. Keep it off the public internet. | **Manual** (password). Tailnet-only access on this branch. |
| HL-03 | **High** | Rack | No login. Listens on `0.0.0.0:4000` and runs as root with `/var/run/docker.sock` mounted. `:ro` does not limit the Docker API, so any code execution in Rack means root on the host. It also mounts the *arr/Plex/Seerr appdata (API keys) read-only. Its HTTP surface is small (GET/HEAD only, secrets are not sent to the browser), so you would need a bug in Rack or its dependencies, but the impact is total. `/api/state` shows container names, images and health to anyone on the LAN. | `compose.yml:61-71`; `rack/Dockerfile` ("Runs as root on purpose"); `rack/server/src/server.ts` (`server.listen(env.port, '0.0.0.0')`); `docs/rack.md:156-160` | `BIND_ADDR` to the LAN IP. Over the tailnet, limit access to admin devices by ACL. Future work: a Docker socket proxy that only allows `GET /containers/*` (needs Rack to support TCP `DOCKER_HOST`), plus Rack running non-root. | Partly on this branch (BIND_ADDR, tailnet ACL template). Socket proxy is **future work**. |
| HL-04 | **High** | Netdata | No login on `:19999`. Runs with `pid: host`, `SYS_ADMIN` and `SYS_PTRACE`, AppArmor unconfined, the host `/` mounted, and `docker.sock`. A Netdata RCE means host root. Without any bug, an attacker can still read the full process list with arguments (which can contain secrets), logs, and `/etc/passwd`. The docs suggest Netdata Cloud for remote access, which is another third party with visibility. | `compose.yml:234-259`; `docs/netdata.md` ("No login required by default", "Consider connecting to Netdata Cloud for remote access") | `BIND_ADDR` to the LAN IP. Admin-only tailnet ACL. Use the tailnet rather than Netdata Cloud. Consider removing `SYS_ADMIN` if you do not need the collectors that require it, and test afterwards. | Partly on this branch. **Manual** for capability trimming. |
| HL-05 | **High** | FlareSolverr | An unauthenticated headless Chrome that fetches any URL you POST to it, i.e. an open SSRF proxy. From the LAN (or the internet, if exposed), anyone can use it to reach internal-only hosts (router admin, `http://radarr:7878`, cloud metadata services) or to run abuse traffic through your IP. Only Prowlarr needs it, and only over the Docker network. | `compose.yml:171-181` | Remove the published port. Prowlarr uses `http://flaresolverr:8191`. Never proxy it through Caddy. | **Done on this branch.** |
| HL-06 | **High** | qBittorrent | It starts with the default `admin` user and a temporary password printed in the logs. The WebUI can set "Run external program on torrent finished", which is code execution in the container with write access to `${DATA_DIR}/torrents`. The settings "Bypass authentication for clients on localhost" and "...in whitelisted IP subnets" would let **all Caddy-proxied traffic** through, because it arrives from the local address 127.0.0.1. | `compose.yml:113-134`; `docs/qbittorrent.md` | Set a strong password. Make sure both bypass options are off. Leave "Enable reverse proxy support" off: in Tailscale userspace mode Caddy sees every tailnet client as 127.0.0.1, so it gives no benefit and a brute-force ban would lock out all tailnet users. Disable UPnP/NAT-PMP in qBittorrent if you do not want it to open ports. | **Manual.** |
| HL-07 | **High** | Radarr, Sonarr, Prowlarr | Authentication is optional, and the common setting "Disabled for Local Addresses" counts every RFC1918 source as local. Behind Caddy, every tailnet request comes from a local address (127.0.0.1), so **auth is silently bypassed for everyone on the tailnet**. The *arr apps can run custom scripts (Connect → Custom Script), which is code execution with read/write on `${DATA_DIR}`. | `compose.yml:136-169`, README "Configure Services" (no auth step) | In each app: Settings → General → Security → Authentication = Forms, Authentication Required = **Enabled**, with a strong unique password. Keep API keys secret. Rack reads them read-only, which is fine. | **Manual** (must be done **before** enabling the `remote` profile). |
| HL-08 | **Medium** | Immich | `env_file: .env` injected the **whole** `.env` (RACK_* API keys, the qBittorrent password and, after this change, `TS_AUTHKEY`) into `immich_server` and `immich_machine_learning`. A bug in Immich or ML model loading would leak every secret. | `compose.yml:188,205` | Explicit `environment:` with only TZ and DB_*. `DB_HOSTNAME`/`REDIS_HOSTNAME` default to `database`/`redis`, which match the service names. If you added custom `IMMICH_*` variables to `.env`, add them explicitly. | **Done on this branch.** |
| HL-09 | **Medium** | Most images | `:latest`, `:stable` and `:release` tags with no update policy. `docker compose pull` takes whatever was pushed last, and nothing is recorded, so you cannot roll back. Images holding the Docker socket or host mounts (Netdata, and Rack's `node:24-alpine` base) are the riskiest. | `compose.yml:23,86,115,138,150,162,173,187,204,235,265`; `rack/Dockerfile:4,11,18` | New network-edge images are pinned exactly: `tailscale/tailscale:v1.104.4`, `caddy:2.11.7`. App images keep vendor stable tags. Pinning 10 images without automation goes stale, and stale is worse than `latest` from these vendors. Update weekly on purpose (`docker compose pull && docker compose up -d`) after skimming release notes. Optional: enable Renovate on the GitHub repo, or run `diun` for notifications (diun needs the Docker socket, so prefer Renovate). Immich, Valkey and Postgres follow Immich's own pinning guidance. | Partly on this branch (infra pinned, policy documented). **Manual**: optional Renovate. |
| HL-10 | **Medium** | Router / Plex / qBittorrent | UPnP lets Plex (Remote Access) and qBittorrent open router ports on their own. IPv6 may bypass NAT entirely. We cannot see this from the repo. | `compose.yml:90-98,127-130` | Turn off UPnP/NAT-PMP on the router. Make sure inbound IPv6 is blocked by default. If you want Plex public, forward 32400/TCP by hand, and nothing else. | **Manual.** |
| HL-11 | **Low** | Plex | `ADVERTISE_IP` is a `plexinc/pms-docker` variable. The `linuxserver/plex` image ignores it, so the tailnet URL never reached Plex. | `compose.yml:104` | Remove `ADVERTISE_IP`. Set Plex > Settings > Network > "Custom server access URLs" to include `https://homelab.<tailnet>.ts.net:32400`. | **This branch** (variable removed). **Manual**: set the URL in Plex. |

> **Update 2026-11-01:** the first version of HL-11 wrongly said the linuxserver image reads `ADVERTISE_IP`. It does not (see `research-best-practices.md` section f).
| HL-12 | **Low** | setup.sh | `source .env` runs `.env` as bash, so a malformed value or command substitution executes. Relative `APPDATA=./appdata` resolves against the current directory, not the repo, so running `../homelab/setup.sh` from elsewhere creates directories in the wrong place. `.env` is left world-readable. | `setup.sh:23-27,34`; `.env.example:19` | Parse `KEY=VALUE` lines without executing them, `cd "$SCRIPT_DIR"`, `chmod 600 .env`, and create the tailscale/caddy directories. | **This branch** (spec). |
| HL-13 | **Low** | Netdata | Config mounts used `./appdata/netdata` instead of `${APPDATA}`, so a custom `APPDATA` split Netdata's data from everything else and from backups. | `compose.yml:249-251` | Use `${APPDATA}/netdata/...`. If you had a non-default `APPDATA`, move `./appdata/netdata` there once. | **Done on this branch** (move is **manual** if applicable). |
| HL-14 | **Low** | All | LAN traffic is plain HTTP, so passwords for qBittorrent, the *arr apps and File Browser cross the LAN unencrypted. Tailnet traffic is encrypted (WireGuard + HTTPS). | all `ports:` | Accept on a trusted LAN, or use the tailnet URLs at home too (Tailscale works on the LAN). | Accepted / optional. |
| HL-15 | **Low** | Immich DB | `.env.example` ships `DB_PASSWORD=change-me-to-a-secure-password`. Postgres is not published, so the risk is low, but everyone copies example files. | `.env.example:41` | Generate one: `openssl rand -hex 24` (alphanumeric only). | **Manual.** |
| HL-16 | **Low** | Plex discovery / torrent | UDP 1900 and 32410-32414, TCP 32469 (DLNA) and 6881 stay on all interfaces. SSDP/DLNA have no auth, but these are LAN discovery protocols. 6881 is meant to be reachable. | `compose.yml:93-98,129-130` | Remove the DLNA/GDM ports if you do not use them (the compose comment already says so). Never forward 1900. | **Manual** (optional). |
| HL-17 | **Low** | Tailscale (new) | The `TS_AUTHKEY` in `.env` is a bearer credential. Certificate Transparency logs make `homelab.<tailnet>.ts.net` public (name only, not reachable). | new | Use a one-off, pre-approved, **tagged** key with a short expiry and remove it from `.env` after the first start (`TS_AUTH_ONCE=true` keeps the node logged in from its state). Pick a tailnet name you do not mind being public. | **This branch** + **manual**. |
| HL-18 | **Info** | Caddy (new) | Gotcha: in Tailscale userspace mode, tailnet connections are forwarded to `localhost:<port>` in the shared network namespace, so **anything listening there, even on 127.0.0.1, is reachable from the tailnet**. Caddy's admin API (`localhost:2019`) would let a tailnet device rewrite the proxy config. | new | `admin off` in the Caddyfile. The health endpoint returns a constant `ok` only. | **This branch** (spec). |

---

## 5. Residual risks after the recommended setup

1. **Rack and Netdata still have no login and still hold the Docker socket.** Exposure drops to your LAN plus your own tailnet devices, but a compromised LAN device can still reach them. Mitigations: put IoT and guests on a separate SSID/VLAN. In future, add a Docker socket proxy and forward-auth (e.g. tinyauth or Authelia) in Caddy if you ever give tailnet access to people you do not fully trust.
2. **App logins are only as good as your passwords.** Over the tailnet, the *arr apps, qBittorrent and File Browser rely on their own logins. Tailnet membership is the first wall, and the app login is the second.
3. **Tailscale is a trusted third party.** Its coordination server could in theory add a node to your tailnet. Turn on **device approval** and **Tailnet Lock** if you want to remove that trust. Your identity provider (Google, GitHub, etc.) account is now a key to your server, so give it 2FA.
4. **Plex, if made public**, is internet-facing software with a history of CVEs. Keep it updated and keep its login.
5. **Caddy depends on the tailscale container.** If `tailscale` is recreated, `caddy` loses its network namespace and must be restarted (`docker compose --profile remote up -d` does that). This fails safe: remote access goes down, nothing is exposed.
6. **Userspace networking throughput.** Large Immich uploads or high-bitrate Plex streams over the tailnet may be limited to a few hundred Mbit/s by userspace WireGuard. That is fine for home internet. Switch to kernel mode later if needed (see spec).
7. **Images you do not pin** can still change under you. You decide when to update, but you are trusting linuxserver.io, Immich, Netdata, File Browser and Seerr to publish good images.
8. **Malicious downloads.** Nothing here scans downloaded files. Do not open executables that the *arr apps fetch.

---

## 6. Verification checklist

Run these after the changes and again after any router or compose change.

**On the server**

```bash
# 1. Repo helper (added on this branch): lists host listeners and Docker published ports, warns on 0.0.0.0/[::]
./scripts/check-exposure.sh

# 2. Everything listening on the host
sudo ss -tulpn | grep -Ev '127\.0\.0\.1|\[::1\]'
#   With BIND_ADDR set to the LAN IP you should see only <LAN-IP>:<port> for web UIs,
#   plus 0.0.0.0 for 32400, 6881, 1900, 32410-32414, 32469 (and sshd).

# 3. What Docker publishes, per container
docker ps --format '{{.Names}}' | xargs -n1 docker port
#   flaresolverr, tailscale and caddy must print nothing.

# 4. Caddy is not publishing host ports and the admin API is off
docker inspect caddy --format '{{.HostConfig.NetworkMode}}'   # container:<id of tailscale>
docker compose --profile remote exec caddy wget -qO- http://127.0.0.1:2019/config/ ; echo "rc=$?"   # must fail

# 5. Immich no longer sees unrelated secrets
docker exec immich_server env | grep -E 'RACK_|TS_AUTHKEY|QBITTORRENT' ; echo "rc=$? (1 = good)"
```

**From outside your home** (phone on mobile data with Wi-Fi **off**, or a friend's network)

- Find your public IP (`curl ifconfig.me` on the server) and, if you have one, your server's global IPv6 address (`ip -6 addr show scope global`).
- From a laptop tethered to the phone's hotspot: `nmap -Pn -p 1-65535 <public-ip>`. Expect everything closed or filtered, except 32400 if you chose Plex Remote Access. Repeat with `nmap -6 -Pn <server-ipv6>`.
- With the Tailscale app **off**: `https://homelab.<tailnet>.ts.net:8989` must not load (the DNS name will not resolve or will time out).
- With the Tailscale app **on**: it loads with a valid padlock and asks for a login (Sonarr shows its login form, not the dashboard). Do the same for 7878, 9696, 8080 and 8181.
- `https://homelab.<tailnet>.ts.net:8191` must fail (FlareSolverr is never proxied).
- From a family member's device (if invited): 443 (family homepage), 32400, 2283 and 5055 work, and 4000 (Rack), 19999, 8080 and 8989 time out (ACL).
- Online check: https://www.shodan.io/host/<public-ip> should show nothing, or Plex only. Check again a week later.

**On the router**

- UPnP / NAT-PMP: off.
- Port forwards: none, or only TCP 32400 to the server.
- IPv6 firewall: inbound blocked by default.

## Update 2026-11-01: family homepage on 443

Rack was served on the bare address (443). Family was denied 443 so it could not reach Rack, but that left family with no friendly start page. Port 443 now serves a static page from `caddy/family/` (no proxy, no scripts from outside, strict Content-Security-Policy). Rack moved to `:4000` only. The tailnet policy now lets `group:family` reach 443 and still denies 4000. Rack still has no login and still holds the Docker socket, so the ACL on 4000 is what protects it. Test: on a family device the homepage opens and `:4000` times out.
