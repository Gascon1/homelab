export type Status = 'up' | 'slow' | 'down' | 'stopped' | 'unknown';
export type Tone = 'normal' | 'good' | 'warn' | 'bad';

export interface Stat {
  label: string;
  value: string;
  tone: Tone;
}

export interface Widget {
  type: string;
  ok: boolean;
  error: string | null;
  stats: Stat[];
  meter: { label: string; value: number } | null;
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
  icon: string | null;
  url: string | null;
  port: number | null;
  path: string | null;
  status: Status;
  since: string | null;
  latencyMs: number | null;
  history: (number | null)[];
  container: ContainerSummary | null;
  widget: Widget | null;
}

export interface Disk {
  path: string;
  label: string;
  usedBytes: number;
  totalBytes: number;
}

export interface Host {
  uptimeSeconds: number | null;
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
  generatedAt: string;
  display: string[];
  groups: { name: string; services: Service[] }[];
  bookmarks: Bookmark[];
  host: Host;
  warnings: string[];
}

/** Something that can produce the current State; implemented by the live engine and the demo. */
export interface StateSource {
  start(): Promise<void>;
  stop(): void;
  snapshot(): State;
}
