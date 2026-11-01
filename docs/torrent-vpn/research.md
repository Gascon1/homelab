# qBittorrent through NordVPN: gluetun or something else? (research, 2026-11-01)

This note checks whether gluetun (`qmcgaw/gluetun`) with qBittorrent in `network_mode: service:gluetun` is the right way to route qBittorrent through NordVPN in this stack, and what breaks when you do it. Nothing in the repo was changed and nothing was committed. The note was peer-reviewed on 2026-11-01 against source code. That review corrected the Rack, firewall, interface-name, server-category and secrets claims.

**How each claim was checked.** The sandbox could not reach `support.nordvpn.com`, `hotio.dev`, `docs.linuxserver.io` or the NordVPN API. Claims are labelled:

- **[src]**: read in source code at a named commit. The commits are gluetun `151fb7a` (2026-10-29), gluetun-servers `0c7381f` (2026-08-06), docker/compose `57751f3` (2026-10-30), hotio/base `alpinevpn` `b920192`, and qBittorrent `master` on 2026-11-01.
- **[wiki]**: read in the gluetun-wiki repo (default branch, 2026-11-01).
- **[docs]**: read in the docker/docs repo source (`content/...`, main, 2026-11-01).
- **[index]**: read only in a search-result snippet or in a summary of a fetched page.
- **unverified**: not confirmed against a primary source, or not runnable here.

## TL;DR

**Recommendation: yes. Use gluetun with qBittorrent in its network namespace, NordVPN WireGuard (NordLynx), `SERVER_COUNTRIES=Canada`, `SERVER_CATEGORIES=P2P`, and the pinned image `qmcgaw/gluetun:v3.41.3`.** It is gluetun's documented pattern, the firewall is a kill switch, and it keeps the linuxserver image and its `/config`. The current SOCKS5 setup in `docs/qbittorrent.md` works inside the application only and has no kill switch.

Top gotchas:

1. **NordVPN has no port forwarding on standard servers**, so no peer can connect in. Remove the `6881` publish and expect fewer peers [index: Nord support]. gluetun does not support port forwarding for Nord [wiki: port-forwarding].
2. **Ports move to gluetun.** qBittorrent can declare neither `networks` [docs: compose `network_mode`] nor `ports` [docs: engine "Container networks": `--publish`/`--expose` are unsupported]. The `x-ls-common` anchor adds `networks`, so qBittorrent cannot use it.
3. **Add the network alias `qbittorrent` on gluetun.** With it, Sonarr, Radarr, Caddy (`reverse_proxy qbittorrent:8080`) and Rack (`http://qbittorrent:8080`) keep working unchanged. **Keep the Rack labels on qBittorrent. Do not move them to gluetun** (section 6).
4. **Set `SERVER_CATEGORIES=P2P`.** Without it, gluetun may pick a Canadian "Dedicated IP" or "Double VPN" server, because nothing excludes them by default [src: `internal/storage/filter.go`; gluetun-servers `nordvpn.json`].
5. **If gluetun restarts outside Compose, qBittorrent loses all network** (it fails closed, so nothing leaks) until qBittorrent is restarted. `depends_on: {condition: service_healthy, restart: true}` only covers Compose-driven restarts (section 3).
6. **`FIREWALL_INPUT_PORTS` is not needed.** gluetun already accepts any source to its Docker-network address [src: `internal/firewall/enable.go`].
7. **The deploy timer runs `docker compose up --wait`** (`scripts/deploy.sh:296`). If gluetun cannot connect (for example, the key is missing), every deploy rolls back. Put the key in place before the compose change lands on the server.

## 1. Alternatives compared

