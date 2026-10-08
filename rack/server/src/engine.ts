import { ConfigStore } from './config.ts';
import { Secrets } from './credentials.ts';
import { buildDisplay, type DisplayInput } from './display.ts';
import { DockerUnavailable, listContainers, type ContainerInfo } from './docker.ts';
import type { Env } from './env.ts';
import { HealthTracker, httpCheck, statusFor } from './health.ts';
import { HostSampler } from './host.ts';
import { every } from './loop.ts';
import { compareGroups, compareServices, resolveServices, type ResolvedService } from './resolve.ts';
import type { Service, State, StateSource } from './types.ts';
import { createWidgetRegistry } from './widgets/index.ts';
import { runWidget, unknownWidget, type WidgetOutcome } from './widgets/run.ts';

const DOCKER_MS = 10_000;
const HEALTH_MS = 20_000;
const HOST_MS = 3_000;
const CONFIG_MS = 2_000;
const WIDGET_TICK_MS = 1_000;

export class LiveSource implements StateSource {
  private readonly env: Env;
  private readonly config: ConfigStore;
  private readonly secrets: Secrets;
  private readonly health = new HealthTracker();
  private readonly host: HostSampler;
  private readonly widgetModules = createWidgetRegistry();
  private readonly widgetResults = new Map<string, WidgetOutcome & { at: number }>();
  private readonly widgetsRunning = new Set<string>();
  private containers: ContainerInfo[] = [];
  private services: ResolvedService[] = [];
  private dockerWarning: string | null = null;
  private healthRunning = false;
  private stoppers: (() => void)[] = [];

  constructor(env: Env) {
    this.env = env;
    this.config = new ConfigStore(env.configDir);
    this.secrets = new Secrets(env.vars, env.appdataDir);
    this.host = new HostSampler(env.procDir, env.sysDir, () => this.config.config.disks);
  }

  async start(): Promise<void> {
    await this.config.refresh();
    await this.refreshDocker();
    await Promise.all([this.pollWidgets(), this.host.sample()]);
    // A second quick sample gives the CPU gauge a value without waiting a full interval.
    setTimeout(() => void this.host.sample(), 500).unref();

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
      every(HOST_MS, () => this.host.sample()),
    ];
  }

  stop(): void {
    this.stoppers.forEach((stop) => stop());
    this.stoppers = [];
  }

  private async refreshDocker(): Promise<void> {
    try {
      this.containers = await listContainers(this.env.dockerSocket, new Set(this.config.config.services.keys()));
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
            this.health.markStopped(service.id);
            return;
          }
          if (onlyNew && known && known.status !== 'stopped') return;
          if (!service.internal) return;
          const check = await httpCheck(service.internal);
          this.health.record(service.id, statusFor(service.container, check), check.latencyMs);
        }),
      );
    } finally {
      this.healthRunning = false;
    }
  }

  private async pollWidgets(): Promise<void> {
    const now = Date.now();
    await Promise.all(
      this.services.map(async (service) => {
        if (!service.widget || this.widgetsRunning.has(service.id)) return;
        const module = this.widgetModules.get(service.widget);
        const previous = this.widgetResults.get(service.id);
        if (module && previous && now - previous.at < module.intervalMs) return;

        this.widgetsRunning.add(service.id);
        try {
          const outcome =
            !module
              ? unknownWidget(service.widget)
              : !service.internal
                ? failure(module.type, `${service.name} has no internal address for Rack to query`)
                : await runWidget(module, {
                    serviceId: service.id,
                    name: service.name,
                    baseUrl: service.internal.replace(/\/+$/, ''),
                    secrets: this.secrets,
                  });
          this.widgetResults.set(service.id, { ...outcome, at: Date.now() });
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
      generatedAt: new Date().toISOString(),
      display: buildDisplay(display),
      groups,
      bookmarks: config.bookmarks,
      host: this.host.current,
      warnings,
    };
  }
}

function failure(type: string, error: string): WidgetOutcome {
  return { widget: { type, ok: false, error, stats: [], meter: null }, lines: [] };
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
  };
}
