# Storage: is mergerfs-only the right setup? (research, 2026-11-01)

The question: is the data pool (two mismatched HDDs pooled with mergerfs, no parity, no backup) the right strategy for this workload, or would something else be better? The workload is mostly replaceable media (Plex, Sonarr/Radarr, qBittorrent with hardlink imports), plus a small set of Immich photos that cannot be replaced. More mismatched drives will be added over time. For how the pool is actually set up and run, see [storage.md](storage.md). This note covers only the choice and the options review.

**How each claim was checked.** Each claim is labelled:

- **[src]**: read on the project's or vendor's own page (linked) on 2026-11-01.
- **[local]**: read on this machine: the installed mergerfs 2.33.5 man page (`/usr/share/man/man1/mergerfs.1.gz`), `df`, `apt-cache policy`, `findmnt`, `systemctl list-timers`.
- **[secondary]**: forum or retailer text. Treat as likely.
- **inference**: my own reasoning from the cited facts. No source says it in those words.

## What is on the machine now [local]

| | data1 | data2 |
|---|---|---|
| Disk | Seagate ST8000DM004 (BarraCuda, 8 TB, SMR) | WD20EARS (WD Green 2 TB, about 2010) |
| ext4 size / used / free | 7.3T / 4.0T / **2.9T** | 1.8T / 24K / **1.7T** |
| Top-level dirs | `media/{movies,photos,series,videos}`, `torrents/{incomplete,movies,prowlarr,series}` | `torrents/{movies,series}` only |
| Notable contents | **photos 637G**, series 1.6T, movies 549G | empty |

- Ubuntu 24.04.4 LTS, kernel 6.8. Repo packages: mergerfs **2.33.5** (installed), zfsutils-linux **2.2.2**, snapraid 12.3, smartmontools 7.4 and btrfs-progs 6.6.3. **smartmontools is not installed.** The only storage timer is `e2scrub_all.timer`. e2scrub checks ext4 metadata, not the disk surface or its SMART health (inference).
- The Immich uploads (637G) sit only on data1, with no parity and no second copy anywhere.

## TL;DR

- **Keep mergerfs, and tweak it. Do not migrate to ZFS or btrfs.** For mismatched drives that are added one at a time, mostly holding replaceable media, a pool of independent filesystems is the right shape: losing one disk loses only that disk's files. ZFS and btrfs raid1 waste most of a mismatched pair, and the ZFS shipped with Ubuntu 24.04 (2.2.2) does not have RAIDZ expansion. OpenZFS also advises against DM-SMR drives like the 8TB here.
- **The real gap is the photos, not the pool design.** 637G of irreplaceable photos have one copy, on one SMR desktop disk, with no health monitoring. Neither parity nor any RAID layout fixes this: Immich recommends 3-2-1 backups, and SnapRAID calls itself only a "partial backup".
- **There is a latent hardlink bug.** With `category.create=epmfs`, new torrents go to data1 only while data1 has more free space than data2. Once data1 drops below about 1.7T free (about 1.2T more data), new torrents start landing on data2. data2 has no `media/` tree, so the *arr hardlink import fails with EXDEV, and Sonarr/Radarr fall back to copying, which doubles the space used. Switching to the non-path-preserving `pfrd`, the current upstream default and quickstart choice, fixes this, and new drives then need no directory skeleton.
- **Top changes, in order:** (1) an off-machine backup of the photos (plus the Immich DB dumps); (2) smartmontools/smartd with alerts, and a check on the 15-year-old WD20EARS; (3) mergerfs: upgrade to the upstream 2.42.0 `.deb` and set `category.create=pfrd,func.getattr=newest`, using the quickstart cache options; (4) when you buy the next disk, make it a CMR disk of 8TB or more and use it as SnapRAID parity.

## 1. Alternatives for this workload

Losses below are for **one disk dying**, with today's two disks (8TB SMR + 2TB) unless stated.

