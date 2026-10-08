import { SECRET_ENV, type SecretKey } from '../credentials.ts';
import { formatCount } from '../format.ts';
import type { Stat } from '../types.ts';
import { getJson } from './http.ts';
import { MissingCredential, type WidgetContext, type WidgetModule } from './types.ts';

interface Paged {
  totalRecords?: number;
}

function keyFor(ctx: WidgetContext, key: SecretKey): string {
  const value = ctx.secrets.get(key);
  if (!value) throw new MissingCredential(SECRET_ENV[key], 'queue and library stats');
  return value;
}

const count = (n: number | undefined) => formatCount(n ?? 0);

function localDay(offsetDays: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays).toISOString();
}

export const sonarr: WidgetModule = {
  type: 'sonarr',
  intervalMs: 10_000,
  credentialHint: SECRET_ENV.sonarr,
  async fetch(ctx) {
    const headers = { 'X-Api-Key': keyFor(ctx, 'sonarr') };
    const api = `${ctx.baseUrl}/api/v3`;
    const calendar = `start=${encodeURIComponent(localDay(0))}&end=${encodeURIComponent(localDay(1))}`;
    const [queue, today, missing] = await Promise.all([
      getJson<Paged>(`${api}/queue?pageSize=1`, headers),
      getJson<unknown[]>(`${api}/calendar?${calendar}`, headers),
      getJson<Paged>(`${api}/wanted/missing?pageSize=1`, headers),
    ]);
    const stats: Stat[] = [
      { label: 'in queue', value: count(queue.totalRecords), tone: 'normal' },
      { label: 'airing today', value: formatCount(today.length), tone: 'normal' },
      { label: 'missing', value: count(missing.totalRecords), tone: 'normal' },
    ];
    return { stats };
  },
};

export const radarr: WidgetModule = {
  type: 'radarr',
  intervalMs: 10_000,
  credentialHint: SECRET_ENV.radarr,
  async fetch(ctx) {
    const headers = { 'X-Api-Key': keyFor(ctx, 'radarr') };
    const api = `${ctx.baseUrl}/api/v3`;
    const [queue, missing] = await Promise.all([
      getJson<Paged>(`${api}/queue?pageSize=1`, headers),
      getJson<Paged>(`${api}/wanted/missing?pageSize=1`, headers),
    ]);
    return {
      stats: [
        { label: 'in queue', value: count(queue.totalRecords), tone: 'normal' },
        { label: 'missing', value: count(missing.totalRecords), tone: 'normal' },
      ],
    };
  },
};

export const prowlarr: WidgetModule = {
  type: 'prowlarr',
  intervalMs: 10_000,
  credentialHint: SECRET_ENV.prowlarr,
  async fetch(ctx) {
    const headers = { 'X-Api-Key': keyFor(ctx, 'prowlarr') };
    const api = `${ctx.baseUrl}/api/v1`;
    const [indexers, status] = await Promise.all([
      getJson<unknown[]>(`${api}/indexer`, headers),
      getJson<unknown[]>(`${api}/indexerstatus`, headers),
    ]);
    const failing = status.length;
    return {
      stats: [
        { label: 'indexers', value: formatCount(indexers.length), tone: 'normal' },
        { label: 'failing', value: formatCount(failing), tone: failing > 0 ? 'warn' : 'good' },
      ],
      lines:
        failing > 0
          ? [{ text: `Prowlarr has ${failing} failing ${failing === 1 ? 'indexer' : 'indexers'}`, kind: 'problem' }]
          : [],
    };
  },
};
