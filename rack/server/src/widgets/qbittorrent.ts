import { formatCount, formatRate } from '../format.ts';
import { HttpError, request, type RawResponse } from './http.ts';
import { MissingCredential, type WidgetContext, type WidgetData, type WidgetModule } from './types.ts';

const PEAK_WINDOW = 200;
const PEAK_FLOOR = 1024 * 1024;

interface Session {
  cookie: string | null;
  speeds: number[];
}

interface TransferInfo {
  dl_info_speed?: number;
  up_info_speed?: number;
}

export function createQbittorrent(): WidgetModule {
  const sessions = new Map<string, Session>();

  const sessionFor = (id: string): Session => {
    let session = sessions.get(id);
    if (!session) sessions.set(id, (session = { cookie: null, speeds: [] }));
    return session;
  };

  async function login(ctx: WidgetContext, session: Session): Promise<void> {
    const creds = ctx.secrets.qbittorrentLogin();
    if (!creds) throw new MissingCredential('RACK_QBITTORRENT_USERNAME and RACK_QBITTORRENT_PASSWORD', 'download stats');
    const res = await request(`${ctx.baseUrl}/api/v2/auth/login`, {
      method: 'POST',
      headers: { ...originHeaders(ctx.baseUrl), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(creds).toString(),
    });
    const sid = res.headers.getSetCookie().find((c) => c.startsWith('SID='));
    if (res.status !== 200 || res.body.trim() !== 'Ok.' || !sid) throw new HttpError(403);
    session.cookie = sid.split(';')[0]!;
  }

  /** Tries the current session (or none, when auth is bypassed) and logs in once on 401/403. */
  async function api(ctx: WidgetContext, session: Session, path: string): Promise<unknown> {
    const send = (): Promise<RawResponse> =>
      request(`${ctx.baseUrl}${path}`, {
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

  return {
    type: 'qbittorrent',
    intervalMs: 3000,
    credentialHint: 'RACK_QBITTORRENT_USERNAME and RACK_QBITTORRENT_PASSWORD',
    async fetch(ctx): Promise<WidgetData> {
      const session = sessionFor(ctx.serviceId);
      const transfer = (await api(ctx, session, '/api/v2/transfer/info')) as TransferInfo;
      const active = (await api(ctx, session, '/api/v2/torrents/info?filter=downloading')) as unknown[];

      const down = transfer.dl_info_speed ?? 0;
      session.speeds.push(down);
      session.speeds.splice(0, Math.max(0, session.speeds.length - PEAK_WINDOW));
      const peak = Math.max(PEAK_FLOOR, ...session.speeds);
      const pulling = down > 0 && active.length > 0;

      return {
        stats: [
          { label: 'down', value: formatRate(down), tone: pulling ? 'good' : 'normal' },
          { label: 'up', value: formatRate(transfer.up_info_speed ?? 0), tone: 'normal' },
          { label: 'active', value: formatCount(active.length), tone: 'normal' },
        ],
        meter: { label: 'download speed', value: Math.min(1, down / peak) },
        lines: pulling ? [{ text: `qBittorrent is pulling ${formatRate(down)}`, kind: 'activity' }] : [],
      };
    },
  };
}

/** qBittorrent rejects API calls whose Referer or Origin does not match its own address. */
function originHeaders(baseUrl: string): Record<string, string> {
  const origin = new URL(baseUrl).origin;
  return { Referer: `${origin}/`, Origin: origin };
}
