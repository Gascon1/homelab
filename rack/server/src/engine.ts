import type { RackConfig } from './config.ts';
import { ConfigStore } from './config.ts';
import { appForWidget, AppRunner, envCredentials, failedWidget, request, unknownWidget, type CredentialLookup, type HttpPort, type WidgetOutcome } from './apps/index.ts';
import { buildDisplay, type DisplayInput } from './display.ts';
import { DockerUnavailable, listContainers, type ContainerInfo } from './docker.ts';
import type { Env } from './env.ts';
import { HealthTracker, httpCheck, statusFor, type CheckResult } from './health.ts';
import { HostSampler } from './host.ts';
import { every } from './loop.ts';
import { compareGroups, compareServices, resolveServices, type ResolvedService } from './resolve.ts';
import type { Host, Service, State, StateSource } from './types.ts';

const DOCKER_MS = 10_000;
const HEALTH_MS = 20_000;
const HOST_MS = 3_000;
const CONFIG_MS = 2_000;
const WIDGET_TICK_MS = 1_000;

/** Where the engine reads rack.yml settings from. ConfigStore is the live adapter. */
export interface ConfigSource {
  readonly config: RackConfig;
  readonly warnings: string[];
  /** Returns true when the effective config changed. */
  refresh(): Promise<boolean>;
}

/**
 * Everything the engine reads from the outside world. The live adapters talk to Docker, the apps,
 * /proc and the clock; the demo and the tests supply fakes. The projection above this seam is shared.
 */
export interface EngineInputs {
  /** Containers that opted in or are named in rack.yml. */
  docker(wantedIds: ReadonlySet<string>): Promise<ContainerInfo[]>;
  /** How widgets reach the apps. */
  http: HttpPort;
  /** One health probe of an app's internal address. */
  check(url: string): Promise<CheckResult>;
  host: { sample(): Promise<void>; readonly current: Host };
  now(): number;
}

export interface EngineOptions {
  config: ConfigSource;
  inputs: EngineInputs;
  credentials: CredentialLookup;
  /** Pass a pre-filled tracker to start with history. */
  health?: HealthTracker;
}

export class Engine implements StateSource {
  private readonly config: ConfigSource;
  private readonly inputs: EngineInputs;
  private readonly runner: AppRunner;
  private readonly health: HealthTracker;
  private readonly widgetResults = new Map<string, WidgetOutcome & { at: number }>();
  private readonly widgetsRunning = new Set<string>();
  private containers: ContainerInfo[] = [];
  private services: ResolvedService[] = [];
  private dockerWarning: string | null = null;
  private healthRunning = false;
  private stoppers: (() => void)[] = [];

  constructor(options: EngineOptions) {
    this.config = options.config;
    this.inputs = options.inputs;
    this.runner = new AppRunner(options.inputs.http, options.credentials);
    this.health = options.health ?? new HealthTracker();
  }

  /** One round of every input, without timers. start() does this, then keeps it going. */
  async refresh(): Promise<void> {
    await this.config.refresh();
    await this.refreshDocker();
    await Promise.all([this.pollWidgets(), this.inputs.host.sample()]);
  }

  async start(): Promise<void> {
    await this.refresh();
    // A second quick sample gives the CPU gauge a value without waiting a full interval.
    setTimeout(() => void this.inputs.host.sample(), 500).unref();

    this.stoppers = [
      every(CONFIG_MS, async () => {
        if (await this.config.refresh()) {
          this.rebuildServices();
          await this.checkHealth(true);
        }
      }),
      every(DOCKER_MS, () => this.refreshDocker()),
      every(HEALTH_MS, () => this.checkHealth()),
      every(WIDGET_TICK_MS, () => this.pollWidgets()),
      every(HOST_MS, () => this.inputs.host.sample()),
    ];
  }

  stop(): void {
    this.stoppers.forEach((stop) => stop());
    this.stoppers = [];
  }

  private async refreshDocker(): Promise<void> {
    try {
      this.containers = await this.inputs.docker(new Set(this.config.config.services.keys()));
      this.dockerWarning = null;
    } catch (err) {
      this.dockerWarning = err instanceof DockerUnavailable ? err.warning : 'Docker could not be queried';
    }
    this.rebuildServices();
    await this.checkHealth(true);
  }

  private rebuildServices(): void {
    this.services = resolveServices(this.containers, this.config.config);
    const ids = new Set(this.services.map((s) => s.id));
    this.health.forgetExcept(ids);
    this.runner.forgetExcept(ids);
    for (const id of this.widgetResults.keys()) if (!ids.has(id)) this.widgetResults.delete(id);
  }