| Option | Kill switch | Verdict for this stack |
|---|---|---|
| **Nord SOCKS5 proxy in qBittorrent** (current docs) | None at the firewall. Traffic that does not use the proxy (for example tracker, DHT or DNS traffic, depending on settings) goes out directly. | Not recommended. In qBittorrent the options are "Use proxy for BitTorrent purposes" and, under it, "Use proxy for peer connections" [src: qBittorrent `src/gui/optionsdialog.ui`]. |
| **gluetun sidecar, `network_mode: service:gluetun`** | Yes. iptables default-deny; outbound traffic is allowed only to the VPN endpoint [wiki: faq/firewall]. | **Recommended** [wiki: connect-a-container-to-gluetun]. |
| **hotio/qbittorrent with `VPN_ENABLED=true`** | Yes (built-in WireGuard and iptables) [src: hotio/base `alpinevpn`]. | Workable, but worse for Nord. It supports WireGuard only, with `VPN_PROVIDER` = `generic`, `pia` or `proton` (default `generic`). For Nord you must write `/config/wireguard/wg0.conf` by hand for one fixed server (endpoint and public key), with no server selection or rotation. It needs `NET_ADMIN` and `VPN_LAN_NETWORK`, and it also changes the image and `/config` layout [src: `linux-amd64.Dockerfile` ENV, `init-wireguard/run`]. hotio.dev docs were unreachable, so sysctl requirements are unverified. |
| **binhex/arch-qbittorrentvpn** | Yes [index: README]. | Nord is not a named provider; only a custom config would work [index]. Not recommended. |
| **VPN on the router or host** | Depends on rules you write. | Not recommended here. |

## 2. NordVPN specifics in gluetun

**Protocol.** Use `VPN_TYPE=wireguard` (NordLynx): it is faster than OpenVPN and needs only the private key [wiki: providers/nordvpn]. gluetun sets Nord's interface address to `10.5.0.2/32` by default, so `WIREGUARD_ADDRESSES` is not needed [src: `internal/configuration/settings/wireguard.go:172`].

**Getting the private key.** gluetun-wiki issue 15 (thread summary from 2026-07-11) and community gists describe this method [index: github.com/qdm12/gluetun-wiki/issues/15; gist bluewalk/7b3db071]:

1. Generate an access token at `https://my.nordaccount.com/dashboard/nordvpn/access-tokens/` (the wiki also points to the manual-configuration area).
2. `curl -s -u 'token:<ACCESS_TOKEN>' https://api.nordvpn.com/v1/users/services/credentials | jq -r .nordlynx_private_key`
3. If the key contains `\/`, remove the backslashes. The key is 44 base64 characters. If gluetun reports `incorrect key size: 48`, you pasted the access token instead of the key [src: `wireguard.go:70`].

Nord's own support page for this was unreachable, so whether the dashboard now shows the key directly is **unverified**. The key is long-lived and tied to the account. Treat it like a password.

**Server selection** [src: gluetun-servers `pkg/servers/nordvpn.json`, `0c7381f`]:

- `SERVER_COUNTRIES=Canada` is the exact string. Matching is case-insensitive [src: `filter.go`]. Canadian cities are Calgary, Montreal, Toronto and Vancouver (`SERVER_CITIES=Toronto` is optional).
- Nord categories are `Standard VPN servers`, `P2P`, `Dedicated IP`, `Double VPN` and `Onion Over VPN`. Every Canadian standard server also has `P2P`, so set **`SERVER_CATEGORIES=P2P`**. This also keeps out Dedicated IP servers, which an ordinary subscription cannot use [src: `internal/provider/nordvpn/updater/models.go` `categories()`].
- Avoid `SERVER_HOSTNAMES`, which the wiki calls fragile [wiki: nordvpn].
- Check what gluetun will pick with `docker run --rm qmcgaw/gluetun:v3.41.3 format-servers -nordvpn` [src: `internal/cli/formatservers.go`].

**Port forwarding.** gluetun's built-in port forwarding covers PIA, Perfect Privacy, PrivateVPN and ProtonVPN, not Nord [wiki: options/port-forwarding]. Nord offers forwarding only with its Dedicated Server add-on [index: support.nordvpn.com article 19483392309649; page not opened]. Outbound peers, DHT and PeX still work.

## 3. Kill switch and restart behaviour

**Firewall.** INPUT, OUTPUT and FORWARD default to drop. Outbound traffic is allowed only through the VPN interface and to the VPN server's IP, port and protocol, and the firewall cannot be disabled [wiki: faq/firewall; Dockerfile `FIREWALL_ENABLED_DISABLING_IT_SHOOTS_YOU_IN_YOUR_FOOT=on`]. While the tunnel is down, qBittorrent has no route out: it does not fall back to your ISP.

