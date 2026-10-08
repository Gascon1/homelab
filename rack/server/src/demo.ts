import { findCatalogEntry } from './catalog.ts';
import { buildDisplay } from './display.ts';
import { formatBytes, formatCount, formatRate, plural } from './format.ts';
import { HISTORY_LENGTH, SLOW_MS } from './health.ts';
import { compareGroups } from './resolve.ts';
import type { Host, Service, State, StateSource, Stat, Status, Widget } from './types.ts';
import type { DisplayLine } from './widgets/types.ts';

const CHECK_SPACING_MS = 20_000;
const DAY_MS = 86_400_000;
const GB = 1024 ** 3;

interface DemoApp {
  id: string;
  image: string;
  port: number;
  baseLatency: number;
}

const APPS: DemoApp[] = [
  { id: 'plex', image: 'lscr.io/linuxserver/plex:latest', port: 32400, baseLatency: 38 },
  { id: 'seerr', image: 'ghcr.io/seerr-team/seerr:latest', port: 5055, baseLatency: 64 },
  { id: 'sonarr', image: 'lscr.io/linuxserver/sonarr:latest', port: 8989, baseLatency: 42 },
  { id: 'radarr', image: 'lscr.io/linuxserver/radarr:latest', port: 7878, baseLatency: 36 },
  { id: 'prowlarr', image: 'lscr.io/linuxserver/prowlarr:latest', port: 9696, baseLatency: 29 },
  { id: 'qbittorrent', image: 'lscr.io/linuxserver/qbittorrent:latest', port: 8080, baseLatency: 21 },
  { id: 'flaresolverr', image: 'ghcr.io/flaresolverr/flaresolverr:latest', port: 8191, baseLatency: 17 },
  { id: 'immich-server', image: 'ghcr.io/immich-app/immich-server:release', port: 2283, baseLatency: 55 },
  { id: 'filebrowser', image: 'filebrowser/filebrowser:latest', port: 8181, baseLatency: 12 },
  { id: 'netdata', image: 'netdata/netdata:stable', port: 19999, baseLatency: 48 },
];

const wave = (seconds: number, period: number, phase = 0): number => Math.sin((seconds / period) * 2 * Math.PI + phase);

/** Health of one app at one moment: Sonarr is sometimes slow, FlareSolverr is down for a stretch. */
function health(app: DemoApp, atMs: number): { status: Status; latency: number | null } {
  const seconds = atMs / 1000;
  if (app.id === 'flaresolverr' && seconds % 300 >= 120 && seconds % 300 < 200) return { status: 'down', latency: null };
  const jitter = Math.round(app.baseLatency + 0.25 * app.baseLatency * wave(seconds, 37, app.port));
  if (app.id === 'sonarr' && seconds % 100 >= 30 && seconds % 100 < 50) return { status: 'slow', latency: SLOW_MS + 400 + jitter };
  return { status: 'up', latency: jitter };
}

function stats(...items: [string, string, Stat['tone']?][]): Stat[] {
  return items.map(([label, value, tone]) => ({ label, value, tone: tone ?? 'normal' }));
}

function widgetFor(app: DemoApp, atMs: number, down: boolean): { widget: Widget; lines: DisplayLine[] } | null {
  const seconds = atMs / 1000;
  const entry = findCatalogEntry(app.id, app.image);
  const type = entry?.widget;
  if (!type) return null;
  const ok = (s: Stat[], lines: DisplayLine[] = [], meter: Widget['meter'] = null) => ({
    widget: { type, ok: true, error: null, stats: s, meter },
    lines,
  });
  if (down) {
    const name = entry!.name;
    return { widget: { type, ok: false, error: `Could not read details from ${name}`, stats: [], meter: null }, lines: [] };
  }

  switch (type) {
    case 'plex': {
      const streams = [0, 0, 1, 2, 2, 1, 0, 0][Math.floor((seconds % 240) / 30)]!;
      return ok(
        stats([streams === 1 ? 'stream' : 'streams', String(streams), streams ? 'good' : 'normal'], [streams === 2 ? 'transcode' : 'transcodes', streams === 2 ? '1' : '0']),
        streams ? [{ text: `Plex is playing to ${plural(streams, 'screen')}`, kind: 'activity' }] : [],
      );
    }
    case 'qbittorrent': {
      const idle = seconds % 300 >= 240;
      const down = idle ? 0 : Math.max(0.4e6, 9e6 + 6e6 * wave(seconds, 23) + 3e6 * wave(seconds, 7));
      const up = 0.6e6 + 0.4e6 * wave(seconds, 31);
      return ok(
        stats(['down', formatRate(down), down ? 'good' : 'normal'], ['up', formatRate(up)], ['active', idle ? '0' : '3']),
        down ? [{ text: `qBittorrent is pulling ${formatRate(down)}`, kind: 'activity' }] : [],
        { label: 'download speed', value: Math.min(1, down / 20e6) },
      );
    }
    case 'sonarr':
      return ok(stats(['in queue', String(3 + Math.round(1.5 * wave(seconds, 60)))], ['airing today', '4'], ['missing', '12']));
    case 'radarr':
      return ok(stats(['in queue', '1'], ['missing', '7']));
    case 'prowlarr':
      return ok(stats(['indexers', '14'], ['failing', '0', 'good']));
    case 'seerr': {
      const pending = Math.floor((seconds % 360) / 120) + 1;
      return ok(
        stats(['waiting', String(pending), 'warn'], ['processing', '1'], ['available', '128', 'good']),
        [{ text: `${pending} ${pending === 1 ? 'request is' : 'requests are'} waiting in Seerr`, kind: 'activity' }],
      );
    }
    case 'immich':
      return ok(stats(['photos', formatCount(18_204)], ['videos', formatCount(1_320)], ['stored', formatBytes(412.6 * GB)]));
    case 'netdata': {
      const warning = seconds % 400 >= 250 && seconds % 400 < 290 ? 1 : 0;
      return ok(
        stats(['critical', '0', 'good'], ['warnings', String(warning), warning ? 'warn' : 'good']),
        warning ? [{ text: 'Netdata has 1 warning', kind: 'problem' }] : [],
      );
    }
    case 'flaresolverr':
      return ok(stats(['ready', 'v3.3.21', 'good']));
    default:
      return null;
  }
}

