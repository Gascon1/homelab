import { getJson } from './http.ts';
import type { WidgetModule } from './types.ts';

interface Hello {
  msg?: string;
  version?: string;
}

export const flaresolverr: WidgetModule = {
  type: 'flaresolverr',
  intervalMs: 10_000,
  credentialHint: null,
  async fetch({ baseUrl }) {
    const hello = await getJson<Hello>(`${baseUrl}/`);
    const ready = /ready/i.test(hello.msg ?? '');
    return {
      stats: [{ label: ready ? 'ready' : 'not ready', value: hello.version ? `v${hello.version}` : '', tone: ready ? 'good' : 'warn' }],
    };
  },
};
