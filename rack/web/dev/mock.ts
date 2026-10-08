// Dev-only fixture server. Not part of the production bundle (see vite.config.ts).
// Scenario: ?scenario=<name> on the page URL (forwarded to the API) or RACK_SCENARIO env.
import type { Plugin } from 'vite';
import type { Service, State, Status, Widget } from '../src/types';

export const SCENARIOS = ['healthy', 'down', 'setup', 'empty', 'many', 'offline', 'drop', 'quiet'] as const;
type Scenario = (typeof SCENARIOS)[number];

const t0 = Date.now();
const GB = 1024 ** 3;

function wobble(seed: number, tick: number, amp: number) {
  return Math.sin(tick / 3 + seed) * amp;
}

function history(base: number, seed: number, tick: number, fail = false): (number | null)[] {
  return Array.from({ length: 40 }, (_, i) => {
    if (fail && i > 31) return null;
    const v = base + Math.sin((i + tick) / 2.3 + seed) * base * 0.35 + ((i * seed * 7) % 9);
    if (!fail && (i + seed) % 23 === 0 && seed % 3 === 0) return null;
    return Math.max(4, Math.round(v));
  });
}

interface Def {
  id: string;
  name: string;
  group: string;
  icon: string | null;
  port: number | null;
  path?: string;
  desc?: string;
  status?: Status;
  sinceMin?: number;
  latency?: number | null;
  widget?: ((tick: number) => Widget | null) | null;
}

const ok = (stats: Widget['stats'], meter: Widget['meter'] = null, type = 'x'): Widget => ({
  type,
  ok: true,
  error: null,
  stats,
  meter,
});
const missing = (type: string, what: string): Widget => ({
  type,
  ok: false,
  error: `Add ${what} to .env to see ${type} stats`,
  stats: [],
  meter: null,
});

function defs(scn: Scenario): Def[] {
  const setup = scn === 'setup';
  const down = scn === 'down';
  return [
    {
      id: 'plex', name: 'Plex', group: 'Media', icon: '/api/icon/plex', port: 32400, path: '/web', desc: 'Films and TV', latency: 38,
      widget: (t) => (setup ? missing('Plex', 'RACK_PLEX_TOKEN') : ok(
        [{ label: t % 8 < 6 ? 'streams' : 'stream', value: t % 8 < 6 ? '2' : '1', tone: 'normal' }, { label: 'transcoding', value: '1', tone: 'normal' }],
        { label: 'Bandwidth', value: 0.45 + wobble(1, t, 0.15) }, 'plex')),
    },
    {
      id: 'seerr', name: 'Seerr', group: 'Media', icon: '/api/icon/seerr', port: 5055, desc: 'Requests', latency: 52,
      widget: () => (setup ? missing('Seerr', 'RACK_SEERR_API_KEY') : ok([{ label: 'waiting for approval', value: '3', tone: 'warn' }], null, 'seerr')),
    },
    {
      id: 'sonarr', name: 'Sonarr', group: 'Downloads', icon: '/api/icon/sonarr', port: 8989, desc: 'TV shows', latency: 41,
      widget: () => (setup ? missing('Sonarr', 'RACK_SONARR_API_KEY') : ok([{ label: 'in queue', value: '4', tone: 'normal' }, { label: 'airing today', value: '2', tone: 'normal' }], null, 'sonarr')),
    },
    {
      id: 'radarr', name: 'Radarr', group: 'Downloads', icon: '/api/icon/radarr', port: 7878, desc: 'Films',
      status: down ? 'stopped' : 'up', sinceMin: 95, latency: 36,
      widget: () => (setup ? missing('Radarr', 'RACK_RADARR_API_KEY') : ok([{ label: 'in queue', value: '1', tone: 'normal' }, { label: 'missing', value: '12', tone: 'warn' }], null, 'radarr')),
    },
    {
      id: 'prowlarr', name: 'Prowlarr', group: 'Downloads', icon: '/api/icon/prowlarr', port: 9696, desc: 'Indexers', latency: 29,
      widget: () => (setup ? missing('Prowlarr', 'RACK_PROWLARR_API_KEY') : ok([{ label: 'indexers', value: '7', tone: 'normal' }, { label: 'failing', value: '1', tone: 'bad' }], null, 'prowlarr')),
    },
    {
      id: 'qbittorrent', name: 'qBittorrent', group: 'Downloads', icon: '/api/icon/qbittorrent', port: 8080, desc: 'Downloads', latency: 19,
      widget: (t) => (setup ? missing('qBittorrent', 'RACK_QBITTORRENT_PASSWORD') : ok(
        [{ label: 'down', value: `${(12.4 + wobble(2, t, 3)).toFixed(1)} MB/s`, tone: 'normal' }, { label: 'up', value: '1.1 MB/s', tone: 'normal' }],
        { label: 'Download speed', value: Math.min(1, Math.max(0.05, 0.6 + wobble(2, t, 0.3))) }, 'qbittorrent')),
    },
    {
      id: 'flaresolverr', name: 'FlareSolverr', group: 'Downloads', icon: '/api/icon/flaresolverr', port: 8191, desc: 'Cloudflare bypass for indexers',
      status: down ? 'down' : 'up', sinceMin: 17, latency: down ? null : 88, widget: () => null,
    },
    {
      id: 'immich', name: 'Immich', group: 'Photos', icon: '/api/icon/immich', port: 2283, desc: 'Photos', latency: 63,
      status: scn === 'many' ? 'slow' : 'up',
      widget: () => (setup ? missing('Immich', 'RACK_IMMICH_API_KEY') : ok([{ label: 'photos', value: '48,212', tone: 'normal' }, { label: 'videos', value: '1,904', tone: 'normal' }], null, 'immich')),
    },
    {
      id: 'netdata', name: 'Netdata', group: 'System', icon: '/api/icon/missing-icon', port: 19999, desc: 'Live graphs', latency: 22,
      widget: (t) => (setup ? missing('Netdata', 'nothing') : ok([{ label: 'alerts', value: '0', tone: 'good' }, { label: 'cpu', value: `${Math.round(31 + wobble(3, t, 8))}%`, tone: 'normal' }], null, 'netdata')),
    },
  ];
}

