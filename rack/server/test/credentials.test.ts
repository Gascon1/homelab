import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArrApiKey, parsePlexToken, parseSeerrKey, Secrets } from '../src/credentials.ts';
import { tempDir } from './helpers.ts';

test('parsers read the real file formats', () => {
  assert.equal(parseArrApiKey('<Config>\n  <Port>8989</Port>\n  <ApiKey>abc123def</ApiKey>\n</Config>'), 'abc123def');
  assert.equal(parsePlexToken('<Preferences MachineIdentifier="x" PlexOnlineToken="tok-en_1" PlexOnlineUsername="me"/>'), 'tok-en_1');
  assert.equal(parseSeerrKey('{"main":{"apiKey":"seerr-key"},"other":1}'), 'seerr-key');
  assert.equal(parseSeerrKey('not json'), null);
  assert.equal(parseArrApiKey('<Config/>'), null);
});

test('secrets: env first, then appdata files, re-read so late keys are found', async () => {
  const appdata = await tempDir();
  const secrets = new Secrets({ RACK_RADARR_API_KEY: 'from-env' }, appdata);

  assert.equal(secrets.get('sonarr'), null);

  await mkdir(join(appdata, 'sonarr'), { recursive: true });
  await writeFile(join(appdata, 'sonarr', 'config.xml'), '<Config><ApiKey>sonarr-key</ApiKey></Config>');
  await mkdir(join(appdata, 'radarr'), { recursive: true });
  await writeFile(join(appdata, 'radarr', 'config.xml'), '<Config><ApiKey>file-key</ApiKey></Config>');
  const plexDir = join(appdata, 'plex', 'Library', 'Application Support', 'Plex Media Server');
  await mkdir(plexDir, { recursive: true });
  await writeFile(join(plexDir, 'Preferences.xml'), '<Preferences PlexOnlineToken="plex-token"/>');
  await mkdir(join(appdata, 'seerr'), { recursive: true });
  await writeFile(join(appdata, 'seerr', 'settings.json'), '{"main":{"apiKey":"seerr-key"}}');

  assert.equal(secrets.get('sonarr'), 'sonarr-key');
  assert.equal(secrets.get('radarr'), 'from-env');
  assert.equal(secrets.get('plex'), 'plex-token');
  assert.equal(secrets.get('seerr'), 'seerr-key');
  assert.equal(secrets.get('immich'), null);
});

test('qBittorrent login needs both env vars', async () => {
  assert.equal(new Secrets({ RACK_QBITTORRENT_USERNAME: 'a' }, '/nope').qbittorrentLogin(), null);
  assert.deepEqual(new Secrets({ RACK_QBITTORRENT_USERNAME: 'a', RACK_QBITTORRENT_PASSWORD: 'b' }, '/nope').qbittorrentLogin(), { username: 'a', password: 'b' });
});
