# qBittorrent through NordVPN: gluetun or something else? (research, 2026-11-01)

This note checks whether gluetun (`qmcgaw/gluetun`) with qBittorrent in `network_mode: service:gluetun` is the right way to route qBittorrent through NordVPN in this stack, and what breaks when you do it. Nothing in the repo was changed and nothing was committed.

**How each claim was checked.** The sandbox could not open `support.nordvpn.com` with WebFetch, `docs.docker.com` or `docs.linuxserver.io`. Claims are labelled:

- **[src]**: read in source code or docs at a named commit. gluetun was cloned at `151fb7a` (2026-10-29), qBittorrent and compose-spec at their default branch heads on 2026-11-01.
- **[wiki]**: read in the gluetun-wiki repo (same clone date).
- **[index]**: read only in a search-result snippet, not the full page.
- **unverified**: not confirmed against a primary source, or not runnable here.

## TL;DR

**Recommendation: yes, gluetun with qBittorrent in its network namespace, using NordVPN WireGuard (NordLynx), a Canadian or nearby server, and a pinned gluetun release tag.** It is the documented gluetun pattern, it has a firewall kill switch, and it keeps the linuxserver image. The SOCKS5 proxy in `docs/qbittorrent.md` is application-level only and has no kill switch.

Top gotchas:

1. **NordVPN does not support port forwarding on standard servers.** Inbound peer connections will not work, so the `6881` publish must be removed and torrent speed and peer count will be lower. Port forwarding is only on the Dedicated Server add-on [index].
2. **Ports move to the gluetun service.** qBittorrent cannot declare `ports` or `networks` when it uses `network_mode: service:gluetun`. The shared `x-ls-common` anchor adds `networks`, so qBittorrent must not use it [src].
3. **Rack loses the qBittorrent container's own ports and DNS name.** Rack's internal URL becomes `http://qbittorrent:8080`, which should not resolve, so the widget breaks. Move the Rack labels to gluetun [src: `resolve.ts`, `docker.ts`].
4. **If gluetun restarts, qBittorrent must restart too.** Its network namespace disappears. Use `depends_on` with `condition: service_healthy` and `restart: true` [wiki: faq/healthcheck; compose-spec].
5. **Sonarr, Radarr and Caddy must still reach `qbittorrent:8080`.** A Compose network alias on the gluetun service keeps those names working without changes [compose-spec: aliases].
6. **Pin the gluetun image.** `:latest` is the development edge [wiki: docker-image-tags].

## 1. Alternatives compared

| Option | Kill switch | Scope | Verdict for this stack |
|---|---|---|---|
| **Nord SOCKS5 proxy in qBittorrent** (current docs) | None at firewall level. Traffic that does not use the proxy goes out directly unless every path is proxied. | qBittorrent only, if configured correctly | Not recommended. libtorrent's proxy behaviour is documented, but a misconfigured peer path leaks [wiki: Disable-connections-not-supported-by-proxies]. Full Nord SOCKS5 page unverified. |
| **gluetun sidecar, `network_mode: service:gluetun`** | Yes. iptables default-deny, outbound only to the VPN endpoint [wiki: faq/firewall]. | qBittorrent (and any other service you attach) | **Recommended.** Documented pattern [wiki: connect-a-container-to-gluetun]. |
| **VPN on the router or host** | Depends on routing rules you write. | Whole LAN or host | Not recommended unless already in place. Not verified in detail here. |
| **binhex/arch-qbittorrentvpn** | Yes, "iptables to prevent IP leakage when the tunnel is down" [src: README via GitHub]. | Container | NordVPN is **not listed** in the fetched README (PIA, AirVPN, ProtonVPN, custom). Not recommended for Nord. |
| **hotio/qbittorrent** | Unknown | Container | Not evaluated. README could not be retrieved, so VPN features are unverified. |
| **linuxserver image + DOCKER_MODS VPN** | Unknown | Container | Not evaluated. The linuxserver README does not mention VPN or DOCKER_MODS [src: linuxserver/docker-qbittorrent README]. |

Why gluetun wins here: it is one extra container, it keeps the linuxserver image and its `/config` layout, and it has a documented firewall and health monitoring [wiki: faq/firewall, faq/healthcheck].

