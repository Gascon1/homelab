import { SECRET_ENV } from '../credentials.ts';
import { formatBytes, formatCount } from '../format.ts';
import { getJson } from './http.ts';
import { MissingCredential, type WidgetModule } from './types.ts';

interface ServerStatistics {
  photos?: number;
  videos?: number;
  usage?: number;
}

export const immich: WidgetModule = {
  type: 'immich',
  intervalMs: 10_000,
  credentialHint: SECRET_ENV.immich,
  async fetch({ baseUrl, secrets }) {
    const key = secrets.get('immich');
    if (!key) throw new MissingCredential(SECRET_ENV.immich, 'library stats');
    const stats = await getJson<ServerStatistics>(`${baseUrl}/api/server/statistics`, { 'x-api-key': key });
    return {
      stats: [
        { label: 'photos', value: formatCount(stats.photos ?? 0), tone: 'normal' },
        { label: 'videos', value: formatCount(stats.videos ?? 0), tone: 'normal' },
        { label: 'stored', value: formatBytes(stats.usage ?? 0), tone: 'normal' },
      ],
    };
  },
};
