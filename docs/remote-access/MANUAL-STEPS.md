# Remote Access: Manual Tasks

This guide gives you the tasks that only you can do. Do them in the order shown.

The tasks make your homelab safe. Then they let you reach it from outside your home with Tailscale. Tailscale is a private network. You do not open ports on your router.

**Time:** 1 to 2 hours.

**You need:**

- The server (a terminal in the `homelab` folder).
- A phone.
- An email account for Tailscale (Google, GitHub, Apple or Microsoft). The account must use 2FA.
- Your router login.

**Names used in this guide:**

- `<YOUR-TAILNET>` is the name of your tailnet. It looks like `tail1234.ts.net`. You get it in Task 8.
- `<SERVER-LAN-IP>` is the LAN address of the server. An example is `10.0.0.100`.
- `homelab` is the machine name on your tailnet. It is the `TS_HOSTNAME` value.
- The full address of the server is `homelab.<YOUR-TAILNET>`.

## Task list

| Done | Task | What it does | Time |
| --- | --- | --- | --- |
| [ ] | 1. File Browser | Remove the old container | 5 min |
| [ ] | 2. qBittorrent | Change the password. Set the safe options | 10 min |
| [ ] | 3. Radarr, Sonarr, Prowlarr | Set Authentication Required to Enabled | 10 min |
| [ ] | 4. Immich and Seerr | Check the database password and sign-in | 5 min |
| [ ] | 5. Router | Stop UPnP and port forwards | 15 min |
| [ ] | 6. BIND_ADDR | Publish the web pages on the LAN address only | 5 min |
| [ ] | 7. Tailscale account | Make the account | 5 min |
| [ ] | 8. MagicDNS and HTTPS | Enable names and certificates | 5 min |
| [ ] | 9. Access rules | Paste the ACL policy (uses `grants`) | 10 min |
| [ ] | 10. Auth key | Make a key for the server | 5 min |
| [ ] | 11. `.env` values | Write the Tailscale values | 5 min |
| [ ] | 12. Start the `remote` profile | Download the images, validate the Caddyfile, start `tailscale` and `caddy` | 10 min |
| [ ] | 13. Examine the new containers | Check health, certificate and machine name | 5 min |
| [ ] | 14. Remove the key | Delete the key from `.env` | 2 min |
| [ ] | 15. Device approval | Approve each new device | 3 min |
| [ ] | 16. Your devices | Install Tailscale on phone and laptop | 10 min |
| [ ] | 17. Phone apps | Set the Immich, Plex and Seerr addresses | 10 min |
| [ ] | 18. Test from outside | Test with mobile data and the checks of the security report | 30 min |
| [ ] | 19. Plex over Tailscale | Set the custom server access URLs | 5 min |
| [ ] | 20. Plex for family without Tailscale (optional) | Use Plex Remote Access | 10 min |
| [ ] | 21. Family invites (optional) | Invite family to the tailnet | 10 min |
| [ ] | 22. Updates | Update the containers each week | 5 min |
| [ ] | 23. GHCR package | Make the `homelab-rack` image public | 5 min |
| [ ] | 24. Protect `main` | Set the branch rules. Turn on 2FA | 10 min |
| [ ] | 25. Server repository | Put the repository on a clean `main` | 3 min |
| [ ] | 26. `jq` and `curl` | Install two tools | 2 min |
| [ ] | 27. Install the deploy timer | Run `deploy/install.sh` | 3 min |
| [ ] | 28. Dry run | Test the deploy script with no change | 3 min |
| [ ] | 29. Examine the timer and logs | Check that the timer runs | 3 min |
| [ ] | 30. Deploy hook secret | Make the secret. Put it in `.env` and in GitHub | 5 min |
| [ ] | 31. Push deploy rules | Paste the policy file that has `tag:ci` | 5 min |
| [ ] | 32. Tailscale federated identity | Make the identity. Put its values in GitHub | 10 min |
| [ ] | 33. Repository variable | Add `TS_HOST` in GitHub | 3 min |
| [ ] | 34. Start the deploy hook | Add the `push` profile. Install the path unit | 5 min |
| [ ] | 35. Test with a small pull request | Make sure an automatic deploy works | 10 min |
| [ ] | 36. Pause and roll back | Stop the deploy units. Go back to an old version | 5 min |
| [ ] | 37. If the repository is private (optional) | Set the token, deploy key and build mode | 20 min |

---

## Part A: Make the system safe

Do Tasks 1 to 6 before you start anything remote.

> **WARNING**
> Do not start the `remote` profile before Tasks 2 and 3 are done. Without these tasks, a person on your tailnet can use the apps with no password. This can cause data loss.

### Task 1. Remove File Browser

**Why:** The app is not used, and it could read and delete all files.

1. Pull the new `compose.yml` to the server.
2. Stop and delete the old container with this command.

```bash
docker compose up -d --remove-orphans
```

> **CAUTION**
> This command also removes each other container that is no longer in `compose.yml`. Read the list that Docker shows before you continue.

3. Make sure this command shows no container.

```bash
docker ps -a --filter name=filebrowser
```

4. Optional: delete the old settings with this command.

```bash
sudo rm -r appdata/filebrowser
```

> **WARNING**
> This command deletes a folder and all its files. You cannot undo it. Make sure the path is correct before you run it.

> **NOTE**
> If you set a custom `APPDATA` in `.env`, use that folder instead of `appdata`.

**Result:** No container has the name `filebrowser`. Nothing listens on port 8181.

### Task 2. Change the qBittorrent password and settings

**Why:** qBittorrent can run programs. Caddy sends all remote traffic from the local address 127.0.0.1. A bypass option would let everyone in.

1. Open `http://<SERVER-LAN-IP>:8080` in a browser.
2. Sign in as `admin`. If you do not know the password, find it in the logs with this command.

```bash
docker logs qbittorrent
```