const extraNames = [
  'Grafana', 'Home Assistant', 'Paperless', 'Vaultwarden', 'Nextcloud', 'Gitea', 'Uptime Kuma', 'Pi-hole', 'Bazarr', 'Tautulli',
  'Lidarr', 'Readarr', 'Navidrome', 'Jellyfin', 'Portainer', 'Syncthing', 'Mealie', 'Miniflux', 'Calibre Web', 'Audiobookshelf',
];

function build(scn: Scenario, tick: number): State {
  const now = Date.now();
  let list = defs(scn);
  if (scn === 'quiet') {
    // Mirrors a calm real server: every count zero, two services without credentials, one Netdata warning.
    const zero = (type: string, labels: string[]): Widget => ok(labels.map((label) => ({ label, value: '0', tone: 'normal' as const })), null, type);
    const q: Record<string, Widget> = {
      plex: zero('plex', ['streams']),
      seerr: zero('seerr', ['waiting']),
      sonarr: zero('sonarr', ['in queue', 'airing today']),
      radarr: zero('radarr', ['in queue', 'missing']),
      prowlarr: ok([{ label: 'indexers', value: '7', tone: 'normal' }, { label: 'failing', value: '0', tone: 'normal' }], null, 'prowlarr'),
      qbittorrent: missing('qBittorrent', 'RACK_QBITTORRENT_USERNAME and RACK_QBITTORRENT_PASSWORD'),
      immich: missing('Immich', 'RACK_IMMICH_API_KEY'),
      netdata: ok([{ label: 'warning', value: '1', tone: 'warn' }], null, 'netdata'),
    };
    list = list.map((d) => ({ ...d, status: 'up' as Status, widget: q[d.id] ? () => q[d.id]! : null }));
  }
  if (scn === 'empty') list = [];
  if (scn === 'many') {
    const groups = ['Media', 'Downloads', 'Photos', 'System', 'Other'];
    extraNames.forEach((n, i) => {
      list.push({
        id: n.toLowerCase().replace(/\W+/g, '-'), name: n, group: groups[i % 5]!, icon: i % 4 === 0 ? null : `/api/icon/${n.toLowerCase().replace(/\W+/g, '-')}`,
        port: 3000 + i, desc: 'Another service', latency: 20 + i * 4, status: i === 7 ? 'down' : i === 11 ? 'stopped' : 'up', sinceMin: 40 + i,
        widget: i % 3 === 0 ? () => ok([{ label: 'items', value: String(100 + i * 13), tone: 'normal' }], null, 'x') : null,
      });
    });
  }
  const services: Service[] = list.map((d, i) => {
    const status: Status = d.status ?? 'up';
    const lat = status === 'down' || status === 'stopped' ? null : (d.latency ?? 30) + Math.round(wobble(i, tick, 5));
    const widget = status === 'stopped' || status === 'down' ? null : d.widget ? d.widget(tick) : null;
    return {
      id: d.id,
      name: d.name,
      description: d.desc ?? null,
      group: d.group,
      icon: d.icon,
      url: null,
      port: d.port,
      path: d.path ?? null,
      status,
      since: new Date(now - (d.sinceMin ?? 60 * 24 * 41) * 60_000).toISOString(),
      latencyMs: lat,
      history: history(d.latency ?? 30, i + 1, tick, status === 'down'),
      container: { name: d.id, image: `example/${d.id}:latest`, state: status === 'stopped' ? 'exited' : 'running', health: null, startedAt: null },
      widget,
    };
  });

  const order = ['Media', 'Downloads', 'Photos', 'System'];
  const names = [...new Set(services.map((s) => s.group))].sort((a, b) => {
    const ia = order.indexOf(a), ib = order.indexOf(b);
    return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
  });

  const display: string[] = [];
  for (const s of services) {
    if (s.status === 'down') display.push(`${s.name} is not responding`);
    if (s.status === 'stopped') display.push(`${s.name} is stopped`);
  }
  if (scn === 'quiet') {
    display.push('Netdata has 1 warning', `All ${services.length} services are up`);
  } else if (scn !== 'empty') {
    display.push('Plex is playing to 2 screens');
    display.push(`qBittorrent is pulling ${(12.4 + wobble(2, tick, 3)).toFixed(1)} MB/s`);
    if (!display.some((x) => x.includes('not responding') || x.includes('stopped'))) display.push(`All ${services.length} services are up`);
  } else display.push('Nothing in the rack yet');

  return {
    title: 'Homelab',
    generatedAt: new Date(now).toISOString(),
    display: display.slice(0, 5),
    groups: names.map((name) => ({ name, services: services.filter((s) => s.group === name) })),
    bookmarks: scn === 'empty' ? [] : [
      { name: 'Router', url: 'http://10.0.0.1', group: 'Network' },
      { name: 'Access point', url: 'http://10.0.0.2', group: 'Network' },
      { name: 'Pi-hole', url: 'http://10.0.0.3/admin', group: 'Network' },
      { name: 'Backblaze', url: 'https://secure.backblaze.com', group: 'Cloud' },
      { name: 'Tailscale', url: 'https://login.tailscale.com', group: 'Cloud' },
    ],
    host: {
      uptimeSeconds: 41 * 86400 + 5 * 3600 + Math.floor((now - t0) / 1000),
      cpu: { percent: Math.round(34 + wobble(5, tick, 12)), cores: 8 },
      memory: { usedBytes: Math.round((11.2 + wobble(6, tick, 0.4)) * GB), totalBytes: 16 * GB },
      load: [1.42, 1.1, 0.87],
      tempC: Math.round(52 + wobble(7, tick, 4)),
      disks: [
        { path: '/mnt/data', label: 'media', usedBytes: Math.round(5.6 * 1024 * GB), totalBytes: 8 * 1024 * GB },
        { path: '/', label: 'system', usedBytes: Math.round(0.93 * 238 * GB), totalBytes: 238 * GB },
      ],
    },
    warnings: scn === 'setup' ? ['rack.yml line 14 could not be read, so the last good config is still in use'] : [],
  };
}

