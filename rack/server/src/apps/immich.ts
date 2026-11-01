import { formatBytes, formatCount } from '../format.ts';
import { secretFinder } from './credentials.ts';
import { getJson } from './http.ts';
import { defineWidget, type App } from './types.ts';

interface ServerStatistics {
  photos?: number;
  videos?: number;
  usage?: number;
}

const KEY_ENV = 'RACK_IMMICH_API_KEY';

export const immich: App = {
  id: 'immich',
  match: ['immich-server'],
  name: 'Immich',
  group: 'Photos',
  icon: 'immich',
  port: 2283,
  widget: defineWidget<string>({
    intervalMs: 10_000,
    // Immich keeps its keys in its database, so there is no appdata file to read.
    credential: { hint: KEY_ENV, purpose: 'library stats', find: secretFinder(KEY_ENV) },
    async fetch({ baseUrl, credential, http }) {
      const stats = await getJson<ServerStatistics>(http, `${baseUrl}/api/server/statistics`, { 'x-api-key': credential });
      return {
        busy: false,
        attention: false,
        stats: [
          { label: 'photos', value: formatCount(stats.photos ?? 0), tone: 'normal' },
          { label: 'videos', value: formatCount(stats.videos ?? 0), tone: 'normal' },
          { label: 'stored', value: formatBytes(stats.usage ?? 0), tone: 'normal' },
        ],
      };
    },
  }),
  demo: {
    image: 'ghcr.io/immich-app/immich-server:release',
    baseLatencyMs: 55,
    credential: 'demo',
    serve: ({ path }) => (path === '/api/server/statistics' ? { photos: 18_204, videos: 1_320, usage: 412.6 * 1024 ** 3 } : null),
  },
};
