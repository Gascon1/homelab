import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { LiveSource } from './engine.ts';
import { DemoSource } from './demo.ts';
import type { Env } from './env.ts';
import { EventHub } from './hub.ts';
import { IconStore, isValidSlug } from './icons.ts';
import { serveStatic } from './static.ts';
import type { StateSource } from './types.ts';

export interface App {
  port: number;
  /** Resolves once the first discovery and health round has finished. */
  ready: Promise<void>;
  close(): Promise<void>;
}

const ICON_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

export async function startApp(env: Env, source: StateSource = env.demo ? new DemoSource() : new LiveSource(env)): Promise<App> {
  const hub = new EventHub(source);
  const icons = new IconStore(env.configDir, env.iconCdn);

  const server = http.createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error('[rack] request failed:', err instanceof Error ? err.message : err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Internal error');
    });
  });

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const path = new URL(req.url ?? '/', 'http://rack.local').pathname;
    const send = (status: number, headers: http.OutgoingHttpHeaders, body: string | Buffer) => {
      res.writeHead(status, { 'Content-Length': Buffer.byteLength(body), ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };

    if (path === '/healthz') return send(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }, 'ok');

    if (path === '/api/state') {
      return send(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, JSON.stringify(source.snapshot()));
    }

    if (path === '/api/events') {
      if (req.method === 'HEAD') return send(200, { 'Content-Type': 'text/event-stream' }, '');
      hub.subscribe(res);
      return;
    }

    if (path.startsWith('/api/icon/')) {
      const slug = path.slice('/api/icon/'.length);
      const icon = isValidSlug(slug) ? await icons.get(slug) : null;
      if (!icon) return send(404, { 'Content-Type': 'text/plain' }, 'Icon not found');
      return send(
        200,
        {
          'Content-Type': icon.contentType,
          'Cache-Control': 'public, max-age=604800',
          'Content-Security-Policy': ICON_CSP,
          'X-Content-Type-Options': 'nosniff',
        },
        icon.body,
      );
    }

    if (path.startsWith('/api/')) return send(404, { 'Content-Type': 'text/plain' }, 'Not found');

    const file = await serveStatic(env.webDir, path);
    send(file.status, { 'Content-Type': file.contentType, 'Cache-Control': file.cacheControl }, file.body);
  }

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(env.port, '0.0.0.0', resolve);
  });
  hub.start();
  const ready = source.start().catch((err) => {
    console.error('[rack] first refresh failed:', err instanceof Error ? err.message : err);
  });

  return {
    port: (server.address() as AddressInfo).port,
    ready,
    async close() {
      source.stop();
      hub.stop();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
