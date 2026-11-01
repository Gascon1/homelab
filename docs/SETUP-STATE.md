# State Outside Git

Git holds the code and config of the homelab. Everything below lives outside git: files on the server, and settings in other services. This is the list to back up, to restore, and to rebuild. The setup steps in [SETUP.md](SETUP.md) create each item.

## On the server

| Item | Path | Made in | Backup |
| --- | --- | --- | --- |
| Photos and videos | `${UPLOAD_LOCATION}` | SETUP step 6 (Immich) | **Critical**. Nothing else has them |
| Immich database | `${DB_DATA_LOCATION}` | SETUP step 5 | **Yes**. Stop Immich or use `pg_dump` first ([immich.md](immich.md#backup)) |
| `.env` | repo root, mode 600 | SETUP step 3 | **Yes**. Its `DB_PASSWORD` is the only key to the Immich database |
| App configs and databases | `${APPDATA}/` | SETUP step 6 | **Yes** |
| Media library | `${DATA_DIR}/media/` | SETUP step 7 | Optional. It can be downloaded again |
| `rack.yml` | `${APPDATA}/rack/rack.yml` | `setup.sh` | Inside `${APPDATA}/` |
| NordVPN WireGuard key | `${APPDATA}/gluetun/wireguard_private_key`, mode 600 | SETUP step 4 | Inside `${APPDATA}/`. Can also be fetched again |
| Tailscale node state | `${APPDATA}/tailscale` | MANUAL-STEPS Task 11 | Skip it on restore: join again with a new key |
| Deploy config | `deploy/deploy.env` | `deploy/install.sh` (Task 26) | Only if you changed it |
| Deploy state | `.deploy-state/` | `scripts/deploy.sh` | No |
| Deploy SSH key (private repo only) | `~/.ssh/homelab-deploy` | MANUAL-STEPS Task 35 | No: make a new one |

## In other services

Write these down. The server cannot restore them.

| Service | Setting | Task |
| --- | --- | --- |
| Router | UPnP and NAT-PMP off, no forwards (TCP 32400 only if Task 19), DHCP reservation | 4, 19 |
| Tailscale | MagicDNS and HTTPS on, tailnet name | 7 |
| Tailscale | Access policy: `docs/remote-access/tailscale-policy.example.hujson` with your family emails | 8 |
| Tailscale | Device approval on | 14 |
| Tailscale | Trust credential: OIDC, subject `repo:Gascon1/homelab:ref:refs/heads/main`, `auth_keys` write, `tag:ci` | 30 |
| GitHub | Package `homelab-rack` public | 22 |
| GitHub | Rules on `main`: pull request, checks `compose` `shell` `hook` `rack` `image`, no force push, no deletion | 23 |
| GitHub | Secrets `DEPLOY_HOOK_SECRET`, `TS_OAUTH_CLIENT_ID`, `TS_AUDIENCE`; variable `TS_HOST` | 29, 30, 31 |
| Plex | Custom server access URLs; empty allowed-without-auth list | 18 |
| App logins | qBittorrent, Radarr, Sonarr, Prowlarr, Immich: in your password manager | SETUP step 6 |

Task numbers refer to [MANUAL-STEPS](remote-access/MANUAL-STEPS.md).

## Restore on a new server

1. Do [SETUP](SETUP.md) steps 1 and 2.
2. Restore `.env`, `${APPDATA}/` (without `tailscale/`), `${DB_DATA_LOCATION}`, `${UPLOAD_LOCATION}` and the media drive as root with `rsync -a`, so owners and modes stay the same.
3. Update `.env` where the server differs: `BIND_ADDR` for a new LAN IP, `PUID` and `PGID` for a new user.
4. Run `./setup.sh`, then do SETUP step 5. The apps keep their settings, so SETUP step 6 is already done.
5. For remote access: delete the old `homelab` machine in the Tailscale console, then do MANUAL-STEPS Tasks 9 to 13.
6. For deploys: do MANUAL-STEPS Tasks 24 to 28, and Task 32 if you use the doorbell.

**Done when:** SETUP step 5's check passes, Immich shows your photos, and every Rack tile shows stats.
