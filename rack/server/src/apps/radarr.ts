import { arrCredential, count, type Paged } from './arr.ts';
import { getJson } from './http.ts';
import { defineWidget, type App } from './types.ts';

export const radarr: App = {
  id: 'radarr',
  match: ['radarr'],
  name: 'Radarr',
  group: 'Downloads',
  icon: 'radarr',
  port: 7878,
  widget: defineWidget<string>({
    intervalMs: 10_000,
    credential: arrCredential('radarr', 'RACK_RADARR_API_KEY'),
    async fetch({ baseUrl, credential, http }) {
      const headers = { 'X-Api-Key': credential };
      const api = `${baseUrl}/api/v3`;
      const [queue, missing] = await Promise.all([
        getJson<Paged>(http, `${api}/queue?pageSize=1`, headers),
        getJson<Paged>(http, `${api}/wanted/missing?pageSize=1`, headers),
      ]);
      return {
        busy: (queue.totalRecords ?? 0) > 0,
        attention: false,
        stats: [
          { label: 'in queue', value: count(queue.totalRecords), tone: 'normal' },
          { label: 'missing', value: count(missing.totalRecords), tone: 'normal' },
        ],
      };
    },
  }),
  demo: {
    image: 'lscr.io/linuxserver/radarr:latest',
    baseLatencyMs: 36,
    credential: 'demo',
    serve({ path }) {
      if (path.startsWith('/api/v3/queue')) return { totalRecords: 1 };
      if (path.startsWith('/api/v3/wanted/missing')) return { totalRecords: 7 };
      return null;
    },
  },
};
