import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { APPS, AppRunner, appForWidget, envCredentials, findApp, iconFallback, request, type App } from '../src/apps/index.ts';
import { fakeServer, json, tempDir } from './helpers.ts';

/** Runs one app's widget against a fake upstream, with credentials from `vars` and files under `appdata`. */
function runner(vars: Record<string, string> = {}, appdataDir = '/nonexistent') {
  return new AppRunner(request, envCredentials({ vars, appdataDir }));
}

const byId = (id: string): App => APPS.find((a) => a.id === id)!;
const target = (app: App, baseUrl: string) => ({ serviceId: app.id, name: app.name, baseUrl });

async function withUpstream<T>(handler: Parameters<typeof fakeServer>[0], use: (url: string, requests: Awaited<ReturnType<typeof fakeServer>>['requests']) => Promise<T>): Promise<T> {
  const upstream = await fakeServer(handler);
  try {
    return await use(upstream.url, upstream.requests);
  } finally {
    await upstream.close();
  }
}

const values = (stats: { label: string; value: string }[]) => stats.map((s) => [s.label, s.value]);

async function writeAppdata(root: string, file: string[], text: string): Promise<void> {
  const path = join(root, ...file);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text);
}

// ---- identity -------------------------------------------------------------------------------

test('the catalog finds an app by compose service id or by image name', () => {
  assert.equal(findApp('plex', 'x/y:1')?.name, 'Plex');
  assert.equal(findApp('whatever', 'ghcr.io/immich-app/immich-server:release')?.name, 'Immich');
  assert.equal(findApp('requests', 'fallenbagel/jellyseerr:latest')?.id, 'seerr');
  assert.equal(findApp('mystery', 'example/app:1'), null);
});

test('every app has an identity the dashboard can group and draw', () => {
  const groups = new Set(APPS.map((a) => a.group));
  assert.deepEqual([...groups].sort(), ['Downloads', 'Media', 'Photos', 'System']);
  for (const app of APPS) {
    assert.ok(app.name && app.icon && app.match.length > 0, app.id);
    assert.ok(app.port && app.port > 0, app.id);
  }
  assert.equal(new Set(APPS.map((a) => a.id)).size, APPS.length);
  assert.equal(iconFallback('seerr'), 'overseerr');
  assert.equal(iconFallback('plex'), undefined);
});

test('widget types resolve to apps that can fetch; apps without a widget do not resolve', () => {
  assert.equal(appForWidget('sonarr')?.name, 'Sonarr');
  assert.equal(appForWidget('immich')?.name, 'Immich');
  assert.equal(appForWidget('nope'), null);
});

// ---- credential discovery ---------------------------------------------------------------------

test('credentials come from the env var first, then the app\'s own appdata file, re-read every time', async () => {
  const appdata = await tempDir();
  const find = (vars: Record<string, string>, id: string) => envCredentials({ vars, appdataDir: appdata })(byId(id));

  assert.equal(find({}, 'sonarr'), null);
  await writeAppdata(appdata, ['sonarr', 'config.xml'], '<Config>\n  <Port>8989</Port>\n  <ApiKey>sonarr-key</ApiKey>\n</Config>');
  await writeAppdata(appdata, ['radarr', 'config.xml'], '<Config><ApiKey>file-key</ApiKey></Config>');
  await writeAppdata(appdata, ['prowlarr', 'config.xml'], '<Config><ApiKey>prowlarr-key</ApiKey></Config>');
  await writeAppdata(
    appdata,
    ['plex', 'Library', 'Application Support', 'Plex Media Server', 'Preferences.xml'],
    '<Preferences MachineIdentifier="x" PlexOnlineToken="plex-token" PlexOnlineUsername="me"/>',
  );
  await writeAppdata(appdata, ['seerr', 'settings.json'], '{"main":{"apiKey":"seerr-key"},"other":1}');

  assert.equal(find({}, 'sonarr'), 'sonarr-key');
  assert.equal(find({}, 'prowlarr'), 'prowlarr-key');
  assert.equal(find({}, 'plex'), 'plex-token');
  assert.equal(find({}, 'seerr'), 'seerr-key');
  assert.equal(find({ RACK_RADARR_API_KEY: '  from-env  ' }, 'radarr'), 'from-env');
  assert.equal(find({}, 'radarr'), 'file-key');
});

