import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDisplay, MAX_SENTENCE } from '../src/display.ts';

const svc = (name: string, status: 'up' | 'down' | 'stopped' | 'slow' | 'unknown', lines: { text: string; kind: 'problem' | 'activity' }[] = []) => ({ name, status, lines });

test('problems come first, then activity, with no fallback when something is wrong', () => {
  const display = buildDisplay([
    svc('Plex', 'up', [{ text: 'Plex is playing to 2 screens', kind: 'activity' }]),
    svc('Radarr', 'stopped'),
    svc('FlareSolverr', 'down'),
    svc('Prowlarr', 'up', [{ text: 'Prowlarr has 1 failing indexer', kind: 'problem' }]),
  ]);
  assert.deepEqual(display, [
    'Radarr is stopped',
    'FlareSolverr is not responding',
    'Prowlarr has 1 failing indexer',
    'Plex is playing to 2 screens',
  ]);
});

test('activity is followed by the all-up fallback', () => {
  const display = buildDisplay([
    svc('qBittorrent', 'up', [{ text: 'qBittorrent is pulling 12.4 MB/s', kind: 'activity' }]),
    svc('Plex', 'up'),
  ]);
  assert.deepEqual(display, ['qBittorrent is pulling 12.4 MB/s', 'All 2 services are up']);
});

test('slow, unknown and empty cases', () => {
  assert.deepEqual(buildDisplay([svc('Sonarr', 'slow')]), ['Sonarr is slow to respond']);
  assert.deepEqual(buildDisplay([svc('Sonarr', 'unknown')]), ['Checking your services']);
  assert.deepEqual(buildDisplay([]), ['No services to show yet']);
});

test('at most five sentences, each at most 48 characters, no trailing full stop', () => {
  const many = Array.from({ length: 9 }, (_, i) => svc(`Service number ${i}`, 'down'));
  const display = buildDisplay(many);
  assert.equal(display.length, 5);
  assert.equal(display[4], 'And 5 more problems');

  const long = buildDisplay([svc('A very long service name that keeps going and going', 'down'), svc('B', 'up', [{ text: 'All good.', kind: 'activity' }])]);
  assert.ok(long.every((s) => s.length <= MAX_SENTENCE));
  assert.equal(long[0]!.length, MAX_SENTENCE);
  assert.ok(long[0]!.endsWith('…'));
  assert.equal(long[1], 'All good');
});
