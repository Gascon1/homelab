/**
 * The State contract: the JSON that GET /api/state and /api/events carry.
 * The server builds it and the web renders it; both import this file, nothing copies it.
 * Types only, so it needs no build step. Never put a secret in State.
 */

export type Status = 'up' | 'slow' | 'down' | 'stopped' | 'unknown';
export type Tone = 'normal' | 'good' | 'warn' | 'bad';

export interface Stat {
  label: string;
  /** Already formatted for humans. */
  value: string;
  tone: Tone;
}

export interface Widget {
  /** The app id, such as "plex". */
  type: string;
  ok: boolean;
  /** Plain sentence when ok is false, e.g. "Add RACK_IMMICH_API_KEY to .env to see library stats". */
  error: string | null;
  /** 0 to 3, already formatted for humans. */
  stats: Stat[];
  /** 0..1, optional activity level. */
  meter: { label: string; value: number } | null;
  /** Something is going on right now (streams, downloads, a queue), as the app itself judges. False when not ok. */
  busy: boolean;
  /** The app reports something the owner should look at (warnings, failures). False when not ok. */
  attention: boolean;
}

export interface ContainerSummary {
  name: string;
  image: string;
  state: string;
  health: string | null;
  startedAt: string | null;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  group: string;
  /** URL the browser can load, normally `/api/icon/<slug>`. */
  icon: string | null;
  /** Full link if explicitly configured. */
  url: string | null;
  /** Else the browser builds `${location.protocol}//${location.hostname}:${port}${path ?? ''}`. */
  port: number | null;
  path: string | null;
  status: Status;
  /** ISO time the current status began. */
  since: string | null;
  /** Last health check. */
  latencyMs: number | null;
  /** Last <=40 latencies, oldest first; null = failed check. */
  history: (number | null)[];
  container: ContainerSummary | null;
  widget: Widget | null;
  /** The app earns a bigger tile and a place at the top of its group. */
  featured: boolean;
}

export interface Disk {
  path: string;
  label: string;
  usedBytes: number;
  totalBytes: number;
}

export interface Host {
  uptimeSeconds: number | null;
  /** percent 0..100 */
  cpu: { percent: number; cores: number } | null;
  memory: { usedBytes: number; totalBytes: number } | null;
  load: [number, number, number] | null;
  tempC: number | null;
  disks: Disk[];
}

export interface Bookmark {
  name: string;
  url: string;
  group: string | null;
}

export interface State {
  title: string;
  /** ISO 8601 */
  generatedAt: string;
  /** 1 to 5 plain sentences for the top display, most important first. */
  display: string[];
  /** Ordered; empty groups omitted. */
  groups: { name: string; services: Service[] }[];
  bookmarks: Bookmark[];
  host: Host;
  /** Config errors etc., plain sentences; usually []. */
  warnings: string[];
}