test('credential files that are empty, malformed or missing give no credential', async () => {
  const appdata = await tempDir();
  await writeAppdata(appdata, ['sonarr', 'config.xml'], '<Config/>');
  await writeAppdata(appdata, ['seerr', 'settings.json'], 'not json');
  await writeAppdata(appdata, ['plex', 'Library', 'Application Support', 'Plex Media Server', 'Preferences.xml'], '<Preferences/>');
  const find = (id: string) => envCredentials({ vars: {}, appdataDir: appdata })(byId(id));
  for (const id of ['sonarr', 'seerr', 'plex', 'radarr']) assert.equal(find(id), null, id);
});

test('immich only reads its env var; flaresolverr and netdata need no credential', () => {
  const find = (vars: Record<string, string>, id: string) => envCredentials({ vars, appdataDir: '/nonexistent' })(byId(id));
  assert.equal(find({}, 'immich'), null);
  assert.equal(find({ RACK_IMMICH_API_KEY: 'k' }, 'immich'), 'k');
  for (const id of ['flaresolverr', 'netdata']) assert.equal(byId(id).widget!.credential, undefined);
  assert.equal(find({}, 'netdata'), null);
});

test('qBittorrent needs both env vars to have a login', () => {
  const find = (vars: Record<string, string>) => envCredentials({ vars, appdataDir: '/nonexistent' })(byId('qbittorrent'));
  assert.equal(find({ RACK_QBITTORRENT_USERNAME: 'a' }), null);
  assert.deepEqual(find({ RACK_QBITTORRENT_USERNAME: 'a', RACK_QBITTORRENT_PASSWORD: 'b' }), { username: 'a', password: 'b' });
});

// ---- failure sentences, for every app that needs a credential ----------------------------------

const ENV_BY_APP: Record<string, string> = {
  plex: 'RACK_PLEX_TOKEN',
  seerr: 'RACK_SEERR_API_KEY',
  sonarr: 'RACK_SONARR_API_KEY',
  radarr: 'RACK_RADARR_API_KEY',
  prowlarr: 'RACK_PROWLARR_API_KEY',
  immich: 'RACK_IMMICH_API_KEY',
};

test('an app without its credential names the exact env var and returns ok:false, without calling the app', async () => {
  await withUpstream((_req, res) => res.writeHead(200).end('{}'), async (url, requests) => {
    for (const [id, envVar] of Object.entries(ENV_BY_APP)) {
      const out = await runner().run(byId(id), target(byId(id), url));
      assert.equal(out.widget.ok, false, id);
      assert.equal(out.widget.error, `Add ${envVar} to .env to see ${byId(id).widget!.credential!.purpose}`);
    }
    assert.equal(requests.length, 0);
  });
});

test('rejected credentials and unreachable apps become plain sentences without the secret', async () => {
  for (const [id, envVar] of Object.entries(ENV_BY_APP)) {
    const app = byId(id);
    await withUpstream((_req, res) => res.writeHead(401).end(), async (url) => {
      const out = await runner({ [envVar]: 'super-secret' }).run(app, target(app, url));
      assert.equal(out.widget.error, `${app.name} did not accept the credentials; check ${envVar}`);
      assert.ok(!JSON.stringify(out).includes('super-secret'));
    });
    await withUpstream((_req, res) => res.writeHead(500).end(), async (url) => {
      const out = await runner({ [envVar]: 'k' }).run(app, target(app, url));
      assert.equal(out.widget.error, `${app.name} answered with an error (HTTP 500)`);
    });
    const dead = await runner({ [envVar]: 'k' }).run(app, target(app, 'http://127.0.0.1:1'));
    assert.equal(dead.widget.error, `Could not read details from ${app.name}`);
  }
});

test('key-less apps never blame credentials for a 403', async () => {
  for (const id of ['flaresolverr', 'netdata']) {
    await withUpstream((_req, res) => res.writeHead(403).end(), async (url) => {
      const out = await runner().run(byId(id), target(byId(id), url));
      assert.equal(out.widget.error, `${byId(id).name} answered with an error (HTTP 403)`);
    });
  }
});

// ---- widgets ------------------------------------------------------------------------------------

