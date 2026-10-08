import { DEFAULT_GROUP_ORDER, findCatalogEntry } from './catalog.ts';
import type { RackConfig, ServiceOverride } from './config.ts';
import { derivePorts, type ContainerInfo } from './docker.ts';
import { titleCase } from './format.ts';

/** A service after merging rack.yml, labels and the catalog, before health and widget data are attached. */
export interface ResolvedService {
  id: string;
  name: string;
  description: string | null;
  group: string;
  /** Slug or absolute URL. */
  icon: string | null;
  url: string | null;
  port: number | null;
  path: string | null;
  /** URL Rack uses for the health check and widgets. */
  internal: string | null;
  widget: string | null;
  order: number | null;
  container: ContainerInfo | null;
}

const toInt = (v: string | undefined): number | null => {
  const n = Number(v);
  return v !== undefined && Number.isInteger(n) && n > 0 ? n : null;
};

const firstDefined = <T>(...values: (T | undefined | null)[]): T | null => values.find((v) => v != null) ?? null;

function widgetName(value: string | null): string | null {
  return value === null || value === 'none' ? null : value;
}

function resolveContainer(container: ContainerInfo, override: ServiceOverride): ResolvedService {
  const id = container.composeService ?? container.name;
  const labels = container.labels;
  const catalog = findCatalogEntry(id, container.image);

  const ports = derivePorts(
    container.ports,
    firstDefined(override.port, toInt(labels['rack.port'])),
    catalog?.port ?? null,
  );
  const derivedInternal = ports.privatePort === null ? null : `http://${container.name}:${ports.privatePort}`;

  return {
    id,
    name: firstDefined(override.name, labels['rack.name'], catalog?.name) ?? titleCase(id),
    description: firstDefined(override.description, labels['rack.description']),
    group: firstDefined(override.group, labels['rack.group'], catalog?.group) ?? 'Other',
    icon: firstDefined(override.icon, labels['rack.icon'], catalog?.icon) ?? id.toLowerCase(),
    url: firstDefined(override.url, labels['rack.url']),
    port: ports.publicPort,
    path: firstDefined(override.path, labels['rack.path'], catalog?.path),
    internal: firstDefined(override.internal, labels['rack.internal'], derivedInternal),
    widget: widgetName(firstDefined(override.widget, labels['rack.widget'], catalog?.widget)),
    order: firstDefined(override.order, toInt(labels['rack.order'])),
    container,
  };
}

function resolveStatic(id: string, override: ServiceOverride): ResolvedService {
  return {
    id,
    name: override.name ?? titleCase(id),
    description: override.description ?? null,
    group: override.group ?? 'Other',
    icon: override.icon ?? id.toLowerCase(),
    url: override.url ?? null,
    port: override.port ?? null,
    path: override.path ?? null,
    internal: override.internal ?? override.url ?? null,
    widget: widgetName(override.widget ?? null),
    order: override.order ?? null,
    container: null,
  };
}

/**
 * Containers appear when they carry rack.enable=true or are named in rack.yml;
 * rack.yml entries without a container become static services.
 */
export function resolveServices(containers: ContainerInfo[], config: RackConfig): ResolvedService[] {
  const services = new Map<string, ResolvedService>();
  for (const container of containers) {
    const id = container.composeService ?? container.name;
    const override = config.services.get(id) ?? {};
    if (container.labels['rack.enable'] !== 'true' && !config.services.has(id)) continue;
    services.set(id, resolveContainer(container, override));
  }
  for (const [id, override] of config.services) {
    if (!services.has(id)) services.set(id, resolveStatic(id, override));
  }
  return [...services.values()].filter((s) => config.services.get(s.id)?.hidden !== true);
}

export function compareGroups(configured: string[]): (a: string, b: string) => number {
  const rank = (name: string): number => {
    const own = configured.indexOf(name);
    if (own >= 0) return own;
    const builtin = DEFAULT_GROUP_ORDER.indexOf(name);
    return builtin >= 0 ? configured.length + builtin : Number.MAX_SAFE_INTEGER;
  };
  return (a, b) => rank(a) - rank(b) || a.localeCompare(b);
}

export function compareServices(a: ResolvedService, b: ResolvedService): number {
  return (a.order ?? Infinity) - (b.order ?? Infinity) || a.name.localeCompare(b.name);
}
