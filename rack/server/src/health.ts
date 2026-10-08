import type { ContainerInfo } from './docker.ts';
import type { Status } from './types.ts';

export const SLOW_MS = 1500;
export const HISTORY_LENGTH = 40;
const CHECK_TIMEOUT_MS = 5000;

export interface CheckResult {
  /** HTTP status, or null for a network error or timeout. */
  httpStatus: number | null;
  latencyMs: number;
}

export function statusFor(container: ContainerInfo | null, check: CheckResult | null): Status {
  if (container && container.state !== 'running') return 'stopped';
  if (!check) return 'unknown';
  if (check.httpStatus === null || check.httpStatus >= 500) return 'down';
  return check.latencyMs > SLOW_MS ? 'slow' : 'up';
}

export async function httpCheck(url: string): Promise<CheckResult> {
  const started = performance.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), redirect: 'manual' });
    await res.body?.cancel();
    return { httpStatus: res.status, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { httpStatus: null, latencyMs: Math.round(performance.now() - started) };
  }
}

export interface HealthEntry {
  status: Status;
  since: string;
  latencyMs: number | null;
  history: (number | null)[];
}

export class HealthTracker {
  private readonly entries = new Map<string, HealthEntry>();

  get(id: string): HealthEntry | undefined {
    return this.entries.get(id);
  }

  record(id: string, status: Status, latencyMs: number | null, now = new Date()): void {
    const previous = this.entries.get(id);
    const failed = status === 'down' || status === 'stopped';
    const sample = failed ? null : latencyMs;
    this.entries.set(id, {
      status,
      since: previous?.status === status ? previous.since : now.toISOString(),
      latencyMs: failed ? null : latencyMs,
      history: [...(previous?.history ?? []), sample].slice(-HISTORY_LENGTH),
    });
  }

  /** Records a stopped container once, so repeated docker polls do not flood the history. */
  markStopped(id: string, now = new Date()): void {
    if (this.entries.get(id)?.status !== 'stopped') this.record(id, 'stopped', null, now);
  }

  forgetExcept(ids: ReadonlySet<string>): void {
    for (const id of this.entries.keys()) if (!ids.has(id)) this.entries.delete(id);
  }
}