function iconSvg(slug: string) {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) % 360;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" rx="10" fill="hsl(${h} 55% 45%)"/><circle cx="24" cy="24" r="10" fill="none" stroke="#fff" stroke-width="4"/></svg>`;
}

export function rackMock(envScenario?: string): Plugin {
  let tick = 0;
  let droppedAt = 0;
  return {
    name: 'rack-mock-api',
    apply: 'serve',
    configureServer(server) {
      setInterval(() => tick++, 2000).unref();
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) return next();
        const url = new URL(req.url, 'http://x');
        const q = url.searchParams.get('scenario') ?? envScenario ?? 'healthy';
        const scn = (SCENARIOS as readonly string[]).includes(q) ? (q as Scenario) : 'healthy';

        if (url.pathname.startsWith('/api/icon/')) {
          const slug = url.pathname.slice('/api/icon/'.length);
          if (!/^[a-z0-9-]+$/.test(slug) || slug.startsWith('missing')) { res.statusCode = 404; return res.end(); }
          res.setHeader('content-type', 'image/svg+xml');
          return res.end(iconSvg(slug));
        }
        if (scn === 'offline' || (scn === 'drop' && droppedAt && Date.now() - droppedAt < 25_000)) {
          res.statusCode = 503;
          return res.end('unavailable');
        }
        if (url.pathname === '/api/state') {
          res.setHeader('content-type', 'application/json');
          return res.end(JSON.stringify(build(scn, tick)));
        }
        if (url.pathname === '/api/events') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
          const send = () => res.write(`event: state\ndata: ${JSON.stringify(build(scn, tick))}\n\n`);
          send();
          const iv = setInterval(send, 2000);
          const drop = scn === 'drop' ? setTimeout(() => { droppedAt = Date.now(); res.end(); }, 8000) : null;
          req.on('close', () => { clearInterval(iv); if (drop) clearTimeout(drop); });
          return;
        }
        res.statusCode = 404;
        res.end();
      });
    },
  };
}