**Tunnel drops.** gluetun checks the tunnel itself. A failed check restarts the VPN inside the container; the container does not restart, so qBittorrent is unaffected [wiki: faq/healthcheck]. The checks are a startup check, a small check every minute (ICMP to `1.1.1.1,8.8.8.8`) and a full TCP+TLS check every 5 minutes (`cloudflare.com:443,github.com:443`). `HEALTH_RESTART_VPN=on` is the default [src: Dockerfile].

**Container restart or recreation** [docs: compose `depends_on`; src: compose `pkg/compose/reconcile.go`]:

| What happens to gluetun | Effect on qBittorrent | Fixed by |
|---|---|---|
| Compose recreates it (`docker compose up -d` after an image or config change) | Current Compose cascades the recreate to `network_mode: service:` dependents (`parentNamespaceRecreated`). | Automatic (Compose main; **unverified** for older 2.x versions) |
| `docker compose restart gluetun` | Restarted after gluetun | `depends_on.restart: true` |
| `docker restart gluetun`, a crash plus the daemon restart policy, or a host reboot ordering race | Keeps running in the old, dead namespace with loopback only. It fails closed, but downloads stall until qBittorrent is restarted. The restart policy does not fire because qBittorrent did not exit. | Nothing automatic. Run `docker compose restart qbittorrent`. The Compose docs say `restart: true` "excludes automated restart by the container runtime" [docs]. |

The wiki confirms that connected containers "lose connection once Gluetun is restarted" [wiki: faq/healthcheck]. The orphaned-namespace mechanics come from Linux namespace semantics and community reports; they were not run here (**unverified**). To make this case visible in Rack, the snippet adds a qBittorrent healthcheck against gluetun's health server at `127.0.0.1:9999`. That server is reachable only from inside the shared namespace, so the check fails both when the tunnel is down and when the namespace is orphaned [src: Dockerfile `HEALTH_SERVER_ADDRESS`, `internal/healthcheck/handler.go`]. Docker does not restart unhealthy containers by itself.

**Image healthcheck.** `--interval=5s --timeout=5s --start-period=10s --retries=3`, running `/gluetun-entrypoint healthcheck`, which queries the health server [src: Dockerfile:294]. The wiki FAQ still shows `--retries=1`; the source wins. `service_healthy` and the deploy's `--wait --wait-timeout 300` use this healthcheck.

## 4. Networking

**Ports.** Publish `${BIND_ADDR:-0.0.0.0}:8080:8080` on gluetun [wiki: port-mapping]. Keep 8080 on both sides: qBittorrent compares the Host header's port with its own listening port (section 5).

**Other containers.** Containers on `homelab` reach gluetun-attached apps at `gluetun:<port>` [wiki: inter-containers-networking]. The alias `qbittorrent` on gluetun's `homelab` endpoint makes `qbittorrent:8080` resolve to gluetun. No container named `qbittorrent` is on that network any more, so the alias does not conflict. Sonarr and Radarr download-client settings and the Caddyfile need no change. The alias was verified in the Compose spec but not tested on this host.

**Firewall input (LAN, Caddy, Rack, Sonarr, Radarr).** `FIREWALL_INPUT_PORTS` is **not needed**. For each local network, gluetun adds `iptables -A INPUT -i eth0 -d <docker subnet> -j ACCEPT`, with the comment "Allows packets from any IP address to go through eth0 / local network to reach Gluetun" [src: `internal/firewall/enable.go:112-118`, `firewall/iptables/iptables.go` `AcceptInputToSubnet`]. A LAN request DNAT'd by Docker arrives on eth0 addressed to gluetun's Docker IP, so it is accepted whatever its source. Replies leave through eth0, not the tunnel, because of an `ip rule` from gluetun's eth0 address to routing table 200 [src: `internal/routing/inbound.go`]. The wiki says the variable "seems needed for Kubernetes sidecars" [wiki: options/firewall]. A LAN test is still worth running.