| Option | Mismatched sizes | Grow one disk at a time | One disk dies | More disks die than redundancy covers | Fit here |
|---|---|---|---|---|---|
| **mergerfs only (now)** | Full capacity of each disk | Add a branch, done | Only the files on that disk are lost. Today that is everything, since data1 holds all of it | Only the failed disks' files | OK for media, **not OK for photos** |
| **mergerfs + SnapRAID** | Full capacity of data disks; parity disk must be ≥ largest data disk | Yes, even disks that already hold data | Nothing lost, except changes since the last `sync` on that disk | Only the failed disks' files | **Best fit** once a parity disk is bought |
| **ZFS mirror(s)** | A mirror holds the size of its smallest member (inference) | Add another mirror vdev (two disks at a time) | Nothing (mirror) | Losing a whole vdev loses the pool (inference) | Poor: 8+2 → 2TB usable; SMR discouraged |
| **ZFS raidz** | Each disk limited to the smallest in the vdev (inference) | RAIDZ expansion only in OpenZFS ≥ 2.3; Ubuntu 24.04 ships 2.2.2 | Nothing (raidz1) | Whole pool | Poor: mismatched, needs ≥ 3 disks, SMR discouraged |
| **btrfs raid1** | Pairs chunks across devices; with 8+2 only about 2TB is mirrored | Add a device + balance | Nothing | Pool-wide damage (inference) | Poor capacity with this pair |
| **btrfs single (data) / raid1 (metadata)** | Full capacity | Add a device | Files with extents on that disk (inference) | Same | No better than mergerfs, and one fs spans every disk |
| **LVM linear / mdadm linear (ext4 on top)** | Full capacity | Extend the LV, grow the fs | Effectively the whole fs, since one ext4 spans both disks (inference) | Whole fs | **Worse than now** |
| **mdadm RAID1/5** | Limited by the smallest member (inference) | RAID5 reshape possible but slow | Nothing | Whole array | Poor with 8+2 |
| **Unraid-style (parity array of independent disks)** | Yes; no data disk may be larger than the parity disk | Yes | Nothing | Only the failed disks (SnapRAID compare page) | Equivalent to mergerfs + SnapRAID, but needs the Unraid OS |

Supporting facts:

