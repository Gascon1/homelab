import { formatCount, formatRate } from '../format.ts';
import { HttpError } from './http.ts';
import { MissingCredential, defineWidget, type App, type RawResponse, type WidgetContext, type WidgetData } from './types.ts';

const PEAK_WINDOW = 200;
const PEAK_FLOOR = 1024 * 1024;

interface Login {
  username: string;
  password: string;
}

interface Session {
  cookie: string | null;
  speeds: number[];
}

interface TransferInfo {
  dl_info_speed?: number;
  up_info_speed?: number;
}

type Ctx = WidgetContext<Login | null>;

const wave = (seconds: number, period: number): number => Math.sin((seconds / period) * 2 * Math.PI);

const sessionOf = (ctx: Ctx): Session => (ctx.memory.session ??= { cookie: null, speeds: [] }) as Session;

/** qBittorrent rejects API calls whose Referer or Origin does not match its own address. */
function originHeaders(baseUrl: string): Record<string, string> {
  const origin = new URL(baseUrl).origin;
  return { Referer: `${origin}/`, Origin: origin };
}

async function login(ctx: Ctx, session: Session): Promise<void> {
  if (!ctx.credential) throw new MissingCredential();
  const res = await ctx.http(`${ctx.baseUrl}/api/v2/auth/login`, {
    method: 'POST',
    headers: { ...originHeaders(ctx.baseUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...ctx.credential }).toString(),
  });
  // Before 5.2: 200 "Ok." with an SID cookie. From 5.2: 204 with a QBT_SID_<port> cookie.
  const sid = res.headers.getSetCookie().find((c) => /^(SID|QBT_SID_\d+)=/.test(c));
  const accepted = res.status === 204 || (res.status === 200 && res.body.trim() === 'Ok.');
  if (!accepted || !sid) throw new HttpError(403);
  session.cookie = sid.split(';')[0]!;
}

/** Tries the current session (or none, when auth is bypassed) and logs in once on 401/403. */
async function api(ctx: Ctx, session: Session, path: string): Promise<unknown> {
  const send = (): Promise<RawResponse> =>
    ctx.http(`${ctx.baseUrl}${path}`, {
      headers: { ...originHeaders(ctx.baseUrl), ...(session.cookie ? { Cookie: session.cookie } : {}) },
    });
  let res = await send();
  if (res.status === 401 || res.status === 403) {
    await login(ctx, session);
    res = await send();
  }
  if (res.status !== 200) throw new HttpError(res.status);
  return JSON.parse(res.body);
}

export const qbittorrent: App = {
  id: 'qbittorrent',
  match: ['qbittorrent'],
  name: 'qBittorrent',
  group: 'Downloads',
  icon: 'qbittorrent',
  featured: true,
  port: 8080,
  widget: defineWidget<Login | null>({
    intervalMs: 3000,
    credential: {
      hint: 'RACK_QBITTORRENT_USERNAME and RACK_QBITTORRENT_PASSWORD',
      purpose: 'download stats',
      // Many installs bypass auth on the local network, so the login is only needed once qBittorrent asks for it.
      optional: true,
      find: ({ vars }) => {
        const username = vars.RACK_QBITTORRENT_USERNAME;
        const password = vars.RACK_QBITTORRENT_PASSWORD;
        return username && password ? { username, password } : null;
      },
    },
    async fetch(ctx): Promise<WidgetData> {
      const session = sessionOf(ctx);
      const transfer = (await api(ctx, session, '/api/v2/transfer/info')) as TransferInfo;
      const active = (await api(ctx, session, '/api/v2/torrents/info?filter=downloading')) as unknown[];

      const down = transfer.dl_info_speed ?? 0;
      session.speeds.push(down);
      session.speeds.splice(0, Math.max(0, session.speeds.length - PEAK_WINDOW));
      const peak = Math.max(PEAK_FLOOR, ...session.speeds);
      const pulling = down > 0 && active.length > 0;

      const level = Math.min(1, down / peak);

      return {
        busy: active.length > 0 || level > 0.04,
        attention: false,
        stats: [
          { label: 'down', value: formatRate(down), tone: pulling ? 'good' : 'normal' },
          { label: 'up', value: formatRate(transfer.up_info_speed ?? 0), tone: 'normal' },
          { label: 'active', value: formatCount(active.length), tone: 'normal' },
        ],
        meter: { label: 'download speed', value: level },
        lines: pulling ? [{ text: `qBittorrent is pulling ${formatRate(down)}`, kind: 'activity' }] : [],
      };
    },
  }),
  demo: {
    image: 'lscr.io/linuxserver/qbittorrent:latest',
    baseLatencyMs: 21,
    /** Idle for the last minute of every five. */
    serve({ path, seconds }) {
      const idle = seconds % 300 >= 240;
      if (path === '/api/v2/transfer/info') {
        const down = idle ? 0 : Math.max(0.4e6, 9e6 + 6e6 * wave(seconds, 23) + 3e6 * wave(seconds, 7));
        return { dl_info_speed: down, up_info_speed: 0.6e6 + 0.4e6 * wave(seconds, 31) };
      }
      if (path.startsWith('/api/v2/torrents/info')) return idle ? [] : [{}, {}, {}];
      return null;
    },
  },
};
