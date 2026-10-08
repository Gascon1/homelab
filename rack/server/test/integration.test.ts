import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadEnv } from '../src/env.ts';
import { startApp } from '../src/server.ts';
import type { State } from '../src/types.ts';
import { fakeServer, json, tempDir } from './helpers.ts';

function dockerContainer(name: string, state: string, labels: Record<string, string>, ports: object[] = []) {
  return { Id: `id-${name}`, Names: [`/${name}`], Image: `lscr.io/linuxserver/${name}:latest`, State: state, Labels: labels, Ports: ports };
}

test('end to end: fake Docker + fake upstreams produce the expected /api/state', async () => {
  const dir = await tempDir();
  const appdata = join(dir, 'appdata');
  const plexDir = join(appdata, 'plex', 'Library', 'Application Support', 'Plex Media Server');
  await mkdir(plexDir, { recursive: true });
  await writeFile(join(plexDir, 'Preferences.xml'), '<Preferences PlexOnlineToken="tok123"/>');
  const web = join(dir, 'web');
  await mkdir(web);
  await writeFile(join(web, 'index.html'), '<html>rack</html>');
  await writeFile(join(dir, 'rack.yml'), 'title: Test Lab\nservices:\n  nas:\n    name: NAS\n    group: Machine\n    url: http://127.0.0.1:1\n');

  const plexUpstream = await fakeServer((req, res) => {
    if (req.url === '/status/sessions') json(res, { MediaContainer: { size: 1, Metadata: [{}] } });
    else res.writeHead(200).end('ok');
  });
  const brokenUpstream = await fakeServer((_req, res) => res.writeHead(500).end());
  const seerrUpstream = await fakeServer((_req, res) => res.writeHead(200).end('ok'));

  const base = { 'rack.enable': 'true' };
  const docker = await fakeServer((req, res) => {
    if (req.url === '/containers/json?all=1') {
      json(res, [
        dockerContainer('plex', 'running', { ...base, 'rack.internal': plexUpstream.url, 'com.docker.compose.service': 'plex' }, [
          { PrivatePort: 32400, PublicPort: 32400, Type: 'tcp' },
        ]),
        dockerContainer('radarr', 'exited', { ...base }, [{ PrivatePort: 7878, PublicPort: 7878, Type: 'tcp' }]),
        dockerContainer('flaresolverr', 'running', { ...base, 'rack.internal': brokenUpstream.url }),
        dockerContainer('seerr', 'running', { ...base, 'rack.internal': seerrUpstream.url }),
        dockerContainer('ignored', 'running', {}),
      ]);
    } else if (req.url === '/containers/id-plex/json') {
      json(res, { State: { StartedAt: '2026-10-01T10:00:00.000Z', Health: { Status: 'healthy' } } });
    } else json(res, { State: { StartedAt: '0001-01-01T00:00:00Z' } });
  }, join(dir, 'docker.sock'));

  const env = loadEnv({
    PORT: '0',
    RACK_DOCKER_SOCKET: docker.url,
    RACK_CONFIG_DIR: dir,
    RACK_APPDATA_DIR: appdata,
    RACK_PROC_DIR: join(dir, 'no-proc'),
    RACK_SYS_DIR: join(dir, 'no-sys'),
    RACK_WEB_DIR: web,
    RACK_ICON_CDN: seerrUpstream.url,
  });
  const app = await startApp(env);
  try {
    await app.ready;
    const base_ = `http://127.0.0.1:${app.port}`;
    const state = (await (await fetch(`${base_}/api/state`)).json()) as State;

    assert.equal(state.title, 'Test Lab');
    assert.deepEqual(state.groups.map((g) => g.name), ['Watch', 'Fetch', 'Machine']);
    const all = Object.fromEntries(state.groups.flatMap((g) => g.services).map((s) => [s.id, s]));
    assert.deepEqual(Object.keys(all).sort(), ['flaresolverr', 'nas', 'plex', 'radarr', 'seerr']);

    assert.equal(all.plex!.status, 'up');
    assert.equal(all.plex!.since !== null, true);
    assert.equal(all.plex!.history.length, 1);
    assert.equal(all.plex!.port, 32400);
    assert.equal(all.plex!.icon, '/api/icon/plex');
    assert.deepEqual(all.plex!.container, {
      name: 'plex',
      image: 'lscr.io/linuxserver/plex:latest',
      state: 'running',
      health: 'healthy',
      startedAt: '2026-10-01T10:00:00.000Z',
    });
    assert.equal(all.plex!.widget!.ok, true);
    assert.equal(all.plex!.widget!.stats[0]!.value, '1');

    assert.equal(all.radarr!.status, 'stopped');
    assert.equal(all.radarr!.container!.startedAt, null);
    assert.equal(all.flaresolverr!.status, 'down');
    assert.equal(all.flaresolverr!.latencyMs, null);
    assert.equal(all.nas!.status, 'down');
    assert.equal(all.nas!.container, null);

    assert.equal(all.seerr!.widget!.ok, false);
    assert.match(all.seerr!.widget!.error!, /RACK_SEERR_API_KEY/);

    assert.deepEqual(state.display.slice(0, 4), [
      'FlareSolverr is not responding',
      'Radarr is stopped',
      'NAS is not responding',
      'Plex is playing to 1 screen',
    ]);
    assert.deepEqual(state.warnings, []);
    assert.deepEqual(state.host.disks.map((d) => d.path).includes('/'), true);
    assert.equal(state.host.cpu, null);

    assert.ok(docker.requests.every((r) => r.method === 'GET'), 'Docker is only ever read');
    assert.ok(!JSON.stringify(state).includes('tok123'));

    assert.equal(await (await fetch(`${base_}/healthz`)).text(), 'ok');
    assert.equal(await (await fetch(`${base_}/some/spa/route`)).text(), '<html>rack</html>');
    assert.equal((await fetch(`${base_}/api/icon/Bad..Slug`)).status, 404);
  } finally {
    await app.close();
    await Promise.all([plexUpstream.close(), brokenUpstream.close(), seerrUpstream.close(), docker.close()]);
  }
});

