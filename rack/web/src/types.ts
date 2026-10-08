// Copied verbatim from the Rack contract (CONTRACT.md, GET /api/state). Do not edit.
export type Status = 'up' | 'slow' | 'down' | 'stopped' | 'unknown';

export interface State {
  title: string;
  generatedAt: string;            // ISO 8601
  display: string[];              // 1 to 5 plain sentences for the top display, most important first
  groups: { name: string; services: Service[] }[];   // ordered; empty groups omitted
  bookmarks: { name: string; url: string; group: string | null }[];
  host: Host;
  warnings: string[];             // config errors etc., plain sentences; usually []
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  group: string;
  icon: string | null;            // URL the browser can load, normally `/api/icon/<slug>`
  url: string | null;             // full link if explicitly configured
  port: number | null;            // else the browser builds `${location.protocol}//${location.hostname}:${port}${path ?? ''}`
  path: string | null;
  status: Status;
  since: string | null;           // ISO time the current status began
  latencyMs: number | null;       // last health check
  history: (number | null)[];     // last <=40 latencies, oldest first; null = failed check
  container: { name: string; image: string; state: string; health: string | null; startedAt: string | null } | null;
  widget: Widget | null;
}

export interface Widget {
  type: string;
  ok: boolean;
  error: string | null;           // plain sentence when ok=false, e.g. "Add RACK_IMMICH_API_KEY to .env to see library stats"
  stats: { label: string; value: string; tone: 'normal' | 'good' | 'warn' | 'bad' }[];  // 0 to 3, already formatted for humans
  meter: { label: string; value: number } | null;   // 0..1, optional activity level
}

export interface Host {
  uptimeSeconds: number | null;
  cpu: { percent: number; cores: number } | null;      // percent 0..100
  memory: { usedBytes: number; totalBytes: number } | null;
  load: [number, number, number] | null;
  tempC: number | null;
  disks: { path: string; label: string; usedBytes: number; totalBytes: number }[];
}