**`FIREWALL_OUTBOUND_SUBNETS`.** Not needed: qBittorrent never initiates connections to the LAN. If you add it, it must not overlap the Nord tunnel address `10.5.0.2/32` [wiki: options/firewall; src: `wireguard.go`].

**DNS.** gluetun runs its own DNS server, which uses DNS-over-TLS to Cloudflare through the tunnel by default (`DNS_UPSTREAM_RESOLVER_TYPE=DoT`, `DNS_UPSTREAM_IPV6=off`) [src: Dockerfile; wiki: options/dns]. Do not set `DNS_UPSTREAM_PLAIN_ADDRESSES` to the router. qBittorrent uses gluetun's resolver because Docker gives a `container:`-mode container the provider's `resolv.conf` (**unverified**: from Docker behaviour, not read in moby source here). Since v3.41, gluetun-attached containers can also resolve other containers by name [wiki: inter-containers-networking].

**IPv6.** No `sysctls` are needed: leave IPv6 off. The `homelab` network does not set `enable_ipv6`, Nord's WireGuard config here is IPv4-only, and gluetun's firewall also programs `ip6tables` [wiki: faq/firewall]. The wiki's IPv6 setup (daemon `ipv6`, `net.ipv6.conf.all.disable_ipv6=0`, `enable_ipv6` on the network, IPv6 in `WIREGUARD_ADDRESSES`) is only for providers with dual-stack support [wiki: advanced/ipv6]. The wiki reports that a user confirmed nothing leaks over IPv6 (gluetun-wiki issue 70). Test with `curl -6` (section 9).

**Caddy and Tailscale.** Caddy shares the tailscale namespace and reaches `qbittorrent:8080` over `homelab` like any other container. That works through the alias with no Caddyfile change.

## 5. qBittorrent settings

Source: qBittorrent `master` (`src/webui/webapplication.cpp`, `src/base/preferences.cpp`, `src/gui/optionsdialog.ui`).

| Setting | With gluetun | Reason |
|---|---|---|
| Proxy type | None | Remove the Nord SOCKS5 proxy, along with "Use proxy for BitTorrent purposes" and "Use proxy for peer connections" (the labels exist under those names [src: `optionsdialog.ui`]). |
| Advanced > Network interface | Optional: `tun0` | gluetun's interface is **`tun0` for WireGuard too** (`VPN_INTERFACE=tun0`) [src: Dockerfile], not `wg0`. The firewall is already the kill switch. Binding adds defence in depth but can stall after an internal VPN restart [index: qBittorrent wiki How-to-bind-your-vpn]. Leave it empty unless you want the extra layer. |
| UPnP / NAT-PMP | Off | It cannot work through gluetun. |
| Listening port | Any (default 6881) | Nothing can reach it from outside. |
| Host header validation | Leave on | `WebUI/ServerDomains` defaults to `*`, so in practice only the Host header's port is checked against the local port (8080) [src: `validateHostHeader`]. `qbittorrent:8080` (Rack, Sonarr), `<LAN-IP>:8080` and `homelab.<tailnet>.ts.net:8080` (Caddy passes Host through) all pass. gluetun does not change this. |
| CSRF protection | Leave on | On `master`, the browser's `Sec-Fetch-Site` header is checked first (it must be `same-origin` or `none`). Otherwise Origin, then Referer, must match the Host header by host and port, and the scheme is ignored [src: `isCrossSiteRequest`]. Caddy's HTTPS termination and Rack's `Origin: http://qbittorrent:8080` pass. Whether the `Sec-Fetch-Site` branch is in a released 5.x version is unverified. |
| Reverse proxy support, auth bypass for localhost or subnets | Off | Unchanged from HL-06 in `docs/remote-access/security-report.md`. |
| `WEBUI_PORT` | `8080` | Must match the published port. |

## 6. Rack and dashboard impact

The note previously said Rack breaks and the labels must move to gluetun. **That is wrong once the alias exists, and moving the labels is the worse option.** From the source [src: `rack/server/src/docker.ts`, `resolve.ts`, `engine.ts`, `apps/qbittorrent.ts`]:

- The `qbittorrent` container still carries `rack.enable=true` and its Compose service label, so it is listed with id `qbittorrent`, and the widget matches by that id.
- Its Docker `Ports` list is empty, because a `container:` network container cannot publish or expose ports [docs]. `derivePorts` takes the explicit `rack.port=8080` for both the public and private port, so the link stays `:8080`.
- The internal URL is `http://${container.name}:8080` = `http://qbittorrent:8080`, which resolves through gluetun's alias. The health check and the widget (login with `Origin`/`Referer` = `http://qbittorrent:8080`) work.
- Rack marks the card stopped from **qBittorrent's own** container state (`engine.ts` `checkHealth`). If the labels moved to gluetun, a crashed qBittorrent would show as running, and `rack.widget`/`rack.name`/`rack.icon` would all need to be set by hand.

**Minimal fix: none in Rack.** Keep `rack.enable=true` and `rack.port=8080` on qBittorrent, and add the alias. Update the label comment, which mentions 6881. Do not add `rack.enable` to gluetun: it would show a second card that links to 8080 and health-checks `http://gluetun:8080`. If you ever drop the alias, set `rack.internal=http://gluetun:8080` on qBittorrent instead. The internal URL can also be set through the `internal` key in `rack.yml`. This analysis comes from reading the source; Rack was not run.

`apps/arr.ts` only reads Sonarr and Radarr API keys. The download-client host lives in their own UI settings (`qbittorrent`), which the alias keeps working.

## 7. Control server and other gluetun features

- **Control server** on `:8000` [src: Dockerfile `HTTP_CONTROL_SERVER_ADDRESS=":8000"`]. Since v3.39.1 the vulnerable routes require auth. v3.40.0 kept the documented routes open "until after this release" and logged a warning when one was used. From v3.41.0, every route is private and `HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE` (JSON, default `{}`, which returns 401 everywhere) was added. v3.41.2 changed unauthenticated responses to 404 or 405 depending on the route [wiki: advanced/control-server; index: GitHub releases page summary].
- **Nothing in this design depends on the control server.** The Docker healthcheck uses the separate health server on `127.0.0.1:9999`. Do not publish 8000 and leave auth at its default. Configure a role only if you later want `GET /v1/publicip/ip`, for example from a Rack widget.
- The HTTP proxy and Shadowsocks are off by default; leave them off.

## 8. Image pinning

`v3.41.3` is the latest release: GitHub "Latest", 2026-07-30, and on Docker Hub as `v3.41.3` and `v3.41`, `v3` [src: `git ls-remote --tags`; Docker Hub tags API]. `latest` tracks the development branch (last pushed 2026-10-29) [wiki: docker-image-tags]. Pin `v3.41.3`. A digest pin is optional.

## 9. Leak and kill-switch tests

None of these were run on this host.

```sh
# Same Nord IP from both (one namespace); the host must show your ISP IP
docker exec gluetun wget -qO- https://ipinfo.io/ip
docker exec qbittorrent curl -s https://ipinfo.io/ip
curl -s https://ipinfo.io/ip

# IPv6: expect no route
docker exec qbittorrent curl -6 -m 5 -s https://ipv6.ipleak.net/json/ || echo "no IPv6 route (good)"

# Kill switch: take the tunnel down; qBittorrent must NOT fall back to eth0
docker exec gluetun ip link set tun0 down
docker exec qbittorrent curl -m 5 -s https://ipinfo.io/ip || echo "blocked (good)"
# gluetun's health check restarts the VPN internally within about a minute; no container restart is needed
docker logs --since 2m gluetun | grep -i restarting

# LAN, Caddy and Rack reachability (FIREWALL_INPUT_PORTS unset)
curl -s -o /dev/null -w '%{http_code}\n' http://<LAN-IP>:8080/
docker exec rack wget -qO- http://qbittorrent:8080/api/v2/app/version   # 403 without login is fine; a DNS error is not
```

Also check that every IP in qBittorrent's Peers tab belongs to a peer, and use a torrent-IP checker that hands you a tracker magnet (whether ipleak.net's "Torrent Address detection" does this is **unverified**).

## Proposed compose snippet

Checked against this repo's `compose.yml`; not run.