- **SnapRAID** is "primarily intended for home media centers with large, infrequently changing files". Parity disks must be at least as large as the largest data disk. "Any data added or modifications made since the last sync that are located on the failed disk will be lost." Hardlinks are saved. Its own built-in pooling is "superseded by the mergerfs tool" [src] ([SnapRAID manual](https://www.snapraid.it/manual)). If too many disks fail, "you lose data only on the failed disks; data on other disks remains safe". The rule of thumb is one parity disk for up to four data disks [src] ([SnapRAID FAQ](https://www.snapraid.it/faq)). SnapRAID can add disks that already hold data, and it can recover data beyond its parity count; ZFS and btrfs cannot [src] ([SnapRAID compare](https://www.snapraid.it/compare)).
- **ZFS**: RAIDZ expansion arrived in OpenZFS 2.3.0 ("Add new devices to an existing RAIDZ pool") [src] ([zfs-2.3.0 release](https://github.com/openzfs/zfs/releases/tag/zfs-2.3.0)). The new disk "must be at least as large as the smallest existing disk in the vdev", and "old blocks retain their old data-to-parity ratio" [src] ([zpool-attach(8)](https://openzfs.github.io/openzfs-docs/man/master/8/zpool-attach.8.html)). Capacity formulas assume equal-size disks: raidz holds about (N−P)×X, and a mirror holds X. Data is "dynamically distributed across all top-level devices" [src] ([zpoolconcepts(7)](https://openzfs.github.io/openzfs-docs/man/master/7/zpoolconcepts.7.html)). Ubuntu 24.04's repo has zfsutils-linux 2.2.2, which is older than 2.3 [local].
- **btrfs**: multi-device data defaults to `single` since 5.8, and metadata to `raid1`. "RAID5/6 has known problems and should not be used in production" [src] ([mkfs.btrfs](https://btrfs.readthedocs.io/en/latest/mkfs.btrfs.html)); RAID56 is marked "unstable" [src] ([btrfs Status](https://btrfs.readthedocs.io/en/latest/Status.html)). On a 50 GiB + 100 GiB pair, raid1 "gives us at most 50GiB of usable space" [src] ([btrfs Volume management](https://btrfs.readthedocs.io/en/latest/Volume-management.html)).
- **Unraid**: "Data disks can't be larger than your parity disks" [src] ([Unraid array overview](https://docs.unraid.net/unraid-os/using-unraid-to/manage-storage/array/overview/)).
- **Hardlinks** work only within one filesystem: "You CAN'T hardlink across separate file systems, partitions, volumes or mounts" [src] ([TRaSH: Hardlinks and Instant Moves](https://trash-guides.info/File-and-Folder-Structure/Hardlinks-and-Instant-Moves/)). TRaSH asks for one `data` share with `torrents` and `media` subfolders, mounted as a single `/data` [src] ([TRaSH Unraid how-to](https://trash-guides.info/File-and-Folder-Structure/How-to-set-up/Unraid/)). The compose file already does this for Sonarr/Radarr (`${DATA_DIR}:/data`). TRaSH's pages that I read do not mention mergerfs or create policies.

Verdict (inference): every option that gives redundancy without waste on mismatched disks is a "pool of independent filesystems + snapshot parity" design: mergerfs + SnapRAID, or Unraid. Striped or RAID designs (ZFS, btrfs raid1, md) cost most of the 8TB disk's capacity next to a 2TB, and turn "lose one disk's files" into "lose everything" once failures exceed the redundancy.

## 2. mergerfs option review

Current line: `defaults,allow_other,use_ino,category.create=epmfs,moveonenospc=true,minfreespace=50G` (+ systemd ordering).

### 2.33.5 is far behind upstream

- The latest upstream release is **2.42.0 (May 2026)** [src] ([mergerfs releases](https://github.com/trapexit/mergerfs/releases)). The install docs warn that Debian/Ubuntu "official" packages are likely old, recommend the `.deb` from the releases page, and ask you to "upgrade to the latest release" before reporting bugs [src] ([mergerfs installation](https://trapexit.github.io/mergerfs/latest/setup/installation/)).
- Changes since 2.33.5 that matter here [src] (releases page and docs):
  - **2.35.0** removed `use_ino`: "mergerfs should always be managing inode values" ([inodecalc](https://trapexit.github.io/mergerfs/latest/config/inodecalc/)). It also made `allow_other` automatic when running as root ([deprecated options](https://trapexit.github.io/mergerfs/latest/config/deprecated_options/)).
  - **2.41.0** changed the default create policy **from `epmfs` to `pfrd`**. It made the default inode calculation more stable across reboots, and `cache.files=off` now auto-enables mmap. mergerfs now lowers its own OOM-kill score.
  - **2.42.0** fixed a `moveonenospc` crash when every destination branch is rejected (it now returns ENOSPC). This option is enabled here. It also fixed `rmdir` reporting success on ENOTEMPTY and a race with runtime branch changes.
- In **2.33.5 itself**, `use_ino` is still needed: the man page says "Currently you still need to use use_ino in order to enable inodecalc", and recommends it "so that linked files share the same inode value" [local]. **Keep `use_ino` while on 2.33.5; remove it after upgrading.**

### Create policy: epmfs vs pfrd/mfs for *arr hardlinks

- `ep*` policies are path preserving: they "only consider branches where the relative path already exists". `pfrd` and `mfs` are not, and do not need the path to exist [src] ([functions, categories and policies](https://trapexit.github.io/mergerfs/latest/config/functions_categories_policies/)).
- How `link` works [local] (2.33.5 man, "rename & link"). With a path-preserving create policy, mergerfs links on the source's branch only if the create policy picks that same branch. Otherwise it returns EXDEV. With a non-path-preserving policy, it "clone[s] target path from target drive to source drive" and then links. "link uses the same strategy." The man page adds that EXDEV "will only be returned by mergerfs if using a path preserving policy… simply change the mergerfs policy to the non-path preserving version". The current docs add `link-exdev` (default `passthrough`, which returns EXDEV). Its symlink fallback modes warn that some apps will complain about getting a symlink instead of a hard link [src] ([link-exdev](https://trapexit.github.io/mergerfs/latest/config/link-exdev/)).
- **What that means here (inference, from the facts above and the `df` numbers):** `torrents/{movies,series}` exist on both branches, so epmfs places new downloads on whichever branch has more free space. That is data1 today (2.9T vs 1.7T free). Once data1's free space falls below data2's, downloads go to data2. An import to `/data/media/movies/...` then needs `media/movies` on data2. epmfs picks data1, the only branch that has that path, and data1 is not the source branch, so the result is EXDEV. Sonarr/Radarr then copy instead of hardlinking ("If the hardlink creation fails… Sonarr will fall back and copy the file" [secondary] ([Sonarr forum](https://forums.sonarr.tv/t/hard-links-active-in-prefs-but-still-full-file-copied-with-manual-import-via-hard-link-copy/29755))). That copy lands on data1, and seeding continues from data2, so every import uses twice the space. **Fix: `category.create=pfrd` (or `mfs`).** Then a link always succeeds on the source branch, because mergerfs clones `media/...` there.
- **The directory-skeleton question:** with epmfs, yes, a new branch gets nothing unless you `mkdir` the paths on it. The man page says "you'll need to manually create the core directories". With pfrd/mfs, no skeleton is needed, because paths are cloned as needed [local]. That is why data2 holds only `torrents/*`.
- Trade-off of pfrd (inference, plus [local]): files spread across disks, so a dead disk takes out a random scattering of episodes rather than whole shows. The man page says strict colocation is "rare[ly]" needed, and suggests `msp*` policies as a middle ground. With SnapRAID that trade-off barely matters. `mfs` is the deterministic alternative: always the emptiest disk.
- **TRaSH**: the pages I read do not mention mergerfs or create policies, so there is no TRaSH recommendation to cite. The mergerfs docs own this question.

### Other options

- Upstream quickstart for **Linux ≥ 6.6** (this box runs 6.8): `cache.files=off,category.create=pfrd,func.getattr=newest,dropcacheonclose=false`. The "auto mmap" this relies on needs **mergerfs ≥ 2.41.0** [src] ([quickstart](https://trapexit.github.io/mergerfs/latest/quickstart/)).
- **Caution on 2.33.5:** its man page says that if you need mmap ("used by rtorrent and many sqlite3 base software"), use `cache.files=partial,dropcacheonclose=true` [local]. qBittorrent's libtorrent 2.x "default disk I/O uses memory mapped files" [src] ([libtorrent 2.0 upgrade notes](https://www.libtorrent.org/upgrade_to_2.0-ref.html)). So **do not set `cache.files=off` before upgrading**. Today's unset value (the 2.33.5 default, `libfuse`) leaves mmap working (inference).
- `func.getattr=newest`: Plex and Kodi use directory mtime to decide whether to rescan. The default `ff` can report a stale mtime from the first branch [src] ([mergerfs known issues](https://trapexit.github.io/mergerfs/latest/known_issues_bugs/)). That page also says to keep SQLite and Plex config off mergerfs, which this repo already does (`${APPDATA}` is on the NVMe).
- `inodecalc`: the default is `hybrid-hash`, where hard links on the same branch share an inode value [src] ([inodecalc](https://trapexit.github.io/mergerfs/latest/config/inodecalc/)). The default is fine; leave it.
- `minfreespace=50G` (default 4G) and `moveonenospc` (current default `pfrd`; in 2.33.5, `true` = `mfs`) are sensible as set [src] ([options](https://trapexit.github.io/mergerfs/latest/config/options/)) [local].
- Cosmetic: the mount shows up as `1:2` in `df`/`findmnt` [local]. Setting `fsname=mergerfs` would make it readable ([options](https://trapexit.github.io/mergerfs/latest/config/options/)).

## 3. These particular drives

- **ST8000DM004 is SMR.** Seagate lists the BarraCuda 8TB as SMR, "best suited for workloads that are sequential or easily sequentialized", for example media libraries [src] ([Seagate CMR/SMR list](https://www.seagate.com/products/cmr-smr-list/)). The page names families, not model numbers; retailers label ST8000DM004 itself SMR [secondary] ([Galaxus](https://www.galaxus.ch/en/s1/product/seagate-barracuda-8-tb-35-smr-hard-drives-10376097), [Micro Center](https://Microcenter.Com/quickView/488757/seagate-barracuda-8tb-5400-rpm-sata-iii-6gb-s-35-oem-internal-smr-hard-drive)). I could not read Seagate's datasheet PDF text.
  - **ZFS:** DM-SMR can "trigger severe write-amplification stalls during RAIDZ/mirror resilver, scrub", and "DM-SMR drives are therefore not recommended for ZFS pools" [src] ([OpenZFS Hardware](https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Hardware.html)). This is a second reason against ZFS here.
  - **SnapRAID:** the manual and FAQ say nothing about SMR [src]. SnapRAID writes parity only to the parity disk during `sync`, and writes a rebuild only to the replacement disk (inference from how it works, per the manual). An SMR **data** disk is therefore mostly read, which SMR handles fine. Buy a **CMR** disk for parity and for replacements anyway.
- **WD20EARS (WD Green, about 2010):** health unknown, because smartmontools is not installed [local]. A disk about 15 years old should be assumed near end of life until SMART says otherwise (inference, unverified). Do not trust it with the only copy of anything. It is fine as a scratch or torrent branch, or as a temporary target, while it lasts.
- **Monitoring:** `smartd` with `-a` turns on health, attribute, error-log and self-test-log checks, and `-s (S/../.././02|L/../../6/03)` schedules a daily short test and a weekly long test. `-m` sends mail [src] ([smartd.conf(5), Ubuntu noble](https://manpages.ubuntu.com/manpages/noble/man5/smartd.conf.5.html)). Run `sudo smartctl -a /dev/sdb` once to read the WD's reallocated and pending sector counts and its power-on hours.

## 4. The photos

- Immich: "A 3-2-1 backup strategy is recommended". Back up `UPLOAD_LOCATION/library`, `upload` and `profile`; the automatic DB dumps go to `UPLOAD_LOCATION/backups` and "do **not** contain photos or videos". "Immich does not handle filesystem backups for you" [src] ([Immich backup and restore](https://docs.immich.app/administration/backup-and-restore)).
- SnapRAID: it "creates a partial backup"; "RAID systems are not backups because they do not allow restoration of an earlier state", and "only a full backup allows recovery from a complete failure of the disk array" [src] ([SnapRAID FAQ](https://www.snapraid.it/faq)).
- So, for 637G at `/srv/data/media/photos` (inference from the above): parity only protects against a disk failure. It does not cover deletion, ransomware, a bad Immich upgrade, or fire or theft. The photos need **at least one off-machine copy** (a cloud bucket or another location), ideally versioned, plus a local second copy. A second disk in the same box is not that copy. The whole `UPLOAD_LOCATION` should be backed up together, because that includes the DB dumps. Tool choice (restic, borg, rclone or another) is out of scope here.

## 5. Recommendation: keep mergerfs, with these changes (ranked)

1. **Back up the photos off-machine now.** This is the only change that protects against loss that cannot be undone. Back up `/srv/data/media/photos` in full (library, upload, profile and backups) to an off-site, versioned target, and add a local copy if possible. Test a restore.
2. **Install smartmontools and enable smartd with alerts.** Use `DEVICESCAN -a -o on -S on -s (S/../.././02|L/../../6/03) -m <you>`. Check the WD20EARS now, and plan to retire it.
3. **Fix the create policy before data1 drops below about 1.7T free.**
   - On 2.33.5 today: change `category.create=epmfs` to `category.create=pfrd` (the installed 2.33.5 man page documents `pfrd`) or `mfs`, and add `func.getattr=newest`. Keep `use_ino`, and do not add `cache.files=off`.
   - Better: install the upstream **2.42.0** `.deb` and use the quickstart set for kernel ≥ 6.6: `cache.files=off,category.create=pfrd,func.getattr=newest,dropcacheonclose=false,moveonenospc=true,minfreespace=50G,fsname=mergerfs`, plus the `x-systemd` lines. Drop `use_ino` (removed) and `allow_other` (automatic as root).
   - After the change, check that new imports are hardlinks: `stat -c %h` on an imported file should show 2 or more.
4. **Next disk purchase: a CMR disk of at least 8TB, used as SnapRAID parity.** Parity must be at least as large as the largest data disk. Exclude `torrents/incomplete`, which changes all the time; this needs checking in the SnapRAID manual's `exclude` section. Schedule `sync` and `scrub`, and keep content files on two or more disks. Every future disk after that, of any size, becomes a mergerfs branch and a SnapRAID data disk, with no skeleton needed under pfrd.
5. **Do not migrate to ZFS, btrfs, LVM or md.** Each one wastes mismatched capacity or makes a single disk failure (or one too many) lose the whole pool. ZFS on Ubuntu 24.04 also lacks RAIDZ expansion and is advised against for this SMR disk.

The concrete fstab change is for [storage.md](storage.md), the operational doc being written separately; this note does not edit it.

## Sources

- mergerfs: [quickstart](https://trapexit.github.io/mergerfs/latest/quickstart/), [policies](https://trapexit.github.io/mergerfs/latest/config/functions_categories_policies/), [options](https://trapexit.github.io/mergerfs/latest/config/options/), [inodecalc](https://trapexit.github.io/mergerfs/latest/config/inodecalc/), [link-exdev](https://trapexit.github.io/mergerfs/latest/config/link-exdev/), [deprecated options](https://trapexit.github.io/mergerfs/latest/config/deprecated_options/), [installation](https://trapexit.github.io/mergerfs/latest/setup/installation/), [known issues](https://trapexit.github.io/mergerfs/latest/known_issues_bugs/), [releases](https://github.com/trapexit/mergerfs/releases); installed 2.33.5 man page [local].
- SnapRAID: [manual](https://www.snapraid.it/manual), [FAQ](https://www.snapraid.it/faq), [compare](https://www.snapraid.it/compare).
- OpenZFS: [zfs-2.3.0 release](https://github.com/openzfs/zfs/releases/tag/zfs-2.3.0), [zpool-attach(8)](https://openzfs.github.io/openzfs-docs/man/master/8/zpool-attach.8.html), [zpoolconcepts(7)](https://openzfs.github.io/openzfs-docs/man/master/7/zpoolconcepts.7.html), [Hardware](https://openzfs.github.io/openzfs-docs/Performance%20and%20Tuning/Hardware.html).
- btrfs: [mkfs.btrfs](https://btrfs.readthedocs.io/en/latest/mkfs.btrfs.html), [Status](https://btrfs.readthedocs.io/en/latest/Status.html), [Volume management](https://btrfs.readthedocs.io/en/latest/Volume-management.html).
- TRaSH Guides: [Hardlinks and Instant Moves](https://trash-guides.info/File-and-Folder-Structure/Hardlinks-and-Instant-Moves/), [Unraid how-to](https://trash-guides.info/File-and-Folder-Structure/How-to-set-up/Unraid/).
- Unraid: [array overview](https://docs.unraid.net/unraid-os/using-unraid-to/manage-storage/array/overview/).
- Seagate: [CMR/SMR list](https://www.seagate.com/products/cmr-smr-list/).
- smartmontools: [smartd.conf(5)](https://manpages.ubuntu.com/manpages/noble/man5/smartd.conf.5.html) (smartmontools.org blocked the fetch).
- Immich: [backup and restore](https://docs.immich.app/administration/backup-and-restore).
- libtorrent: [upgrading to 2.0](https://www.libtorrent.org/upgrade_to_2.0-ref.html).

Not verified: LVM/mdadm and btrfs-single failure behaviour (reasoning only), a SnapRAID `exclude` example, the WD20EARS's actual SMART state (needs sudo), and Seagate's own datasheet text for ST8000DM004.
