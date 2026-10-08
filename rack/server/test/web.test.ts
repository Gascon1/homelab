import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isValidSlug, IconStore } from '../src/icons.ts';
import { resolveInside, serveStatic } from '../src/static.ts';
import { fakeServer, tempDir } from './helpers.ts';

test('icon slugs must match ^[a-z0-9-]+$', () => {
  for (const ok of ['plex', 'immich', 'home-assistant', 'a1']) assert.equal(isValidSlug(ok), true, ok);
  for (const bad of ['', 'Plex', '../etc', 'a/b', 'a.svg', 'a b', 'a_b', '%2e%2e', 'x\0']) assert.equal(isValidSlug(bad), false, bad);
});

test('icons are fetched once, cached on disk, and misses are remembered', async () => {
  const dir = await tempDir();
  const cdn = await fakeServer((req, res) => {
    if (req.url === '/svg/plex.svg') res.writeHead(200).end('<svg/>');
    else res.writeHead(404).end();
  });
  try {
    const store = new IconStore(dir, cdn.url);
    const first = await store.get('plex');
    assert.equal(first!.contentType, 'image/svg+xml');
    assert.equal(first!.body.toString(), '<svg/>');
    const requestsAfterFirst = cdn.requests.length;

    assert.equal((await new IconStore(dir, cdn.url).get('plex'))!.body.toString(), '<svg/>');
    assert.equal(cdn.requests.length, requestsAfterFirst, 'second store reads from disk');

    assert.equal(await store.get('nothing'), null);
    const requestsAfterMiss = cdn.requests.length;
    assert.equal(await store.get('nothing'), null);
    assert.equal(cdn.requests.length, requestsAfterMiss, 'misses are cached');
    assert.equal(await store.get('../x'), null);
  } finally {
    await cdn.close();
  }
});

test('seerr falls back to the overseerr icon but is cached under its own slug', async () => {
  const dir = await tempDir();
  const cdn = await fakeServer((req, res) => {
    if (req.url === '/svg/overseerr.svg') res.writeHead(200).end('<svg id="o"/>');
    else res.writeHead(404).end();
  });
  try {
    assert.equal((await new IconStore(dir, cdn.url).get('seerr'))!.body.toString(), '<svg id="o"/>');
  } finally {
    await cdn.close();
  }
});

test('static serving: content types, SPA fallback, and path traversal', async () => {
  const root = await tempDir();
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<html>app</html>');
  await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(join(root, '..', 'rack-secret.txt'), 'secret').catch(() => {});

  const js = await serveStatic(root, '/assets/app.js');
  assert.equal(js.status, 200);
  assert.match(js.contentType, /^text\/javascript/);
  assert.match(js.cacheControl, /immutable/);

  assert.equal((await serveStatic(root, '/')).body.toString(), '<html>app</html>');
  assert.equal((await serveStatic(root, '/some/client/route')).body.toString(), '<html>app</html>');
  assert.equal((await serveStatic(root, '/missing.js')).status, 404);

  for (const attack of ['/../rack-secret.txt', '/..%2Frack-secret.txt', '/%2e%2e/rack-secret.txt', '/assets/../../rack-secret.txt', '/%00', '/..\\x', '/%E0%A4%A']) {
    const res = await serveStatic(root, attack);
    assert.notEqual(res.body.toString(), 'secret', attack);
  }
  assert.equal(resolveInside(root, '/../x'), null);
  assert.equal(resolveInside(root, '/%2e%2e/x'), null);
  assert.ok(resolveInside(root, '/assets/app.js')!.startsWith(root));
});