```yaml
  gluetun:
    image: qmcgaw/gluetun:v3.41.3
    container_name: gluetun
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    networks:
      homelab:
        aliases: [qbittorrent]  # Sonarr, Radarr, Caddy and Rack keep using qbittorrent:8080
    environment:
      - TZ=${TZ}
      - VPN_SERVICE_PROVIDER=nordvpn
      - VPN_TYPE=wireguard
      - SERVER_COUNTRIES=${VPN_SERVER_COUNTRIES:-Canada}
      - SERVER_CATEGORIES=P2P  # also keeps out Dedicated IP / Double VPN servers
      # WIREGUARD_PRIVATE_KEY is read from /run/secrets/wireguard_private_key (gluetun's default)
    secrets:
      - wireguard_private_key
    ports:
      - '${BIND_ADDR:-0.0.0.0}:8080:8080' # qBittorrent Web UI (no torrent port: Nord has no port forwarding)
    # No rack.* labels: the qBittorrent card stays on the qbittorrent container
    restart: unless-stopped
    logging: *logging

  qbittorrent:
    # No x-ls-common anchor: it adds `networks`, which Compose rejects with network_mode
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: qbittorrent
    network_mode: 'service:gluetun'
    depends_on:
      gluetun:
        condition: service_healthy
        restart: true
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - TZ=${TZ}
      - UMASK=002
      - WEBUI_PORT=8080
    volumes:
      - ${APPDATA}/qbittorrent:/config
      - ${DATA_DIR}/torrents:/data/torrents
    healthcheck:
      # gluetun's health server, reachable only inside the shared namespace: fails when the
      # tunnel is down or when gluetun was restarted without qBittorrent (stale namespace)
      test: ['CMD', 'curl', '-fsS', '-m', '5', 'http://127.0.0.1:9999/']
      interval: 60s
      timeout: 10s
      retries: 3
      start_period: 30s
    labels:
      - rack.enable=true
      - rack.port=8080 # no published ports on this container; Rack uses http://qbittorrent:8080 via the alias
    stop_grace_period: 30s
    restart: unless-stopped
    logging: *logging

# top level, next to volumes:
secrets:
  wireguard_private_key:
    file: ${APPDATA}/gluetun/wireguard_private_key  # chmod 600; never in git
```

Notes:

- **Why a secret file, not `.env`:** the repo already warns that anything with the Docker socket (Rack, Netdata) can read container environment variables through `docker inspect` (`.env.example`, TS_AUTHKEY note). Unlike the Tailscale auth key, the Nord key is long-lived. gluetun reads `WIREGUARD_PRIVATE_KEY_SECRETFILE=/run/secrets/wireguard_private_key` by default [src: Dockerfile:105], and Compose mounts file secrets at `/run/secrets/<name>`. A simpler alternative is `WIREGUARD_PRIVATE_KEY=${NORDVPN_WIREGUARD_PRIVATE_KEY:-}` in `.env`, which accepts that exposure. Whether `docker compose up` fails cleanly when the secret file is missing, and whether `docker compose config` (used by `check-exposure.sh`) still works then, is **unverified**.
- `curl` is in the linuxserver Alpine base image [src: linuxserver/docker-baseimage-alpine `Dockerfile`, master].
- `check-exposure.sh` needs no change. It reads ports from `docker compose config` and `docker ps`, so 8080 now shows under `gluetun`. 8080 is not in `RISKY_PORTS`, and 6881 disappears.

## Repo changes for the implementer

1. `compose.yml`: add the `gluetun` service and the top-level `secrets:` block. Rewrite `qbittorrent` as above (no anchor, `network_mode`, `depends_on`, healthcheck, no `ports`), and update its `rack.port` comment.
2. `.env.example`: add optional `VPN_SERVER_COUNTRIES=Canada` with a comment pointing to `docs/torrent-vpn/`, and a note on where the key file lives. Change "Plex and the qBittorrent torrent ports always stay on all interfaces" to Plex only.
3. `docs/qbittorrent.md`: replace the SOCKS5 section with the gluetun setup (key procedure, P2P category, no port forwarding, restart caveat, tests). Drop "Listening Port: 6881 (ensure port forwarding on router)" and the 6881 row in the ports table.
4. `docs/remote-access/MANUAL-STEPS.md` (lines ~239 and ~517) and `docs/remote-access/security-report.md` (HL-01 and HL-16 text about 6881): remove the 6881 mentions.
5. No change to `caddy/Caddyfile`, `scripts/check-exposure.sh` or Rack code, because the alias keeps every `qbittorrent:8080` reference working.
6. On the server, before deploying: create `${APPDATA}/gluetun/wireguard_private_key`, or the deploy's `up --wait` fails and rolls back.