test('plex counts streams and transcodes, writes a display sentence and sends its token', async () => {
  await withUpstream((_req, res) => json(res, { MediaContainer: { size: 2, Metadata: [{ TranscodeSession: {} }, {}] } }), async (url, requests) => {
    const out = await runner({ RACK_PLEX_TOKEN: 'tok' }).run(byId('plex'), target(byId('plex'), url));
    assert.deepEqual(values(out.widget.stats), [['streams', '2'], ['transcode', '1']]);
    assert.deepEqual(out.lines, [{ text: 'Plex is playing to 2 screens', kind: 'activity' }]);
    assert.equal(requests[0]!.url, '/status/sessions');
    assert.equal(requests[0]!.headers['x-plex-token'], 'tok');
    assert.equal(requests[0]!.headers.accept, 'application/json');
  });
});

test('plex with nobody watching says nothing', async () => {
  await withUpstream((_req, res) => json(res, { MediaContainer: { size: 0 } }), async (url) => {
    const out = await runner({ RACK_PLEX_TOKEN: 't' }).run(byId('plex'), target(byId('plex'), url));
    assert.deepEqual(values(out.widget.stats), [['streams', '0'], ['transcodes', '0']]);
    assert.deepEqual(out.lines, []);
  });
});

test('sonarr reports queue, airing today and missing, using its key from the appdata file', async () => {
  const appdata = await tempDir();
  await writeAppdata(appdata, ['sonarr', 'config.xml'], '<Config><ApiKey>file-key</ApiKey></Config>');
  await withUpstream(
    (req, res) => {
      if (req.url!.startsWith('/api/v3/queue')) json(res, { totalRecords: 1234 });
      else if (req.url!.startsWith('/api/v3/calendar')) json(res, [{}, {}, {}]);
      else json(res, { totalRecords: 5 });
    },
    async (url, requests) => {
      const out = await runner({}, appdata).run(byId('sonarr'), target(byId('sonarr'), url));
      assert.equal(out.widget.ok, true);
      assert.deepEqual(values(out.widget.stats), [['in queue', '1,234'], ['airing today', '3'], ['missing', '5']]);
      assert.equal(requests.length, 3);
      assert.ok(requests.every((r) => r.headers['x-api-key'] === 'file-key'));
      assert.ok(requests.some((r) => /^\/api\/v3\/calendar\?start=.+&end=.+/.test(r.url)));
    },
  );
});

test('radarr reports queue and missing from the v3 API', async () => {
  await withUpstream(
    (req, res) => json(res, { totalRecords: req.url!.startsWith('/api/v3/queue') ? 2 : 41 }),
    async (url, requests) => {
      const out = await runner({ RACK_RADARR_API_KEY: 'rk' }).run(byId('radarr'), target(byId('radarr'), url));
      assert.deepEqual(values(out.widget.stats), [['in queue', '2'], ['missing', '41']]);
      assert.deepEqual(out.lines, []);
      assert.deepEqual(requests.map((r) => r.url).sort(), ['/api/v3/queue?pageSize=1', '/api/v3/wanted/missing?pageSize=1']);
      assert.ok(requests.every((r) => r.headers['x-api-key'] === 'rk'));
    },
  );
});

test('prowlarr counts indexers and raises a problem line when some fail', async () => {
  const serve = (failing: number) => (req: { url?: string }, res: Parameters<typeof json>[0]) =>
    json(res, req.url === '/api/v1/indexer' ? [{}, {}, {}, {}] : Array.from({ length: failing }, () => ({})));
  await withUpstream(serve(0), async (url) => {
    const out = await runner({ RACK_PROWLARR_API_KEY: 'k' }).run(byId('prowlarr'), target(byId('prowlarr'), url));
    assert.deepEqual(out.widget.stats.map((s) => [s.label, s.value, s.tone]), [['indexers', '4', 'normal'], ['failing', '0', 'good']]);
    assert.deepEqual(out.lines, []);
  });
  await withUpstream(serve(1), async (url) => {
    const out = await runner({ RACK_PROWLARR_API_KEY: 'k' }).run(byId('prowlarr'), target(byId('prowlarr'), url));
    assert.equal(out.widget.stats[1]!.tone, 'warn');
    assert.deepEqual(out.lines, [{ text: 'Prowlarr has 1 failing indexer', kind: 'problem' }]);
  });
  await withUpstream(serve(3), async (url) => {
    const out = await runner({ RACK_PROWLARR_API_KEY: 'k' }).run(byId('prowlarr'), target(byId('prowlarr'), url));
    assert.deepEqual(out.lines, [{ text: 'Prowlarr has 3 failing indexers', kind: 'problem' }]);
  });
});

