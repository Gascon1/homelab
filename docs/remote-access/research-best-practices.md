# Remote access: is this the "right way"? (research, 2026-11-01)

This note checks the design in `compose.yml` (`tailscale` and `caddy`, profile `remote`), `caddy/Caddyfile` and `tailscale-policy.example.hujson` against primary sources as of 2026-11-01.

**How each claim was checked.** The sandbox could not open tailscale.com, caddyserver.com, docs.immich.app, support.plex.tv, docs.pangolin.net or cloudflare.com (the proxy refused them). Claims were therefore checked in one of three ways, and each is labelled:

- **[src]**: read in the project's own source code or docs repository at its latest commit (cloned 2026-11-01). The GitHub URL is given.
- **[index]**: read only in the search-engine text of the official page given. The page itself could not be opened, so treat these claims as likely but not confirmed word for word.
- **unverified**: no primary source was found.

Tailscale has moved its documentation from `tailscale.com/kb/NNNN/...` to `tailscale.com/docs/...`. Headscale's docs already link to the new paths ([src] [headscale docs/ref/policy.md](https://github.com/juanfont/headscale/blob/main/docs/ref/policy.md)), and both styles appear below.

Versions checked: tailscale `main` at 1.105.0, with the latest release tag v1.104.4; caddy `main`, with the latest tag v2.11.7. The versions pinned in `compose.yml` are therefore the current releases ([src] `git ls-remote --tags` on [tailscale/tailscale](https://github.com/tailscale/tailscale) and [caddyserver/caddy](https://github.com/caddyserver/caddy)).

## TL;DR

**Overall verdict: Good, with three fixes needed.** A Tailscale container, with Caddy sharing its network namespace, no router forwards and port-level ACLs, is a sound design for a homelab. Every piece is documented by Tailscale or Caddy. The cert path through the shared socket works exactly as the comments say. Nothing here goes against current guidance. The three fixes:

1. **The Plex tailnet URL never reaches Plex.** `ADVERTISE_IP` is an environment variable of the `plexinc/pms-docker` image. The `lscr.io/linuxserver/plex` image used here ignores it. Set *Custom server access URLs* in Plex's own settings instead.
2. **Move the policy from `acls` to `grants`.** `acls` still works, but it is the legacy syntax and will get no new features.
3. **Optional for family:** Tailscale Services is now generally available (10 services on the free Personal plan, per Tailscale's blog). It can give family short per-app names such as `https://photos.<tailnet>.ts.net`, with per-service grants, without adding containers.

Tailscale Serve (`TS_SERVE_CONFIG`) could replace Caddy completely. Change that only if you want fewer moving parts or the real client IP passed to apps.

## Verdicts

| # | Question | Verdict | One-line reason |
|---|---|---|---|
| a | Tailscale container with Caddy in its namespace, vs Tailscale Serve | **Good** (Serve is an equal alternative) | Both patterns are documented. Serve is simpler and passes the real client IP and identity headers. Caddy gives you HSTS and familiar config. |
| b | Caddy certs through `/var/run/tailscale/tailscaled.sock` | **Good** | That path is tscert's built-in default on Linux. Needs MagicDNS and HTTPS turned on for the tailnet, and Caddy running as root (the default) or `TS_PERMIT_CERT_UID`. |
| c | One hostname with many ports, vs one hostname per service | **Good for admin; Acceptable for family** | Smallest CT exposure, simple ACLs and one cert. Tailscale Services is now the native way to give family per-app names. |
| d | Userspace vs kernel mode | **Acceptable** | It is the image default and Tailscale calls it "lower performance". Family Plex does not use it, so switch only if Immich uploads or your own Plex are measurably slow. |
| e | ACL syntax | **Change it** (low urgency) | `acls` is legacy. Rewrite it as `grants`. |
| f | Plex Remote Access with a manual 32400 forward | **Acceptable** | Still the documented way for people without Tailscale. Remote video needs your Plex Pass or each viewer's Remote Watch Pass. **Fix the `ADVERTISE_IP` no-op.** |
| g | Alternatives | Tailscale remains the best fit | Headscale: if you want no third-party control plane. Cloudflare public hostnames: bad for video and Immich uploads. Pangolin: if family must use plain browser URLs. Plain WireGuard: needs a port forward. |
| h | Immich behind Caddy | **Good** | Caddy sets `X-Forwarded-*`, proxies websockets, has no body limit, and its default timeouts are idle-based rather than total. This matches Immich's own Caddy example. |

## Detailed findings

### a. Shared network namespace, and Tailscale Serve

**What the design relies on, confirmed in source.** In userspace mode, containerboot defaults `TS_USERSPACE` to true ([src] [cmd/containerboot/settings.go](https://github.com/tailscale/tailscale/blob/main/cmd/containerboot/settings.go), `def.Bool(os.Getenv("TS_USERSPACE"), true)`). netstack sends a TCP connection for the node's own tailnet IP to `127.0.0.1:<same port>` in that network namespace (`case isTailscaleIP: dialIP = ipv4Loopback`, then `forwardTCP`) ([src] [wgengine/netstack/netstack.go](https://github.com/tailscale/tailscale/blob/main/wgengine/netstack/netstack.go)). So Caddy, sharing the namespace through `network_mode: service:tailscale`, receives tailnet traffic on every port it listens on. This is also why `admin off` is right: a localhost-only admin API on :2019 would be reachable from the tailnet.

Side effects of that forwarding, from the same function: tailscaled dials the backend with an ordinary `net.Dialer`. **Caddy therefore sees every tailnet client as `127.0.0.1`**, and so do the apps behind it. Logs and any per-IP rate limiting (for example, failed Immich logins) cannot tell clients apart. tailscaled keeps a port-to-peer mapping (`RegisterIPPortIdentity`) so that LocalAPI WhoIs still works, but plain Caddy does not use it.

**Does Tailscale endorse the pattern?** Tailscale documents sharing a network namespace with `network_mode: service:<tailscale>`, and its Docker deep-dive blog recommends "one Tailscale sidecar container per service" ([index] [Tailscale blog: docker-tailscale-guide](https://tailscale.com/blog/docker-tailscale-guide); [index] [Connect a Docker container with Compose](https://tailscale.com/docs/features/containers/docker/how-to/connect-docker-container)). Tailscale also has a page on Caddy certificates on Tailscale ([index] [Caddy certificates on Tailscale](https://tailscale.com/docs/integrations/web-servers/caddy/caddy-certificates)). One Tailscale node with one reverse proxy behind it, rather than one sidecar per app, is a combination of documented pieces, not a single page. It is not discouraged anywhere. Unverified: no Tailscale page shows this exact Caddy-in-namespace compose file.

**Tailscale Serve as a Caddy replacement.** `TS_SERVE_CONFIG` points to an `ipn.ServeConfig` JSON file. It is applied once tailscaled is up and re-applied whenever the file changes, with `${TS_CERT_DOMAIN}` replaced by the node's FQDN ([src] [cmd/containerboot/main.go](https://github.com/tailscale/tailscale/blob/main/cmd/containerboot/main.go) header comment). Tailscale's Docker parameters page says to bind-mount the directory rather than the single file, so updates are noticed ([index] [Docker configuration parameters](https://tailscale.com/docs/features/containers/docker/docker-params)). Serve proxy targets may be Docker hostnames such as `http://immich-server:2283`, not only localhost; a non-localhost target just needs a scheme ([src] [ipn/serve.go `ExpandProxyTargetValue`](https://github.com/tailscale/tailscale/blob/main/ipn/serve.go)). Serve sets `X-Forwarded-For` to the **real tailnet client IP** and adds `Tailscale-User-Login` and related identity headers ([src] [ipn/ipnlocal/serve.go](https://github.com/tailscale/tailscale/blob/main/ipn/ipnlocal/serve.go), `addProxyForwardedHeaders`).

| | Caddy in the Tailscale namespace (current) | Tailscale Serve (`TS_SERVE_CONFIG`) |
|---|---|---|
| Containers | 2 | 1 |
| TLS cert | Caddy fetches it from tailscaled over the LocalAPI socket | tailscaled handles it itself |
| LocalAPI socket shared with another container | Yes. Caddy runs as root, which gives it full control of tailscaled. | No |
| Client IP seen by apps | `127.0.0.1` | Real tailnet IP |
| Tailscale identity headers | No (needs the `caddy-tailscale` plugin or `forward_auth`) | Yes |
| Response headers such as HSTS, header stripping, extra routing | Yes | No |
| Can host Tailscale Services (per-service names) | No | Yes (see c) |

**Verdict: Good.** Keep Caddy if you value the HSTS header and Caddyfile flexibility. Moving to Serve is a reasonable simplification, especially if you adopt Tailscale Services.

### b. Certificates through the tailscaled socket

- Caddy hands every `*.ts.net` name to the Tailscale cert manager automatically. No `tls` directive is needed (`isTailscaleDomain` → `caddytls.Tailscale`) ([src] [modules/caddyhttp/autohttps.go](https://github.com/caddyserver/caddy/blob/master/modules/caddyhttp/autohttps.go), [modules/caddytls/certmanagers.go](https://github.com/caddyserver/caddy/blob/master/modules/caddytls/certmanagers.go)). The cert is fetched at TLS handshake time, after Caddy checks that the SNI name is in tailscaled's `CertDomains`. Caddy's docs say the same ([src] [caddyserver/website automatic-https.md](https://github.com/caddyserver/website/blob/master/src/docs/markdown/automatic-https.md), "Special cases").
- **Socket path:** Caddy uses `github.com/tailscale/tscert`. On Linux, tscert uses `$TS_SOCKET` if it is set; otherwise, if `/var/run` exists, it uses **`/var/run/tailscale/tailscaled.sock`** ([src] [tscert internal/paths/paths.go](https://github.com/tailscale/tscert/blob/main/internal/paths/paths.go)). The compose file sets `TS_SOCKET` to that path in the Tailscale container (containerboot's own default would be `/tmp/tailscaled.sock`, [src] settings.go) and mounts the shared volume at `/var/run/tailscale` in Caddy. **The mechanism is correct.**
- **Requirements:**
  - HTTPS certificates must be turned on for the tailnet. Tailscale requires MagicDNS first, and turning HTTPS on publishes machine names to Certificate Transparency ([src] Caddy docs above; [index] [Enabling HTTPS](https://tailscale.com/docs/how-to/set-up-https-certificates)). tailscaled refuses with "your Tailscale account does not support getting TLS certs" when `CertDomains` is empty ([src] [feature/acme/cert.go](https://github.com/tailscale/tailscale/blob/main/feature/acme/cert.go)).
  - **The caller must be root, or have the UID in `TS_PERMIT_CERT_UID`** ([src] [ipn/ipnserver/server.go `CanFetchCerts`](https://github.com/tailscale/tailscale/blob/main/ipn/ipnserver/server.go); Caddy docs above). The official `caddy` image runs as root, so this works. In a container, `TS_PERMIT_CERT_UID` would go on the *tailscale* service.
  - Caddy version: Tailscale cert support has been in Caddy since 2.5 (PR #4541, referenced in the Caddy docs). The pinned 2.11.7 is the latest release. No minimum version issue.
- `TS_ACCEPT_DNS=false` does not affect certificates. MagicDNS is a tailnet setting, and `CertDomains` comes from the netmap.

**Verdict: Good.** Optional hardening: the socket gives Caddy (root) full LocalAPI control, so it could log the node out or change its serve config. Either accept that (Caddy is the only service on this namespace) or use Serve, which needs no socket sharing.

### c. One hostname with many ports, or one hostname per service

Options as of now:

- **Current: one node, ports on one name.** One cert, one name in CT logs. ACLs filter by port, which tailnet packet filtering supports directly. The URLs carry ports, but Rack's links keep working.
- **Per-service sidecars or TSDProxy.** Every app becomes its own node with its own name and cert, and every name is published to CT logs. TSDProxy needs `/var/run/docker.sock` mounted ([src] [almeidapaulopt/tsdproxy README](https://github.com/almeidapaulopt/tsdproxy/blob/main/README.md)). This repo already flags the Docker socket as a total-compromise risk (security report HL-03), so TSDProxy adds risk.
- **`tailscale/caddy-tailscale` plugin.** One Caddy binary that joins the tailnet as one *or more* nodes. Its README calls itself "still very experimental", and says you do not need it when Tailscale is already installed ([src] [tailscale/caddy-tailscale README](https://github.com/tailscale/caddy-tailscale/blob/main/README.md)). Not recommended here.
- **Tailscale Services (VIP services).** Now in the client. `tailscale serve --service=svc:<name>`, with the rule "service hosts must be tagged nodes" and a "waiting for approval" state ([src] [cmd/tailscale/cli/serve_v2.go](https://github.com/tailscale/tailscale/blob/main/cmd/tailscale/cli/serve_v2.go)). The VIP firewall forwards only served ports and RSTs the rest, so a peer granted one service cannot reach other localhost ports ([src] netstack.go, `isVIPServiceIP` case). containerboot auto-advertises services from its serve config outside Kubernetes (`TS_EXPERIMENTAL_SERVICE_AUTO_ADVERTISEMENT`, default true) ([src] main.go). Tailscale's GA announcement says Services is on all plans, with up to 10 services for Personal. Each service gets its own MagicDNS name and VIP, and clients need an explicit grant (`dst: ["svc:name"]`). Requirements: client v1.86+, TCP only ([index] [Services GA blog](https://tailscale.com/blog/services-ga), [Tailscale Services docs](https://tailscale.com/docs/features/tailscale-services)).
- **Wildcard subdomains of one node.** tailscaled now has a `dns-subdomain-resolve` node capability (`anything.myserver.tailnet.ts.net` resolves to the node) and can issue `*.node.ts.net` certs ([src] [tailcfg/nodecap/nodecap.go](https://github.com/tailscale/tailscale/blob/main/tailcfg/nodecap/nodecap.go), feature/acme/cert.go). Caddy's Tailscale manager matches SNI only against the exact `CertDomains`, so Caddy would not use this as it stands. Unverified: whether admins can turn this on through the policy file, and whether it is documented.

| | One name with ports (current) | Sidecar per app or TSDProxy | Tailscale Services |
|---|---|---|---|
| ACLs | Port lists on `tag:homelab` | Per node | Per `svc:` (clearest) |
| Names in CT logs | 1 | 1 per app | 1 per service (unverified how the cert is named) |
| Let's Encrypt limits | Not an issue: `ts.net` is on the Public Suffix List, so each tailnet counts as its own registered domain ([src] [publicsuffix/list](https://github.com/publicsuffix/list/blob/main/public_suffix_list.dat)) | Same | Same |
| Immich mobile | A port in the URL is fine. Immich only needs to be at the root of a (sub)domain, not on a sub-path ([src] [immich docs reverse-proxy.md](https://github.com/immich-app/immich/blob/main/docs/docs/administration/reverse-proxy.md)) | Fine | Fine |
| Plex clients | Plex learns the URL from *Custom server access URLs*, so it is never typed in (see f) | Same | Same |
| Family use | Needs `:2283` and `:5055` in the URL | Clean names | Clean names, no extra containers |
| Extra containers | 0 | 1 per app, or the Docker socket | 0 (needs Serve, not Caddy, for those names) |

**Verdict: Good for the admin side.** For the three family apps, Tailscale Services is now the current best-practice way to get names without ports. It is optional: family can bookmark the port URLs once.

### d. Userspace vs kernel mode

`TS_USERSPACE` defaults to true in the official image ([src] settings.go). Tailscale's Docker parameters page says userspace "works everywhere but has lower performance". It says to set `TS_USERSPACE=false` with `/dev/net/tun` and `cap_add` for better speed ([index] [Docker configuration parameters](https://tailscale.com/docs/features/containers/docker/docker-params)). Tailscale rates kernel mode "best" and netstack "acceptable" for subnet routers ([index] [kb/1177 kernel-vs-userspace-routers](https://tailscale.com/kb/1177/kernel-vs-userspace-routers)). Its throughput work (segmentation offload) targets the kernel TUN path ([index] [blog: throughput-improvements](https://tailscale.com/blog/throughput-improvements)). The userspace data path is gVisor netstack ([src] wgengine/netstack imports `gvisor.dev/gvisor`). No current official benchmark gives the size of the gap (unverified).

Here, family Plex goes over Plex Remote Access, not Tailscale. Only your own Plex sessions and Immich uploads pass through netstack. A connection relayed through DERP limits throughput far more than userspace mode does.

Kernel mode inside the container keeps the security property you have now. `tailscale0` lives in the container's own network namespace, so peers still reach only what that namespace listens on. Kernel mode also lets Caddy see real tailnet client IPs instead of `127.0.0.1`.

**Verdict: Acceptable.** Keep userspace. Switch to kernel mode (spec Appendix B) only if an Immich upload or a remote Plex stream from your phone is measurably capped, and first check that the connection is direct with `tailscale ping`.

### e. `acls` vs `grants`

Headscale's docs, which mirror Tailscale's policy language, say: "We recommend the use of Grants since ACLs are considered legacy and will not receive new features by Tailscale". They link Tailscale's ACL-to-grants migration guide ([src] [headscale docs/ref/policy.md](https://github.com/juanfont/headscale/blob/main/docs/ref/policy.md); [index] [Grants syntax](https://tailscale.com/docs/reference/syntax/grants), [Migrate ACLs to grants](https://tailscale.com/docs/reference/migrate-acls-grants)). Grants are available on the Personal plan, which allows up to 3 groups and 6 users ([index] [Tailscale pricing](https://tailscale.com/pricing)). The current file uses one group, so it fits. Tailscale Services can only be granted with `grants` (`dst: ["svc:..."]`) ([index] Grant examples).

The equivalent policy, with port syntax as in Headscale's grant examples:

```hujson
"grants": [
	{"src": ["autogroup:admin"], "dst": ["tag:homelab"], "ip": ["*"]},
	{"src": ["group:family"], "dst": ["tag:homelab"], "ip": ["32400", "2283", "5055"]},
	{"src": ["autogroup:member"], "dst": ["autogroup:self"], "ip": ["*"]},
],
```

`tcp:`-prefixed ports (`"tcp:2283"`) narrow a rule to TCP. That prefix is in Tailscale's grants syntax per the search index, but was not confirmed in a fetched page. Keep the policy's `tests` section, if you add one, to check that family is denied on 4000 and 8080.

**Verdict: Change it.** The current `acls` file is valid and works today. This is future-proofing, not a fix.

### f. Plex Remote Access with a manual 32400 forward

- Since 29 April 2025, streaming personal *video* remotely needs one of: a Plex Pass on the server admin's account, a Plex Pass on the viewer's account, or a Remote Watch Pass on the viewer's account. Music in Plexamp and photos are exempt. Remote Access must be enabled on the server ([index] [Requirements for Remote Playback of Personal Media](https://support.plex.tv/articles/requirements-for-remote-playback-of-personal-media/), [Remote Watch Pass overview](https://support.plex.tv/articles/remote-watch-pass-overview/), [Important 2025 Plex updates](https://www.plex.tv/blog/important-2025-plex-updates/)).
- "Remote" means the app cannot connect on the same subnet of the local network. By default, *LAN Networks* is only the server's own subnet. VPNs can make a connection count as remote ([index] same Plex article; [Network settings](https://support.plex.tv/articles/200430283-network/)).
  - Over the tailnet, Plex sees Caddy's address on the `homelab` Docker network. That address is in Plex's own bridge subnet, so Plex may treat your tailnet sessions as local. **Unverified**: Plex also uses plex.tv-side signals, so test it.
- With bridge networking, Plex cannot open router ports itself. Forward 32400 by hand and set the public port in Remote Access ([src] [plexinc/pms-docker README](https://github.com/plexinc/pms-docker/blob/master/README.md)). The linuxserver README recommends host networking but supports bridge with explicit ports ([src] [linuxserver/docker-plex README](https://github.com/linuxserver/docker-plex/blob/master/README.md)).
- **Bug found:** `ADVERTISE_IP` is a `plexinc/pms-docker` variable. That image writes it to Plex's `customConnections` preference on first run ([src] [pms-docker root/etc/cont-init.d/40-plex-first-run](https://github.com/plexinc/pms-docker/blob/master/root/etc/cont-init.d/40-plex-first-run)). The **`linuxserver/docker-plex` repository has no reference to `ADVERTISE_IP` or `customConnections` at all** ([src] grep of [linuxserver/docker-plex](https://github.com/linuxserver/docker-plex) at its 2026-10-26 commit). So `PLEX_ADVERTISE_URLS` does nothing with this image, and security report HL-11's claim that "the linuxserver image expects full URLs" is wrong. Set **Settings → Network → Custom server access URLs** to `https://homelab.<tailnet>.ts.net:32400` in Plex instead. Plex documents that this field is published to plex.tv for discovery ([index] Plex Network article).

**Verdict: Acceptable.** It is still the right path for family who will not install Tailscale, and it works with your Plex Pass. A Plex Pass on your account is the cheapest option once more than one or two remote viewers would each need a Remote Watch Pass. Fix the advertise URL.

### g. Alternatives

| Option | What the primary sources say | Better than this design when |
|---|---|---|
| **Headscale** (self-hosted control server) | Supports grants, ACLs, tags, MagicDNS, Serve and an embedded DERP server. Funnel is not supported ([src] [headscale docs/about/features.md](https://github.com/juanfont/headscale/blob/main/docs/about/features.md)). Headscale itself needs a reachable `server_url` with its own TLS cert ([src] [docs/ref/tls.md](https://github.com/juanfont/headscale/blob/main/docs/ref/tls.md)), which means a VPS or a port forward. Caddy's Tailscale cert path works with Headscale only if the server issues certs ([src] Caddy tls.md). Unverified: whether Headscale issues `ts.net`-style certs; it does not use `ts.net`. | You want no third-party coordination server and already run a VPS with a domain. More to run, same clients. |
| **Cloudflare Tunnel + Access** | On Free, Pro and Business plans, *public hostname* routes fall under the CDN terms, which require a paid service such as Stream for video and large files. *Private network* routes (Cloudflare One Client / Mesh) are not restricted ([src] [cloudflare-docs cloudflare-tunnels-faq.mdx](https://github.com/cloudflare/cloudflare-docs/blob/production/src/content/docs/cloudflare-one/faq/cloudflare-tunnels-faq.mdx)). Proxied request bodies are capped at 100 MB on Free and Pro ([index] [Error 413](https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-413/), [Workers limits](https://developers.cloudflare.com/workers/platform/limits/)). Immich's FAQ warns that Tunnel's 100 MB cap breaks video uploads ([src] [immich docs FAQ.mdx](https://github.com/immich-app/immich/blob/main/docs/docs/FAQ.mdx)). Cloudflare terminates TLS. | Only for small web apps without video that family must open in a browser with no app installed, such as Seerr behind Access. Not for Plex or Immich. |
| **Pangolin** | Self-hosted WireGuard "zero-trust reverse proxy + VPN". The connector ("Newt") dials out from home; the server needs a VPS with a domain, a wildcard DNS record, and open TCP 80/443 plus UDP ports ([src] [fosrl/docs how-pangolin-works.mdx, dns-and-networking.mdx](https://github.com/fosrl/docs/tree/main/content/docs); [fosrl/pangolin README](https://github.com/fosrl/pangolin/blob/main/README.md)). | Family must use public browser URLs with SSO (Immich sharing, Seerr) and you are willing to run and patch a VPS. You also lose Tailscale's "nothing public" property. |
| **Plain WireGuard** | Immich lists it as option 1, "simple and very secure", but it needs a port forward and DDNS without a static IP ([src] [immich docs guides/remote-access.md](https://github.com/immich-app/immich/blob/main/docs/docs/guides/remote-access.md)). | Only you connect, you accept one UDP port forward, and you want no third-party coordinator. Per-user, per-port access then becomes hand-written firewall rules. |

**Verdict:** Tailscale is still the best fit for an owner who wants no public admin surface and has fewer than 6 family users willing to install an app.

### h. Immich behind Caddy

What Immich asks for ([src] [immich docs reverse-proxy.md](https://github.com/immich-app/immich/blob/main/docs/docs/administration/reverse-proxy.md)) and how this setup meets it:

- **Forward all headers and set `Host`, `X-Real-IP`, `X-Forwarded-Proto` and `X-Forwarded-For`.** Caddy passes `Host` through and sets the three `X-Forwarded-*` headers by default ([src] [caddyserver/website reverse_proxy.md "Defaults"](https://github.com/caddyserver/website/blob/master/src/docs/markdown/caddyfile/directives/reverse_proxy.md)). It does not set `X-Real-IP`. Immich trusts `X-Forwarded-For` from `linklocal` and `uniquelocal` proxies by default, which covers the Docker bridge ([src] [immich server config.repository.ts](https://github.com/immich-app/immich/blob/main/server/src/repositories/config.repository.ts), `IMMICH_TRUSTED_PROXIES`). Because of userspace mode, the forwarded IP is `127.0.0.1` anyway (see a).
- **Big uploads.** Caddy has no body limit unless you add `request_body max_size`, and it streams requests rather than buffering them unless `request_buffers` is set ([src] reverse_proxy.md; request_body.md). Immich's nginx example disables buffering to avoid OOM. Caddy already behaves that way.
- **Websockets.** Caddy proxies upgrades automatically ([src] reverse_proxy.md "Streaming").
- **Timeouts (600 s in Immich's nginx and Traefik examples).** Caddy has no total timeout on request bodies or responses. In 2.11.7, the server defaults are `read_header 1m` and *idle* timeouts `read_body_idle 1m` and `write_idle 1m`. The deadline is "reset on every successful read/write; only a stalled connection is affected" ([src] [caddy v2.11.7 modules/caddyhttp/app.go](https://github.com/caddyserver/caddy/blob/v2.11.7/modules/caddyhttp/app.go); [options.md](https://github.com/caddyserver/website/blob/master/src/docs/markdown/caddyfile/options.md)). Upstream `read_timeout`, `write_timeout` and `response_header_timeout` default to no timeout ([src] reverse_proxy.md). Traefik's 60 s total timeout caused Immich's documented failure; that does not happen with Caddy.
- **Root path, not a sub-path.** Met: Immich is at `:2283/`.
- Immich's own Caddy example is just `reverse_proxy <host>:2283`, which is what this Caddyfile does.

**Verdict: Good.** No change needed. Optional: `header_up X-Real-IP {remote_host}` for completeness.

## Recommended changes (ranked by value)

1. **Fix the Plex advertise URL (High, 2 minutes).** `ADVERTISE_IP` is ignored by `linuxserver/plex`. In Plex, go to Settings → Network → *Custom server access URLs* and enter `https://homelab.<tailnet>.ts.net:32400`. Then remove `ADVERTISE_IP` and `PLEX_ADVERTISE_URLS` from `compose.yml` and `.env.example`, or switch to `plexinc/pms-docker`. Correct HL-11 in the security report and step 14 of the spec's manual steps. (§f)
2. **Rewrite `tailscale-policy.example.hujson` with `grants` (Medium, 10 minutes).** Use the block in §e. Add policy `tests` that check family is denied on 4000, 8080 and 19999. (§e)
3. **Test whether Plex treats tailnet sessions as local (Medium, 5 minutes).** Play a video on your phone over cellular plus Tailscale, and check the Plex dashboard. That tells you whether family on the tailnet need a Pass at all. (§f)
4. **Optional: Tailscale Services for the family apps (Medium value, about 1 hour).** For example `svc:plex`, `svc:photos` and `svc:requests` from a `TS_SERVE_CONFIG` on the existing tagged node. Grant `group:family` → `svc:*` and drop their port grants. This gives clean names and per-service access, and works on the free plan (up to 10). (§c)
5. **Optional: replace Caddy with Tailscale Serve (Low–Medium).** Fewer containers, no shared LocalAPI socket, real client IPs and identity headers. You lose the HSTS header and Caddyfile flexibility. Do it together with 4, or not at all. (§a)
6. **Kernel mode only if measured to be slow (Low).** Spec Appendix B. It also gives Caddy and the apps real client IPs. (§d)
7. **Small hardening (Low).** Pin the docs URL to `https://tailscale.com/docs/...` in comments. Optionally add `header_up X-Real-IP {remote_host}` for Immich. Keep using a one-off tagged auth key. Consider `TS_CLIENT_ID`/`TS_CLIENT_SECRET` (OAuth) if you rebuild the node often ([src] containerboot main.go). (§a, §h)
