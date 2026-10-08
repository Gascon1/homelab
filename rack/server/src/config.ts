import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { parse, YAMLParseError } from 'yaml';
import type { Bookmark } from './types.ts';

export interface ServiceOverride {
  name?: string;
  group?: string;
  description?: string;
  icon?: string;
  url?: string;
  port?: number;
  path?: string;
  internal?: string;
  widget?: string;
  order?: number;
  hidden?: boolean;
}

export interface DiskConfig {
  path: string;
  label: string;
}

export interface RackConfig {
  title: string | null;
  groups: string[];
  services: Map<string, ServiceOverride>;
  bookmarks: Bookmark[];
  disks: DiskConfig[] | null;
}

export const EMPTY_CONFIG: RackConfig = { title: null, groups: [], services: new Map(), bookmarks: [], disks: null };

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates parsed YAML, keeping what is usable and describing what is not. Unknown keys are ignored. */
export function validateConfig(raw: unknown): { config: RackConfig; problems: string[] } {
  const problems: string[] = [];
  if (raw === null || raw === undefined) return { config: EMPTY_CONFIG, problems };
  if (!isRecord(raw)) {
    throw new Error('rack.yml should be a list of settings such as "title:" and "services:"');
  }

  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : null;
  if (raw.title !== undefined && title === null) problems.push('"title" in rack.yml should be text');

  let groups: string[] = [];
  if (Array.isArray(raw.groups) && raw.groups.every((g) => typeof g === 'string')) groups = raw.groups as string[];
  else if (raw.groups !== undefined) problems.push('"groups" in rack.yml should be a list of names');

  const services = new Map<string, ServiceOverride>();
  if (isRecord(raw.services)) {
    for (const [id, value] of Object.entries(raw.services)) {
      if (value === null) {
        services.set(id, {});
        continue;
      }
      if (!isRecord(value)) {
        problems.push(`Service "${id}" in rack.yml should be a set of settings`);
        continue;
      }
      services.set(id, readOverride(id, value, problems));
    }
  } else if (raw.services !== undefined) {
    problems.push('"services" in rack.yml should be a map of service ids');
  }

  const bookmarks: Bookmark[] = [];
  if (Array.isArray(raw.bookmarks)) {
    for (const item of raw.bookmarks) {
      if (isRecord(item) && typeof item.name === 'string' && typeof item.url === 'string') {
        bookmarks.push({ name: item.name, url: item.url, group: typeof item.group === 'string' ? item.group : null });
      } else problems.push('A bookmark in rack.yml needs a name and a url');
    }
  } else if (raw.bookmarks !== undefined) problems.push('"bookmarks" in rack.yml should be a list');

  let disks: DiskConfig[] | null = null;
  if (Array.isArray(raw.disks)) {
    disks = [];
    for (const item of raw.disks) {
      if (isRecord(item) && typeof item.path === 'string') {
        disks.push({ path: item.path, label: typeof item.label === 'string' ? item.label : item.path });
      } else problems.push('A disk in rack.yml needs a path');
    }
  } else if (raw.disks !== undefined) problems.push('"disks" in rack.yml should be a list');

  return { config: { title, groups, services, bookmarks, disks }, problems };
}

function readOverride(id: string, value: Record<string, unknown>, problems: string[]): ServiceOverride {
  const out: ServiceOverride = {};
  const text = (key: 'name' | 'group' | 'description' | 'icon' | 'url' | 'path' | 'internal' | 'widget') => {
    const v = value[key];
    if (typeof v === 'string' && v !== '') out[key] = v;
    else if (v !== undefined) problems.push(`"${key}" for service "${id}" in rack.yml should be text`);
  };
  (['name', 'group', 'description', 'icon', 'url', 'path', 'internal', 'widget'] as const).forEach(text);
  for (const key of ['port', 'order'] as const) {
    const v = value[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
    else if (v !== undefined) problems.push(`"${key}" for service "${id}" in rack.yml should be a number`);
  }
  if (typeof value.hidden === 'boolean') out.hidden = value.hidden;
  else if (value.hidden !== undefined) problems.push(`"hidden" for service "${id}" in rack.yml should be true or false`);
  return out;
}

/** Loads rack.yml, re-reading only when its mtime changes and keeping the last good config on errors. */
export class ConfigStore {
  private readonly file: string;
  private mtimeMs: number | null = null;
  private current: RackConfig = EMPTY_CONFIG;
  private problems: string[] = [];
  private failure: string | null = null;

  constructor(configDir: string) {
    this.file = join(configDir, 'rack.yml');
  }

  get config(): RackConfig {
    return this.current;
  }

  get warnings(): string[] {
    return this.failure ? [this.failure, ...this.problems] : this.problems;
  }

  /** Returns true when the effective config changed. */
  async refresh(): Promise<boolean> {
    let mtime: number | null;
    try {
      mtime = (await stat(this.file)).mtimeMs;
    } catch {
      mtime = null;
    }
    if (mtime === this.mtimeMs) return false;
    this.mtimeMs = mtime;

    if (mtime === null) {
      this.current = EMPTY_CONFIG;
      this.problems = [];
      this.failure = null;
      return true;
    }
    try {
      const { config, problems } = validateConfig(parse(await readFile(this.file, 'utf8')));
      this.current = config;
      this.problems = problems;
      this.failure = null;
    } catch (err) {
      const where = err instanceof YAMLParseError ? ` (line ${err.linePos?.[0].line ?? '?'})` : '';
      const why = err instanceof YAMLParseError ? err.code.toLowerCase().replaceAll('_', ' ') : (err as Error).message;
      this.failure = `rack.yml could not be read${where}: ${why}. Keeping the last working settings`;
    }
    return true;
  }
}
