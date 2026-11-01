# qBittorrent

qBittorrent is a free, open-source BitTorrent client with a web interface for remote management.

## Official Documentation

- [qBittorrent Website](https://www.qbittorrent.org/)
- [qBittorrent Wiki](https://github.com/qbittorrent/qBittorrent/wiki)
- [LinuxServer qBittorrent Image](https://docs.linuxserver.io/images/docker-qbittorrent/)

## TRaSH Guides

- [qBittorrent - Basic Setup](https://trash-guides.info/Downloaders/qBittorrent/Basic-Setup/) - Initial configuration
- [qBittorrent - Paths](https://trash-guides.info/Downloaders/qBittorrent/Paths/) - Proper path configuration
- [qBittorrent - How to Add Categories](https://trash-guides.info/Downloaders/qBittorrent/How-to-add-categories/) - Category setup for Radarr/Sonarr
- [Hardlinks and Instant Moves](https://trash-guides.info/Hardlinks/Hardlinks-and-Instant-Moves/) - Proper folder structure

## Ports

| Port | Protocol | Description        |
| ---- | -------- | ------------------ |
| 8080 | TCP      | Web UI (published by gluetun) |

No torrent port is published: NordVPN has no port forwarding, so peers cannot connect in.

## Volumes

| Container Path   | Description               |
| ---------------- | ------------------------- |
| `/config`        | qBittorrent configuration |
| `/data/torrents` | Download directory        |

## Configuration

### Initial Setup

1. Access qBittorrent at `http://<server-ip>:8080`
2. Default credentials:
   - Username: `admin`
   - Password: Check container logs for temporary password, or set in config
3. Change the default password immediately

### Recommended Settings

#### Downloads

- Default Save Path: `/data/torrents`
- Keep incomplete torrents in: `/data/torrents/incomplete`

#### Connection

- Proxy Type: None (remove any old SOCKS5 proxy)
- Use UPnP / NAT-PMP: off (it cannot work through gluetun)
- Listening Port: any (default 6881); nothing can reach it from outside
- Optional: Advanced > Network interface `tun0` (gluetun's interface, also for WireGuard). Extra layer only, the gluetun firewall is already the kill switch; it can stall after gluetun restarts its VPN internally.
- Leave Host header validation and CSRF protection on; keep "reverse proxy support" and auth bypass off

#### BitTorrent

- Enable DHT, PeX, and Local Peer Discovery for better connectivity

#### Web UI

- Change default username and password
- Enable HTTPS if exposing externally

### Categories for Automation

Create categories for Radarr and Sonarr:

1. Go to Categories (right-click in sidebar)
2. Add `radarr` category with save path `/data/torrents/movies`
3. Add `sonarr` category with save path `/data/torrents/series`

## Integration with Other Services

- **Radarr**: Sends movie downloads
- **Sonarr**: Sends TV show downloads
- **Prowlarr**: Provides indexer configuration

## Data Directories

```
${APPDATA}/qbittorrent/   # Config
${DATA_DIR}/torrents/     # Download directory
```

## VPN (gluetun + NordVPN)

qBittorrent shares the network of the `gluetun` container (`network_mode: service:gluetun`), so all its traffic goes through NordVPN WireGuard. gluetun's firewall blocks everything outside the tunnel, so there is no fallback to your ISP if the VPN drops. gluetun publishes the Web UI on 8080 and has the network alias `qbittorrent`, so Sonarr, Radarr, Caddy and Rack still use `http://qbittorrent:8080`. Background and sources: [torrent-vpn/research.md](torrent-vpn/research.md) (read from source, not run on this host).

### 1. Get the WireGuard key

This method comes from the research (community sources; NordVPN's own page could not be checked, so the dashboard may now show the key directly):

1. Create an access token at <https://my.nordaccount.com/dashboard/nordvpn/access-tokens/>.
2. Run:

   ```bash
   curl -s -u 'token:<ACCESS_TOKEN>' https://api.nordvpn.com/v1/users/services/credentials | jq -r .nordlynx_private_key
   ```

3. If the key contains `\/`, remove the backslashes. It is 44 base64 characters. `incorrect key size: 48` in gluetun's log means you pasted the access token.

### 2. Put it in place (before first start)

```bash
./setup.sh                                  # creates ${APPDATA}/gluetun
umask 077
printf '%s' '<KEY>' > "${APPDATA}/gluetun/wireguard_private_key"
chmod 600 "${APPDATA}/gluetun/wireguard_private_key"
```

The key stays out of `.env` because anything with the Docker socket (Rack, Netdata) can read container environment variables. Treat it like a password; it never goes in git. The file must exist on the server before a deploy adds gluetun, or `up --wait` fails and rolls back (see [deploy.md](deploy.md)).

### 3. First start

```bash
docker compose up -d gluetun qbittorrent
docker logs gluetun | tail     # look for "Public IP address is ..." in Canada
```

Optional: `VPN_SERVER_COUNTRIES` in `.env` (default `Canada`). The compose file sets `SERVER_CATEGORIES=P2P`, which keeps out Dedicated IP and Double VPN servers. List candidates with `docker run --rm qmcgaw/gluetun:v3.41.3 format-servers -nordvpn`.

### 4. qBittorrent settings

See Recommended Settings > Connection above: remove the SOCKS5 proxy, UPnP off, interface binding optional.

### Gotchas

- **No port forwarding with NordVPN** (only with its Dedicated Server add-on, per the research; gluetun does not support it for Nord). Nobody can connect in, so expect fewer peers. Outbound connections, DHT and PeX still work.
- **gluetun restarted outside Compose** (`docker restart gluetun`, a crash, a reboot race): qBittorrent keeps running in a dead network and downloads stall, but nothing leaks. Run `docker compose restart qbittorrent`. The qBittorrent healthcheck turns unhealthy in this state, which shows in Rack. `docker compose up -d` and `docker compose restart gluetun` handle it automatically.
- Do not publish gluetun's control server (8000).
- If you drop the `qbittorrent` alias, set `rack.internal=http://gluetun:8080` on qBittorrent.

### Leak and kill-switch tests

Not yet run on this host.

```bash
# Same Nord IP from both; the host must show your ISP IP
docker exec gluetun wget -qO- https://ipinfo.io/ip
docker exec qbittorrent curl -s https://ipinfo.io/ip
curl -s https://ipinfo.io/ip

# IPv6: expect no route
docker exec qbittorrent curl -6 -m 5 -s https://ipv6.ipleak.net/json/ || echo "no IPv6 route (good)"

# Kill switch: qBittorrent must NOT fall back to eth0
docker exec gluetun ip link set tun0 down
docker exec qbittorrent curl -m 5 -s https://ipinfo.io/ip || echo "blocked (good)"
docker logs --since 2m gluetun | grep -i restarting   # VPN restarts itself within about a minute

# LAN and Rack reachability
curl -s -o /dev/null -w '%{http_code}\n' http://<LAN-IP>:8080/
docker exec rack wget -qO- http://qbittorrent:8080/api/v2/app/version   # 403 is fine; a DNS error is not
```

Also use a torrent-IP checker (e.g. ipleak.net "Torrent Address detection"; unverified that it works this way) and check that every IP in the Peers tab is a peer.
