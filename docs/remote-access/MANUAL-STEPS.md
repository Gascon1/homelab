# Remote Access and Deploys: Manual Tasks

The tasks that only you can do: in web UIs, on the router, in the Tailscale admin console and on GitHub. Do them in order. Each task ends on a **Result**: start the next task only when the result is true.

On a new server, [SETUP.md](../SETUP.md) tells you which tasks to do and when.

**You need:** a terminal in the `homelab` folder on the server, a phone, your router login, and an email account for Tailscale (Google, GitHub, Apple or Microsoft) with 2FA on.

**Names:**

- `<SERVER-LAN-IP>`: the LAN address of the server, for example `10.0.0.100` (Task 4 fixes it).
- `<YOUR-TAILNET>`: your tailnet name, for example `tail1234.ts.net` (Task 7).
- `homelab`: the machine name on the tailnet, the `TS_HOSTNAME` value. The server is `homelab.<YOUR-TAILNET>`.
- **Locked**: an app shows its sign-in form in a new private browser window, and every localhost or local-address bypass is off. Caddy sends all tailnet traffic from 127.0.0.1, so an app with a bypass is open to the whole tailnet.

If you set a custom `APPDATA` in `.env`, use that folder wherever this guide says `appdata`.

## Task list

| Done | Task | Time |
| --- | --- | --- |
| | **Part A: Make the system safe** | |
| [ ] | 1. Lock qBittorrent | 10 min |
| [ ] | 2. Lock Radarr, Sonarr, Prowlarr | 10 min |
| [ ] | 3. Lock Immich and Seerr | 5 min |
| [ ] | 4. Close the router | 15 min |
| [ ] | 5. Publish on the LAN address only | 5 min |
| | **Part B: Configure Tailscale** | |
| [ ] | 6. Make the Tailscale account | 5 min |
| [ ] | 7. Enable MagicDNS and HTTPS | 5 min |
| [ ] | 8. Paste the access policy | 10 min |
| [ ] | 9. Make the auth key | 5 min |
| [ ] | 10. Write the Tailscale values in `.env` | 5 min |
| [ ] | 11. Start the `remote` profile | 10 min |
| [ ] | 12. Examine the new containers | 5 min |
| [ ] | 13. Remove the auth key | 2 min |
| [ ] | 14. Enable device approval | 3 min |
| | **Part C: Use it** | |
| [ ] | 15. Install Tailscale on your devices | 10 min |
| [ ] | 16. Set the phone apps | 10 min |
| [ ] | 17. Test from outside | 30 min |
| [ ] | 18. Tell Plex the tailnet address | 5 min |
| [ ] | 19. Plex for family without Tailscale (optional) | 10 min |
| [ ] | 20. Invite family (optional) | 10 min |
| [ ] | 21. Update the containers each week | 5 min |
| | **Part D: Automatic deploys** | |
| [ ] | 22. Make the GHCR package public | 5 min |
| [ ] | 23. Protect `main` | 10 min |
| [ ] | 24. Put the server on a clean `main` | 3 min |
| [ ] | 25. Install `jq` and `curl` | 2 min |
| [ ] | 26. Install the deploy timer | 3 min |
| [ ] | 27. Do a dry run | 3 min |
| [ ] | 28. Examine the timer and logs | 3 min |
| [ ] | 29. Make the deploy hook secret | 5 min |
| [ ] | 30. Make the Tailscale federated identity | 10 min |
| [ ] | 31. Add the `TS_HOST` variable | 3 min |
| [ ] | 32. Start the deploy hook | 5 min |
| [ ] | 33. Test with a small pull request | 10 min |
| [ ] | 34. Pause and roll back | 5 min |
| [ ] | 35. Private repository (optional) | 20 min |

---

## Part A: Make the system safe

Every app is **locked** (Tasks 1 to 3) before you start the `remote` profile in Task 11.

### Task 1. Lock qBittorrent

**Why:** qBittorrent can run programs. With a localhost bypass, every tailnet user gets in.

