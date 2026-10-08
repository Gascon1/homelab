import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HealthTracker, HISTORY_LENGTH, statusFor } from '../src/health.ts';
import { container } from './helpers.ts';

const running = container({ name: 'a' });

test('a stopped container is stopped regardless of any check', () => {
  assert.equal(statusFor(container({ name: 'a', state: 'exited' }), { httpStatus: 200, latencyMs: 5 }), 'stopped');
});

test('no check yet means unknown', () => {
  assert.equal(statusFor(running, null), 'unknown');
});

test('network errors and 5xx are down; 4xx is up', () => {
  assert.equal(statusFor(running, { httpStatus: null, latencyMs: 5000 }), 'down');
  assert.equal(statusFor(running, { httpStatus: 503, latencyMs: 20 }), 'down');
  assert.equal(statusFor(running, { httpStatus: 401, latencyMs: 20 }), 'up');
  assert.equal(statusFor(null, { httpStatus: 200, latencyMs: 20 }), 'up');
});

test('slow only above 1500 ms', () => {
  assert.equal(statusFor(running, { httpStatus: 200, latencyMs: 1500 }), 'up');
  assert.equal(statusFor(running, { httpStatus: 200, latencyMs: 1501 }), 'slow');
});

test('tracker keeps since while status is stable, resets on change, and caps history', () => {
  const tracker = new HealthTracker();
  tracker.record('a', 'up', 10, new Date('2026-01-01T00:00:00Z'));
  tracker.record('a', 'up', 12, new Date('2026-01-01T00:00:20Z'));
  assert.equal(tracker.get('a')!.since, '2026-01-01T00:00:00.000Z');
  tracker.record('a', 'down', null, new Date('2026-01-01T00:00:40Z'));
  const entry = tracker.get('a')!;
  assert.equal(entry.since, '2026-01-01T00:00:40.000Z');
  assert.deepEqual(entry.history, [10, 12, null]);
  assert.equal(entry.latencyMs, null);

  for (let i = 0; i < 60; i++) tracker.record('a', 'up', i);
  assert.equal(tracker.get('a')!.history.length, HISTORY_LENGTH);
});

test('markStopped records once', () => {
  const tracker = new HealthTracker();
  tracker.markStopped('a');
  tracker.markStopped('a');
  assert.equal(tracker.get('a')!.history.length, 1);
  assert.equal(tracker.get('a')!.status, 'stopped');
});
