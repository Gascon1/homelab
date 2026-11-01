import { APPS, type App, type HttpPort } from './apps/index.ts';
import type { RackConfig } from './config.ts';
import type { ContainerInfo } from './docker.ts';
import { Engine, type ConfigSource } from './engine.ts';
import { HISTORY_LENGTH, HealthTracker, SLOW_MS, type CheckResult } from './health.ts';
import type { Host, Status } from './types.ts';

// The demo is a set of fake inputs for the real Engine: Docker containers, upstream replies, health
// probes and host readings. Grouping, ordering, icons, labels and sentences all come from the engine
// and the apps, so the demo cannot drift from a real install. Each app's replies live in its own module.

const CHECK_SPACING_MS = 20_000;
const DAY_MS = 86_400_000;
const GB = 1024 ** 3;

interface DemoApp extends App {
  demo: NonNullable<App['demo']>;
}

const DEMO_APPS = APPS.filter((app): app is DemoApp => app.demo !== undefined);

/** The compose service id the demo gives each app. */
const serviceId = (app: DemoApp): string => app.match[0]!;

const containerName = (app: DemoApp): string => serviceId(app).replace('-', '_');

const wave = (seconds: number, period: number, phase = 0): number => Math.sin((seconds / period) * 2 * Math.PI + phase);

/** Health of one app at one moment. */
function healthAt(app: DemoApp, atMs: number): { status: Status; latency: number | null } {
  const seconds = atMs / 1000;
  const outage = app.demo.outage?.(seconds) ?? null;
  if (outage === 'down') return { status: 'down', latency: null };
  const base = app.demo.baseLatencyMs;
  const jitter = Math.round(base + 0.25 * base * wave(seconds, 37, app.port ?? 0));
  if (outage === 'slow') return { status: 'slow', latency: SLOW_MS + 400 + jitter };
  return { status: 'up', latency: jitter };
}

function containerFor(app: DemoApp, anchor: number): ContainerInfo {
  const port = app.port ?? 0;
  return {
    id: `demo-${serviceId(app)}`,
    name: containerName(app),
    image: app.demo.image,
    state: 'running',
    health: app.demo.containerHealth ?? null,
    startedAt: new Date(anchor).toISOString(),
    labels: { 'rack.enable': 'true', 'com.docker.compose.service': serviceId(app) },
    ports: [{ PublicPort: port, PrivatePort: port, Type: 'tcp' }],
    composeService: serviceId(app),
  };
}

function hostAt(atMs: number, startMs: number): Host {
  const s = atMs / 1000;
  return {
    uptimeSeconds: 19 * 86_400 + Math.floor((atMs - startMs) / 1000),
    cpu: { percent: Math.round((16 + 11 * wave(s, 40) + 5 * wave(s, 9)) * 10) / 10, cores: 8 },
    memory: { usedBytes: Math.round((9.4 + 0.8 * wave(s, 180)) * GB), totalBytes: Math.round(31.2 * GB) },
    load: [1.1 + 0.5 * wave(s, 40), 0.9 + 0.2 * wave(s, 120), 0.8].map((n) => Math.round(n * 100) / 100) as [number, number, number],
    tempC: Math.round((47 + 4 * wave(s, 90)) * 10) / 10,
    disks: [
      { path: '/', label: 'system', usedBytes: Math.round(118.4 * GB), totalBytes: Math.round(476 * GB) },
      { path: '/mnt/data', label: 'media', usedBytes: Math.round(7210 * GB), totalBytes: Math.round(14_900 * GB) },
    ],
  };
}

/** What a user's rack.yml would say: the bookmarks, and the order the demo apps are listed in. */
function demoConfig(): ConfigSource {
  const config: RackConfig = {
    title: null,
    groups: [],
    services: new Map(DEMO_APPS.map((app, order) => [serviceId(app), { order }])),
    bookmarks: [
      { name: 'Router', url: 'http://10.0.0.1', group: 'Network' },
      { name: 'Pi-hole', url: 'http://10.0.0.2/admin', group: 'Network' },
    ],
    disks: null,
  };
  return { config, warnings: [], refresh: () => Promise.resolve(false) };
}

export interface DemoClock {
  now(): number;
  /** When the pretend server came up; the host uptime counts from here. */
  startedAt: number;
}

/** A health history as if the demo had been running: one probe every 20 s, ending now. */
function seedHealth(clock: DemoClock): HealthTracker {
  const tracker = new HealthTracker();
  const anchor = clock.startedAt - 2 * DAY_MS;
  const now = clock.now();
  for (const app of DEMO_APPS) {
    const samples = Array.from({ length: HISTORY_LENGTH }, (_, k) => healthAt(app, now - (HISTORY_LENGTH - 1 - k) * CHECK_SPACING_MS));
    // The first probe is recorded at the anchor so a steady app reports "up since" two days ago.
    tracker.record(serviceId(app), samples[0]!.status, samples[0]!.latency, new Date(anchor));
    samples.forEach((s, k) => tracker.record(serviceId(app), s.status, s.latency, new Date(now - (HISTORY_LENGTH - 1 - k) * CHECK_SPACING_MS)));
  }
  return tracker;
}

/** Plays each demo app's upstream: the JSON the real app would send, or a refused connection while it is down. */
function demoHttp(clock: DemoClock): HttpPort {
  const byHost = new Map(DEMO_APPS.map((app) => [containerName(app), app]));
  return (url, options) => {
    const target = new URL(url);
    const app = byHost.get(target.hostname);
    const seconds = clock.now() / 1000;
    if (!app || app.demo.outage?.(seconds) === 'down') return Promise.reject(new Error('connection refused'));
    const body = app.demo.serve({ method: options?.method ?? 'GET', path: `${target.pathname}${target.search}`, seconds });
    const status = body === null ? 404 : 200;
    return Promise.resolve({ status, headers: new Headers(), body: JSON.stringify(body) });
  };
}

function demoCheck(clock: DemoClock): (url: string) => Promise<CheckResult> {
  const byHost = new Map(DEMO_APPS.map((app) => [containerName(app), app]));
  return (url) => {
    const app = byHost.get(new URL(url).hostname);
    const { status, latency } = app ? healthAt(app, clock.now()) : { status: 'down' as Status, latency: null };
    return Promise.resolve(status === 'down' || latency === null ? { httpStatus: null, latencyMs: 0 } : { httpStatus: 200, latencyMs: latency });
  };
}

/** The real Engine, fed a pretend homelab. Pass a clock to freeze or step time in tests. */
export function createDemoSource(clock: DemoClock = { now: Date.now, startedAt: Date.now() }): Engine {
  const anchor = clock.startedAt - 2 * DAY_MS;
  return new Engine({
    config: demoConfig(),
    health: seedHealth(clock),
    credentials: (app) => app.demo?.credential ?? null,
    inputs: {
      docker: () => Promise.resolve(DEMO_APPS.map((app) => containerFor(app, anchor))),
      http: demoHttp(clock),
      check: demoCheck(clock),
      host: {
        sample: () => Promise.resolve(),
        get current() {
          return hostAt(clock.now(), clock.startedAt);
        },
      },
      now: clock.now,
    },
  });
}
