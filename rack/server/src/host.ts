import { readFile, readdir, statfs, access } from 'node:fs/promises';
import { availableParallelism } from 'node:os';
import { join } from 'node:path';
import type { DiskConfig } from './config.ts';
import type { Disk, Host } from './types.ts';

interface CpuTimes {
  busy: number;
  total: number;
}

export function parseCpuLine(statText: string): CpuTimes | null {
  const line = statText.split('\n').find((l) => l.startsWith('cpu '));
  if (!line) return null;
  const fields = line.trim().split(/\s+/).slice(1).map(Number);
  if (fields.length < 4 || fields.some(Number.isNaN)) return null;
  const idle = (fields[3] ?? 0) + (fields[4] ?? 0); // idle + iowait
  const total = fields.slice(0, 8).reduce((a, b) => a + b, 0);
  return { busy: total - idle, total };
}

export function parseMeminfo(text: string): { usedBytes: number; totalBytes: number } | null {
  const kb = (key: string) => {
    const m = text.match(new RegExp(`^${key}:\\s+(\\d+)`, 'm'));
    return m ? Number(m[1]) * 1024 : null;
  };
  const total = kb('MemTotal');
  const available = kb('MemAvailable');
  if (total === null || available === null) return null;
  return { usedBytes: total - available, totalBytes: total };
}

const read = (path: string): Promise<string | null> => readFile(path, 'utf8').catch(() => null);

export class HostSampler {
  private previousCpu: CpuTimes | null = null;
  private latest: Host = { uptimeSeconds: null, cpu: null, memory: null, load: null, tempC: null, disks: [] };

  private readonly procDir: string;
  private readonly sysDir: string;
  private readonly diskConfig: () => DiskConfig[] | null;

  constructor(procDir: string, sysDir: string, diskConfig: () => DiskConfig[] | null) {
    this.procDir = procDir;
    this.sysDir = sysDir;
    this.diskConfig = diskConfig;
  }

  get current(): Host {
    return this.latest;
  }

  async sample(): Promise<void> {
    const [stat, meminfo, loadavg, uptime, tempC, disks] = await Promise.all([
      read(join(this.procDir, 'stat')),
      read(join(this.procDir, 'meminfo')),
      read(join(this.procDir, 'loadavg')),
      read(join(this.procDir, 'uptime')),
      this.readTemperature(),
      this.readDisks(),
    ]);

    let cpu: Host['cpu'] = null;
    const times = stat ? parseCpuLine(stat) : null;
    if (times && this.previousCpu && times.total > this.previousCpu.total) {
      const percent = ((times.busy - this.previousCpu.busy) / (times.total - this.previousCpu.total)) * 100;
      const cores = stat!.split('\n').filter((l) => /^cpu\d+ /.test(l)).length || availableParallelism();
      cpu = { percent: Math.round(Math.min(100, Math.max(0, percent)) * 10) / 10, cores };
    }
    if (times) this.previousCpu = times;

    const load = loadavg ? loadavg.trim().split(/\s+/).slice(0, 3).map(Number) : [];
    const up = uptime ? Number(uptime.trim().split(/\s+/)[0]) : NaN;

    this.latest = {
      uptimeSeconds: Number.isFinite(up) ? Math.floor(up) : null,
      cpu,
      memory: meminfo ? parseMeminfo(meminfo) : null,
      load: load.length === 3 && load.every(Number.isFinite) ? (load as [number, number, number]) : null,
      tempC,
      disks,
    };
  }

  /** Hottest thermal zone, best effort. */
  private async readTemperature(): Promise<number | null> {
    const root = join(this.sysDir, 'class', 'thermal');
    const zones = await readdir(root).catch(() => [] as string[]);
    const temps = await Promise.all(
      zones.filter((z) => z.startsWith('thermal_zone')).map(async (z) => Number(await read(join(root, z, 'temp')))),
    );
    const valid = temps.filter((t) => Number.isFinite(t) && t > 0 && t < 150_000);
    return valid.length ? Math.round(Math.max(...valid) / 100) / 10 : null;
  }

  private async readDisks(): Promise<Disk[]> {
    const configured = this.diskConfig();
    let wanted: DiskConfig[];
    if (configured) wanted = configured;
    else {
      const media = await access('/mnt/data').then(() => true, () => false);
      wanted = [{ path: '/', label: 'system' }, ...(media ? [{ path: '/mnt/data', label: 'media' }] : [])];
    }
    const disks = await Promise.all(
      wanted.map(async ({ path, label }): Promise<Disk | null> => {
        try {
          const fs = await statfs(path);
          const totalBytes = fs.blocks * fs.bsize;
          return { path, label, totalBytes, usedBytes: totalBytes - fs.bfree * fs.bsize };
        } catch {
          return null;
        }
      }),
    );
    return disks.filter((d): d is Disk => d !== null);
  }
}