3. Open Tools > Options > Web UI.
4. Type a new strong password in the Authentication section. Use a password that you use nowhere else.
5. Make sure "Bypass authentication for clients on localhost" is off.
6. Make sure "Bypass authentication for clients in whitelisted IP subnets" is off.
7. Make sure "Enable reverse proxy support" is off. Do not change this option.
8. Click Save.
9. Open `.env` in a text editor.
10. Write the new user name and password in the `RACK_QBITTORRENT_USERNAME` and `RACK_QBITTORRENT_PASSWORD` lines.
11. Restart Rack so it reads the new values.

```bash
docker compose up -d rack
```

12. Open Radarr at `http://<SERVER-LAN-IP>:7878`. Open Settings > Download Clients.
13. Open the qBittorrent entry. Type the new password. Click Save.
14. Do the same in Sonarr at `http://<SERVER-LAN-IP>:8989`.

**Result:** The Web UI asks for the new password. Radarr and Sonarr show a green test result for qBittorrent.

> **NOTE**
> In Tailscale userspace mode, Caddy sees every tailnet client as 127.0.0.1. Reverse proxy support gives no benefit here. A ban after failed logins would lock out all tailnet users. Your protection is a strong password.

### Task 3. Set authentication in Radarr, Sonarr and Prowlarr

**Why:** The option "Disabled for Local Addresses" lets Caddy traffic in without a password. Caddy traffic always looks local.

> **WARNING**
> Do not use "Disabled for Local Addresses". With this option, each person on your tailnet can use the app with no password.

Do the steps below in each app. The addresses are:

- Radarr: `http://<SERVER-LAN-IP>:7878`
- Sonarr: `http://<SERVER-LAN-IP>:8989`
- Prowlarr: `http://<SERVER-LAN-IP>:9696`

1. Open the address in a browser.
2. Open Settings > General.
3. Find the Security section. Click Show Advanced if you do not see it.
4. Set Authentication to Forms.
5. Set Authentication Required to Enabled.
6. Type a user name.
7. Type a strong password. Use a different password for each app.
8. Click Save.
9. Do what the app asks. It can ask you to restart.
10. Sign in with the new login to make sure it works.

**Result:** Each app shows a sign-in form when you open it in a new private browser window.

### Task 4. Check Immich and Seerr

**Why:** Immich keeps your photos. Seerr lets other people ask for media.

1. Open the `.env` file.
2. Find the `DB_PASSWORD` line.
3. If it says `change-me-to-a-secure-password` or `your-secure-password`, you must change it.

> **WARNING**
> Change `DB_PASSWORD` only before the first start of Immich. If Immich already runs, a new value breaks the database link and Immich does not start. In that case, keep the old value. Postgres has no published port, so the risk is low.

4. To make a new password, type this command.

```bash
openssl rand -hex 24
```

5. Write the result in the `DB_PASSWORD` line of `.env`.
6. Open Immich at `http://<SERVER-LAN-IP>:2283`.
7. Create the admin account if you did not create it. If you want, enable 2FA in Account Settings.
8. Open Seerr at `http://<SERVER-LAN-IP>:5055`.
9. Open Settings > Users.
10. Make sure that only Plex accounts you approve can sign in.

**Result:** `DB_PASSWORD` is not an example value, or you chose to keep the old value. The Seerr user list shows only people you know.

### Task 5. Set the router

**Why:** UPnP lets a program open router ports with no warning. A port forward or open IPv6 makes the apps visible on the internet.

Each router has different menus. Use the manual of your router if you cannot find a setting.

1. Sign in to your router.
2. Set UPnP to off.
3. Set NAT-PMP to off.
4. Delete all port forwards that point to the server.
5. Find the IPv6 firewall setting. Make sure it blocks inbound traffic by default.
6. Find the DHCP settings. Make a DHCP reservation for the server. The server then always gets the same LAN address.
7. Write the reserved address. Use it as `<SERVER-LAN-IP>` in this guide.

**Result:** The router shows no port forwards and UPnP is off. The server keeps the same LAN address after a restart.

> **NOTE**
> If you want Plex for family without Tailscale, you add one port forward in Task 20. Do not add it now.

### Task 6. Set BIND_ADDR and check the exposure

**Why:** `BIND_ADDR` makes Docker publish the web pages on the LAN address only. Docker ports bypass the `ufw` firewall.

1. Open the `.env` file in a text editor.
2. Find the line `BIND_ADDR=0.0.0.0`.
3. Change it to `BIND_ADDR=<SERVER-LAN-IP>`. Write the real address, for example `BIND_ADDR=10.0.0.100`.
4. Save the file.
5. Apply the change.

```bash
docker compose up -d
```

6. Run the exposure check.

```bash
./scripts/check-exposure.sh
```

7. Read the output. Rack (4000), Netdata (19999) and FlareSolverr (8191) must not show on all interfaces.
8. If the script shows a warning, examine the `BIND_ADDR` line and do step 5 again.

**Result:** The script ends with no warning. The apps still open at `http://<SERVER-LAN-IP>:<port>` from your LAN.

> **NOTE**
> Plex (32400) and the torrent port (6881) stay on all interfaces on purpose. The script does not warn about them.

---

## Part B: Configure Tailscale

### Task 7. Make the Tailscale account

**Why:** The Tailscale account decides who can enter your tailnet. The account is the key to your server.

1. Open `https://tailscale.com` in a browser.
2. Click Get started.
3. Sign in with a Google, GitHub, Apple or Microsoft account.
4. Make sure the account has 2FA enabled. If it does not, enable 2FA in the settings of that provider.

**Result:** You see the Tailscale admin console at `https://login.tailscale.com/admin`.

### Task 8. Enable MagicDNS and HTTPS certificates

**Why:** MagicDNS gives the server a name. The HTTPS certificate makes the browser padlock work.