## 2. NordVPN specifics in gluetun

**WireGuard vs OpenVPN.** gluetun supports both for NordVPN. WireGuard (NordLynx) is the better choice for this use case: it is faster and needs one key, not a username and password. gluetun's NordVPN page shows both [wiki: setup/providers/nordvpn.md]. Use `VPN_TYPE=wireguard`. `VPN_TYPE` accepts `openvpn`, `wireguard` or `amneziawg` [src: `internal/configuration/settings/vpn.go`].

**Getting the WireGuard private key.** The gluetun wiki says the key must be taken from NordVPN's web interface, in the manual setup section, and links to gluetun-wiki issue 15 [wiki: nordvpn.md]. The Nord service credentials page at `https://my.nordaccount.com/dashboard/nordvpn/manual-configuration/service-credentials/` is the link the wiki gives. The exact page layout is unverified.

Community method (unverified, and it may have changed): create an access token in the same dashboard, then read `nordlynx_private_key` from the NordVPN API using the token as the basic-auth username [index: gist.github.com/bluewalk/7b3db071c488c82c604baf76a42eaad3]. Treat the key as a secret. Do not commit it, and keep it in `.env` only.

**Environment variables** [wiki: nordvpn.md, environment-variables]:

- Required: `VPN_SERVICE_PROVIDER=nordvpn`, `VPN_TYPE=wireguard`, `WIREGUARD_PRIVATE_KEY`.
- Location: `SERVER_COUNTRIES`, `SERVER_REGIONS`, `SERVER_CITIES`. Values are comma-separated. The exact country string `Canada` is unverified; list it with `format-servers` (below).
- Category: `SERVER_CATEGORIES` is matched against Nord's category titles [src: `internal/provider/utils/tier.go`, `internal/provider/nordvpn/updater/models.go`]. The title for peer-to-peer servers is unverified. List it with:
  `docker run --rm qmcgaw/gluetun format-servers -nordvpn --format markdown` (flag names are from `internal/cli/formatservers.go` [src]).
- Avoid `SERVER_HOSTNAMES`. The wiki calls it the narrowest filter and says it is fragile [wiki: nordvpn.md].

**P2P servers.** A category filter (`SERVER_CATEGORIES`) is the way to pick P2P servers, once the title is confirmed with `format-servers`. Nord's own P2P policy is unverified here.

**Port forwarding.** gluetun's built-in port forwarding covers PIA, Perfect Privacy, PrivateVPN and ProtonVPN only [wiki: setup/options/port-forwarding.md]. NordVPN is not in that list. NordVPN's own support article says standard servers and the Dedicated IP add-on cannot forward ports; only the Dedicated Server add-on can, with up to 20 rules [index: support.nordvpn.com/hc/en-us/articles/19483392309649]. Consequences: no inbound peers on the forwarded port, so you lose some connectivity and speed. Do not publish `6881` as if it worked. qBittorrent will still make outbound connections, and DHT and PeX still work.

**OpenVPN fallback.** NordVPN's own gluetun OpenVPN guide exists [index: support.nordvpn.com/hc/en-us/articles/47830508425745]. Use it only if WireGuard fails. It needs `OPENVPN_USER` and `OPENVPN_PASSWORD` set to the service credentials [wiki: nordvpn.md].

## 3. Kill switch and restart behaviour

**Firewall.** gluetun's firewall is strict by default: it drops incoming traffic except from the Docker network on the default route, drops outgoing traffic except to the VPN interface, server IP, port and protocol, and drops forwarded traffic. It is never turned off [wiki: faq/firewall]. Rules are set in about 15 ms at container start, before any proxy or service starts [wiki: faq/firewall].

**Tunnel drops.** gluetun monitors the connection. A failed check restarts the VPN inside the container, without restarting the container. Failed checks show up as `connection refused`, `operation not permitted`, or timeouts, which are consequences, not causes [wiki: faq/healthcheck]. The default periodic checks are: startup check (TCP+TLS within 6 s), per-minute ICMP/DNS check, and a 5-minute full TCP+TLS check [wiki: faq/healthcheck, options/healthcheck]. `HEALTH_RESTART_VPN` defaults to `on` and the wiki recommends keeping it on [wiki: options/healthcheck.md].