1. Open `http://<SERVER-LAN-IP>:8080`. Sign in as `admin`. The first temporary password is in `docker logs qbittorrent`.
2. In Tools > Options > Web UI, set a new user name and a strong, unique password.
3. In the same page, keep these three options off: "Bypass authentication for clients on localhost", "Bypass authentication for clients in whitelisted IP subnets", and "Enable reverse proxy support". Click Save.
4. In `.env`, write the user name and password in `RACK_QBITTORRENT_USERNAME` and `RACK_QBITTORRENT_PASSWORD`. Then restart Rack.

```bash
docker compose up -d rack
```

5. If Radarr and Sonarr already use qBittorrent, type the new password in each one's Settings > Download Clients > qBittorrent. Click Test, then Save.

**Result:** qBittorrent is locked. Rack shows qBittorrent stats. The Radarr and Sonarr test for qBittorrent is green.

> **NOTE**
> Reverse proxy support gives no benefit here: in Tailscale userspace mode, Caddy sees every tailnet client as 127.0.0.1, so a ban after failed logins would lock out all tailnet users. The strong password is the protection.

### Task 2. Lock Radarr, Sonarr and Prowlarr

**Why:** "Disabled for Local Addresses" counts Caddy traffic as local, so it lets every tailnet user in.

Do these steps in Radarr (`:7878`), Sonarr (`:8989`) and Prowlarr (`:9696`):

1. Open `http://<SERVER-LAN-IP>:<port>`. Open Settings > General. Click Show Advanced if you do not see Security.
2. Set Authentication to **Forms** and Authentication Required to **Enabled**.
3. Set a user name and a strong password, different for each app. Click Save, and restart the app if it asks.

**Result:** all three apps are locked.

### Task 3. Lock Immich and Seerr

**Why:** Immich keeps your photos. Seerr lets other people request media.

1. In `.env`, read `DB_PASSWORD`. If it is an example value (`change-me-to-a-secure-password` or `your-secure-password`) **and Immich has never started**, replace it with the output of `openssl rand -hex 24`. If Immich already runs, keep the old value: a new one locks Immich out of its database. Postgres has no published port, so the old value is a low risk.
2. Open Immich at `http://<SERVER-LAN-IP>:2283`. Create the admin account if it does not exist. Optional: enable 2FA in Account Settings.
3. Open Seerr at `http://<SERVER-LAN-IP>:5055`. In Settings > Users, keep only Plex accounts you approve.

**Result:** `DB_PASSWORD` is not an example value (or you chose to keep the old one), Immich asks for a login, and the Seerr user list shows only people you know.

### Task 4. Close the router

**Why:** UPnP lets programs open router ports with no warning. A port forward or open IPv6 puts the apps on the internet.

Menus differ per router. Use its manual if you cannot find a setting.

1. Set UPnP and NAT-PMP to off.
2. Delete every port forward to the server. (Task 19 can add one for Plex later.)
3. Set the IPv6 firewall to block inbound traffic by default.
4. Make a DHCP reservation for the server. That address is `<SERVER-LAN-IP>`.

**Result:** the router shows UPnP off, no port forwards, and the reservation. The server keeps its address after a restart.

### Task 5. Publish on the LAN address only

**Why:** Docker-published ports bypass the `ufw` firewall. `BIND_ADDR` makes Docker publish the web UIs on the LAN address only.

1. In `.env`, set `BIND_ADDR=<SERVER-LAN-IP>`, for example `BIND_ADDR=10.0.0.100`. Apply it.

```bash
docker compose up -d
```

2. Run the exposure check.

```bash
./scripts/check-exposure.sh
```

**Result:** the check exits with no warning, and the apps still open at `http://<SERVER-LAN-IP>:<port>`. Plex (32400) stays on all interfaces on purpose; the script expects it.

---

## Part B: Configure Tailscale

### Task 6. Make the Tailscale account

**Why:** the Tailscale account decides who joins your tailnet. It is the key to your server.

1. Open `https://tailscale.com`, click Get started, and sign in with a Google, GitHub, Apple or Microsoft account.
2. Make sure that account has 2FA on, in the settings of that provider.