1. In the admin console, open the DNS page.
2. Make sure MagicDNS is on. Enable it if it is off.
3. Find the tailnet name. It looks like `tail1234.ts.net`.
4. Write the name. This is your `<YOUR-TAILNET>`.
5. Find the section HTTPS Certificates.
6. Click Enable.

**Result:** The DNS page shows MagicDNS on and your tailnet name. HTTPS Certificates shows as enabled.

> **NOTE**
> Public certificate logs show the name `homelab.<YOUR-TAILNET>`. The name shows only that the host exists. You cannot reach the host with it. If you want a random name, rename the tailnet on the DNS page before step 4.

### Task 9. Paste the access rules

**Why:** The rules decide who can reach which port. You get all ports. Family gets only the family homepage, Plex, Immich and Seerr.

1. On the server, show the policy file.

```bash
cat docs/remote-access/tailscale-policy.example.hujson
```

2. Copy all the text.
3. In the admin console, open the Access controls page.
4. Delete the old text. Paste the new text.
5. Find the line that starts with `"group:family"`.
6. Replace `family-member@example.com` with the real email of each family member. Separate the emails with commas.
7. Find the `"tests"` section near the end. Find the line `"src": "family-member@example.com"`.
8. Replace that email with one email from step 6. The test then checks a real family member.
9. If you have no family now, write `"group:family": [],` in step 6.
10. Then delete the test block that starts with `"src": "family-member@example.com"`. Keep the `tag:ci` test block.
11. Click Save.

**Result:** The page shows a green message that the policy is saved. It shows no errors.

> **NOTE**
> The error "want: Accept, got: Drop" for `family-member@example.com` means step 8 is not done. The test user must be in `group:family`.

> **NOTE**
> The file uses `grants`. The old `acls` syntax is not used. The admin console must accept the file without errors. If it shows an error, do not continue.

> **NOTE**
> Do this task before Task 10. The tag `tag:homelab` must exist before you make the auth key.

### Task 10. Make the auth key

**Why:** The server uses the key to join your tailnet one time.

> **WARNING**
> The auth key works like a password. Do not send it to other people. Do not save it in a file other than `.env`. Delete it from `.env` in Task 14.

> **CAUTION**
> Never add `--advertise-routes` to `TS_EXTRA_ARGS`. It makes every container reachable from the tailnet. FlareSolverr is also reachable then.

1. In the admin console, open Settings > Keys.
2. Click Generate auth key.
3. Set Reusable to off.
4. Set Ephemeral to off.
5. Set Pre-approved to on.
6. Click Add tags. Choose `tag:homelab`.
7. Set the expiry to 1 day.
8. Click Generate key.
9. Copy the key. The page shows it only one time.

**Result:** You have a key that starts with `tskey-auth-`.

### Task 11. Write the Tailscale values in `.env`

**Why:** The containers read their settings from `.env`.

1. Open the `.env` file in a text editor.
2. Find the section "Remote access". If it is not there, copy it from `.env.example`.
3. Set `TS_AUTHKEY` to the key from Task 10.
4. Set `TS_TAILNET` to `<YOUR-TAILNET>`, for example `TS_TAILNET=tail1234.ts.net`.
5. Keep `TS_HOSTNAME=homelab`. Change it only if a machine named `homelab` is already in your tailnet.
6. Keep `TS_EXTRA_ARGS` empty.
7. If you want the `remote` profile in each command, remove the `#` from the line `COMPOSE_PROFILES=remote`. The deploy timer (Part D) uses only this line. It does not use `--profile remote`.
8. Save the file.

**Result:** `.env` has your key, your tailnet name and the host name `homelab`.

### Task 12. Check the images and start the `remote` profile

**Why:** This task checks the images and the Caddyfile before it starts the `tailscale` container and the `caddy` container.

1. Prepare the folders. The script makes the `tailscale` and `caddy` folders.

```bash
./setup.sh
```

2. Download the images.

```bash
docker compose --profile remote pull
```

3. Validate the Caddyfile.

```bash
docker run --rm -e CADDY_DOMAIN=homelab.example.ts.net -v "$PWD/caddy/Caddyfile:/etc/caddy/Caddyfile:ro" caddy:2.11.7 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
```

NOTE: This command does not use the `tailscale` container. Thus, it works before the containers start.

4. Make sure the command ends with "Valid configuration". If it does not, do not continue.
5. Start the containers.

```bash
docker compose --profile remote up -d
```

6. Wait 1 minute.
7. Examine the status of the containers.

```bash
docker compose --profile remote ps
```

**Result:** The Caddyfile is valid. The `tailscale` and `caddy` containers run. The Tailscale admin console shows a new machine named `homelab` with the tag `tag:homelab`.

> **NOTE**
> If `./setup.sh` says that you need more rights, type `sudo ./setup.sh`. The script uses `chown`.

### Task 13. Examine the new containers on the server

**Why:** These checks find faults before you test from a phone.

1. Make sure the health check reports healthy.

```bash
docker compose --profile remote ps
```

2. Read the logs of Caddy.

```bash
docker compose logs caddy
```

3. Make sure each site shows "server running". Make sure the log shows no line with `"level":"error"`.

> **NOTE**
> Caddy gets the certificate at the first visit, not at the start. Thus, the log shows no certificate line yet. These warnings are normal: "Caddyfile input is not formatted", "failed to sufficiently increase receive buffer size", "HTTP/2 skipped" and "admin endpoint disabled".

3a. On a phone or laptop with Tailscale on, open `https://homelab.<YOUR-TAILNET>`. The first load can take a few seconds.
3b. Make sure the browser shows the Home media page with no certificate warning.
3c. Read the recent logs of Caddy again.

```bash
docker compose logs caddy --since 5m
```

3d. Make sure no error line mentions `tailscale` or `certificate`.
4. In the admin console, open the Machines page.
5. Make sure the machine name is exactly `homelab`. The name must not end in `-1`.
6. Restart `tailscale`.

