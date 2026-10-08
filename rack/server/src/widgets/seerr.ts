import { SECRET_ENV } from '../credentials.ts';
import { formatCount } from '../format.ts';
import { getJson } from './http.ts';
import { MissingCredential, type WidgetModule } from './types.ts';

interface RequestCount {
  pending?: number;
  processing?: number;
  available?: number;
}

export const seerr: WidgetModule = {
  type: 'seerr',
  intervalMs: 10_000,
  credentialHint: SECRET_ENV.seerr,
  async fetch({ baseUrl, secrets }) {
    const key = secrets.get('seerr');
    if (!key) throw new MissingCredential(SECRET_ENV.seerr, 'request stats');
    const counts = await getJson<RequestCount>(`${baseUrl}/api/v1/request/count`, { 'X-Api-Key': key });
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
};
