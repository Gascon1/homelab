import type { ServerResponse } from 'node:http';
import type { State, StateSource } from './types.ts';

const TICK_MS = 1000;
const HEARTBEAT_MS = 20_000;

const signature = (state: State): string => JSON.stringify({ ...state, generatedAt: '' });
const frame = (state: State): string => `event: state\ndata: ${JSON.stringify(state)}\n\n`;

/** Fans state changes out to SSE clients, checking at most once per second. */
export class EventHub {
  private readonly source: StateSource;
  private readonly clients = new Set<ServerResponse>();
  private lastSignature = '';
  private timers: NodeJS.Timeout[] = [];

  constructor(source: StateSource) {
    this.source = source;
  }

  start(): void {
    this.timers = [
      setInterval(() => this.broadcastIfChanged(), TICK_MS),
      setInterval(() => this.clients.forEach((c) => c.write(': ping\n\n')), HEARTBEAT_MS),
    ];
  }

  stop(): void {
    this.timers.forEach(clearInterval);
    this.timers = [];
    for (const client of this.clients) client.end();
    this.clients.clear();
  }

  subscribe(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const state = this.source.snapshot();
    this.lastSignature = signature(state);
    res.write(frame(state));
    this.clients.add(res);
    res.on('close', () => this.clients.delete(res));
  }

  private broadcastIfChanged(): void {
    if (this.clients.size === 0) return;
    const state = this.source.snapshot();
    const next = signature(state);
    if (next === this.lastSignature) return;
    this.lastSignature = next;
    const message = frame(state);
    for (const client of this.clients) client.write(message);
  }
}