```bash
docker compose restart tailscale
```

7. Wait 1 minute. Make sure Caddy still works.
8. If Caddy does not work, recreate it.

```bash
docker compose --profile remote up -d --force-recreate caddy
```

**Result:** Both containers are healthy. The homepage opens with no certificate warning. The machine name is `homelab`.

### Task 14. Remove the auth key

**Why:** The server stays signed in without the key. A key in `.env` is a risk.

1. Open the `.env` file.
2. Delete the value of `TS_AUTHKEY`. Keep the line `TS_AUTHKEY=`.
3. Save the file.
4. Apply the change.

```bash
docker compose --profile remote up -d
```

5. In the admin console, open Settings > Keys.
6. If the key shows in the list, click Revoke.

**Result:** `.env` has no key. The machine `homelab` is still online in the admin console.

### Task 15. Enable device approval

**Why:** A new device then needs your approval before it can join the tailnet.

1. In the admin console, open Settings > Device management.
2. Enable Device approval.
3. If you want more protection, enable Tailnet Lock. This is optional.

**Result:** The page shows Device approval on. The machine `homelab` stays online.

> **NOTE**
> A new device needs your approval to join. Open the Machines page and click Approve for each new device. Do this in Task 16 for your phone and laptop.

---

## Part C: Use it

### Task 16. Install Tailscale on your phone and laptop

**Why:** A device must run Tailscale to reach the server from outside.

1. Install the Tailscale app on your phone from the app store.
2. Open the app. Sign in with the account from Task 7.
3. Install the Tailscale app on your laptop. Get it from `https://tailscale.com/download`.
4. Sign in on the laptop.
5. If the admin console shows a device that waits for approval, open the Machines page and click Approve.
6. On the phone, set Tailscale to on.
7. Open `https://homelab.<YOUR-TAILNET>:4000` in the phone browser. This is the Rack address.
8. Open `https://homelab.<YOUR-TAILNET>` in the phone browser. This is the family homepage.

**Result:** The Rack address shows a padlock and the Rack dashboard. The links in Rack open each app. The family homepage shows three tiles.

### Task 17. Set the phone apps

**Why:** The apps need the new address to work away from home.

Keep Tailscale on during these steps.

1. Open the Immich app.
2. Set the server URL to `https://homelab.<YOUR-TAILNET>:2283`.
3. Sign in.
4. Enable background backup.
5. Open the Plex app. Sign in as usual. Plex detects the server automatically.
6. For Seerr, open `https://homelab.<YOUR-TAILNET>:5055` in the phone browser.
7. If you use an app such as nzb360 or LunaSea, use `https://homelab.<YOUR-TAILNET>:<port>`. The port is the same as on the LAN.

**Result:** The Immich app shows your photos. Seerr shows the sign-in page.

### Task 18. Test from outside

**Why:** This test shows that the system works with Tailscale and is closed without it. It uses the checks from section 6 of the security report.

> **CAUTION**
> Set Wi-Fi to off on the phone. Use mobile data. A test on your home Wi-Fi tells you nothing about the internet.

1. On the phone, set Wi-Fi to off.
2. In the Tailscale app, set Tailscale to off.
3. Open `https://homelab.<YOUR-TAILNET>:8989` in the browser.
4. Make sure the page does not load. The name does not resolve, or the browser shows a time-out.
5. In the Tailscale app, set Tailscale to on.
6. Open `https://homelab.<YOUR-TAILNET>:8989` again.
7. Make sure the browser shows a padlock and the Sonarr sign-in form. The page must not show the Sonarr dashboard.
8. Do the same for these addresses. Each one must show a sign-in form.
   - `https://homelab.<YOUR-TAILNET>:7878` (Radarr)
   - `https://homelab.<YOUR-TAILNET>:9696` (Prowlarr)
   - `https://homelab.<YOUR-TAILNET>:8080` (qBittorrent)
9. Open `https://homelab.<YOUR-TAILNET>:8191`. The page must not load. FlareSolverr is never available through Caddy.
10. Open `https://homelab.<YOUR-TAILNET>:4000`. The Rack dashboard must open for you, the admin.
11. Set Wi-Fi to on again.
12. On the server, run the exposure check one more time.

```bash
./scripts/check-exposure.sh
```

12. On the server, list all host listeners. With `BIND_ADDR` set, the web pages must show only the LAN address.

```bash
sudo ss -tulpn | grep -Ev '127\.0\.0\.1|\[::1\]'
```

13. Read the output. Only Plex (32400), the torrent port (6881), the Plex discovery ports and `sshd` can show on 0.0.0.0.
14. On the server, list the ports that Docker publishes for each container.

```bash
docker ps --format '{{.Names}}' | xargs -n1 docker port
```

15. Make sure `flaresolverr`, `tailscale` and `caddy` print nothing.
16. Make sure Caddy publishes no host ports. The result must show `container:` and the ID of `tailscale`.

```bash
docker inspect caddy --format '{{.HostConfig.NetworkMode}}'
```

17. Make sure the Caddy admin API does not answer on the server. The command must fail.

```bash
docker compose --profile remote exec caddy wget -qO- http://127.0.0.1:2019/config/ ; echo "rc=$?"
```

18. On the laptop with Tailscale on, make sure port 2019 does not answer from the tailnet. The command must fail or time out.

```bash
curl -m 10 http://homelab.<YOUR-TAILNET>:2019/config/
```

19. On the server, make sure Immich does not see unrelated secrets. The command must print nothing.

```bash
docker exec immich_server env | grep RACK_
```

20. On the server, find your public IPv4 address.

```bash
curl ifconfig.me
```

21. On the server, find your global IPv6 address, if you have one.

```bash
ip -6 addr show scope global
```

22. Connect the laptop to the phone hotspot. Set Tailscale on the laptop to off.
23. Run this command on the laptop. Replace `<PUBLIC-IP>` with the address from step 20.

