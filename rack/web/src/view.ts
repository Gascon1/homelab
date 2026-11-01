import type { Host, Service } from '../../shared/state.ts';
import { bytes, uptime } from './format.ts';

/* What the contract says about a service, in the shape the tiles want. The server decides what is
   busy or worth a look (Widget.busy, Widget.attention) and which apps are featured; this file only
   combines that with the health status. */

export function describe(s: Service) {
  const w = s.widget;
  const down = s.status === 'down' || s.status === 'stopped';
  const stats = w?.ok ? w.stats : [];
  const busy = !down && !!w?.ok && w.busy;
  const attention = !down && (s.status === 'slow' || (!!w?.ok && w.attention));
  const needsSetup = !down && !!w && !w.ok;
  return { down, stats, busy, attention, needsSetup, featured: s.featured };
}

export function summarise(svcs: Service[]): { text: string; tone: string } {
  const bad = svcs.filter((s) => s.status === 'down' || s.status === 'stopped');
  if (bad.length) return { text: `${bad.length} ${bad.length === 1 ? 'needs' : 'need'} attention`, tone: 'is-bad' };
  const busy = svcs.filter((s) => describe(s).busy).length;
  const attn = svcs.filter((s) => describe(s).attention).length;
  if (attn) return { text: `${attn} to look at`, tone: 'is-warn' };
  return busy ? { text: `${busy} busy`, tone: 'is-busy' } : { text: 'All quiet', tone: '' };
}

export type HostTone = 'ok' | 'warn' | 'crit';

export interface HostTileData { key: string; kind: 'gauge' | 'fact'; label: string; big: string; unit?: string; v?: number; tone: HostTone; detail: string }

const toneOf = (p: number, warn: number, crit: number): HostTone => (p >= crit ? 'crit' : p >= warn ? 'warn' : 'ok');
const toneNote: Record<HostTone, string> = { ok: '', warn: 'Getting full. ', crit: 'Nearly full. ' };
/** "5.6 of 8.0 TB" when both sides share a unit. */
function pair(used: number, total: number): string {
  const a = bytes(used), b = bytes(total);
  const [an, au] = a.split(' '), [, bu] = b.split(' ');
  return au === bu ? `${an} of ${b}` : `${a} of ${b}`;
}

export function hostTiles(host: Host): HostTileData[] {
  const out: HostTileData[] = [];
  if (host.cpu) {
    const p = host.cpu.percent;
    out.push({ key: 'cpu', kind: 'gauge', label: 'Processor', big: String(Math.round(p)), unit: '%', v: p / 100, tone: toneOf(p, 70, 90), detail: `${host.cpu.cores} cores` });
  }
  if (host.memory) {
    const p = (host.memory.usedBytes / host.memory.totalBytes) * 100;
    const tone = toneOf(p, 80, 92);
    out.push({ key: 'mem', kind: 'gauge', label: 'Memory', big: String(Math.round(p)), unit: '%', v: p / 100, tone, detail: `${toneNote[tone]}${pair(host.memory.usedBytes, host.memory.totalBytes)}` });
  }
  for (const dk of host.disks) {
    const p = (dk.usedBytes / dk.totalBytes) * 100;
    const tone = toneOf(p, 80, 92);
    out.push({ key: `disk:${dk.path}`, kind: 'gauge', label: `Disk, ${dk.label}`, big: String(Math.round(p)), unit: '%', v: p / 100, tone, detail: `${toneNote[tone]}${pair(dk.usedBytes, dk.totalBytes)}` });
  }
  if (host.uptimeSeconds != null) {
    const u = uptime(host.uptimeSeconds);
    const [n, ...rest] = u.split(' ');
    out.push({ key: 'up', kind: 'fact', label: 'Uptime', big: n!, unit: rest.join(' '), tone: 'ok', detail: 'Since last restart' });
  }
  if (host.load) out.push({ key: 'load', kind: 'fact', label: 'Load', big: host.load[0].toFixed(2), tone: 'ok', detail: `${host.load[1].toFixed(2)} 5 min, ${host.load[2].toFixed(2)} 15 min` });
  if (host.tempC != null) {
    const t = host.tempC;
    out.push({ key: 'temp', kind: 'fact', label: 'Temperature', big: String(Math.round(t)), unit: '°C', tone: t >= 85 ? 'crit' : t >= 70 ? 'warn' : 'ok', detail: t >= 85 ? 'Running hot' : t >= 70 ? 'Warm' : 'Normal' });
  }
  return out;
}

