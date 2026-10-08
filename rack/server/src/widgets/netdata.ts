import { formatCount } from '../format.ts';
import { getJson } from './http.ts';
import type { WidgetModule } from './types.ts';

interface Info {
  alarms?: { normal?: number; warning?: number; critical?: number };
}

export const netdata: WidgetModule = {
  type: 'netdata',
  intervalMs: 10_000,
  credentialHint: null,
  async fetch({ baseUrl }) {
    const alarms = (await getJson<Info>(`${baseUrl}/api/v1/info`)).alarms ?? {};
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
};