**Result:** you see the admin console at `https://login.tailscale.com/admin`.

### Task 7. Enable MagicDNS and HTTPS certificates

**Why:** MagicDNS gives the server a name. The HTTPS certificate makes the padlock work.

1. In the admin console, open DNS. Make sure MagicDNS is on.
2. Optional: rename the tailnet now. Certificate logs make `homelab.<YOUR-TAILNET>` public (the name only; nobody can reach it).
3. Write down the tailnet name. It is `<YOUR-TAILNET>`.
4. In HTTPS Certificates, click Enable.

**Result:** the DNS page shows MagicDNS on, your tailnet name, and HTTPS Certificates enabled.

### Task 8. Paste the access policy

**Why:** the policy decides who reaches which port. Admins get every port. Family gets the homepage (443), Plex, Immich and Seerr. GitHub's deploy node (`tag:ci`, Part D) gets port 9000 only.

The policy uses `grants`, and its `tests` block makes the console refuse a policy that gives the wrong access.

1. Show the file and copy all of it.

```bash
cat docs/remote-access/tailscale-policy.example.hujson
```

2. In the admin console, open Access controls. Replace all the text with the copy.
3. In `"group:family"`, replace `family-member@example.com` with the real emails, separated by commas.
4. In `"tests"`, set the `"src"` of the first block to one of those emails.
5. With no family yet: write `"group:family": [],` and delete the first test block. Keep the `tag:ci` block.
6. Click Save.

**Result:** the console saves the policy with no error, and every test passes.

> **NOTE**
> "want: Accept, got: Drop" for `family-member@example.com` means step 4 is not done.

### Task 9. Make the auth key

**Why:** the server uses the key once, to join the tailnet. Task 8 must be done first: the key needs `tag:homelab`.

1. In the admin console, open Settings > Keys and click Generate auth key.
2. Set Reusable **off**, Ephemeral **off**, Pre-approved **on**, tag `tag:homelab`, expiry 1 day.
3. Click Generate key. Copy it: the page shows it only once.

**Result:** you have a key that starts with `tskey-auth-`. Keep it only in `.env` until Task 13 removes it.

### Task 10. Write the Tailscale values in `.env`

**Why:** the `tailscale` and `caddy` containers read their settings from `.env`.

1. In `.env`, find the "Remote access" section (copy it from `.env.example` if it is missing). Set:
   - `TS_AUTHKEY` to the key from Task 9.
   - `TS_TAILNET` to `<YOUR-TAILNET>`.
   - `TS_HOSTNAME=homelab`. Change it only if the tailnet already has a machine named `homelab`.
   - `TS_EXTRA_ARGS` empty. It must never contain `--advertise-routes`: that makes every container, FlareSolverr too, reachable from the tailnet.
2. Uncomment `COMPOSE_PROFILES=remote`. Every `docker compose` command, and every deploy in Part D, then includes `tailscale` and `caddy`.

**Result:** `.env` has the key, the tailnet name, `TS_HOSTNAME=homelab` and `COMPOSE_PROFILES=remote`.

### Task 11. Start the `remote` profile

**Why:** this checks the Caddyfile before the containers start.

1. Make the folders (use `sudo` if it asks for rights).

```bash
./setup.sh
```

2. Download the images.

```bash
docker compose pull
```

3. Validate the Caddyfile with the image that `compose.yml` pins.