Because the firewall blocks non-VPN traffic, qBittorrent traffic stops during a drop. It does not fall back to your ISP. This is the kill switch. Test it (section 9).

**Container restart or recreation.** The wiki says containers connected to gluetun "lose connection once Gluetun is restarted" [wiki: faq/healthcheck]. Their network namespace belongs to gluetun, so when gluetun's container stops, qBittorrent has no network until it restarts. Docker's restart policy does not restart qBittorrent for this, since it is not a crash of qBittorrent itself [unverified: exact Docker behaviour, docs.docker.com not reachable].

**Compose ordering.** Compose treats `network_mode: service:<name>` as a dependency. The Compose spec says dependencies can be referenced "using the `service:{name}` syntax in namespace declarations such as `ipc`, `pid`, or `network_mode`" [src: compose-spec spec.md]. `depends_on` with `condition: service_healthy` waits for gluetun's Docker healthcheck [src: compose-spec]. `restart: true` makes Compose restart qBittorrent after it updates gluetun [src: compose-spec]. The Caddy service in this repo already uses this same pattern with tailscale.

**Dockerfile healthcheck.** At HEAD the healthcheck is `--interval=5s --timeout=5s --start-period=10s --retries=3` [src: gluetun Dockerfile line 294]. The FAQ page still shows `--retries=1` from 2022 [wiki: faq/healthcheck]. The source wins. Gluetun can report unhealthy during a slow VPN connect, so `docker compose up --wait` can time out. Watch the first start.

## 4. Networking gotchas

**Ports.** Ports must be published on the gluetun service: `'${BIND_ADDR:-0.0.0.0}:8080:8080'` [wiki: port-mapping.md]. The qBittorrent service cannot have `ports` [src: compose-spec, network_mode].

**Other containers.** Containers connected to gluetun share its `localhost`. Containers outside it reach gluetun by name, for example `gluetun:8080` [wiki: inter-containers-networking.md]. Sonarr and Radarr must change their download client host to `gluetun` unless you add an alias (below). Caddy's `reverse_proxy qbittorrent:8080` also needs the alias or a change to `gluetun:8080`.

**Alias.** Compose supports network-scoped aliases on a service [src: compose-spec, `aliases`]. Putting `aliases: [qbittorrent]` on gluetun's `homelab` network lets `qbittorrent:8080` keep resolving to gluetun. Verified in the spec; not tested on this host.

**Firewall for LAN and Docker-network access.** The default firewall allows incoming traffic from the Docker network. Requests from the LAN to a published port may arrive with the LAN source IP. In that case they are dropped unless the port is in `FIREWALL_INPUT_PORTS` [wiki: options/firewall.md]. Set `FIREWALL_INPUT_PORTS=8080`. Whether the LAN source is preserved depends on Docker's NAT path, which is unverified here. Test it.

**FIREWALL_OUTBOUND_SUBNETS.** Not needed for this design. Only add it for LAN access from inside qBittorrent. If you add it, it must not overlap with the VPN tunnel range [wiki: options/firewall.md]. Nord's tunnel address was not verified.

**DNS.** gluetun runs its own DNS server, defaulting to DNS-over-TLS to Cloudflare [wiki: options/dns.md]. Do not set `DNS_UPSTREAM_PLAIN_ADDRESSES` to your router or to the VPN provider, which leaks outside the tunnel [wiki: options/dns.md]. Leave `DNS_UPSTREAM_RESOLVER_TYPE` at its default `dot`.

**IPv6.** The gluetun firewall covers `ip6tables` [wiki: faq/firewall]. The Docker bridge in this stack does not enable IPv6 (`compose.yml` sets none). Nothing is leaking over IPv6 by default. The wiki says an outside tester confirmed this [wiki: ipv6.md, linking to gluetun-wiki issue 70]. Test with `curl -6` (section 9).

**Caddy and Tailscale.** Caddy and tailscale share a namespace. gluetun is a different namespace, so they do not interact directly. Caddy reaches gluetun over the `homelab` network like any other container. Caddy keeps the Host and Origin headers, so qBittorrent's CSRF check passes (section 5).