## Sources

- gluetun source, https://github.com/qdm12/gluetun at `151fb7a`: `Dockerfile`, `internal/firewall/enable.go`, `internal/firewall/iptables/iptables.go`, `internal/routing/inbound.go`, `internal/storage/filter.go`, `internal/configuration/settings/wireguard.go`, `internal/provider/nordvpn/updater/models.go`, `internal/healthcheck/handler.go`, `internal/cli/formatservers.go`.
- gluetun server data: https://github.com/qdm12/gluetun-servers/blob/main/pkg/servers/nordvpn.json (`0c7381f`).
- gluetun wiki: https://github.com/qdm12/gluetun-wiki, pages `setup/providers/nordvpn.md`, `setup/connect-a-container-to-gluetun.md`, `setup/inter-containers-networking.md`, `setup/port-mapping.md`, `setup/options/firewall.md`, `setup/options/dns.md`, `setup/options/port-forwarding.md`, `setup/options/wireguard.md`, `setup/advanced/control-server.md`, `setup/advanced/ipv6.md`, `setup/docker-image-tags.md`, `faq/firewall.md`, `faq/healthcheck.md`; issue https://github.com/qdm12/gluetun-wiki/issues/15 [index].
- gluetun releases: https://github.com/qdm12/gluetun/releases [index]; Docker Hub tags API for `qmcgaw/gluetun`.
- Docker docs source: https://github.com/docker/docs, files `content/reference/compose-file/services.md` (`depends_on` long syntax, `network_mode`) and `content/manuals/engine/network/_index.md` ("Container networks").
- docker/compose source, `pkg/compose/reconcile.go` at `57751f3` (`parentNamespaceRecreated`).
- qBittorrent source, `master`: `src/webui/webapplication.cpp`, `src/gui/optionsdialog.ui`, `src/webui/www/private/views/preferences.html`.
- hotio: https://github.com/hotio/qbittorrent (`release`, `67daff7`) and https://github.com/hotio/base (`alpinevpn`, `b920192`).
- NordVPN, not reachable, so [index] only: https://support.nordvpn.com/hc/en-us/articles/19483392309649 (port forwarding), https://gist.github.com/bluewalk/7b3db071c488c82c604baf76a42eaad3 (key via API).
- Repo files read: `compose.yml`, `.env.example`, `caddy/Caddyfile`, `scripts/check-exposure.sh`, `scripts/deploy.sh`, `docs/qbittorrent.md`, `docs/rack.md`, `docs/remote-access/security-report.md`, `docs/remote-access/MANUAL-STEPS.md`, `rack/server/src/{docker,resolve,engine}.ts`, `rack/server/src/apps/{qbittorrent,arr}.ts`.

## Still unverified

- NordVPN's official key procedure and whether the dashboard now shows the key directly (support.nordvpn.com unreachable). The token-plus-API method is from community sources.
- Nord's port-forwarding policy (search snippet only).
- How older Compose 2.x handles cascading a gluetun recreate to qBittorrent (current Compose main does it).
- The orphaned-namespace behaviour after `docker restart gluetun`, and that a `container:`-mode container gets the provider's `resolv.conf` (not read in moby source; not run).
- hotio sysctl and IPv6 requirements (hotio.dev unreachable; read from source only).
- How Compose behaves when the secret file is missing.
- Whether qBittorrent's `Sec-Fetch-Site` CSRF branch is in the release the linuxserver image ships.
- Every runtime test in section 9, the snippet, and the Rack analysis (all from reading source, none run).