test('seerr shows waiting requests as a warning and a sentence', async () => {
  await withUpstream((_req, res) => json(res, { pending: 3, processing: 1, available: 128 }), async (url, requests) => {
    const out = await runner({ RACK_SEERR_API_KEY: 'sk' }).run(byId('seerr'), target(byId('seerr'), url));
    assert.deepEqual(out.widget.stats.map((s) => [s.label, s.value, s.tone]), [['waiting', '3', 'warn'], ['processing', '1', 'normal'], ['available', '128', 'good']]);
    assert.deepEqual(out.lines, [{ text: '3 requests are waiting in Seerr', kind: 'activity' }]);
    assert.equal(requests[0]!.url, '/api/v1/request/count');
    assert.equal(requests[0]!.headers['x-api-key'], 'sk');
  });
  await withUpstream((_req, res) => json(res, { pending: 1 }), async (url) => {
    const out = await runner({ RACK_SEERR_API_KEY: 'sk' }).run(byId('seerr'), target(byId('seerr'), url));
    assert.deepEqual(out.lines, [{ text: '1 request is waiting in Seerr', kind: 'activity' }]);
  });
  await withUpstream((_req, res) => json(res, {}), async (url) => {
    const out = await runner({ RACK_SEERR_API_KEY: 'sk' }).run(byId('seerr'), target(byId('seerr'), url));
    assert.deepEqual(out.lines, []);
    assert.equal(out.widget.stats[0]!.tone, 'normal');
  });
});

test('immich formats library counts and storage, sending its key in x-api-key', async () => {
  await withUpstream((_req, res) => json(res, { photos: 18204, videos: 1320, usage: 443_000_000_000 }), async (url, requests) => {
    const out = await runner({ RACK_IMMICH_API_KEY: 'ik' }).run(byId('immich'), target(byId('immich'), url));
    assert.deepEqual(values(out.widget.stats), [['photos', '18,204'], ['videos', '1,320'], ['stored', '413 GB']]);
    assert.equal(requests[0]!.url, '/api/server/statistics');
    assert.equal(requests[0]!.headers['x-api-key'], 'ik');
  });
});

test('flaresolverr says ready with its version, or not ready as a warning', async () => {
  await withUpstream((_req, res) => json(res, { msg: 'FlareSolverr is ready!', version: '3.3.21' }), async (url) => {
    const out = await runner().run(byId('flaresolverr'), target(byId('flaresolverr'), url));
    assert.deepEqual(out.widget.stats, [{ label: 'ready', value: 'v3.3.21', tone: 'good' }]);
  });
  await withUpstream((_req, res) => json(res, { msg: 'starting' }), async (url) => {
    const out = await runner().run(byId('flaresolverr'), target(byId('flaresolverr'), url));
    assert.deepEqual(out.widget.stats, [{ label: 'not ready', value: '', tone: 'warn' }]);
  });
});

test('netdata reports alarms and turns them into problem sentences, critical first', async () => {
  const serve = (alarms: object) => (_req: unknown, res: Parameters<typeof json>[0]) => json(res, { alarms });
  await withUpstream(serve({ normal: 30, warning: 0, critical: 0 }), async (url, requests) => {
    const out = await runner().run(byId('netdata'), target(byId('netdata'), url));
    assert.deepEqual(out.widget.stats.map((s) => [s.label, s.value, s.tone]), [['critical', '0', 'good'], ['warnings', '0', 'good']]);
    assert.deepEqual(out.lines, []);
    assert.equal(requests[0]!.url, '/api/v1/info');
  });
  await withUpstream(serve({ warning: 2, critical: 1 }), async (url) => {
    const out = await runner().run(byId('netdata'), target(byId('netdata'), url));
    assert.equal(out.widget.stats[0]!.tone, 'bad');
    assert.deepEqual(out.lines, [{ text: 'Netdata has 1 critical alarm', kind: 'problem' }]);
  });
  await withUpstream(serve({ warning: 2 }), async (url) => {
    const out = await runner().run(byId('netdata'), target(byId('netdata'), url));
    assert.deepEqual(out.lines, [{ text: 'Netdata has 2 warnings', kind: 'problem' }]);
  });
  await withUpstream(serve({ warning: 1 }), async (url) => {
    const out = await runner().run(byId('netdata'), target(byId('netdata'), url));
    assert.deepEqual(out.lines, [{ text: 'Netdata has 1 warning', kind: 'problem' }]);
  });
});