**Docker subnet.** The Docker bridge pool (`172.16.0.0/12` by default) does not overlap a typical LAN. This only matters if you enable outbound subnets or your LAN uses `10.x.x.x` [wiki: options/firewall.md].

## 5. qBittorrent settings to change

Source checked: qBittorrent at HEAD [src: `src/webui/webapplication.cpp`, `src/base/preferences.cpp`].

| Setting | Recommended with gluetun | Reason |
|---|---|---|
| Proxy server type | None | Remove SOCKS5. Proxy and VPN together create confusion. |
| Optional IP address to bind to / interface binding | Leave empty | Binding to `wg0` or `tun0` is optional defence in depth [wiki: How-to-bind-your-vpn]. The interface name inside gluetun is unverified (`wg0` is likely). If the tunnel is recreated, the bind can break. The firewall is the kill switch. |
| Use UPnP / NAT-PMP port forwarding from my router | Off | It cannot work through gluetun and only adds noise [wiki: Explanation-of-Options]. |
| Listening port | Leave default (6881) | Harmless. Nothing reaches it from outside, since NordVPN has no port forwarding. |
| Web UI host header validation (`WebUI/HostHeaderValidation`) | Leave on | Default is on, with `WebUI/ServerDomains` default `*` [src: preferences.cpp]. `*` matches any host name, so only the **port** in the Host header is checked: it must equal qBittorrent's local port (8080) [src: `validateHostHeader`]. Sonarr's `gluetun:8080` and Caddy's `homelab.<tailnet>.ts.net:8080` both pass. |
| CSRF protection (`WebUI/CSRFProtection`) | Leave on | Default on. The origin check compares host and port and ignores scheme [src: webapplication.cpp `isSameOrigin`]. HTTPS termination in Caddy therefore needs no change. Rack's Origin and Referer match its internal base URL. |
| Reverse proxy support | Off | As the existing security report says, Caddy's tailnet clients all look like 127.0.0.1 in userspace Tailscale [repo: docs/remote-access/security-report.md HL-06]. |
| Bypass auth for localhost / subnet whitelist | Off | Same as HL-06 in the security report. Still relevant. |
| `WEBUI_PORT` | Keep `8080` | linuxserver: both sides of the published port must change, plus `WEBUI_PORT` [src: linuxserver README]. Keep 8080 on both. |
| Run external program on torrent finished | Off | Unchanged from HL-06. |

The linuxserver README says a temporary `admin` password is printed to the container log on each start unless you set one [src: linuxserver README]. The repo already sets `RACK_QBITTORRENT_*` for login.

## 6. Rack and dashboard impact

Rack's discovery logic [src: `rack/server/src/docker.ts`, `resolve.ts`, `apps/qbittorrent.ts`]:

- Containers are included when they carry `rack.enable=true` or are named in `rack.yml` (`listContainers`).
- Ports come from Docker's `Ports` list for that container (`derivePorts`).
- The internal URL is `http://${container.name}:${privatePort}` (`resolveContainer`), unless `rack.internal` or a `rack.yml` override sets it.
- The widget matches by app id (`qbittorrent`), by `rack.widget`, or by image name.

**Expected breakage if you only remove the ports and keep the labels on qBittorrent:**

- `Ports` is empty for a container using `network_mode: service:...`. Docker attaches ports to the owning container [unverified: Docker docs not reachable].
- `rack.port=8080` still sets `publicPort` to 8080. The link works.
- `privatePort` falls back to the explicit port 8080. The internal URL becomes `http://qbittorrent:8080`.
- The qBittorrent name should not resolve from the Rack container: the container has no endpoint on `homelab` of its own, and gluetun has the alias only with the change below [unverified: not run]. The widget and health check then fail, but the link still works.

**Fix:** move the Rack labels from qBittorrent to gluetun and set `rack.widget=qbittorrent` so the widget still matches. Keep `rack.port=8080`. The internal URL will then derive from `container.name` = `gluetun` as `http://gluetun:8080`, which resolves on `homelab`. Alternatively, keep the labels on qBittorrent and set `internal` in `rack.yml` for `qbittorrent` to `http://gluetun:8080` (the override is read in `resolve.ts`). Pick one, and do not keep labels on both containers, or Rack lists two entries.

