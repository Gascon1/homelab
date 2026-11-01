# Storage

`DATA_DIR` (`/srv/data`) is a **mergerfs pool**. Each HDD is its own ext4 filesystem (a **branch**) mounted at `/srv/dataN`. mergerfs presents them as one volume. Both the branches and the pool are mounted from `/etc/fstab`, so fstab is the source of truth for the current branches and options. `lsblk -o NAME,SIZE,FSTYPE,MOUNTPOINTS,MODEL,SERIAL` maps each branch to its disk.

## How the pool behaves

- **Placement is `epmfs`** (existing path, most free space). A new file goes only to a branch that already has its parent directory. Of those branches, it goes to the one with the most free space. A branch without `media/movies` never receives a movie, no matter how empty it is. Every branch needs the same top-level directory **skeleton** (step 4).
- **Hardlinks work only within one branch.** The \*arr apps hardlink from `torrents/` into `media/`. `epmfs` keeps the link on the branch that holds the torrent, as long as that branch also has the `media/...` parent. If the parent is missing, the import silently becomes a full copy. This is another reason every branch needs the skeleton.
- **There is no parity.** A dead disk loses only the files on that disk. The rest of the pool still mounts. Photos (`UPLOAD_LOCATION`) live in the pool, so they need the backup listed in the README.
- `minfreespace=50G` stops new files from landing on a branch with less than 50G free. `moveonenospc=true` moves a file that is being written when its branch fills up.

## Adding a disk

Run as the server's user, from the repo root. `N` is the next unused branch number. The disk device (`sdX`) is whatever step 1 identifies.

1. **Identify the new disk by serial number.** Device names (`sda`, `sdb`) can change between boots. Match the model and serial in `lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS,MODEL,SERIAL` against the drive's label.
   Done when exactly one disk matches, and it has no partitions and no mountpoints. If it has partitions, stop and confirm it is the right disk before going on, because step 2 erases it.

2. **Partition and format it.**

   ```bash
   sudo parted -s /dev/sdX mklabel gpt mkpart dataN ext4 0% 100%
   sudo mkfs.ext4 -L dataN /dev/sdX1
   ```

   Done when `lsblk -f /dev/sdX` shows one ext4 partition labelled `dataN`.

3. **Mount it as a branch.** Get the partition UUID with `sudo blkid /dev/sdX1`. Add a line to `/etc/fstab` that matches the existing branch lines:

   ```
   UUID=<uuid>  /srv/dataN  ext4  defaults,noatime  0 2
   ```

   ```bash
   sudo mkdir /srv/dataN
   sudo systemctl daemon-reload
   sudo mount /srv/dataN
   ```

   Done when `findmnt /srv/dataN` shows the ext4 partition.

4. **Seed the skeleton and set ownership.** Copy every directory down to depth 2 from an existing branch (`media/movies`, `torrents/incomplete`, ...). Then give the new branch to `PUID:PGID` from `.env`:

   ```bash
   sudo find /srv/data1 -mindepth 1 -maxdepth 2 -type d -printf '%P\0' \
     | (cd /srv/dataN && sudo xargs -0 mkdir -p)
   sudo chown -R "$(grep -oP '^PUID=\K\d+' .env):$(grep -oP '^PGID=\K\d+' .env)" /srv/dataN
   ```

   Done when `diff <(cd /srv/data1 && find . -maxdepth 2 -type d | sort) <(cd /srv/dataN && find . -maxdepth 2 -type d | sort)` prints nothing.

5. **Add the branch to the pool.** Stop anything that could restart the stack, then stop the stack:

   ```bash
   sudo systemctl stop homelab-deploy.timer homelab-deploy.path
   docker compose down
   ```

   Edit the `fuse.mergerfs` line in `/etc/fstab` in two places:
   - Append `:/srv/dataN` to the branch list in the first field.
   - Add `,x-systemd.requires-mounts-for=/srv/dataN` to the options.

   Then remount:

   ```bash
   sudo systemctl daemon-reload
   sudo umount /srv/data
   sudo mount /srv/data
   ```

   Done when `df -h /srv/data` shows a size equal to the sum of all branches.

6. **Check placement.** Create a probe file through the pool and see which branch it landed on:

   ```bash
   touch /srv/data/torrents/.probe && ls /srv/data*/torrents/.probe; rm /srv/data/torrents/.probe
   ```

   Done when the probe lands on the branch with the most free space, which is normally the new one.

7. **Bring everything back.**

   ```bash
   docker compose up -d
   sudo systemctl start homelab-deploy.timer homelab-deploy.path
   ```

   Done when `docker compose ps` shows every service running or healthy, and Rack's media disk shows the new total.

8. **Reboot once.** This proves the fstab ordering works without help: all branches mount before the pool. Done when, after the reboot, `findmnt /srv/data` and `findmnt /srv/dataN` both succeed and the stack is up.