// ---- qBittorrent ------------------------------------------------------------------------------

const LOGIN = { RACK_QBITTORRENT_USERNAME: 'me', RACK_QBITTORRENT_PASSWORD: 'pw' };
const qb = byId('qbittorrent');

test('qBittorrent works without credentials when auth is bypassed, sending Referer and Origin', async () => {
  await withUpstream(
    (req, res) => (req.url === '/api/v2/transfer/info' ? json(res, { dl_info_speed: 13_002_342, up_info_speed: 1024 }) : json(res, [{}, {}])),
    async (url, requests) => {
      const out = await runner().run(qb, target(qb, url));
      assert.equal(out.widget.ok, true);
      assert.deepEqual(out.lines, [{ text: 'qBittorrent is pulling 12.4 MB/s', kind: 'activity' }]);
      assert.equal(out.widget.meter!.value, 1);
      assert.equal(requests[0]!.headers.referer, `${url}/`);
      assert.equal(requests[0]!.headers.origin, url);
    },
  );
});

test('qBittorrent logs in on 403 and reuses the session cookie across runs', async () => {
  await withUpstream(
    (req, res, body) => {
      if (req.url === '/api/v2/auth/login') {
        assert.equal(body, 'username=me&password=pw');
        res.writeHead(200, { 'Set-Cookie': 'SID=abc; HttpOnly; path=/' }).end('Ok.');
      } else if (req.headers.cookie !== 'SID=abc') res.writeHead(403).end('Forbidden');
      else if (req.url === '/api/v2/transfer/info') json(res, { dl_info_speed: 0, up_info_speed: 0 });
      else json(res, []);
    },
    async (url, requests) => {
      const shared = runner(LOGIN);
      const first = await shared.run(qb, target(qb, url));
      assert.equal(first.widget.ok, true);
      assert.deepEqual(first.lines, []);
      const logins = () => requests.filter((r) => r.url === '/api/v2/auth/login').length;
      assert.equal(logins(), 1);
      await shared.run(qb, target(qb, url));
      assert.equal(logins(), 1);
    },
  );
});

test('qBittorrent 5.2 login (204 with a QBT_SID_<port> cookie) is accepted', async () => {
  await withUpstream(
    (req, res) => {
      if (req.url === '/api/v2/auth/login') res.writeHead(204, { 'Set-Cookie': 'QBT_SID_8080=abc; HttpOnly; path=/' }).end();
      else if (req.headers.cookie !== 'QBT_SID_8080=abc') res.writeHead(403).end('Forbidden');
      else if (req.url === '/api/v2/transfer/info') json(res, { dl_info_speed: 0, up_info_speed: 0 });
      else json(res, []);
    },
    async (url) => {
      assert.equal((await runner(LOGIN).run(qb, target(qb, url))).widget.ok, true);
    },
  );
});

test('qBittorrent without credentials asks for both env vars when auth is required', async () => {
  await withUpstream((_req, res) => res.writeHead(403).end(), async (url) => {
    const out = await runner().run(qb, target(qb, url));
    assert.equal(out.widget.error, 'Add RACK_QBITTORRENT_USERNAME and RACK_QBITTORRENT_PASSWORD to .env to see download stats');
  });
});

test('qBittorrent with a wrong password says the credentials were not accepted', async () => {
  await withUpstream((_req, res) => res.writeHead(403).end('Fails.'), async (url) => {
    const out = await runner(LOGIN).run(qb, target(qb, url));
    assert.equal(out.widget.error, 'qBittorrent did not accept the credentials; check RACK_QBITTORRENT_USERNAME and RACK_QBITTORRENT_PASSWORD');
    assert.ok(!JSON.stringify(out).includes('pw'));
  });
});

test('qBittorrent scales the meter against the fastest recent speed, per service', async () => {
  let speed = 20e6;
  await withUpstream(
    (req, res) => (req.url === '/api/v2/transfer/info' ? json(res, { dl_info_speed: speed, up_info_speed: 0 }) : json(res, [{}])),
    async (url) => {
      const shared = runner();
      assert.equal((await shared.run(qb, target(qb, url))).widget.meter!.value, 1);
      speed = 5e6;
      assert.equal((await shared.run(qb, target(qb, url))).widget.meter!.value, 0.25);
      const other = await shared.run(qb, { serviceId: 'second', name: 'qBittorrent', baseUrl: url });
      assert.equal(other.widget.meter!.value, 1);
    },
  );
});