```bash
docker run --rm -e CADDY_DOMAIN=homelab.example.ts.net -v "$PWD/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" "$(docker compose config --images | grep '^caddy:')" caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

4. Start the containers.

```bash
docker compose up -d
```

**Result:** step 3 ends with "Valid configuration", and the admin console Machines page shows `homelab` with `tag:homelab`.

### Task 12. Examine the new containers

**Why:** these checks find faults before you test from a phone.

1. Wait 1 minute. Show the status.

```bash
docker compose ps tailscale caddy
```

2. Read the Caddy log. Find the line that says Caddy got a certificate for `homelab.<YOUR-TAILNET>`.

```bash
docker compose logs caddy
```

3. Restart `tailscale`, wait 1 minute, and show the status again. Caddy restarts with it.

```bash
docker compose restart tailscale
```

**Result:** both containers are healthy after the restart, the Caddy log has the certificate and no error, and the machine name is exactly `homelab` (not `homelab-1`).

> **NOTE**
> If Caddy is not healthy after step 3, run `docker compose up -d --force-recreate caddy`.

### Task 13. Remove the auth key

**Why:** the node stays signed in from its saved state (`appdata/tailscale`). A key in `.env` is a credential anything with the Docker socket can read.

1. In `.env`, empty the value: keep the line as `TS_AUTHKEY=`. Recreate the container without the key.

```bash
docker compose up -d
```

2. In the admin console, open Settings > Keys. Revoke the key if it is still listed.

**Result:** `.env` has no key, no auth key is listed, and `homelab` is still online.

### Task 14. Enable device approval

**Why:** a new device then waits for your approval before it joins.

1. In the admin console, open Settings > Device management. Enable Device approval.
2. Optional: enable Tailnet Lock for more protection.

**Result:** Device approval is on, and `homelab` stays online. From now on, approve each new device on the Machines page.

---

## Part C: Use it

### Task 15. Install Tailscale on your phone and laptop

1. Install Tailscale on the phone (app store) and the laptop (`https://tailscale.com/download`). Sign in on both with the Task 6 account.
2. On the Machines page, click Approve for each new device.
3. On the phone, turn Tailscale on. Open `https://homelab.<YOUR-TAILNET>:4000` (Rack) and `https://homelab.<YOUR-TAILNET>` (family homepage).

**Result:** both pages load with a padlock. Rack's links open each app. The homepage shows three tiles: Plex, Immich and Seerr.

### Task 16. Set the phone apps

Keep Tailscale on.

1. In the Immich app, set the server URL to `https://homelab.<YOUR-TAILNET>:2283`. Sign in and enable background backup.
2. Open the Plex app and sign in. It finds the server by itself (Task 18 makes this work away from home).
3. Other apps (Seerr in a browser, nzb360, LunaSea): use `https://homelab.<YOUR-TAILNET>:<port>`, with the same port as on the LAN.

**Result:** the Immich app shows your photos, and `https://homelab.<YOUR-TAILNET>:5055` shows the Seerr sign-in page.

### Task 17. Test from outside

**Why:** this is the security test of the whole setup: the apps work with Tailscale and are closed without it. Run it again after any router or compose change.

Use mobile data with Wi-Fi off. A test on your home Wi-Fi tells you nothing about the internet.

**On the phone:**

1. With Tailscale **off**, open `https://homelab.<YOUR-TAILNET>:8989`. It must not load.
2. With Tailscale **on**, open each address. Each must show a padlock and a sign-in form, never a dashboard:
   - `:8989` (Sonarr), `:7878` (Radarr), `:9696` (Prowlarr), `:8080` (qBittorrent)
3. `https://homelab.<YOUR-TAILNET>:8191` must not load: FlareSolverr has no Caddy site.
4. `https://homelab.<YOUR-TAILNET>:4000` must open Rack for you, the admin.

**On the server:**

5. The exposure check passes.

```bash
./scripts/check-exposure.sh
```

6. Host listeners: only Plex (32400 and its discovery ports) and `sshd` may show on `0.0.0.0`; web UIs show only `<SERVER-LAN-IP>`.

```bash
sudo ss -tulpn | grep -Ev '127\.0\.0\.1|\[::1\]'
```

7. Published ports: `flaresolverr`, `tailscale`, `caddy` and `deploy-hook` print nothing.

```bash
docker ps --format '{{.Names}}' | xargs -n1 docker port
```

8. Caddy shares the `tailscale` network: the output is `container:<id of tailscale>`.

```bash
docker inspect caddy --format '{{.HostConfig.NetworkMode}}'
```

9. The Caddy admin API is off: the command fails (`rc` is not 0).

```bash
docker compose exec caddy wget -qO- http://127.0.0.1:2019/config/ ; echo "rc=$?"
```

