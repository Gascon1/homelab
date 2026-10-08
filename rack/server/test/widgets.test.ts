import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Secrets } from '../src/credentials.ts';
import { createQbittorrent } from '../src/widgets/qbittorrent.ts';
import { plex } from '../src/widgets/plex.ts';
import { sonarr } from '../src/widgets/arr.ts';
import { runWidget } from '../src/widgets/run.ts';
import { fakeServer, json } from './helpers.ts';

const ctx = (baseUrl: string, vars: Record<string, string> = {}, name = 'Svc') => ({
  serviceId: name.toLowerCase(),
  name,
  baseUrl,
  secrets: new Secrets(vars, '/nonexistent'),
});

test('a widget without credentials names the exact env var and returns ok:false', async () => {
  const out = await runWidget(sonarr, ctx('http://127.0.0.1:1', {}, 'Sonarr'));
  assert.equal(out.widget.ok, false);
  assert.match(out.widget.error!, /RACK_SONARR_API_KEY/);
});

test('rejected credentials and unreachable hosts become plain sentences without the secret', async () => {
  const upstream = await fakeServer((_req, res) => res.writeHead(401).end());
  try {
    const out = await runWidget(plex, ctx(upstream.url, { RACK_PLEX_TOKEN: 'super-secret' }, 'Plex'));
    assert.equal(out.widget.ok, false);
    assert.match(out.widget.error!, /RACK_PLEX_TOKEN/);
    assert.ok(!JSON.stringify(out).includes('super-secret'));
  } finally {
    await upstream.close();
  }
  const dead = await runWidget(plex, ctx('http://127.0.0.1:1', { RACK_PLEX_TOKEN: 't' }, 'Plex'));
  assert.equal(dead.widget.ok, false);
  assert.match(dead.widget.error!, /Plex/);
});

test('plex counts streams and transcodes and writes a display sentence', async () => {
  const upstream = await fakeServer((req, res) => {
    json(res, { MediaContainer: { size: 2, Metadata: [{ TranscodeSession: {} }, {}] } });
  });
  try {
    const out = await runWidget(plex, ctx(upstream.url, { RACK_PLEX_TOKEN: 'tok' }, 'Plex'));
    assert.deepEqual(out.widget.stats.map((s) => [s.label, s.value]), [['streams', '2'], ['transcode', '1']]);
    assert.deepEqual(out.lines, [{ text: 'Plex is playing to 2 screens', kind: 'activity' }]);
    assert.equal(upstream.requests[0]!.headers['x-plex-token'], 'tok');
    assert.equal(upstream.requests[0]!.headers.accept, 'application/json');
  } finally {
    await upstream.close();
  }
});

test('qBittorrent works without credentials when auth is bypassed, sending Referer and Origin', async () => {
  const upstream = await fakeServer((req, res) => {
    if (req.url === '/api/v2/transfer/info') json(res, { dl_info_speed: 13_002_342, up_info_speed: 1024 });
    else json(res, [{}, {}]);
  });
  try {
    const out = await runWidget(createQbittorrent(), ctx(upstream.url, {}, 'qBittorrent'));
    assert.equal(out.widget.ok, true);
    assert.deepEqual(out.lines, [{ text: 'qBittorrent is pulling 12.4 MB/s', kind: 'activity' }]);
    assert.equal(out.widget.meter!.value, 1);
    assert.equal(upstream.requests[0]!.headers.referer, `${upstream.url}/`);
    assert.equal(upstream.requests[0]!.headers.origin, upstream.url);
  } finally {
    await upstream.close();
  }
});

test('qBittorrent logs in on 403 and reuses the session cookie', async () => {
  const upstream = await fakeServer((req, res, body) => {
    if (req.url === '/api/v2/auth/login') {
      assert.equal(body, 'username=me&password=pw');
      res.writeHead(200, { 'Set-Cookie': 'SID=abc; HttpOnly; path=/' }).end('Ok.');
    } else if (req.headers.cookie !== 'SID=abc') res.writeHead(403).end('Forbidden');
    else if (req.url === '/api/v2/transfer/info') json(res, { dl_info_speed: 0, up_info_speed: 0 });
    else json(res, []);
  });
  try {
    const module = createQbittorrent();
    const vars = { RACK_QBITTORRENT_USERNAME: 'me', RACK_QBITTORRENT_PASSWORD: 'pw' };
    const first = await runWidget(module, ctx(upstream.url, vars, 'qBittorrent'));
    assert.equal(first.widget.ok, true);
    assert.deepEqual(first.lines, []);
    const logins = () => upstream.requests.filter((r) => r.url === '/api/v2/auth/login').length;
    assert.equal(logins(), 1);
    await runWidget(module, ctx(upstream.url, vars, 'qBittorrent'));
    assert.equal(logins(), 1);
  } finally {
    await upstream.close();
  }
});

test('qBittorrent 5.2 login (204 with a QBT_SID_<port> cookie) is accepted', async () => {
  const upstream = await fakeServer((req, res) => {
    if (req.url === '/api/v2/auth/login') res.writeHead(204, { 'Set-Cookie': 'QBT_SID_8080=abc; HttpOnly; path=/' }).end();
    else if (req.headers.cookie !== 'QBT_SID_8080=abc') res.writeHead(403).end('Forbidden');
    else if (req.url === '/api/v2/transfer/info') json(res, { dl_info_speed: 0, up_info_speed: 0 });
    else json(res, []);
  });
  try {
    const vars = { RACK_QBITTORRENT_USERNAME: 'me', RACK_QBITTORRENT_PASSWORD: 'pw' };
    const out = await runWidget(createQbittorrent(), ctx(upstream.url, vars, 'qBittorrent'));
    assert.equal(out.widget.ok, true);
  } finally {
    await upstream.close();
  }
});

test('qBittorrent without credentials asks for both env vars when auth is required', async () => {
  const upstream = await fakeServer((_req, res) => res.writeHead(403).end());
  try {
    const out = await runWidget(createQbittorrent(), ctx(upstream.url, {}, 'qBittorrent'));
    assert.match(out.widget.error!, /RACK_QBITTORRENT_USERNAME and RACK_QBITTORRENT_PASSWORD/);
  } finally {
    await upstream.close();
  }
});