```bash
nmap -Pn -p 1-65535 <PUBLIC-IP>
```

24. If step 21 gave an IPv6 address, run this command on the laptop. Replace `<SERVER-IPV6>` with that address.

```bash
nmap -6 -Pn -p 1-65535 <SERVER-IPV6>
```

25. Read the results of both scans. All ports must show as closed or filtered. Port 32400 can be open if you did Task 20.
26. Open `https://www.shodan.io/host/<PUBLIC-IP>` in a browser. Replace `<PUBLIC-IP>` with the address from step 20.
27. Make sure Shodan shows nothing, or shows only Plex. Check again after one week.

**Result:** Without Tailscale, no page loads. With Tailscale, each page loads with a padlock and asks for a login. The server checks, the port scans and Shodan show no exposed port.

### Task 19. Tell Plex the tailnet address

**Why:** Plex tells its apps which addresses to use. The apps then find the server over the tailnet.

1. Open Plex at `http://<SERVER-LAN-IP>:32400/web`.
2. Open Settings > Network.
3. Find "Custom server access URLs".
4. Type this text in the field.

```text
http://<SERVER-LAN-IP>:32400,https://homelab.<YOUR-TAILNET>:32400
```

5. Find "List of IP addresses and networks that are allowed without auth".
6. Make sure this field is EMPTY.
7. Click Save Changes.
8. Optional: on a phone, set Wi-Fi to off and Tailscale to on.
9. Optional: play a video in the Plex app.
10. Optional: on the server, open the Plex dashboard and examine the stream.
11. Optional: note if the stream shows as "Local".

**Result:** The Plex app on your phone detects the server when Tailscale is on and Wi-Fi is off.

> **WARNING**
> If the allowed-without-auth list contains 127.0.0.1, 172.16.0.0/12 or your LAN range, every user through Tailscale skips the Plex sign-in. Keep the list empty.

> **NOTE**
> If the stream shows as "Local", you may not need a Plex Pass to watch video from outside the home. This result is not certain. Otherwise, you need a Plex Pass on your account, or the viewer needs a Remote Watch Pass.

### Task 20. Plex for family without Tailscale (optional)

**Why:** Some family members do not want to install Tailscale. Plex has its own remote access with its own login.

> **WARNING**
> This task opens one port on your router. Open only TCP port 32400. Do not open any other port. A second open port can expose your apps to the internet.

1. Open Plex at `http://<SERVER-LAN-IP>:32400/web`.
2. Open Settings > Remote Access.
3. Click Enable Remote Access.
4. Click Show Advanced.
5. Select "Manually specify public port". Type `32400`.
6. Click Apply.
7. In your router, add a port forward. Forward TCP port 32400 to `<SERVER-LAN-IP>` port 32400.
8. Make sure UPnP is still off.
9. Wait for Plex to show a green check mark for Remote Access.

**Result:** Plex shows "Fully accessible outside your network". No other port is forwarded.

> **NOTE**
> To watch video from outside the home, you need a Plex Pass on your account. Or the viewer needs a Remote Watch Pass.

### Task 21. Invite family to the tailnet (optional)

**Why:** Family members who use Tailscale can reach Plex, Immich and Seerr. They cannot reach the other apps.

1. In the admin console, open the Users page.
2. Click Invite external users or Invite users.
3. Type the email of the family member. Click Invite.
4. Open the Access controls page.
5. Add the same email to the list `"group:family"`.
6. Click Save.
7. Tell the family member to install Tailscale and accept the invite.
8. Open the Machines page. Click Approve for the new device.
9. Ask the family member to test these addresses. All three must load.
   - `https://homelab.<YOUR-TAILNET>:32400`
   - `https://homelab.<YOUR-TAILNET>:2283`
   - `https://homelab.<YOUR-TAILNET>:5055`
10. Send the family member this address: `https://homelab.<YOUR-TAILNET>`. This is the family homepage.
11. Tell the family member to save the address as a bookmark on the phone.
12. Ask the family member to open the family homepage. The page must show tiles for Plex, Immich and Seerr.
13. Ask the family member to open `https://homelab.<YOUR-TAILNET>:4000`. The page must not load.
14. Ask the family member to open `https://homelab.<YOUR-TAILNET>:8989`. The page must not load.

**Result:** Family can use ports 443 (homepage), 32400, 2283 and 5055. The ports 4000 (Rack), 19999, 8080 and 8989 time out for them.

> **NOTE**
> The free plan allows up to 6 users.

### Task 22. Update the containers each week

**Why:** Old images can have known faults. Update on purpose and not by chance.

1. Read the release notes for Netdata and Plex.
2. Download and start the new images.

```bash
docker compose --profile remote pull && docker compose --profile remote up -d --build
```

3. Every few months, examine Docker Hub for newer tags of `tailscale/tailscale` and `caddy`.
4. Change the tags in `compose.yml` by hand. The tags are now `tailscale/tailscale:v1.104.4` and `caddy:2.11.7`.

**Result:** `docker compose --profile remote ps` shows the status "running" for all containers.

---

## Part D: Automatic deploys

Do these tasks once. Then the server deploys each change from the `main` branch by itself. Read [docs/deploy.md](../deploy.md) first.

> **NOTE**
> The server asks GitHub for new releases. GitHub does not connect to your home. You open no port and you give GitHub no key.

### Task 23. Make the GHCR package public

**Why:** The server downloads the Rack image with no login. A private package needs a token on the server.

**Before you start:** Wait for the first run of the `Release` workflow. It must finish with a green mark. The package does not exist before this run.

1. Open `https://github.com` in a browser. Sign in.
2. Click your profile picture. Click Your profile.
3. Click the Packages tab.
4. Click `homelab-rack`.
5. Click Package settings.
6. Find the Danger Zone section. Click Change visibility.
7. Select Public.
8. Type the name of the package to confirm.
9. Click the confirm button.