10. Immich sees no unrelated secrets: the command prints nothing but `rc=1`.

```bash
docker exec immich_server env | grep -E 'RACK_|TS_AUTHKEY|QBITTORRENT' ; echo "rc=$?"
```

11. Write down the public IPv4 address, and the global IPv6 address if there is one.

```bash
curl ifconfig.me
```

```bash
ip -6 addr show scope global
```

**On the laptop:**

12. With Tailscale on, port 2019 must fail or time out.

```bash
curl -m 10 http://homelab.<YOUR-TAILNET>:2019/config/
```

13. Connect to the phone hotspot and turn Tailscale off. Scan both addresses from step 11. Every port must be closed or filtered, except 32400 if you did Task 19.

```bash
nmap -Pn -p 1-65535 <PUBLIC-IP>
```

```bash
nmap -6 -Pn -p 1-65535 <SERVER-IPV6>
```

14. Open `https://www.shodan.io/host/<PUBLIC-IP>`. It must show nothing, or only Plex. Check again after one week.

**Result:** every check above passes.

### Task 18. Tell Plex the tailnet address

**Why:** Plex tells its apps which addresses to try. With the tailnet address listed, the apps find the server over Tailscale.

1. Open `http://<SERVER-LAN-IP>:32400/web`. Open Settings > Network.
2. Set "Custom server access URLs" to:

```text
http://<SERVER-LAN-IP>:32400,https://homelab.<YOUR-TAILNET>:32400
```

3. Keep "List of IP addresses and networks that are allowed without auth" **empty**. An entry such as 127.0.0.1, 172.16.0.0/12 or your LAN range lets every tailnet user skip the Plex sign-in.
4. Click Save Changes.

**Result:** with Wi-Fi off and Tailscale on, the Plex phone app finds the server and plays a video.

> **NOTE**
> If the Plex dashboard shows that stream as "Local", you may not need a Plex Pass for it. This is not certain. Otherwise, remote streaming needs a Plex Pass on your account or a Remote Watch Pass for the viewer.

### Task 19. Plex for family without Tailscale (optional)

**Why:** Plex has its own remote access with its own login, for family who do not install Tailscale.

This task opens exactly one router port: TCP 32400. That port is the only forward the router ever has.

1. In Plex, open Settings > Remote Access. Click Enable Remote Access, then Show Advanced.
2. Select "Manually specify public port", type `32400`, and click Apply.
3. In the router, forward TCP 32400 to `<SERVER-LAN-IP>` port 32400. UPnP stays off.

**Result:** Plex shows "Fully accessible outside your network", and the router has this one forward only. Viewers need a Plex Pass on your account or a Remote Watch Pass.

### Task 20. Invite family (optional)

**Why:** family on the tailnet reach the homepage, Plex, Immich and Seerr, and nothing else.

1. In the admin console, open Users. Invite the family member by email.
2. In Access controls, add the same email to `"group:family"`. Click Save.
3. When the family member has installed Tailscale and accepted, click Approve for the device on the Machines page.
4. Send them `https://homelab.<YOUR-TAILNET>` (the family homepage) to save as a bookmark.
5. Ask them to open the homepage tiles (Plex, Immich, Seerr), then `:4000` and `:8989`.

**Result:** the homepage and its three tiles load for them, and `:4000` and `:8989` time out. The free plan allows up to 6 users.

### Task 21. Update the containers each week

**Why:** old images can have known faults. Update on purpose, not by chance.

1. Read the release notes for Netdata and Plex (they have the most host access).
2. Download and start the new images. `COMPOSE_PROFILES` in `.env` (Task 10) brings in `tailscale`, `caddy` and `deploy-hook`.

```bash
docker compose pull && docker compose up -d
```

3. Every few months, look on Docker Hub for newer tags of `tailscale/tailscale` and `caddy`. The pinned tags are the `image:` lines in `compose.yml`. Change them in a pull request, so the server stays on a clean `main` (Task 24).

**Result:** `docker compose ps` shows every container running and healthy.

