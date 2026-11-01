import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { bytes, clock, isZero, linkFor, sinceLabel, statusSentence, uptime } from '../src/format.ts';
import { service } from './fixtures.ts';

test('isZero reads formatted numbers, not prose', () => {
  for (const v of ['0', '0.0', ' 0 ', '0 B/s', '0.00 MB/s']) assert.equal(isZero(v), true, v);
  for (const v of ['', '10', '0.5', '0,5', '1,204', 'v3.3.21']) assert.equal(isZero(v), false, v);
});

test('bytes picks a unit and keeps three significant figures', () => {
  assert.equal(bytes(0), '0 B');
  assert.equal(bytes(1536), '1.5 KB');
  assert.equal(bytes(120 * 1024 ** 2), '120 MB');
  assert.equal(bytes(5.6 * 1024 ** 4), '5.6 TB');
});

test('uptime is days, hours or minutes', () => {
  assert.equal(uptime(3 * 86400), '3 days');
  assert.equal(uptime(3 * 3600 + 120), '3 h 2 min');
  assert.equal(uptime(5), '1 min');
});

test('sinceLabel shortens with age', () => {
  const now = new Date(2026, 9, 20, 12, 0);
  assert.equal(sinceLabel(null, now), null);
  assert.equal(sinceLabel('nonsense', now), null);
  assert.equal(sinceLabel(new Date(2026, 9, 20, 9, 5).toISOString(), now), '09:05');
  assert.equal(sinceLabel(new Date(2026, 9, 18, 9, 5).toISOString(), now), 'Sun 09:05');
  assert.equal(sinceLabel(new Date(2026, 8, 1, 9, 5).toISOString(), now), '1 Sep 09:05');
  assert.equal(clock(new Date(2026, 0, 1, 7, 3)), '07:03');
});

const realLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
afterEach(() => {
  if (realLocation) Object.defineProperty(globalThis, 'location', realLocation);
  else delete (globalThis as { location?: unknown }).location;
});

test('linkFor prefers the configured url, else builds one from the page address', () => {
  Object.defineProperty(globalThis, 'location', { value: { protocol: 'http:', hostname: '10.0.0.5' }, configurable: true });
  assert.equal(linkFor(service({ url: 'http://plex.lan' })), 'http://plex.lan');
  assert.equal(linkFor(service({ port: 32400, path: '/web' })), 'http://10.0.0.5:32400/web');
  assert.equal(linkFor(service({ port: 8080 })), 'http://10.0.0.5:8080');
  assert.equal(linkFor(service()), null);
});

test('statusSentence tells the owner what to do', () => {
  assert.equal(statusSentence(service({ status: 'up' })), null);
  assert.equal(statusSentence(service({ status: 'down' })), 'Not responding. Check its logs.');
  assert.equal(statusSentence(service({ status: 'stopped' })), 'Stopped. Start the container.');
  assert.equal(statusSentence(service({ status: 'slow', latencyMs: 2500 })), 'Slow, answering in 2.5 s');
  assert.equal(statusSentence(service({ status: 'unknown' })), 'Checking now');
});
