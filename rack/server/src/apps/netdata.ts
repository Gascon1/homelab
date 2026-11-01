import { formatCount } from '../format.ts';
import { getJson } from './http.ts';
import { defineWidget, type App } from './types.ts';

interface Info {
  alarms?: { normal?: number; warning?: number; critical?: number };
}

export const netdata: App = {
  id: 'netdata',
  match: ['netdata'],
  name: 'Netdata',
  group: 'System',
  icon: 'netdata',
  port: 19999,
  widget: defineWidget<null>({
    intervalMs: 10_000,
    async fetch({ baseUrl, http }) {
      const alarms = (await getJson<Info>(http, `${baseUrl}/api/v1/info`)).alarms ?? {};
      const critical = alarms.critical ?? 0;
      const warning = alarms.warning ?? 0;
      const lines =
        critical > 0
          ? [{ text: `Netdata has ${critical} critical ${critical === 1 ? 'alarm' : 'alarms'}`, kind: 'problem' as const }]
          : warning > 0
            ? [{ text: `Netdata has ${warning} ${warning === 1 ? 'warning' : 'warnings'}`, kind: 'problem' as const }]
            : [];
      return {
        stats: [
          { label: 'critical', value: formatCount(critical), tone: critical > 0 ? 'bad' : 'good' },
          { label: 'warnings', value: formatCount(warning), tone: warning > 0 ? 'warn' : 'good' },
        ],
        lines,
      };
    },
  }),
  demo: {
    image: 'netdata/netdata:stable',
    baseLatencyMs: 48,
    serve({ path, seconds }) {
      if (path !== '/api/v1/info') return null;
      const warning = seconds % 400 >= 250 && seconds % 400 < 290 ? 1 : 0;
      return { alarms: { normal: 20, warning, critical: 0 } };
    },
  },
};
