import type { Service } from './types';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');

export const clock = (d: Date) => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
export const dateLabel = (d: Date) => `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;

/** "21:30", "Tue 18:02" or "8 Oct 18:02", depending on how long ago. */
export function sinceLabel(iso: string | null, now = new Date()): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  if (d.toDateString() === now.toDateString()) return clock(d);
  const age = now.getTime() - d.getTime();
  if (age < 6 * 86400_000) return `${DAYS[d.getDay()]} ${clock(d)}`;
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${clock(d)}`;
}

export function uptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  if (d >= 2) return `${d} days`;
  const h = Math.floor(sec / 3600);
  if (h >= 1) return `${h} h ${Math.floor((sec % 3600) / 60)} min`;
  return `${Math.max(1, Math.floor(sec / 60))} min`;
}

export function bytes(n: number): string {
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)} ${u[i]}`;
}

export function linkFor(s: Service): string | null {
  if (s.url) return s.url;
  if (s.port == null) return null;
  return `${location.protocol}//${location.hostname}:${s.port}${s.path ?? ''}`;
}

export const STATUS_WORD: Record<Service['status'], string> = {
  up: 'Up',
  slow: 'Slow',
  down: 'Not responding',
  stopped: 'Stopped',
  unknown: 'Checking',
};

/** The sentence that replaces the readouts when something is wrong. */
export function statusSentence(s: Service): string | null {
  const since = sinceLabel(s.since);
  switch (s.status) {
    case 'down': return since ? `Not responding since ${since}. Check its logs.` : 'Not responding. Check its logs.';
    case 'stopped': return since ? `Stopped since ${since}. Start the container.` : 'Stopped. Start the container.';
    case 'slow': return s.latencyMs ? `Slow, answering in ${(s.latencyMs / 1000).toFixed(1)} s` : 'Slow to answer';
    case 'unknown': return 'Checking now';
    default: return null;
  }
}