function hostAt(atMs: number, startMs: number): Host {
  const s = atMs / 1000;
  return {
    uptimeSeconds: 19 * 86_400 + Math.floor((atMs - startMs) / 1000),
    cpu: { percent: Math.round((16 + 11 * wave(s, 40) + 5 * wave(s, 9)) * 10) / 10, cores: 8 },
    memory: { usedBytes: Math.round((9.4 + 0.8 * wave(s, 180)) * GB), totalBytes: Math.round(31.2 * GB) },
    load: [1.1 + 0.5 * wave(s, 40), 0.9 + 0.2 * wave(s, 120), 0.8].map((n) => Math.round(n * 100) / 100) as [number, number, number],
    tempC: Math.round((47 + 4 * wave(s, 90)) * 10) / 10,
    disks: [
      { path: '/', label: 'system', usedBytes: Math.round(118.4 * GB), totalBytes: Math.round(476 * GB) },
      { path: '/mnt/data', label: 'media', usedBytes: Math.round(7210 * GB), totalBytes: Math.round(14_900 * GB) },
    ],
  };
}

export function demoState(atMs: number, startMs: number): State {
  const anchor = startMs - 2 * DAY_MS;
  const services: Service[] = [];
  const lines = new Map<string, DisplayLine[]>();

  for (const app of APPS) {
    const entry = findCatalogEntry(app.id, app.image)!;
    const samples = Array.from({ length: HISTORY_LENGTH }, (_, k) => {
      const at = atMs - (HISTORY_LENGTH - 1 - k) * CHECK_SPACING_MS;
      return { at, ...health(app, at) };
    });
    const now = samples[samples.length - 1]!;
    let streakStart = samples.length - 1;
    while (streakStart > 0 && samples[streakStart - 1]!.status === now.status) streakStart--;
    const widget = widgetFor(app, atMs, now.status === 'down');
    lines.set(app.id, widget?.lines ?? []);

    services.push({
      id: app.id,
      name: entry.name,
      description: null,
      group: entry.group,
      icon: `/api/icon/${entry.icon}`,
      url: null,
      port: app.port,
      path: entry.path ?? null,
      status: now.status,
      since: new Date(streakStart === 0 ? anchor : samples[streakStart]!.at).toISOString(),
      latencyMs: now.latency,
      history: samples.map((s) => s.latency),
      container: {
        name: app.id.replace('-', '_'),
        image: app.image,
        state: 'running',
        health: app.id === 'seerr' ? 'healthy' : null,
        startedAt: new Date(anchor).toISOString(),
      },
      widget: widget?.widget ?? null,
    });
  }

  const byGroup = new Map<string, Service[]>();
  for (const service of services) byGroup.set(service.group, [...(byGroup.get(service.group) ?? []), service]);
  const groups = [...byGroup.keys()].sort(compareGroups([])).map((name) => ({ name, services: byGroup.get(name)! }));

  return {
    title: 'Homelab',
    generatedAt: new Date(atMs).toISOString(),
    display: buildDisplay(
      groups.flatMap((g) => g.services).map((s) => ({ name: s.name, status: s.status, lines: lines.get(s.id) ?? [] })),
    ),
    groups,
    bookmarks: [
      { name: 'Router', url: 'http://10.0.0.1', group: 'Network' },
      { name: 'Pi-hole', url: 'http://10.0.0.2/admin', group: 'Network' },
    ],
    host: hostAt(atMs, startMs),
    warnings: [],
  };
}

export class DemoSource implements StateSource {
  private readonly startedAt = Date.now();

  start(): Promise<void> {
    return Promise.resolve();
  }

  stop(): void {}

  snapshot(): State {
    return demoState(Date.now(), this.startedAt);
  }
}
