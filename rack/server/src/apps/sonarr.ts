import { formatCount } from '../format.ts';
import { arrCredential, count, type Paged } from './arr.ts';
import { getJson } from './http.ts';
import { defineWidget, type App } from './types.ts';

function localDay(offsetDays: number): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + offsetDays).toISOString();
}

const wave = (seconds: number, period: number): number => Math.sin((seconds / period) * 2 * Math.PI);

export const sonarr: App = {
  id: 'sonarr',
  match: ['sonarr'],
  name: 'Sonarr',
  group: 'Downloads',
  icon: 'sonarr',
  port: 8989,
  widget: defineWidget<string>({
    intervalMs: 10_000,
    credential: arrCredential('sonarr', 'RACK_SONARR_API_KEY'),
    async fetch({ baseUrl, credential, http }) {
      const headers = { 'X-Api-Key': credential };
      const api = `${baseUrl}/api/v3`;
      const calendar = `start=${encodeURIComponent(localDay(0))}&end=${encodeURIComponent(localDay(1))}`;
      const [queue, today, missing] = await Promise.all([
        getJson<Paged>(http, `${api}/queue?pageSize=1`, headers),
        getJson<unknown[]>(http, `${api}/calendar?${calendar}`, headers),
        getJson<Paged>(http, `${api}/wanted/missing?pageSize=1`, headers),
      ]);
      return {
        stats: [
          { label: 'in queue', value: count(queue.totalRecords), tone: 'normal' },
          { label: 'airing today', value: formatCount(today.length), tone: 'normal' },
          { label: 'missing', value: count(missing.totalRecords), tone: 'normal' },
        ],
      };
    },
  }),
  demo: {
    image: 'lscr.io/linuxserver/sonarr:latest',
    baseLatencyMs: 42,
    credential: 'demo',
    /** Sonarr is slow for twenty seconds in every hundred. */
    outage: (seconds) => (seconds % 100 >= 30 && seconds % 100 < 50 ? 'slow' : null),
    serve({ path, seconds }) {
      if (path.startsWith('/api/v3/queue')) return { totalRecords: 3 + Math.round(1.5 * wave(seconds, 60)) };
      if (path.startsWith('/api/v3/calendar')) return [{}, {}, {}, {}];
      if (path.startsWith('/api/v3/wanted/missing')) return { totalRecords: 12 };
      return null;
    },
  },
};