## 7. Health and monitoring

- **Docker healthcheck:** gluetun's image healthcheck queries its local health server at `127.0.0.1:9999` [wiki: options/healthcheck.md; src: Dockerfile line 294].
- **Control server:** listens on `:8000` by default [src: `settings/server.go`; wiki: options/control-server.md]. Since v3.39.1 all routes are private and need auth [wiki: advanced/control-server.md]. In source, a route with no role returns 401 [src: `internal/server/middlewares/auth/middleware.go`]. Do not publish 8000. If you use it, set `HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE` to an API-key role. Any auth change between v3.40 and v3.41 was not verified: the release notes were not reachable.
- **Public IP endpoint:** `GET /v1/publicip/ip` needs auth under the same rules [wiki: advanced/control-server.md].
- **Monitoring for Rack:** the gluetun container will show health in Rack once labelled. The qBittorrent widget will show errors if the tunnel is down.

## 8. Image pinning and updates

- **Pin a release tag**, for example `qmcgaw/gluetun:v3.41.3`, or `v3` for stable patch updates [wiki: docker-image-tags.md]. The wiki says `:latest` is the edge of development. The latest GitHub release tag is `v3.41.3` [src: `git ls-remote --tags`], which was not checked against Docker Hub.
- **Recent changes:** v3.41.0 added `HTTP_CONTROL_SERVER_AUTH_DEFAULT_ROLE` [index: release mirror]. v3.41.3 changed the control server's status for unauthenticated routes (404 vs 405) [index]. Neither was read from the release page.
- **Not verified:** whether v3.40 changed the control server's default auth, as the question asked. The current source does, however, deny by default.

## 9. Leak testing

Run these after `docker compose up -d`. They have not been run on this host.

```sh
# Public IP from gluetun's network namespace and from qBittorrent's (same namespace, expect the same Nord IP)
docker exec gluetun wget -qO- https://ipinfo.io/ip
docker exec qbittorrent curl -s https://ipinfo.io/ip
curl -s https://ipinfo.io/ip                     # host: your ISP address, must differ

# IPv6 must not show your ISP address
docker exec qbittorrent curl -6 -m 5 -s https://ipv6.ipleak.net/json/ || echo "no IPv6 route (good)"

# Kill switch: drop all outbound in gluetun's namespace, then qBittorrent must lose connectivity
docker exec gluetun iptables -I OUTPUT 1 -j DROP
docker exec qbittorrent curl -m 5 -s https://ipinfo.io/ip || echo "blocked (good)"
docker restart gluetun    # clears the test rule; qBittorrent must be restarted too
```

Notes:

- The kill-switch test uses `iptables` inside gluetun. gluetun uses `iptables-nft`, with `iptables-legacy` as fallback [wiki: faq/firewall]. The exact command is unverified.
- The ipleak torrent check in `docs/qbittorrent.md` is a browser-side page. Its method is unverified, and it may not test qBittorrent's traffic. Prefer checking the peer IPs in qBittorrent's Peers tab, which should all be Nord addresses for a known public torrent.

## Gotchas checklist