**Result:** The package page shows the label "Public".

> **NOTE**
> If the repository stays private, do Task 37 instead.

### Task 24. Protect the main branch

**Why:** The server runs the code of `main`. A person who can change `main` can run code on your server. Branch rules and 2FA stop this.

1. Open the repository on GitHub. Click Settings.
2. Click Branches. Or click Rules, then Rulesets.
3. Click Add branch ruleset, or Add classic branch protection rule.
4. Set the branch name pattern to `main`.
5. Turn on "Require a pull request before merging".
6. Turn on "Require status checks to pass".
7. Add the five checks from the workflow `ci.yml`: `compose`, `shell`, `hook`, `rack` and `image`.
8. Do not add the check `release`. It runs only after the merge. A pull request cannot get it, so the pull request cannot merge.
9. Turn on "Block force pushes".
10. Turn on "Restrict deletions".
11. Click Create, or click Save changes.
12. Click your profile picture. Click Settings.
13. Click Password and authentication.
14. Turn on two-factor authentication. Use an authenticator app or a passkey.

**Result:** A direct push to `main` is refused. A pull request cannot merge until the checks are green.

> **WARNING**
> Do not skip this task. Without it, a stolen GitHub password gives control of your server.

### Task 25. Put the repository on a clean main

**Why:** The deploy script refuses to run when the repository has local changes. It also refuses to run on another branch.

1. On the server, open a terminal in the `homelab` folder.
2. Switch to the `main` branch.

```bash
git checkout main
```

3. Get the newest code.

```bash
git pull
```

4. Examine the status.

```bash
git status
```

5. Make sure the output says "nothing to commit, working tree clean".
6. If the output lists changed files, keep or discard them with `git stash` before you continue.
7. If you use remote access (Part B), open `.env`. Make sure the line `COMPOSE_PROFILES=remote` has no `#` before it.

**Result:** `git status` shows `On branch main` and "working tree clean".

> **NOTE**
> The files `.env` and `appdata` are not in Git. The deploy script does not change them.

> **WARNING**
> The deploy script does not use `--profile remote`. If `COMPOSE_PROFILES=remote` is not in `.env`, the deploys do not update `tailscale` and `caddy`. The containers continue to run.

### Task 26. Install jq and curl

**Why:** The deploy script uses `curl` to ask GitHub. It uses `jq` to read the answer.

1. Install the two tools.

```bash
sudo apt install jq curl
```

2. Make sure that both tools work.

```bash
jq --version && curl --version | head -n 1
```

**Result:** The terminal shows a version for `jq` and for `curl`.

### Task 27. Install the deploy timer

**Why:** The timer starts the deploy script every hour. It is the fallback when the push trigger (Tasks 30 to 34) does not work.

**Before you start:** Make sure your user is in the `docker` group. Type `id` to see your groups.

1. In the `homelab` folder, run the install script.

```bash
./deploy/install.sh
```

2. Type your password when `sudo` asks for it.
3. Read the last line of the output.

**Result:** The output says "Installed". The file `deploy/deploy.env` exists.

> **NOTE**
> The script is safe to run again. To remove the timer, type `./deploy/install.sh --uninstall`.

### Task 28. Do a dry run

**Why:** A dry run shows what the script would do. It changes nothing.

1. Type the command.

```bash
./scripts/deploy.sh --dry-run
```

2. Read the output. Each line has a time and a short commit ID.
3. Make sure the output has no line with "ERROR".

**Result:** The output says "up to date". Or it lists the steps that the script would do.

> **NOTE**
> A line with "refusing" means the repository has local changes or is not on `main`. Do Task 25 again.

### Task 29. Examine the timer and the logs

**Why:** You must know that the timer runs. You must know where to read the logs.

1. Show the timer.

```bash
systemctl list-timers homelab-deploy.timer
```

2. Make sure the NEXT column shows a time in the next hour.
3. Show the last 50 log lines.

```bash
journalctl -u homelab-deploy -n 50
```

4. Make sure each line shows a time and a commit ID.

**Result:** The timer is active. The log has lines from the deploy script.

### Task 30. Make the deploy hook secret

**Why:** The deploy hook accepts only a signed request. The server and GitHub must know the same secret.

> **WARNING**
> The secret works like a password. Do not send it to other people. Do not save it in a file other than `.env`.

1. On the server, make a random secret.

```bash
openssl rand -hex 32
```

2. Copy the output.
3. Open the `.env` file in a text editor.
4. Find the line `DEPLOY_HOOK_SECRET=`. If it is not there, copy it from `.env.example`.
5. Paste the secret after the equals sign. Save the file.
6. On GitHub, open the repository. Click Settings.
7. Click Secrets and variables. Click Actions.
8. Click New repository secret.
9. Set Name to `DEPLOY_HOOK_SECRET`.
10. Paste the same secret in the Secret box.
11. Click Add secret.

**Result:** `.env` and GitHub have the same value for `DEPLOY_HOOK_SECRET`.

> **NOTE**
> The deploy hook does not start when the secret has fewer than 32 characters. The command above gives 64.

### Task 31. Paste the access rules for push deploy

**Why:** The new rules add the tag `tag:ci`. A temporary GitHub node with this tag can reach port 9000 on the server. It can reach no other port.

**Before you start:** Do Task 9 first. Keep the family emails that you set there.

1. On the server, show the policy file.

```bash
cat docs/remote-access/tailscale-policy.example.hujson
```

2. Copy all the text.
3. In the admin console, open the Access controls page.
4. Delete the old text. Paste the new text.
5. Find the line that starts with `"group:family"`.
6. Write the same family emails as in Task 9.
7. Click Save.
8. Read the test results on the page.
9. Make sure all tests pass.

**Result:** The page shows a green message that the policy is saved. All tests pass.

> **CAUTION**
> If a test fails, do not continue. A failed test can mean that `tag:ci` reaches more than port 9000.