> **NOTE**
> `docker compose up -d --build` builds Rack on the server instead of using the image that CI built. Use it only to test a local change to `rack/`.

---

## Part D: Automatic deploys

Do these tasks once. Then the server deploys each green change on `main` by itself. Read [deploy.md](../deploy.md) first.

The server asks GitHub for new releases. GitHub never gets a login to the server.

### Task 22. Make the GHCR package public

**Why:** the server then downloads the Rack image with no login. A private repository does Task 35 instead.

The package exists only after the first `Release` workflow run is green.

1. On GitHub, open your profile, then Packages, then `homelab-rack`.
2. Open Package settings. In Danger Zone, click Change visibility, select Public, and type the package name to confirm.

**Result:** the package page shows "Public".

### Task 23. Protect the main branch

**Why:** the server runs the code on `main`. Whoever can change `main` can run code on your server.

1. In the repository, open Settings > Rules > Rulesets (or Branches), and add a ruleset (or classic rule) for `main`.
2. Turn on "Require a pull request before merging".
3. Turn on "Require status checks to pass" with the five checks of `ci.yml`: `compose`, `shell`, `hook`, `rack` and `image`. Leave out `release`: it runs only after a merge, so a pull request would wait for it forever.
4. Turn on "Block force pushes" and "Restrict deletions". Save.
5. In your GitHub account, open Settings > Password and authentication. Turn on 2FA with an authenticator app or a passkey.

**Result:** a direct push to `main` is refused, a pull request merges only with green checks, and your account has 2FA.

### Task 24. Put the server on a clean main

**Why:** the deploy script refuses to run on another branch or with local changes.

1. In the `homelab` folder, switch to `main` and pull.

```bash
git checkout main && git pull
```

2. Show the status. Put local changes away with `git stash` if it lists any.

```bash
git status
```

**Result:** `git status` shows `On branch main` and "working tree clean", and `.env` has `COMPOSE_PROFILES=remote` uncommented if you use remote access. (`.env` and `appdata/` are gitignored; deploys never change them.)

### Task 25. Install jq and curl

**Why:** the deploy script asks GitHub with `curl` and reads the answer with `jq`.

```bash
sudo apt install jq curl
```

**Result:** `jq --version && curl --version | head -n 1` shows two versions.

### Task 26. Install the deploy timer

**Why:** the timer runs the deploy script every hour. It is the fallback for the push trigger (Tasks 29 to 32).

Your user must be in the `docker` group (`id` lists it).

```bash
./deploy/install.sh
```

**Result:** the output ends with "Installed", and `deploy/deploy.env` exists. The script is safe to run again; `./deploy/install.sh --uninstall` removes the timer.

### Task 27. Do a dry run

**Why:** a dry run shows what the script would do and changes nothing.

```bash
./scripts/deploy.sh --dry-run
```

**Result:** the output says "up to date" or lists the planned steps, and has no "ERROR" line. A "refusing" line means Task 24 is not done.

### Task 28. Examine the timer and the logs

1. Show the timer.

```bash
systemctl list-timers homelab-deploy.timer
```

2. Show the last 50 log lines.

```bash
journalctl -u homelab-deploy -n 50
```

**Result:** the NEXT column shows a time within the next hour, and each log line has a time and a commit ID.

### Task 29. Make the deploy hook secret

**Why:** the deploy hook accepts only requests signed with a secret that the server and GitHub share.

1. Make the secret.

```bash
openssl rand -hex 32
```

2. In `.env`, set `DEPLOY_HOOK_SECRET=` to it (copy the line from `.env.example` if it is missing).
3. In the repository, open Settings > Secrets and variables > Actions. Add a repository secret named `DEPLOY_HOOK_SECRET` with the same value.

**Result:** `.env` and GitHub have the same 64-character `DEPLOY_HOOK_SECRET`. Keep it only in those two places. (The hook refuses a secret shorter than 32 characters.)

### Task 30. Make the Tailscale federated identity

