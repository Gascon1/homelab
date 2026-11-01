import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Host } from '../../shared/state.ts';
import { describe, hostTiles, summarise } from '../src/view.ts';
import { service, widget } from './fixtures.ts';

test('busy and attention come from the widget, whatever its stat labels say', () => {
  const quiet = service({ widget: widget({ stats: [{ label: 'streams', value: '3', tone: 'warn' }] }) });
  assert.equal(describe(quiet).busy, false);
  assert.equal(describe(quiet).attention, false);

  const lively = service({ widget: widget({ busy: true, attention: true, stats: [{ label: 'zorp', value: '0', tone: 'normal' }] }) });
  assert.equal(describe(lively).busy, true);
  assert.equal(describe(lively).attention, true);
});

test('a down or stopped service is neither busy nor in need of a look, it is down', () => {
  for (const status of ['down', 'stopped'] as const) {
    const d = describe(service({ status, widget: widget({ busy: true, attention: true }) }));
    assert.equal(d.down, true);
    assert.equal(d.busy, false);
    assert.equal(d.attention, false);
    assert.equal(d.needsSetup, false);
  }
});

test('a slow service needs a look even when its widget is calm', () => {
  assert.equal(describe(service({ status: 'slow', widget: widget() })).attention, true);
  assert.equal(describe(service({ status: 'slow' })).attention, true);
});

test('a widget that is not ok needs setup and claims no activity', () => {
  const d = describe(service({ widget: widget({ ok: false, error: 'Add a key', busy: true, attention: true }) }));
  assert.equal(d.needsSetup, true);
  assert.equal(d.busy, false);
  assert.equal(d.attention, false);
  assert.deepEqual(d.stats, []);
});

test('featured is the service flag, with or without a widget', () => {
  assert.equal(describe(service({ featured: true })).featured, true);
  assert.equal(describe(service({ id: 'plex' })).featured, false);
  assert.equal(describe(service({ widget: widget({ meter: { label: 'm', value: 0.5 } }) })).featured, false);
});

test('a group summary names trouble first, then things to look at, then activity', () => {
  const calm = service({ widget: widget() });
  const busy = service({ widget: widget({ busy: true }) });
  const attn = service({ widget: widget({ attention: true }) });
  const down = service({ status: 'down' });
  assert.deepEqual(summarise([calm]), { text: 'All quiet', tone: '' });
  assert.deepEqual(summarise([calm, busy, busy]), { text: '2 busy', tone: 'is-busy' });
  assert.deepEqual(summarise([busy, attn]), { text: '1 to look at', tone: 'is-warn' });
  assert.deepEqual(summarise([attn, down]), { text: '1 needs attention', tone: 'is-bad' });
  assert.deepEqual(summarise([down, down]), { text: '2 need attention', tone: 'is-bad' });
});

const GB = 1024 ** 3;
const host = (overrides: Partial<Host> = {}): Host => ({ uptimeSeconds: null, cpu: null, memory: null, load: null, tempC: null, disks: [], ...overrides });

test('host tiles only exist for readings the host has', () => {
  assert.deepEqual(hostTiles(host()), []);
  const keys = hostTiles(host({ cpu: { percent: 10, cores: 4 }, uptimeSeconds: 90_000, load: [1, 2, 3] })).map((t) => t.key);
  assert.deepEqual(keys, ['cpu', 'up', 'load']);
});

test('gauges turn warn and crit at their thresholds, with a plain note', () => {
  const tiles = hostTiles(host({
    cpu: { percent: 91, cores: 8 },
    memory: { usedBytes: 13 * GB, totalBytes: 16 * GB },
    disks: [{ path: '/', label: 'system', usedBytes: 10 * GB, totalBytes: 100 * GB }],
  }));
  const [cpu, mem, disk] = tiles;
  assert.equal(cpu!.tone, 'crit');
  assert.equal(mem!.tone, 'warn');
  assert.equal(mem!.detail, 'Getting full. 13.0 of 16.0 GB');
  assert.equal(disk!.tone, 'ok');
  assert.equal(disk!.label, 'Disk, system');
});

test('temperature reads normal, warm or hot', () => {
  const tone = (tempC: number) => hostTiles(host({ tempC }))[0]!;
  assert.equal(tone(50).detail, 'Normal');
  assert.equal(tone(72).tone, 'warn');
  assert.equal(tone(90).detail, 'Running hot');
});
