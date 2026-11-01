import { getJson } from './http.ts';
import { defineWidget, type App } from './types.ts';

interface Hello {
  msg?: string;
  version?: string;
}

export const flaresolverr: App = {
  id: 'flaresolverr',
  match: ['flaresolverr'],
  name: 'FlareSolverr',
  group: 'Downloads',
  icon: 'flaresolverr',
  port: 8191,
  widget: defineWidget<null>({
    intervalMs: 10_000,
    async fetch({ baseUrl, http }) {
      const hello = await getJson<Hello>(http, `${baseUrl}/`);
      const ready = /ready/i.test(hello.msg ?? '');
      return {
        stats: [{ label: ready ? 'ready' : 'not ready', value: hello.version ? `v${hello.version}` : '', tone: ready ? 'good' : 'warn' }],
      };
    },
  }),
  demo: {
    image: 'ghcr.io/flaresolverr/flaresolverr:latest',
    baseLatencyMs: 17,
    /** Down for 80 seconds in every five minutes. */
    outage: (seconds) => (seconds % 300 >= 120 && seconds % 300 < 200 ? 'down' : null),
    serve: ({ path }) => (path === '/' ? { msg: 'FlareSolverr is ready!', version: '3.3.21' } : null),
  },
};