// ---- what the numbers mean --------------------------------------------------------------------

test('each app says for itself whether it is busy or needs a look', async () => {
  const facts = async (id: string, vars: Record<string, string>, handler: Parameters<typeof fakeServer>[0]) =>
    withUpstream(handler, async (url) => {
      const { widget } = await runner(vars).run(byId(id), target(byId(id), url));
      return [widget.busy, widget.attention];
    });

  const plex = (size: number) => (_req: unknown, res: Parameters<typeof json>[0]) => json(res, { MediaContainer: { size, Metadata: Array.from({ length: size }, () => ({})) } });
  assert.deepEqual(await facts('plex', { RACK_PLEX_TOKEN: 't' }, plex(0)), [false, false]);
  assert.deepEqual(await facts('plex', { RACK_PLEX_TOKEN: 't' }, plex(1)), [true, false]);

  const arr = (queue: number) => (_req: unknown, res: Parameters<typeof json>[0]) => json(res, { totalRecords: queue });
  assert.deepEqual(await facts('radarr', { RACK_RADARR_API_KEY: 'k' }, arr(0)), [false, false]);
  assert.deepEqual(await facts('radarr', { RACK_RADARR_API_KEY: 'k' }, arr(2)), [true, false]);

  const seerr = (pending: number) => (_req: unknown, res: Parameters<typeof json>[0]) => json(res, { pending, processing: 4 });
  assert.deepEqual(await facts('seerr', { RACK_SEERR_API_KEY: 'k' }, seerr(0)), [false, false]);
  assert.deepEqual(await facts('seerr', { RACK_SEERR_API_KEY: 'k' }, seerr(2)), [true, true]);

  const prowlarr = (failing: number) => (req: { url?: string }, res: Parameters<typeof json>[0]) =>
    json(res, req.url === '/api/v1/indexer' ? [{}, {}] : Array.from({ length: failing }, () => ({})));
  assert.deepEqual(await facts('prowlarr', { RACK_PROWLARR_API_KEY: 'k' }, prowlarr(0)), [false, false]);
  assert.deepEqual(await facts('prowlarr', { RACK_PROWLARR_API_KEY: 'k' }, prowlarr(1)), [false, true]);

  const netdata = (alarms: object) => (_req: unknown, res: Parameters<typeof json>[0]) => json(res, { alarms });
  assert.deepEqual(await facts('netdata', {}, netdata({ warning: 0, critical: 0 })), [false, false]);
  assert.deepEqual(await facts('netdata', {}, netdata({ warning: 1 })), [false, true]);
  assert.deepEqual(await facts('netdata', {}, netdata({ critical: 1 })), [false, true]);

  const flare = (msg: string) => (_req: unknown, res: Parameters<typeof json>[0]) => json(res, { msg, version: '3' });
  assert.deepEqual(await facts('flaresolverr', {}, flare('FlareSolverr is ready!')), [false, false]);
  assert.deepEqual(await facts('flaresolverr', {}, flare('starting')), [false, true]);

  const qbt = (speed: number, active: number) => (req: { url?: string }, res: Parameters<typeof json>[0]) =>
    req.url === '/api/v2/transfer/info' ? json(res, { dl_info_speed: speed, up_info_speed: 0 }) : json(res, Array.from({ length: active }, () => ({})));
  assert.deepEqual(await facts('qbittorrent', {}, qbt(0, 0)), [false, false]);
  assert.deepEqual(await facts('qbittorrent', {}, qbt(0, 1)), [true, false]);
  assert.deepEqual(await facts('qbittorrent', {}, qbt(5_000_000, 0)), [true, false]);
});

test('a widget that could not run is neither busy nor in need of a look', async () => {
  const out = await runner().run(byId('plex'), target(byId('plex'), 'http://127.0.0.1:1'));
  assert.equal(out.widget.ok, false);
  assert.deepEqual([out.widget.busy, out.widget.attention], [false, false]);
});

test('only Plex and qBittorrent are featured', () => {
  assert.deepEqual(APPS.filter((a) => a.featured).map((a) => a.id), ['plex', 'qbittorrent']);
});
