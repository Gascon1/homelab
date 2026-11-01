import { formatCount } from '../format.ts';
import { arrCredential } from './arr.ts';
import { getJson } from './http.ts';
import { defineWidget, type App } from './types.ts';

export const prowlarr: App = {
  id: 'prowlarr',
  match: ['prowlarr'],
  name: 'Prowlarr',
  group: 'Downloads',
  icon: 'prowlarr',
  port: 9696,
  widget: defineWidget<string>({
    intervalMs: 10_000,
    credential: arrCredential('prowlarr', 'RACK_PROWLARR_API_KEY'),
    async fetch({ baseUrl, credential, http }) {
      const headers = { 'X-Api-Key': credential };
      const api = `${baseUrl}/api/v1`;
      const [indexers, status] = await Promise.all([
        getJson<unknown[]>(http, `${api}/indexer`, headers),
        getJson<unknown[]>(http, `${api}/indexerstatus`, headers),
      ]);
      const failing = status.length;
      return {
        busy: false,
        attention: failing > 0,
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
  }),
  demo: {
    image: 'lscr.io/linuxserver/prowlarr:latest',
    baseLatencyMs: 29,
    credential: 'demo',
    serve({ path }) {
      if (path === '/api/v1/indexer') return Array.from({ length: 14 }, () => ({}));
      if (path === '/api/v1/indexerstatus') return [];
      return null;
    },
  },
};
