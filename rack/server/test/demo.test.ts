import assert from 'node:assert/strict';
import { test } from 'node:test';
import { demoState } from '../src/demo.ts';
import { MAX_SENTENCE } from '../src/display.ts';

const START = Date.parse('2026-10-08T12:00:00Z');

test('demo state has the nine real services in contract shape', () => {
  const state = demoState(START + 5000, START);
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

test('demo state drifts: streams come and go, FlareSolverr goes down for a stretch', () => {
  const at = (s: number) => demoState(Math.floor(START / 300_000) * 300_000 + s * 1000, START);
  const find = (s: ReturnType<typeof at>, id: string) => s.groups.flatMap((g) => g.services).find((x) => x.id === id)!;
  assert.equal(find(at(0), 'plex').widget!.stats[0]!.value, '0');
  assert.equal(find(at(100), 'plex').widget!.stats[0]!.value, '2');
  assert.equal(find(at(10), 'flaresolverr').status, 'up');
  assert.equal(find(at(150), 'flaresolverr').status, 'down');
  assert.ok(at(150).display.includes('FlareSolverr is not responding'));
  assert.equal(find(at(40), 'sonarr').status, 'slow');
});
