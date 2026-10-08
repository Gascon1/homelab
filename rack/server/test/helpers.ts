import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ContainerInfo, PortMapping } from '../src/docker.ts';

export const tempDir = (): Promise<string> => mkdtemp(join(tmpdir(), 'rack-test-'));

export function container(overrides: Partial<ContainerInfo> & { name: string }): ContainerInfo {
  return {
    id: `id-${overrides.name}`,
    image: 'example/app:latest',
    state: 'running',
    health: null,
    startedAt: null,
    labels: {},
    ports: [],
    composeService: null,
    ...overrides,
  };
}

export const tcp = (publicPort: number, privatePort: number): PortMapping => ({
  PublicPort: publicPort,
  PrivatePort: privatePort,
  Type: 'tcp',
});

export interface FakeServer {
  url: string;
  requests: { method: string; url: string; headers: http.IncomingHttpHeaders }[];
  close(): Promise<void>;
}

/** Starts an HTTP server on a TCP port (no listen target) or a unix socket path. */
export async function fakeServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void,
  socketPath?: string,
): Promise<FakeServer> {
  const requests: FakeServer['requests'] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      requests.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers });
      handler(req, res, Buffer.concat(chunks).toString());
    });
  });
  await new Promise<void>((resolve) => (socketPath ? server.listen(socketPath, resolve) : server.listen(0, '127.0.0.1', resolve)));
  return {
    url: socketPath ?? `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

export const json = (res: http.ServerResponse, body: unknown, status = 200): void => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

export async function until(check: () => Promise<boolean> | boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await check())) {
    if (Date.now() > deadline) throw new Error('condition not met in time');
    await new Promise((r) => setTimeout(r, 25));
  }
}
