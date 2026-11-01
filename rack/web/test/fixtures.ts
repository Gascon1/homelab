import type { Service, Widget } from '../../shared/state.ts';

export function widget(overrides: Partial<Widget> = {}): Widget {
  return { type: 'x', ok: true, error: null, stats: [], meter: null, busy: false, attention: false, ...overrides };
}

export function service(overrides: Partial<Service> = {}): Service {
  return {
    id: 'app',
    name: 'App',
    description: null,
    group: 'Media',
    icon: null,
    url: null,
    port: null,
    path: null,
    status: 'up',
    since: null,
    latencyMs: null,
    history: [],
    container: null,
    widget: null,
    featured: false,
    ...overrides,
  };
}
