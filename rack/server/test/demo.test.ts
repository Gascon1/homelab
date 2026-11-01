import assert from 'node:assert/strict';
import { test } from 'node:test';
import { APPS } from '../src/apps/index.ts';
import { createDemoSource } from '../src/demo.ts';
import { MAX_SENTENCE } from '../src/display.ts';
import type { State } from '../src/types.ts';

const START = Date.parse('2026-10-08T12:00:00Z');
const BASE = Math.floor(START / 300_000) * 300_000;

/** The demo engine as it looks `s` seconds into a five-minute cycle. */
async function demoAt(s: number): Promise<State> {
  const at = BASE + s * 1000;
  const engine = createDemoSource({ now: () => at, startedAt: START });
  await engine.refresh();
  return engine.snapshot();
}

const find = (state: State, id: string) => state.groups.flatMap((g) => g.services).find((x) => x.id === id)!;

test('demo state has the nine real services in contract shape', async () => {
  const state = await demoAt(5);
  const services = state.groups.flatMap((g) => g.services);
  assert.deepEqual(state.groups.map((g) => g.name), ['Media', 'Downloads', 'Photos', 'System']);
  assert.equal(services.length, 9);
  for (const s of services) {
    assert.equal(s.history.length, 40);
    assert.ok(['up', 'slow', 'down'].includes(s.status));
  }
  assert.ok(state.display.length >= 1 && state.display.length <= 5);
  assert.ok(state.display.every((d) => d.length <= MAX_SENTENCE));
});

test('demo state drifts: streams come and go, FlareSolverr goes down for a stretch', async () => {
  assert.equal(find(await demoAt(0), 'plex').widget!.stats[0]!.value, '0');
  assert.equal(find(await demoAt(100), 'plex').widget!.stats[0]!.value, '2');
  assert.equal(find(await demoAt(10), 'flaresolverr').status, 'up');
  const down = await demoAt(150);
  assert.equal(find(down, 'flaresolverr').status, 'down');
  assert.ok(down.display.includes('FlareSolverr is not responding'));
  assert.equal(find(await demoAt(40), 'sonarr').status, 'slow');
});

test('the demo runs through the real projection: catalog facts, icons, order and widget sentences', async () => {
  const state = await demoAt(100);
  assert.deepEqual(state.groups.map((g) => g.services.map((s) => s.id)), [
    ['plex', 'seerr'],
    ['sonarr', 'radarr', 'prowlarr', 'qbittorrent', 'flaresolverr'],
    ['immich-server'],
    ['netdata'],
  ]);
  const plex = find(state, 'plex');
  assert.equal(plex.name, 'Plex');
  assert.equal(plex.icon, '/api/icon/plex');
  assert.equal(plex.path, '/web');
  assert.equal(plex.port, 32400);
  assert.deepEqual(plex.container, {
    name: 'plex',
    image: 'lscr.io/linuxserver/plex:latest',
    state: 'running',
    health: null,
    startedAt: new Date(START - 2 * 86_400_000).toISOString(),
  });
  assert.equal(find(state, 'seerr').container!.health, 'healthy');
  assert.equal(find(state, 'immich-server').container!.name, 'immich_server');
  assert.ok(state.display.includes('Plex is playing to 2 screens'));
  assert.ok(state.display.some((d) => d.startsWith('qBittorrent is pulling')));
  assert.deepEqual(state.bookmarks.map((b) => b.name), ['Router', 'Pi-hole']);
  assert.equal(state.title, 'Homelab');
  assert.deepEqual(state.warnings, []);
});

test('a steady demo app reports up since two days before the demo started; a recovered one since the change', async () => {
  const state = await demoAt(10);
  assert.equal(find(state, 'plex').since, new Date(START - 2 * 86_400_000).toISOString());
  const slow = await demoAt(40);
  const sonarr = find(slow, 'sonarr');
  assert.equal(sonarr.status, 'slow');
  assert.ok(Date.parse(sonarr.since!) > BASE + 29_000 && Date.parse(sonarr.since!) <= BASE + 40_000);
});

test('every demo fixture is read successfully by its real widget at any time of the cycle', async () => {
  for (let s = 0; s < 600; s += 7) {
    const state = await demoAt(s);
    for (const service of state.groups.flatMap((g) => g.services)) {
      const down = service.status === 'down';
      assert.equal(service.widget!.ok, !down, `${service.id} at ${s}s: ${service.widget!.error}`);
    }
  }
  assert.equal(APPS.filter((app) => app.demo).length, 9);
});

test('a down demo app shows the plain failure sentence and the demo never exposes its stand-in credentials', async () => {
  const state = await demoAt(150);
  assert.equal(find(state, 'flaresolverr').widget!.error, 'Could not read details from FlareSolverr');
  assert.ok(!JSON.stringify(state).includes('"demo"'));
});

test('the demo host moves with the clock', async () => {
  const a = await demoAt(0);
  const b = await demoAt(20);
  assert.equal(b.host.uptimeSeconds! - a.host.uptimeSeconds!, 20);
  assert.equal(a.host.disks.length, 2);
});

test('the demo states what is busy, what needs a look and what is featured', async () => {
  const busy = await demoAt(100);
  assert.deepEqual(['plex', 'qbittorrent'].map((id) => find(busy, id).featured), [true, true]);
  assert.equal(find(busy, 'sonarr').featured, false);
  assert.equal(find(busy, 'plex').widget!.busy, true);
  assert.equal(find(busy, 'netdata').widget!.attention, false);

  const idle = await demoAt(0);
  assert.equal(find(idle, 'plex').widget!.busy, false);
  assert.equal(find(await demoAt(270), 'netdata').widget!.attention, true);
});