### Task 32. Make the Tailscale federated identity

**Why:** GitHub uses this identity to join your tailnet for a few seconds. GitHub proves who it is with a short token (OIDC). You store no Tailscale secret in GitHub. The identity can only make nodes with the tag `tag:ci`.

**Before you start:** Do Task 31. The tag `tag:ci` must exist.

1. In the admin console, open Settings. Click Trust credentials.
2. Add a new credential. Choose the type OpenID Connect.
3. Set the issuer to GitHub.
4. Set the subject to this exact text:

```text
repo:Gascon1/homelab:ref:refs/heads/main
```

5. Find the Keys section. Find the scope Auth Keys (`auth_keys`). Set it to Write.
6. Select no other scope. Do not select Devices Core.
7. For the Auth Keys scope, add the tag `tag:ci`. Add no other tag.
8. Save the credential.
9. Copy the Client ID. Copy the Audience.
10. On GitHub, open Settings > Secrets and variables > Actions.
11. Click New repository secret.
12. Set Name to `TS_OAUTH_CLIENT_ID`. Paste the Client ID. Click Add secret.
13. Click New repository secret.
14. Set Name to `TS_AUDIENCE`. Paste the Audience. Click Add secret.

**Result:** GitHub has the two secrets `TS_OAUTH_CLIENT_ID` and `TS_AUDIENCE`. The credential in Tailscale trusts only the `main` branch of `Gascon1/homelab`.

> **CAUTION**
> Do not use a subject with `*`. A wide subject lets other branches, pull requests or other repositories join your tailnet as `tag:ci`.

> **CAUTION**
> The scope Devices Core can delete and approve all devices on your tailnet. The GitHub action needs only Auth Keys with Write.

> **NOTE**
> The names on the page can be different. Look for "workload identity federation" in the Tailscale documentation.

### Task 33. Add the repository variable TS_HOST

**Why:** The workflow needs the address of your server. The address is not secret, so it is a variable.

1. On GitHub, open Settings > Secrets and variables > Actions.
2. Click the Variables tab.
3. Click New repository variable.
4. Set Name to `TS_HOST`.
5. Set Value to `homelab.<YOUR-TAILNET>`. Use your real tailnet name.
6. Click Add variable.

**Result:** The Variables tab shows `TS_HOST` with the address of your server.

### Task 34. Start the deploy hook and install the path unit

**Why:** The `deploy-hook` container receives the request. The path unit starts the deploy when the hook writes its trigger file.

**Before you start:** Do Tasks 30 to 33. Make sure that `.env` has the secret from Task 30.

> **CAUTION**
> Do not add the `push` profile before you set `DEPLOY_HOOK_SECRET`. Without the secret, `deploy-hook` does not start. Then each deploy fails and rolls back.

1. Open `.env`. Find the line `COMPOSE_PROFILES=remote`.
2. Change it to `COMPOSE_PROFILES=remote,push`. Save the file.
3. In the `homelab` folder, start the containers.

```bash
docker compose up -d
```

4. Make sure `deploy-hook` is healthy.

```bash
docker compose ps deploy-hook
```

5. Run the install script again.

```bash
./deploy/install.sh
```

6. Type your password when `sudo` asks for it.
7. Make sure the path unit is active.

```bash
systemctl status homelab-deploy.path
```

**Result:** `deploy-hook` is healthy. The path unit shows "active (waiting)".

> **NOTE**
> If `docker logs deploy-hook` says "not writable", run `./setup.sh` again. It makes the folder for the trigger file and gives it to your user. Then run `docker compose up -d --force-recreate deploy-hook`.

### Task 35. Test with a small pull request

**Why:** This test shows that the full path works, from GitHub to your server.

**Before you start:** Do Tasks 30 to 34.

1. On GitHub, make a small pull request. Change one line in a document.
2. Wait for the `CI` checks to turn green.
3. Merge the pull request.
4. Wait for the `Release` workflow to finish with a green mark.
5. Wait one minute. The `notify` job runs after the `release` job.
6. On GitHub, open the `notify` job of the run. Read its log.
7. Make sure the log shows no error. The last step must show a green mark.
8. On the server, read the log of the receiver.

```bash
docker logs deploy-hook
```

9. Make sure the last line shows the status 202.
10. Read the log of the deploy service.

```bash
journalctl -u homelab-deploy -n 50
```

11. Make sure the log has a line with "DEPLOYED".
12. Open Rack at `http://<SERVER-LAN-IP>:4000`.
13. Make sure Rack loads with no error.

**Result:** The log shows "DEPLOYED" and the new commit ID. `git log -1` on the server shows the same commit.

> **NOTE**
> The log line "gate pending" is normal. It means the `Release` workflow is not finished. The next doorbell or the hourly timer tries again.

> **NOTE**
> If the `notify` log says "push deploy not configured", a secret or `TS_HOST` is not set. Do Tasks 30 to 33 again. The hourly timer deploys the change in the meantime.

### Task 36. Pause and roll back

**Why:** You must be able to stop automatic deploys. You must be able to go back to an old version.

**To pause:**

1. Stop the timer and the path unit.

```bash
sudo systemctl stop homelab-deploy.timer homelab-deploy.path
```

2. To start them again, type this command.

```bash
sudo systemctl start homelab-deploy.timer homelab-deploy.path
```

**To roll back by hand:**

1. Pause the timer and the path unit. Use the command above.
2. Find the commit ID of the good version.

```bash
git log --oneline -n 10
```

3. Go back to that commit. Replace `<GOOD-SHA>` with the full commit ID.

```bash
git reset --hard <GOOD-SHA>
```

4. Set the image tag. Replace `<GOOD-SHA>` with the full commit ID.

```bash
RACK_TAG=sha-<GOOD-SHA> docker compose up -d --wait
```

5. Make sure Rack works.
6. Start the timer and the path unit again only after a fix is on `main`.