| # | Gotcha | Check | Source |
|---|---|---|---|
| 1 | No port forwarding on Nord standard servers | Remove the `6881` publish. Expect fewer peers. | [index] Nord support |
| 2 | qBittorrent cannot have `ports`, `networks` or the `x-ls-common` anchor | Move ports to gluetun; write qBittorrent without the anchor | [src] compose-spec |
| 3 | Rack internal URL uses the container name | Move `rack.*` labels to gluetun, or set `rack.yml` `internal` | [src] `resolve.ts` |
| 4 | Restarting gluetun kills qBittorrent's network | `depends_on: service_healthy` + `restart: true` | [wiki] faq/healthcheck; [src] compose-spec |
| 5 | Sonarr, Radarr and Caddy use `qbittorrent:8080` | Add the `qbittorrent` alias on gluetun | [src] compose-spec aliases |
| 6 | LAN requests may be dropped by the firewall | `FIREWALL_INPUT_PORTS=8080` | [wiki] options/firewall |
| 7 | DNS leaks if pointed outside the tunnel | Leave DoT default; no plain upstream | [wiki] options/dns |
| 8 | IPv6 | Test with `curl -6` | [wiki] ipv6 |
| 9 | `:latest` is the dev edge | Pin `v3.41.3` or `v3` | [wiki] docker-image-tags |
| 10 | Dockerfile healthcheck retries differ between wiki and source | Trust the source (`retries=3`) | [src] Dockerfile |
| 11 | Control server must not be published | Do not publish 8000 | [wiki] advanced/control-server |
| 12 | Interface binding in qBittorrent can break on tunnel recreation | Leave the bind empty | [wiki] How-to-bind-your-vpn |
| 13 | UPnP in qBittorrent is useless behind gluetun | Turn it off | [wiki] Explanation-of-Options |
| 14 | WireGuard key is a secret | Store in `.env`, never in compose.yml or git | repo `.env.example` pattern |
| 15 | `check-exposure.sh` reads published ports from compose | Still works: gluetun publishes 8080 on `BIND_ADDR` | repo `scripts/check-exposure.sh` |
| 16 | `docs/qbittorrent.md` and the SOCKS5 section | Update the docs in the same change | repo `docs/qbittorrent.md` |

## Proposed compose snippet

This is a proposal only. Nothing in the repo was changed. Image tag, server country, and category title need confirming.

```yaml
  gluetun:
    image: qmcgaw/gluetun:v3.41.3  # pin; check the release before bumping
    container_name: gluetun
    cap_add:
      - NET_ADMIN
    devices:
      - /dev/net/tun:/dev/net/tun
    networks:
      homelab:
        aliases: [qbittorrent]  # keeps qbittorrent:8080 working for Sonarr, Radarr and Caddy
    environment:
      - TZ=${TZ}
      - VPN_SERVICE_PROVIDER=nordvpn
      - VPN_TYPE=wireguard
      - WIREGUARD_PRIVATE_KEY=${NORDVPN_WIREGUARD_PRIVATE_KEY}
      - SERVER_COUNTRIES=${VPN_SERVER_COUNTRIES:-Canada}  # confirm the name with format-servers
      - SERVER_CATEGORIES=${VPN_SERVER_CATEGORIES:-}      # e.g. the P2P title; confirm first
      - FIREWALL_INPUT_PORTS=8080                          # LAN and Docker access to the Web UI
    ports:
      - '${BIND_ADDR:-0.0.0.0}:8080:8080'
    labels:
      - rack.enable=true
      - rack.name=qBittorrent
      - rack.group=Downloads
      - rack.icon=qbittorrent
      - rack.widget=qbittorrent
      - rack.port=8080
    restart: unless-stopped
    logging: *logging

  qbittorrent:
    # Not using the x-ls-common anchor: it adds `networks`, which Compose rejects with network_mode.
    image: lscr.io/linuxserver/qbittorrent:latest
    container_name: qbittorrent
    network_mode: 'service:gluetun'
    depends_on:
      gluetun:
        condition: service_healthy
        restart: true  # restart qBittorrent when gluetun is recreated
    restart: unless-stopped
    environment:
      - PUID=${PUID}
      - PGID=${PGID}
      - TZ=${TZ}
      - UMASK=002
      - WEBUI_PORT=8080
    volumes:
      - ${APPDATA}/qbittorrent:/config
      - ${DATA_DIR}/torrents:/data/torrents
    stop_grace_period: 30s
    logging: *logging
```

Notes on the snippet:

- Remove the old `ports` (`6881`) and `labels` from qBittorrent, and the `networks` line from the anchor.
- The `NORDVPN_WIREGUARD_PRIVATE_KEY` variable goes in `.env` and in `.env.example` as an empty placeholder.
- Add `VPN_SERVER_COUNTRIES` and `VPN_SERVER_CATEGORIES` to `.env.example` as optional values.
- `restart: true` in `depends_on` only fires when Compose recreates gluetun. A plain `docker restart gluetun` will not restart qBittorrent. Check that behaviour on the first test.

