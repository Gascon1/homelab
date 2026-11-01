import { formatCount } from '../format.ts';
import { secretFinder } from './credentials.ts';
import { getJson } from './http.ts';
import { defineWidget, type App } from './types.ts';

interface RequestCount {
  pending?: number;
  processing?: number;
  available?: number;
}

const KEY_ENV = 'RACK_SEERR_API_KEY';

function parseSeerrKey(json: string): string | null {
  try {
    const key = (JSON.parse(json) as { main?: { apiKey?: unknown } }).main?.apiKey;
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

export const seerr: App = {
  id: 'seerr',
  match: ['seerr', 'overseerr', 'jellyseerr'],
  name: 'Seerr',
  group: 'Media',
  icon: 'seerr',
  iconFallback: 'overseerr',
  port: 5055,
  widget: defineWidget<string>({
    intervalMs: 10_000,
    credential: {
      hint: KEY_ENV,
      purpose: 'request stats',
      find: secretFinder(KEY_ENV, { path: ['seerr', 'settings.json'], parse: parseSeerrKey }),
    },
    async fetch({ baseUrl, credential, http }) {
      const counts = await getJson<RequestCount>(http, `${baseUrl}/api/v1/request/count`, { 'X-Api-Key': credential });
      const pending = counts.pending ?? 0;
      return {
        stats: [
          { label: 'waiting', value: formatCount(pending), tone: pending > 0 ? 'warn' : 'normal' },
          { label: 'processing', value: formatCount(counts.processing ?? 0), tone: 'normal' },
          { label: 'available', value: formatCount(counts.available ?? 0), tone: 'good' },
        ],
        lines:
          pending > 0
            ? [{ text: `${pending} ${pending === 1 ? 'request is' : 'requests are'} waiting in Seerr`, kind: 'activity' }]
            : [],
      };
    },
  }),
  demo: {
    image: 'ghcr.io/seerr-team/seerr:latest',
    baseLatencyMs: 64,
    containerHealth: 'healthy',
    credential: 'demo',
    serve({ path, seconds }) {
      if (path !== '/api/v1/request/count') return null;
      return { pending: Math.floor((seconds % 360) / 120) + 1, processing: 1, available: 128 };
    },
  },
};