test('without a Docker socket Rack keeps running, shows static services and explains why', async () => {
  const dir = await tempDir();
  await writeFile(join(dir, 'rack.yml'), 'services:\n  nas:\n    name: NAS\n    url: http://127.0.0.1:1\n');
  const app = await startApp(loadEnv({ PORT: '0', RACK_DOCKER_SOCKET: join(dir, 'missing.sock'), RACK_CONFIG_DIR: dir, RACK_APPDATA_DIR: dir, RACK_WEB_DIR: dir }));
  try {
    await app.ready;
    const state = (await (await fetch(`http://127.0.0.1:${app.port}/api/state`)).json()) as State;
    assert.equal(state.groups[0]!.services[0]!.id, 'nas');
    assert.equal(state.warnings.length, 1);
    assert.match(state.warnings[0]!, /Docker is not reachable/);
  } finally {
    await app.close();
  }
});

test('/api/events sends an initial state event straight away', async () => {
  const app = await startApp(loadEnv({ PORT: '0', RACK_DEMO: '1', RACK_WEB_DIR: '/nonexistent' }));
  try {
    const first = await new Promise<{ type: string; data: string }>((resolve, reject) => {
      const req = http.get(`http://127.0.0.1:${app.port}/api/events`, (res) => {
        res.setEncoding('utf8');
        res.once('data', (chunk: string) => {
          resolve({ type: String(res.headers['content-type']), data: chunk });
          req.destroy();
        });
      });
      req.on('error', (err) => ((err as NodeJS.ErrnoException).code === 'ECONNRESET' ? undefined : reject(err)));
    });
    assert.equal(first.type, 'text/event-stream');
    assert.match(first.data, /^event: state\ndata: \{.*\}\n\n$/s);
    const payload = JSON.parse(first.data.split('\n')[1]!.slice('data: '.length)) as State;
    assert.equal(payload.groups.flatMap((g) => g.services).length, 10);
  } finally {
    await app.close();
  }
});