**Why:** GitHub joins your tailnet for a few seconds with a short-lived OIDC token, so no Tailscale secret is stored in GitHub. The identity can only make `tag:ci` nodes, and the Task 8 policy lets `tag:ci` reach port 9000 only.

1. In the admin console, open Settings > Trust credentials. Add a credential of type OpenID Connect, issuer GitHub.
2. Set the subject to exactly:

```text
repo:Gascon1/homelab:ref:refs/heads/main
```

3. In Keys, set Auth Keys (`auth_keys`) to Write, with the tag `tag:ci` only. Select no other scope.
4. Save. Copy the Client ID and the Audience.
5. In GitHub Actions secrets (as in Task 29), add `TS_OAUTH_CLIENT_ID` (the Client ID) and `TS_AUDIENCE` (the Audience).

**Result:** GitHub has `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`, and the credential trusts only `main` of `Gascon1/homelab`, with one scope and one tag.

> **CAUTION**
> The subject is exact, with no `*`: a wildcard lets other branches, pull requests or repositories join as `tag:ci`. The single scope is Auth Keys Write: Devices Core could delete and approve every device on the tailnet.

> **NOTE**
> If the console names differ, search the Tailscale docs for "workload identity federation".

### Task 31. Add the repository variable TS_HOST

**Why:** the workflow needs the server address. It is not secret, so it is a variable.

1. In GitHub, open Settings > Secrets and variables > Actions > Variables. Add `TS_HOST` with the value `homelab.<YOUR-TAILNET>`.

**Result:** the Variables tab shows `TS_HOST` with your real tailnet name.

### Task 32. Start the deploy hook and install the path unit

**Why:** the `deploy-hook` container receives the request. The path unit starts the deploy when the hook writes its trigger file.

Tasks 29 to 31 come first. The hook does not start without `DEPLOY_HOOK_SECRET`, and with the `push` profile on, every deploy would then fail and roll back.

1. In `.env`, change `COMPOSE_PROFILES=remote` to `COMPOSE_PROFILES=remote,push`. Start the containers.

```bash
docker compose up -d
```

2. Run the installer again. It now also installs the path unit.

```bash
./deploy/install.sh
```

**Result:** `docker compose ps deploy-hook` shows healthy, and `systemctl status homelab-deploy.path` shows "active (waiting)".

> **NOTE**
> If `docker logs deploy-hook` says "not writable", run `./setup.sh`, then `docker compose up -d --force-recreate deploy-hook`.

### Task 33. Test with a small pull request

**Why:** this proves the full path, from GitHub to your server.

1. On GitHub, make a pull request that changes one line in a document. Merge it when `CI` is green.
2. Wait for the `Release` workflow, then its `notify` job, to finish green.
3. On the server, read the receiver log, then the deploy log.

```bash
docker logs deploy-hook
```

```bash
journalctl -u homelab-deploy -n 50
```

**Result:** the last `deploy-hook` line has status 202, the deploy log has "DEPLOYED" with the new commit, `git log -1` shows the same commit, and Rack loads.

> **NOTE**
> "gate pending" is normal: the `Release` workflow was not finished yet, and the next doorbell or hourly run tries again. "push deploy not configured" in the `notify` log means a secret or `TS_HOST` is missing (Tasks 29 to 31); the hourly timer still deploys.

### Task 34. Pause and roll back

**Why:** you must be able to stop deploys and go back to a good version. The script already rolls back by itself when a new version does not start.

**Pause and resume:**

```bash
sudo systemctl stop homelab-deploy.timer homelab-deploy.path
```

```bash
sudo systemctl start homelab-deploy.timer homelab-deploy.path
```

**Roll back by hand:**

1. Pause (above). Find the full commit ID of the good version with `git log --oneline -n 10`.
2. Go back to it and start its image. Replace `<GOOD-SHA>`.

```bash
git reset --hard <GOOD-SHA>
```

```bash
RACK_TAG=sha-<GOOD-SHA> docker compose up -d --wait
```

3. Resume only after a fix is on `main`: the units deploy `main` again as soon as they run.

**Result:** the units are stopped, and Rack runs the good version.

### Task 35. If the repository is private (optional)

