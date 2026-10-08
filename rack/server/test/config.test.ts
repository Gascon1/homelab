import assert from 'node:assert/strict';
import { test } from 'node:test';
import { utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ConfigStore, validateConfig } from '../src/config.ts';
import { tempDir } from './helpers.ts';

test('validation keeps what is usable, tolerates unknown keys, and reports bad types', () => {
  const { config, problems } = validateConfig({
    title: 'Mine',
    futureSetting: { anything: true },
    groups: ['A', 'B'],
    services: { plex: { name: 'P', port: 'oops', extra: 1 }, nas: null },
    bookmarks: [{ name: 'R', url: 'http://r' }, { name: 'bad' }],
    disks: [{ path: '/mnt/data', label: 'media' }],
  });
  assert.equal(config.title, 'Mine');
  assert.deepEqual(config.groups, ['A', 'B']);
  assert.equal(config.services.get('plex')!.name, 'P');
  assert.equal(config.services.get('plex')!.port, undefined);
  assert.ok(config.services.has('nas'));
  assert.equal(config.bookmarks.length, 1);
  assert.equal(config.bookmarks[0]!.group, null);
  assert.deepEqual(config.disks, [{ path: '/mnt/data', label: 'media' }]);
  assert.equal(problems.length, 2);
});

test('a missing file means defaults and no warnings', async () => {
  const store = new ConfigStore(await tempDir());
  await store.refresh();
  assert.equal(store.config.title, null);
  assert.deepEqual(store.warnings, []);
});

test('reload picks up changes and keeps the last good config on a parse error', async () => {
  const dir = await tempDir();
  const file = join(dir, 'rack.yml');
  const store = new ConfigStore(dir);
  const touch = (seconds: number) => utimes(file, new Date(seconds * 1000), new Date(seconds * 1000));

  await writeFile(file, 'title: First\n');
  await touch(1000);
  assert.equal(await store.refresh(), true);
  assert.equal(store.config.title, 'First');
  assert.equal(await store.refresh(), false);

  await writeFile(file, 'title: [unclosed\n  services: : :\n');
  await touch(2000);
  await store.refresh();
  assert.equal(store.config.title, 'First');
  assert.equal(store.warnings.length, 1);
  assert.match(store.warnings[0]!, /rack\.yml could not be read/);
  assert.match(store.warnings[0]!, /last working settings/);

  await writeFile(file, 'title: Second\n');
  await touch(3000);
  await store.refresh();
  assert.equal(store.config.title, 'Second');
  assert.deepEqual(store.warnings, []);
});