  /** Runs health checks; with `onlyNew` skips services that already have a fresh result. */
  private async checkHealth(onlyNew = false): Promise<void> {
    if (this.healthRunning) return;
    this.healthRunning = true;
    try {
      await Promise.all(
        this.services.map(async (service) => {
          const known = this.health.get(service.id);
          if (service.container && service.container.state !== 'running') {
            this.health.markStopped(service.id, new Date(this.inputs.now()));
            return;
          }
          if (onlyNew && known && known.status !== 'stopped') return;
          if (!service.internal) return;
          const check = await this.inputs.check(service.internal);
          this.health.record(service.id, statusFor(service.container, check), check.latencyMs, new Date(this.inputs.now()));
        }),
      );
    } finally {
      this.healthRunning = false;
    }
  }

  private async pollWidgets(): Promise<void> {
    const now = this.inputs.now();
    await Promise.all(
      this.services.map(async (service) => {
        if (!service.widget || this.widgetsRunning.has(service.id)) return;
        const app = appForWidget(service.widget);
        const previous = this.widgetResults.get(service.id);
        if (app?.widget && previous && now - previous.at < app.widget.intervalMs) return;

        this.widgetsRunning.add(service.id);
        try {
          const outcome =
            !app
              ? unknownWidget(service.widget)
              : !service.internal
                ? failedWidget(app.id, `${service.name} has no internal address for Rack to query`)
                : await this.runner.run(app, {
                    serviceId: service.id,
                    name: service.name,
                    baseUrl: service.internal.replace(/\/+$/, ''),
                  });
          this.widgetResults.set(service.id, { ...outcome, at: this.inputs.now() });
        } finally {
          this.widgetsRunning.delete(service.id);
        }
      }),
    );
  }

  snapshot(): State {
    const config = this.config.config;
    const warnings = [...(this.dockerWarning ? [this.dockerWarning] : []), ...this.config.warnings];
    const sorted = [...this.services].sort(compareServices);

    const built = sorted.map((resolved) => {
      const widget = this.widgetResults.get(resolved.id);
      return { service: toService(resolved, this.health, widget), lines: widget?.lines ?? [] };
    });

    const byGroup = new Map<string, Service[]>();
    for (const { service } of built) byGroup.set(service.group, [...(byGroup.get(service.group) ?? []), service]);
    const groups = [...byGroup.keys()]
      .sort(compareGroups(config.groups))
      .map((name) => ({ name, services: byGroup.get(name)! }));

    // Display follows the dashboard's visual order so the busiest group's lines read first.
    const ordered = groups.flatMap((g) => g.services);
    const lineMap = new Map(built.map((b) => [b.service.id, b.lines]));
    const display: DisplayInput[] = ordered.map((s) => ({ name: s.name, status: s.status, lines: lineMap.get(s.id) ?? [] }));

    return {
      title: config.title ?? 'Homelab',
      generatedAt: new Date(this.inputs.now()).toISOString(),
      display: buildDisplay(display),
      groups,
      bookmarks: config.bookmarks,
      host: this.inputs.host.current,
      warnings,
    };
  }
}

function toService(resolved: ResolvedService, health: HealthTracker, widget: WidgetOutcome | undefined): Service {
  const entry = health.get(resolved.id);
  const container = resolved.container;
  const stopped = container !== null && container.state !== 'running';
  const icon = resolved.icon;
  return {
    id: resolved.id,
    name: resolved.name,
    description: resolved.description,
    group: resolved.group,
    icon: icon === null ? null : /^https?:\/\//.test(icon) ? icon : /^[a-z0-9-]+$/.test(icon) ? `/api/icon/${icon}` : null,
    url: resolved.url,
    port: resolved.port,
    path: resolved.path,
    status: stopped ? 'stopped' : entry && entry.status !== 'stopped' ? entry.status : 'unknown',
    since: entry?.since ?? null,
    latencyMs: entry?.latencyMs ?? null,
    history: entry?.history ?? [],
    container: container && {
      name: container.name,
      image: container.image,
      state: container.state,
      health: container.health,
      startedAt: container.startedAt,
    },
    widget: widget?.widget ?? null,
    featured: resolved.featured,
  };
}

/** The engine wired to the real Docker socket, the real apps, /proc and the system clock. */
export function createLiveSource(env: Env): Engine {
  const config = new ConfigStore(env.configDir);
  return new Engine({
    config,
    credentials: envCredentials({ vars: env.vars, appdataDir: env.appdataDir }),
    inputs: {
      docker: (wantedIds) => listContainers(env.dockerSocket, wantedIds),
      http: request,
      check: httpCheck,
      host: new HostSampler(env.procDir, env.sysDir, () => config.config.disks),
      now: Date.now,
    },
  });
}
