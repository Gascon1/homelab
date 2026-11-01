# Photo backup

Every night the server backs up `UPLOAD_LOCATION` (the Immich library, including Immich's own database dumps in `backups/`) with **restic**. The backup goes to a **backup Pi** that lives at another house and is reached over the tailnet. `thumbs/` and `encoded-video/` are skipped because Immich rebuilds them from the originals. Media in `DATA_DIR` is not backed up, because it can be downloaded again.

The files in `backup/` are the source of truth: `backup.sh` for what runs, the units for when, and `pi/` for the Pi's config. The tailnet grant is in `docs/remote-access/tailscale-policy.example.hujson`.

## How it behaves

- **The Pi is append-only.** The server can add snapshots but never delete or rewrite them, so a compromised server cannot wipe its own backups. As a result, nothing is ever pruned automatically (see [Pruning](#pruning)).
- **The repository password is the encryption key.** It lives in `/etc/homelab-backup.password`. Without it, the backup cannot be read, so it must also be in a password manager.
- **A failed run shows as a failed unit.** That includes a run where some files could not be read. Nothing sends an alert, so a run can fail without anyone noticing: [Checking on it](#checking-on-it) is the only way to see it.
- **Once a month the run also verifies the backup.** It downloads 2G of backup data from the Pi and checks it (`CHECK_SUBSET` in the env file).

## Set up the Pi

Do this at home, with the Pi on your own network. The first upload is about 500G, and it takes hours over the LAN but days over the internet.

1. **Flash Raspberry Pi OS Lite (64-bit)** with SSH enabled, then boot the Pi. Pi 3 and Pi 4 both work. Done when you can `ssh` into it.

2. **Join the tailnet as `tag:backup`.** First copy the `tag:backup` entries from `docs/remote-access/tailscale-policy.example.hujson` into the admin console's access controls. Then, on the Pi:

   ```bash
   curl -fsSL https://tailscale.com/install.sh | sh
   sudo tailscale up --hostname=backup-pi --advertise-tags=tag:backup
   ```

   Done when `tailscale ping backup-pi` from the server gets a reply. The tag also turns off key expiry, so the Pi never needs a login again.

3. **Prepare the drive.** Plug it into a USB port, through an enclosure or hub that has its own power supply. Find it by serial number with `lsblk -o NAME,SIZE,MODEL,SERIAL,MOUNTPOINTS`. Then run the commands below, replacing `<uuid>` with the UUID from `sudo blkid /dev/sdX1`:

   ```bash
   sudo parted -s /dev/sdX mklabel gpt mkpart backup ext4 0% 100%
   sudo mkfs.ext4 -L backup /dev/sdX1
   sudo mkdir /srv/backup
   echo 'UUID=<uuid>  /srv/backup  ext4  defaults,noatime,nofail  0 2' | sudo tee -a /etc/fstab
   sudo systemctl daemon-reload && sudo mount /srv/backup
   ```

   Done when `findmnt /srv/backup` shows the drive. To reuse the WD Green, take it out of the server's mergerfs pool first. That procedure isn't written yet.

4. **Install rest-server.** Copy `backup/pi/restic-rest-server` and `backup/pi/override.conf` from the repo to the Pi first. Then, on the Pi:

   ```bash
   sudo apt install -y restic-rest-server apache2-utils
   openssl rand -hex 24          # the rest-server password: keep it for step 5
   sudo htpasswd -B -c /etc/restic-rest-server/users.htpasswd homelab
   sudo chown root:restic-rest-server /etc/restic-rest-server/users.htpasswd
   sudo chmod 640 /etc/restic-rest-server/users.htpasswd
   sudo chown restic-rest-server: /srv/backup
   sudo install -m 644 restic-rest-server /etc/default/restic-rest-server
   sudo sed -i "s/100.X.Y.Z/$(tailscale ip -4)/" /etc/default/restic-rest-server
   sudo install -D -m 644 override.conf /etc/systemd/system/restic-rest-server.service.d/override.conf
   sudo systemctl daemon-reload && sudo systemctl enable --now restic-rest-server
   ```

   Done when `curl -s -o /dev/null -w '%{http_code}\n' http://backup-pi:8000/` on the server prints `401`. A `401` means the server is up and asking for a login. A timeout means the server is down or the tailnet grant is missing.

## Set up the server

5. **Install the backup.** Run `backup/install.sh` from the repo. In `/etc/homelab-backup.env`, replace `CHANGE_ME` with the password from step 4. Then store `sudo cat /etc/homelab-backup.password` in your password manager. Done when the password manager entry exists and `systemctl list-timers homelab-backup.timer` shows the next run.

6. **Create the repository** with `sudo /usr/local/libexec/homelab-backup/backup.sh init`. Done when restic prints `created restic repository`.

7. **Run the first backup.** Start it with `sudo systemctl start --no-block homelab-backup.service`, then watch it with `journalctl -fu homelab-backup`. Done when the journal ends with `Done` and `sudo /usr/local/libexec/homelab-backup/backup.sh restic snapshots` lists one snapshot.

8. **Prove a restore.** Pick any one file from `restic ls latest`, restore it, and compare it with the original:

   ```bash
   B=/usr/local/libexec/homelab-backup/backup.sh
   sudo $B restic restore latest --target /tmp/restore-test --include <path-from-ls>
   sudo cmp /tmp/restore-test<path-from-ls> <path-from-ls> && echo identical
   sudo rm -rf /tmp/restore-test
   ```

   Done when it prints `identical`.

9. **Move the Pi to the other house** and plug it in. It needs only power and internet. Done when the next morning's run succeeds and `restic snapshots` shows a new snapshot dated that night.

## Checking on it

```bash
systemctl status homelab-backup.service    # result of the last run
systemctl list-timers homelab-backup.timer # last and next run
sudo /usr/local/libexec/homelab-backup/backup.sh restic snapshots
```

## Pruning

Snapshots of a photo library cost almost nothing, because restic stores unchanged files only once. Photos you delete stay in the backup, which is intended. Pruning is needed only when the backup drive gets full. Run it on the Pi itself, where the append-only limit does not apply. It asks for the repository password:

```bash
sudo apt install -y restic
sudo -u restic-rest-server restic -r /srv/backup/homelab forget --prune \
  --keep-daily 7 --keep-weekly 8 --keep-monthly 24
```

## Restoring after a loss

1. Restore the whole library: `sudo /usr/local/libexec/homelab-backup/backup.sh restic restore latest --target /` puts files back at their original paths.
2. Restore Immich's database from the newest dump in `backups/`, following [Immich's backup and restore guide](https://immich.app/docs/administration/backup-and-restore).

With the server gone, any Linux machine can do the restore. It needs restic, the repository password and tailnet access, and then `RESTIC_REPOSITORY` and `RESTIC_PASSWORD_FILE` set by hand.