**Why:** a private repository needs credentials for the release check, the code download and the image.

**A. The release check**

1. In GitHub, open Settings > Developer settings > Personal access tokens > Fine-grained tokens. Generate a token for the `homelab` repository only, with read-only Checks, Contents and Metadata.
2. In `deploy/deploy.env`, add `GITHUB_TOKEN=<token>`.

**B. The code download**

1. Make a deploy-only SSH key and show its public half.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/homelab-deploy -N ""
```

```bash
cat ~/.ssh/homelab-deploy.pub
```

2. In the repository, open Settings > Deploy keys > Add deploy key. Paste the key, with "Allow write access" unselected.
3. Point Git at the key and the SSH remote, then fetch once to accept the GitHub host key.

```bash
git config core.sshCommand "ssh -i ~/.ssh/homelab-deploy -o IdentitiesOnly=yes"
```

```bash
git remote set-url origin git@github.com:Gascon1/homelab.git
```

```bash
git fetch origin main
```

**C. The image**

1. In `deploy/deploy.env`, set `RACK_SOURCE=build`. The server then builds Rack itself (a few minutes per deploy).

**Result:** the Task 27 dry run shows no "404" and no "fetch failed" line.

---

## If you have a problem

| Symptom | Action |
| --- | --- |
| The admin console does not show `homelab`. | Read `docker compose logs tailscale`. Check that the key has not expired and `TS_AUTHKEY` has no spaces. |
| The log says the auth key is not valid. | Make a new key (Task 9), write it in `.env`, and run `docker compose up -d`. |
| The browser shows a certificate error. | Check HTTPS Certificates (Task 7) and `TS_TAILNET`. Run `docker compose restart caddy`. |
| `homelab.<YOUR-TAILNET>` does not resolve. | Turn Tailscale on in the app. Check MagicDNS (Task 7). |
| The page does not load, with Tailscale on. | Approve the device (Task 14). Check that `caddy` runs with `docker compose ps caddy`. |
| `caddy` is not running. | Run `docker compose up -d`. |
| The machine is named `homelab-1`. | Delete the old `homelab` machine in the admin console, or set a new `TS_HOSTNAME` and use that name. |
| Rack links do not open. | Open Rack at `https://homelab.<YOUR-TAILNET>:4000`, not the LAN address. Only admins can. |
| A family member cannot open Plex, Immich or Seerr. | Check their email in `group:family` (Task 8) and approve their device. |
| A page opens with no sign-in form. | Stop using it. Lock the app again (Tasks 1 to 3). |
| Radarr or Sonarr cannot reach qBittorrent. | Type the new password in Settings > Download Clients (Task 1). |
| qBittorrent refuses all logins after wrong passwords. | Run `docker compose restart qbittorrent` to clear the ban list. |
| Rack shows no qBittorrent data. | Check `RACK_QBITTORRENT_*` in `.env`. Run `docker compose up -d rack`. |
| `check-exposure.sh` warns. | Check `BIND_ADDR` (Task 5). Run `docker compose up -d` and the script again. |
| The Plex app cannot find the server over Tailscale. | Check "Custom server access URLs" (Task 18). |
| Immich does not start after a `DB_PASSWORD` change. | Write the old value back in `.env`. Run `docker compose up -d`. |

## How to undo

These steps remove remote access and push deploys. LAN access stays the same.

1. Stop and delete the containers.

```bash
docker compose --profile remote --profile push rm -sf caddy tailscale deploy-hook
```

2. In `.env`, comment out `COMPOSE_PROFILES` again and empty `TS_AUTHKEY`.
3. In Plex, remove the tailnet address from "Custom server access URLs".
4. In the admin console, delete the `homelab` machine and revoke every remaining key.
5. Optional: delete the Tailscale state, which holds the node's private key. Check the path first: this deletes the folder for good.

```bash
sudo rm -r appdata/tailscale
```

6. In the router, delete the TCP 32400 forward if you added it in Task 19.

Keep `BIND_ADDR` on the LAN address and keep the app passwords: they protect the LAN too.