**Result:** The timer and the path unit are stopped. Rack runs the good version.

> **WARNING**
> After step 3, the repository is behind `origin/main`. If you start the timer or the path unit, it deploys `main` again. Fix `main` first.

> **NOTE**
> The script rolls back by itself when the new version does not start. It then ignores that commit until `main` changes.

### Task 37. If the repository is private (optional)

**Why:** Do this task only if you make the repository private. A private repository needs credentials for three things.

**A. The release check**

1. On GitHub, click your profile picture. Click Settings.
2. Click Developer settings. Click Personal access tokens. Click Fine-grained tokens.
3. Click Generate new token.
4. Select only the `homelab` repository.
5. Give read-only access to Checks, Contents and Metadata.
6. Click Generate token. Copy the token.
7. On the server, open `deploy/deploy.env` in a text editor.
8. Add the line `GITHUB_TOKEN=` followed by the token.
9. Save the file.

**B. The code download**

1. On the server, make an SSH key for deploys only.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/homelab-deploy -N ""
```

2. Show the public key.

```bash
cat ~/.ssh/homelab-deploy.pub
```

3. On GitHub, open the repository. Click Settings, then Deploy keys, then Add deploy key.
4. Paste the public key. Do not select "Allow write access".
5. Click Add key.
6. Tell Git to use the key for this repository.

```bash
git config core.sshCommand "ssh -i ~/.ssh/homelab-deploy -o IdentitiesOnly=yes"
```

7. Change the remote to SSH.

```bash
git remote set-url origin git@github.com:Gascon1/homelab.git
```

8. Connect once by hand to accept the GitHub host key.

```bash
git fetch origin main
```

**C. The image**

1. Open `deploy/deploy.env` in a text editor.
2. Set `RACK_SOURCE=build`.
3. Save the file.
4. Run the dry run from Task 28.

**Result:** The dry run shows no "404" and no "fetch failed" line. The server builds the Rack image on its own.

> **NOTE**
> A build on the server takes a few minutes. The token must have read-only access. Never use a token that can write.

---

## If you have a problem

| Symptom | Action |
| --- | --- |
| The admin console does not show the machine `homelab`. | Read the logs with `docker compose logs tailscale`. Make sure the key is not expired and `TS_AUTHKEY` has no spaces. |
| The log says the auth key is not valid. | Make a new key (Task 10). Write it in `.env`. Run `docker compose --profile remote up -d`. |
| The browser shows a certificate error. | Make sure HTTPS Certificates is on (Task 8). Make sure `TS_TAILNET` is correct. Run `docker compose restart caddy`. |
| The name `homelab.<YOUR-TAILNET>` does not resolve. | Make sure Tailscale is on in the phone app. Make sure MagicDNS is on (Task 8). |
| The page does not load, and Tailscale is on. | Make sure the device is approved (Task 15). Run `docker compose --profile remote ps` to see if `caddy` runs. |
| `caddy` does not start, or stops after a restart of `tailscale`. | Run `docker compose --profile remote up -d`. This starts `caddy` again. |
| The machine is named `homelab-1`. | An old machine named `homelab` exists. Delete the old machine in the admin console. Or set `TS_HOSTNAME` to a new name and use that name. |
| Rack links do not open. | Use the Rack address `https://homelab.<YOUR-TAILNET>:4000`. Do not use the LAN address. Only the admin can open this address. |
| A family member cannot open Plex, Immich or Seerr. | Examine the email in `group:family` (Task 9). Make sure the device is approved. |
| A page opens with no sign-in form. | Stop. Do Task 3 again. Do not use the page until it asks for a password. |
| Radarr or Sonarr cannot reach qBittorrent. | Type the new password in Settings > Download Clients (Task 2). |
| qBittorrent refuses all logins after wrong passwords. | Run `docker compose restart qbittorrent`. This clears the ban list. Then use the correct password. |
| Rack shows no data for qBittorrent. | Make sure the `RACK_QBITTORRENT_*` values in `.env` are correct. Run `docker compose up -d rack`. |
| `./scripts/check-exposure.sh` shows a warning. | Make sure `BIND_ADDR` has the LAN address. Run `docker compose up -d`. Run the script again. |
| The Plex app cannot find the server over Tailscale. | Examine "Custom server access URLs" in Plex > Settings > Network (Task 19). |
| Immich does not start after you changed `DB_PASSWORD`. | Write the old value back in `.env`. Run `docker compose up -d`. |

## How to undo

Use these steps to remove remote access. Your LAN access does not change.

1. Stop the containers.

```bash
docker compose --profile remote --profile push stop caddy tailscale deploy-hook
```

2. Delete the containers.

```bash
docker compose --profile remote --profile push rm -f caddy tailscale deploy-hook
```

3. Open `.env`. Add the `#` again before `COMPOSE_PROFILES`.
4. In `.env`, delete the value of `TS_AUTHKEY`.
5. In Plex, open Settings > Network. Delete the tailnet address from "Custom server access URLs".
6. In the admin console, open the Machines page. Delete the machine `homelab`.
7. Open Settings > Keys. Revoke all keys that are still in the list.
8. If you want, delete the Tailscale state folder. This folder holds the key of the node.

```bash
sudo rm -r appdata/tailscale
```

> **WARNING**
> The command in step 8 deletes a folder and all its files. You cannot undo it. Make sure you are in the `homelab` folder. Make sure the path is exactly `appdata/tailscale`.

9. In your router, delete the port forward for TCP 32400 if you added it in Task 20.
10. If you want the old LAN behavior, set `BIND_ADDR=0.0.0.0` in `.env`. Then type this command.

```bash
docker compose up -d
```

> **WARNING**
> Step 10 publishes the web pages on all network interfaces. Do it only if you have a reason. Keep the passwords from Tasks 2 and 3.

> **NOTE**
> Step 8 uses the default `APPDATA=./appdata`. If you set another `APPDATA`, use that path.
