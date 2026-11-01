# Implementation spec: remote access (Tailscale + Caddy) and remaining hardening

Audience: the implementer agent. Follow it literally. Do not commit or push. Context and reasoning are in `docs/remote-access/security-report.md`.

## 0. Ground rules

- **Already done on this branch by another agent. Do not redo or revert:** `BIND_ADDR` in `.env.example` and on web UI ports in `compose.yml`, FlareSolverr's published port removed, Immich `env_file` replaced with explicit env vars, Netdata mounts moved to `${APPDATA}/netdata`, `scripts/check-exposure.sh`, and the README notes for those. Make your edits **on top of** the current working tree. Re-read each file right before editing it.
- **Must not break LAN access by default.** Everything new is either opt-in (compose profile `remote`) or keeps the old behaviour when the new `.env` variables are unset.
- `docker compose config` must keep working with **only** the old `.env` variables present. Never use `${VAR:?…}` (it fails interpolation even for services in inactive profiles; verified with Compose v5.6.1).
- Use 2-space YAML indentation and the same quoting style as nearby entries. Use tabs in the Caddyfile (Caddy's convention).
- Do not add emojis anywhere.

## 1. Decisions (fixed, do not revisit)

| Topic | Decision | Why |
| --- | --- | --- |
| Tailscale placement | **Container** `tailscale` in `compose.yml`, profile `remote`, **userspace networking** (image default), no `NET_ADMIN`, no `/dev/net/tun`, no published ports | Opt-in and versioned in the repo. Tailnet peers can reach only what Caddy listens on in that network namespace, not the host's SSH or other ports. |
| Entrypoint | **Caddy** container with `network_mode: service:tailscale` | It shares the tailnet IP and the `homelab` network (so it can reach `sonarr:8989` etc.). |
| TLS default | Tailscale-issued cert for `${TS_HOSTNAME}.${TS_TAILNET}` (a `*.ts.net` name). Caddy ≥2.5 fetches it automatically from tailscaled's LocalAPI socket at `/var/run/tailscale/tailscaled.sock`, which is shared between the containers through a named volume. | No domain, no DNS API token, no custom Caddy build. |
| TLS alternative | DNS-01 with a real domain: documented in Appendix A, **not implemented** | It needs a custom Caddy build and a DNS provider token. |
| Hostname scheme | **One hostname, one port per service, same port numbers as the LAN** (`https://homelab.<tailnet>.ts.net:8989` → sonarr). Rack on 443 **and** 4000. | Tailscale certs cover exactly one name per node (no wildcard). Rack builds links as `location.protocol//location.hostname:<published port>` (`rack/web/src/format.ts:36-40`), so mirroring the ports makes every Rack link work over HTTPS with **no Rack code change**. It also lets Tailscale ACLs restrict per service by port. |
| Forward-auth | **None.** Tailnet membership plus ACLs (admin-only for Rack and Netdata). FlareSolverr is never proxied. | The owner asked to keep it simple, and the only people on the tailnet are the owner and invited family limited by ACL. |
| Image pinning | Pin the **new** images exactly: `tailscale/tailscale:v1.104.4`, `caddy:2.11.7` (both verified on Docker Hub on 2026-11-01: `v1.104.4` is the current `stable`; `2.11.7` is the newest 2.x tag). **Do not change existing app image tags.** | The policy is documented in the report (HL-09). |
| Caddy admin API | `admin off` | In userspace mode, tailnet connections are forwarded to `localhost:<port>`, so a localhost-only admin API would be reachable from the tailnet. Reload with `docker compose restart caddy`. |

## 2. File changes

### 2.1 `compose.yml`

**(a) Plex ADVERTISE_IP (HL-11).** In the `plex` service, replace

```yaml
      - ADVERTISE_IP=${HOST_ADDR}:32400/
```

with

```yaml
      # Comma-separated URLs Plex advertises to clients. Add your tailnet URL via PLEX_ADVERTISE_URLS (see .env.example)
      - ADVERTISE_IP=${PLEX_ADVERTISE_URLS:-http://${HOST_ADDR}:32400/}
```

(Nested default interpolation was verified with Compose v5.6.1: it renders `http://10.0.0.100:32400/`.)

**(b) New services.** Insert these two services **after the `filebrowser` service and before the top-level `volumes:` key**, keeping 2-space indentation under `services:`:

```yaml
  # ---------- Remote access (opt-in: docker compose --profile remote ...) ----------
  # See docs/remote-access/. Tailnet devices reach only the ports Caddy serves.
  tailscale:
    image: tailscale/tailscale:v1.104.4
    container_name: tailscale
    profiles: [remote]
    hostname: ${TS_HOSTNAME:-homelab}
    networks: [homelab]
    environment:
      - TS_AUTHKEY=${TS_AUTHKEY:-}
      - TS_HOSTNAME=${TS_HOSTNAME:-homelab}
      - TS_STATE_DIR=/var/lib/tailscale
      - TS_SOCKET=/var/run/tailscale/tailscaled.sock
      - TS_USERSPACE=true
      - TS_AUTH_ONCE=true
      - TS_ACCEPT_DNS=false
      - TS_EXTRA_ARGS=${TS_EXTRA_ARGS:-}
    volumes:
      - ${APPDATA}/tailscale:/var/lib/tailscale
      - tailscale-socket:/var/run/tailscale
    # No ports: nothing is published on the host
    healthcheck:
      test: ['CMD', 'tailscale', 'status', '--peers=false']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'

  caddy:
    image: caddy:2.11.7
    container_name: caddy
    profiles: [remote]
    # Shares the tailscale container's network: same tailnet IP, same homelab network
    network_mode: service:tailscale
    depends_on:
      tailscale:
        condition: service_healthy
        restart: true
    environment:
      - CADDY_DOMAIN=${TS_HOSTNAME:-homelab}.${TS_TAILNET:-tailnet-name.ts.net}
    volumes:
      - ./caddy/Caddyfile:/etc/caddy/Caddyfile:ro
      - ${APPDATA}/caddy/data:/data
      - ${APPDATA}/caddy/config:/config
      # tailscaled's LocalAPI socket: Caddy gets the *.ts.net certificate through it
      - tailscale-socket:/var/run/tailscale
    healthcheck:
      test: ['CMD', 'wget', '-q', '-O', '/dev/null', 'http://127.0.0.1:8099/']
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 20s
    security_opt:
      - no-new-privileges:true
    restart: unless-stopped
    logging:
      driver: json-file
      options:
        max-size: '10m'
        max-file: '3'
```

Notes:
- `caddy` must **not** have `networks:` or `ports:`. Compose rejects them with `network_mode`.
- Do **not** add `rack.enable=true` labels to these two. They have no web UI.
- If the `docker compose config` check in section 3 rejects `--peers=false` (it will not, config does not run commands) or a runtime test shows the flag is unknown, change the test to `['CMD', 'tailscale', 'status']`.

**(c) Named volume.** Change the top-level

```yaml
volumes:
  model-cache:
```

to

```yaml
volumes:
  model-cache:
  tailscale-socket:
```

### 2.2 New file `caddy/Caddyfile`

Create exactly:

```caddyfile
# Single HTTPS entrypoint for the tailnet. See docs/remote-access/.
# The certificate for {$CADDY_DOMAIN} (a *.ts.net name) comes from tailscaled
# through /var/run/tailscale/tailscaled.sock; no ACME account or DNS token is needed.
# Each app keeps its LAN port number so Rack's links work unchanged.
# Never add flaresolverr here: it is an unauthenticated proxy.
# After editing: docker compose restart caddy

{
	# Off on purpose: tailnet traffic reaches localhost ports in this network namespace
	admin off
}

(common) {
	header {
		Strict-Transport-Security "max-age=31536000"
		-Server
	}
}

# Rack dashboard (also on :4000 so its own link works)
{$CADDY_DOMAIN}, {$CADDY_DOMAIN}:4000 {
	import common
	reverse_proxy rack:4000
}

{$CADDY_DOMAIN}:5055 {
	import common
	reverse_proxy seerr:5055
}

{$CADDY_DOMAIN}:32400 {
	import common
	reverse_proxy plex:32400
}

{$CADDY_DOMAIN}:8080 {
	import common
	reverse_proxy qbittorrent:8080
}

{$CADDY_DOMAIN}:7878 {
	import common
	reverse_proxy radarr:7878
}

{$CADDY_DOMAIN}:8989 {
	import common
	reverse_proxy sonarr:8989
}

{$CADDY_DOMAIN}:9696 {
	import common
	reverse_proxy prowlarr:9696
}

{$CADDY_DOMAIN}:2283 {
	import common
	reverse_proxy immich-server:2283
}

{$CADDY_DOMAIN}:19999 {
	import common
	reverse_proxy netdata:19999
}

{$CADDY_DOMAIN}:8181 {
	import common
	reverse_proxy filebrowser:80
}

# Container healthcheck only; returns a constant
http://:8099 {
	bind 127.0.0.1
	respond "ok" 200
}
```

### 2.3 `.env.example`

Append at the **end of the file** (after the Rack block):

```ini

# =============================================================================
# Remote access (optional): Tailscale + Caddy. See docs/remote-access/
# =============================================================================

# Uncomment so every docker compose command also runs tailscale and caddy
# COMPOSE_PROFILES=remote

# Tailscale auth key (admin console > Settings > Keys > Generate auth key).
# Use a one-off, pre-approved key tagged tag:homelab. It is only needed for the
# first start: delete it from here afterwards (login is kept in ${APPDATA}/tailscale).
TS_AUTHKEY=

# Machine name on your tailnet, and your tailnet DNS name (admin console > DNS,
# looks like tail1234.ts.net). Services are then at https://homelab.tail1234.ts.net:<port>
TS_HOSTNAME=homelab
TS_TAILNET=tailnet-name.ts.net

# Extra flags for `tailscale set` (usually empty)
TS_EXTRA_ARGS=

# Plex: comma-separated URLs advertised to clients. Default: http://${HOST_ADDR}:32400/
# To use Plex over Tailscale: http://10.0.0.100:32400/,https://homelab.tail1234.ts.net:32400
# PLEX_ADVERTISE_URLS=
```

### 2.4 `setup.sh` (HL-12)

Make exactly these changes:

**(a)** Right after the line `SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"`, add:

```bash

# Relative paths in .env (APPDATA=./appdata) are relative to the repo, like docker compose
cd "${SCRIPT_DIR}"

# Read KEY=VALUE lines from an env file without executing it as shell code
load_env() {
    local line key value
    while IFS= read -r line || [[ -n "$line" ]]; do
        line="${line%$'\r'}"
        [[ "$line" =~ ^[[:space:]]*(#|$) ]] && continue
        if [[ "$line" =~ ^[[:space:]]*(export[[:space:]]+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
            key="${BASH_REMATCH[2]}"
            value="${BASH_REMATCH[3]}"
            if [[ "$value" =~ ^\"(.*)\"[[:space:]]*$ ]] || [[ "$value" =~ ^\'(.*)\'[[:space:]]*$ ]]; then
                value="${BASH_REMATCH[1]}"
            else
                # Unquoted: drop an inline " # comment" and trailing spaces, like docker compose
                value="${value%%[[:space:]]#*}"
                value="${value%"${value##*[![:space:]]}"}"
            fi
            export "${key}=${value}"
        fi
    done < "$1"
}
```

**(b)** Replace the block

```bash
    set -a
    source "${SCRIPT_DIR}/.env"
    set +a
```

with

```bash
    load_env "${SCRIPT_DIR}/.env"
    chmod 600 "${SCRIPT_DIR}/.env" 2>/dev/null || log_warn "Could not restrict permissions on .env"
```

**(c)** In the `APPDATA_DIRS=(` array, after the `"${APPDATA}/filebrowser/database"` line, add:

```bash

    # Remote access (only used with the 'remote' compose profile)
    "${APPDATA}/tailscale"
    "${APPDATA}/caddy/data"
    "${APPDATA}/caddy/config"
```

**(d)** After the `chown -R "${PUID}:${PGID}" "${APPDATA}" ...` line, add:

```bash
# Tailscale state holds the node's private key
chmod 700 "${APPDATA}/tailscale" 2>/dev/null || true
```

Do not change the rest of `setup.sh`, including the `.env.example` heredoc.

### 2.5 New file `docs/remote-access/tailscale-policy.example.hujson`

The owner pastes this into the Tailscale admin console (Access controls). Create exactly:

```hujson
// Example tailnet policy for this homelab. Paste into admin console > Access controls,
// then replace the example family address(es). Keep "tagOwners" before creating the auth key.
{
	"tagOwners": {
		"tag:homelab": ["autogroup:admin"],
	},

	"groups": {
		// People you invite who should only see Plex, Immich and Seerr
		"group:family": ["family-member@example.com"],
	},

	"acls": [
		// You (tailnet admins): everything on the server
		{"action": "accept", "src": ["autogroup:admin"], "dst": ["tag:homelab:*"]},

		// Family: Plex 32400, Immich 2283, Seerr 5055 only (no Rack, Netdata, *arr, qBittorrent, File Browser)
		{"action": "accept", "src": ["group:family"], "dst": ["tag:homelab:32400,2283,5055"]},

		// Everyone's own devices can still talk to each other
		{"action": "accept", "src": ["autogroup:member"], "dst": ["autogroup:self:*"]},
	],
}
```

### 2.6 Docs

- **`README.md`**: add a section `## Remote Access` directly **before** `## Security Considerations` (if the parallel agent already added a remote-access paragraph, merge into it rather than duplicating):

  ```markdown
  ## Remote Access

  Remote access goes through [Tailscale](https://tailscale.com) (a private WireGuard network), not open router ports. Two opt-in containers do this: `tailscale` joins your tailnet and `caddy` serves every app over HTTPS at `https://<TS_HOSTNAME>.<TS_TAILNET>:<usual port>` (Rack is on the plain `https://<TS_HOSTNAME>.<TS_TAILNET>`). FlareSolverr is never exposed.

  Set the `TS_*` variables in `.env`, then:

  ```bash
  docker compose --profile remote up -d
  ```

  Set `COMPOSE_PROFILES=remote` in `.env` to include them in every command. See [docs/remote-access/](docs/remote-access/) for the security report and setup steps.
  ```

  (Write the inner code fence normally. The outer fence above is only for this spec.)

- **`README.md` "Common Commands"**: after the `# Update all containers` command add:

  ```bash
  # Same, including the remote-access containers (not needed if COMPOSE_PROFILES=remote is in .env)
  docker compose --profile remote pull && docker compose --profile remote up -d --build
  ```

- **`README.md` "Security Considerations"**: replace the bullet `- Use a reverse proxy with HTTPS for external access` with `- For access away from home use the Tailscale + Caddy setup (see Remote Access), not router port forwards`. Add a bullet: `- In Radarr, Sonarr and Prowlarr set Authentication Required to "Enabled", not "Disabled for Local Addresses": behind Caddy every request looks local`.

- **`docs/rack.md` "Security"**: replace `- Do not expose port 4000 beyond your LAN.` with:

  ```markdown
  - Do not expose port 4000 beyond your LAN. For remote use, reach Rack over Tailscale at `https://<TS_HOSTNAME>.<TS_TAILNET>/` (see [remote access](remote-access/)); its links to the other apps then use HTTPS automatically, because Caddy serves each app on its usual port.
  ```

- **`docs/netdata.md`**: in "Tips", replace `- Consider connecting to Netdata Cloud for remote access` with `- For remote access use the Tailscale setup in [remote access](remote-access/) instead of Netdata Cloud`. In "Initial Setup", replace `2. No login required by default (configure if exposing externally)` with `2. No login. Never expose port 19999 to the internet; over Tailscale, limit it to your own devices (see the example policy in remote-access/)`.

- **Do not** write `docs/remote-access/README.md` (the owner's step-by-step guide). The orchestrator writes it from section 4. The README link above points at the directory, so it works either way.

### 2.7 Not in scope (do not do)

- Do not change any Rack code. Mirroring the ports makes links work.
- Do not pin or change existing app image tags.
- Do not add Authelia, tinyauth, a Docker socket proxy, Renovate or diun.
- Do not change Netdata capabilities.
- Do not touch `scripts/check-exposure.sh` beyond what section 3 asks for, if anything.

## 3. Validation (run all, report the results)

From `/home/user/homelab`:

```bash
# 1. Compose renders with ONLY the example env, with and without the profile
cp .env.example .env
docker compose config -q && echo OK-default
docker compose --profile remote config -q && echo OK-remote
docker compose --profile remote config | grep -nE 'ADVERTISE_IP|CADDY_DOMAIN|network_mode|tailscale-socket'
#   expect: ADVERTISE_IP: http://10.0.0.100:32400/ ; CADDY_DOMAIN: homelab.tailnet-name.ts.net ;
#           network_mode: service:tailscale (Compose may print container:tailscale)
docker compose config --services | grep -E '^(tailscale|caddy)$' && echo "FAIL: remote services leak into default profile" || echo OK-profile
PLEX_ADVERTISE_URLS='http://a:32400/,https://b:32400' docker compose config | grep ADVERTISE_IP
#   expect the override value
docker compose --profile remote config | grep -n 'published' 
#   expect no published ports under tailscale or caddy (eyeball the surrounding service names)
rm .env

# 2. Caddyfile syntax (needs a running Docker daemon; skip with a note if `docker info` fails)
docker info >/dev/null 2>&1 && docker run --rm -e CADDY_DOMAIN=homelab.tailnet-name.ts.net \
  -v "$PWD/caddy:/etc/caddy:ro" caddy:2.11.7 caddy adapt --config /etc/caddy/Caddyfile --adapter caddyfile >/dev/null && echo OK-caddy
#   If you can, also confirm the healthcheck flag: docker run --rm tailscale/tailscale:v1.104.4 tailscale status --help 2>&1 | grep -q peers && echo OK-peers-flag

# 3. Shell scripts
bash -n setup.sh && echo OK-setup-syntax
command -v shellcheck >/dev/null && shellcheck setup.sh scripts/*.sh || echo "shellcheck not installed: skipped"

# 4. setup.sh parser behaves (no root needed; uses a temp copy)
T=$(mktemp -d) && cp setup.sh "$T/" && cat > "$T/.env" <<'EOF'
APPDATA=./appdata
DATA_DIR=$T_SHOULD_NOT_EXPAND/data   # inline comment
UPLOAD_LOCATION="./up loads"
DB_DATA_LOCATION='./db'
EVIL=$(touch /tmp/pwned-by-env)
PUID=1000
PGID=1000
EOF
(cd / && DATA_DIR= bash "$T/setup.sh" >/dev/null 2>&1); ls "$T"; test ! -e /tmp/pwned-by-env && echo OK-no-exec
#   expect: $T/appdata/{tailscale,caddy/data,caddy/config} exist, a literal directory named '$T_SHOULD_NOT_EXPAND'
#   under $T, "$T/up loads" exists, $T/.env has mode 600 (stat -c %a "$T/.env"), and /tmp/pwned-by-env does NOT exist.
rm -rf "$T"
```

Rack tests: **not required** because no Rack code changes. If you do touch `rack/`, run `cd rack/server && npm ci && npm test && npm run typecheck`. Rack needs Node ≥24 and this environment has Node 22, so report that and skip the run rather than "fixing" it.

## 4. Manual steps for the owner (in order; the orchestrator will rewrite these)

1. **Fix logins first, before anything goes remote.**
   1. File Browser: log in (password from `docker logs filebrowser` on first start, or `admin`/`admin` on old installs), change it to a strong unique one, and create a normal user for daily use.
   2. qBittorrent: Tools → Options → Web UI. Set a strong password. Make sure both "Bypass authentication for clients on localhost" and "...in whitelisted IP subnets" are **off**. Turn on "Enable reverse proxy support" with trusted proxies `172.16.0.0/12`. Put the new login in `.env` as `RACK_QBITTORRENT_*`.
   3. Radarr, Sonarr and Prowlarr: Settings → General → Security. Authentication = Forms, Authentication Required = **Enabled** (not "Disabled for Local Addresses"), strong unique password.
   4. Immich: if `DB_PASSWORD` is still the example value, change it **before first start** (changing it later needs a Postgres password change too). Turn on 2FA/OAuth if you want.
   5. Seerr: check that sign-in works only with Plex accounts you approve.
2. **Router.**
   1. Turn off UPnP / NAT-PMP.
   2. Delete any port forwards to the server.
   3. Check that inbound IPv6 is blocked.
   4. Give the server a DHCP reservation, so it always gets the same LAN IP.
3. **Optional LAN hardening:** in `.env` set `BIND_ADDR=<server LAN IP>` (same as `HOST_ADDR` if that is an IP), then run `docker compose up -d`.
4. **Tailscale account:** sign up at tailscale.com with an account that has 2FA (Google, GitHub, Apple or Microsoft).
5. **Admin console → DNS:** make sure **MagicDNS** is on. Under "HTTPS Certificates" click **Enable**. Note the tailnet name (`tailXXXX.ts.net`). It will appear in public certificate logs, so you can rename it to a random-looking one first if you prefer.
6. **Admin console → Access controls:** paste `docs/remote-access/tailscale-policy.example.hujson`. Put family emails in `group:family`, or remove that line if there is no family yet. Save. (The `tag:homelab` owner must exist before step 7.)
7. **Admin console → Settings → Keys → Generate auth key:** reusable **off**, ephemeral **off**, pre-approved **on**, tags = `tag:homelab`, expiry 1 day.
8. **`.env`:** set `TS_AUTHKEY=<key>`, `TS_TAILNET=tailXXXX.ts.net`, and keep `TS_HOSTNAME=homelab` unless that name is already taken on your tailnet. Optionally uncomment `COMPOSE_PROFILES=remote`.
9. **Start it:** `./setup.sh && docker compose --profile remote up -d`. Check with `docker compose logs tailscale caddy` that Caddy says it obtained a certificate for `homelab.tailXXXX.ts.net`.
10. **Remove the key:** delete the `TS_AUTHKEY` value from `.env`. The node stays logged in, and tagged nodes do not expire.
11. **Admin console:** under Settings, turn on **Device approval**. Optionally turn on Tailnet Lock.
12. **Your devices:** install the Tailscale app on your phone and laptop, sign in, and open `https://homelab.tailXXXX.ts.net` (Rack). Rack's links open each app.
13. **Phone apps** (Tailscale VPN on):
    - Immich app: server URL `https://homelab.tailXXXX.ts.net:2283`. Turn on background backup.
    - Plex app: sign in normally.
    - Optional *arr/qBittorrent apps (e.g. nzb360, LunaSea): use `https://homelab.tailXXXX.ts.net:<port>`.
    - Seerr in the browser: `...:5055`.
14. **Plex over Tailscale:** set `PLEX_ADVERTISE_URLS=http://<LAN IP>:32400/,https://homelab.tailXXXX.ts.net:32400` in `.env`, then `docker compose up -d plex`.
15. **Plex for family without Tailscale (optional):**
    1. Plex → Settings → Remote Access → enable it, then "Manually specify public port" = 32400.
    2. Forward TCP 32400 on the router to the server by hand.
    3. Remote streaming needs a Plex Pass (yours) or a Remote Watch Pass (theirs).
    4. Do not publish anything else.
16. **Family with Tailscale (optional):** admin console → Users → Invite (free plan: up to 6 users). Add each email to `group:family` in the policy.
17. **Verify:** run section 6 of the security report (`./scripts/check-exposure.sh`, `nmap` from a phone hotspot, and test with Tailscale on and off).
18. **Updates:** about once a week, `docker compose --profile remote pull && docker compose --profile remote up -d --build`. Read release notes for Netdata and Plex. Change the pinned `tailscale`/`caddy` tags in `compose.yml` by hand every few months (check Docker Hub for the newest `tailscale/tailscale:vX.Y.Z` and `caddy:2.x.y`).

## Appendix A: alternative TLS with your own domain (documented only)

Use this if you want `sonarr.home.example.com` style names or ever need a public hostname.

- Build Caddy with a DNS plugin: a `caddy/Dockerfile` using `FROM caddy:2.11.7-builder AS build` then `RUN xcaddy build --with github.com/caddy-dns/cloudflare`, then `FROM caddy:2.11.7` and `COPY --from=build /usr/bin/caddy /usr/bin/caddy`. Point the compose service at `build: ./caddy`.
- Add `CF_API_TOKEN` (Zone.DNS edit, one zone only) to `.env`. In the Caddyfile global block: `acme_dns cloudflare {env.CF_API_TOKEN}`.
- Public DNS: `*.home.example.com A <tailscale IP of the homelab node>` (100.x.y.z). The names resolve publicly but only work from inside the tailnet. One site block per hostname, e.g. `sonarr.home.example.com { reverse_proxy sonarr:8989 }`.
- Rack links then need `url:` overrides per service in `rack.yml`, because the port scheme is gone.

## Appendix B: kernel-mode Tailscale (only if throughput is a problem)

Add `devices: [/dev/net/tun:/dev/net/tun]`, `cap_add: [NET_ADMIN, NET_RAW]` and `TS_USERSPACE=false` to the `tailscale` service. Peers then reach the container's tailnet IP directly, and Caddy still listens on the same ports. Re-run the section 6 checks from the security report afterwards.