## Sources

Primary sources (fetched or cloned, 2026-11-01):

- gluetun source: https://github.com/qdm12/gluetun (commit `151fb7a`, 2026-10-29). Files: `Dockerfile`, `internal/server/middlewares/auth/middleware.go`, `internal/configuration/settings/server.go`, `internal/configuration/settings/vpn.go`, `internal/provider/nordvpn/connection.go`, `internal/provider/utils/tier.go`, `internal/cli/formatservers.go`.
- gluetun wiki: https://github.com/qdm12/gluetun-wiki (clone of default branch). Pages:
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/providers/nordvpn.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/connect-a-container-to-gluetun.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/inter-containers-networking.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/port-mapping.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/options/firewall.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/faq/firewall.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/faq/healthcheck.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/options/healthcheck.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/options/dns.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/options/port-forwarding.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/control-server.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/options/control-server.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/advanced/ipv6.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/docker-image-tags.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/servers.md
  - https://github.com/qdm12/gluetun-wiki/blob/main/setup/wireguard.md
- Compose specification: https://github.com/compose-spec/compose-spec/blob/master/spec.md (sections `network_mode`, `depends_on`, `aliases`, and the note on `service:{name}` implicit dependencies).
- linuxserver qBittorrent image: https://github.com/linuxserver/docker-qbittorrent/blob/master/README.md
- qBittorrent source: https://github.com/qbittorrent/qBittorrent (`src/webui/webapplication.cpp`, `src/base/preferences.cpp`).
- qBittorrent wiki: https://github.com/qbittorrent/qBittorrent.wiki (pages `Explanation-of-Options-in-qBittorrent`, `How-to-bind-your-vpn-to-prevent-ip-leaks`, `Disable-connections-not-supported-by-proxies`, `Anonymous-Mode`).
- binhex image README: https://github.com/binhex/arch-qbittorrentvpn (fetched summary, 2026-11-01).

NordVPN (search-result snippets only):

- https://support.nordvpn.com/hc/en-us/articles/19483392309649-Does-NordVPN-offer-port-forwarding [index]
- https://support.nordvpn.com/hc/en-us/articles/47830508425745-How-to-set-up-an-OpenVPN-manual-connection-to-NordVPN-with-Gluetun [index]
- https://my.nordaccount.com/dashboard/nordvpn/manual-configuration/service-credentials/ (link from the gluetun wiki; not opened)

Community (unverified):

- https://gist.github.com/bluewalk/7b3db071c488c82c604baf76a42eaad3 (private key via API)
- https://support.nordvpn.com/hc/en-us/articles/20195967385745-NordVPN-proxy-setup-for-qBittorrent (linked from `docs/qbittorrent.md`; not opened)

Repo files read: `compose.yml`, `.env.example`, `docs/qbittorrent.md`, `scripts/check-exposure.sh`, `rack/server/src/apps/qbittorrent.ts`, `rack/server/src/resolve.ts`, `rack/server/src/docker.ts`, `caddy/Caddyfile`, `docs/remote-access/research-best-practices.md`, `docs/remote-access/security-report.md`.

## Could not verify

- Docker's exact behaviour for `Ports` and restart of a `network_mode: service:` container (docs.docker.com unreachable).
- The linuxserver docs site (unreachable); only the GitHub README was read.
- Nord's own WireGuard private-key procedure in full (support.nordvpn.com unreachable from WebFetch; the gluetun wiki points to a dashboard page).
- Nord's exact country name for Canada, and the title of its P2P category, for gluetun's filters.
- Whether Nord has Canadian servers at the time of writing.
- gluetun v3.40 and v3.41 control server default-auth changes (release notes not reachable).
- Whether qBittorrent's "Use proxy for peer connections" option still exists under that label (not in the wiki text read).
- Whether hotio/qbittorrent has VPN features (README not retrieved).
- The kill-switch test, leak commands, and the compose snippet (none run on this host).
- Whether `FIREWALL_INPUT_PORTS=8080` is needed for LAN access in this exact network setup.
- The Rack breakage analysis is from source reading, not a running Rack.
