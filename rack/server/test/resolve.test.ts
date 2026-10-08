import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageBaseName } from '../src/catalog.ts';
import { validateConfig } from '../src/config.ts';
import { derivePorts } from '../src/docker.ts';
import { compareGroups, resolveServices } from '../src/resolve.ts';
import { container, tcp } from './helpers.ts';

const noConfig = validateConfig(null).config;

test('image names are reduced to the app name', () => {
  assert.equal(imageBaseName('ghcr.io/immich-app/immich-server:release'), 'immich-server');
  assert.equal(imageBaseName('lscr.io/linuxserver/plex@sha256:abc'), 'plex');
  assert.equal(imageBaseName('netdata/netdata:stable'), 'netdata');
});

test('rack.enable alone is enough: the catalog fills in the rest', () => {
  const [plex] = resolveServices(
    [container({ name: 'plex', image: 'lscr.io/linuxserver/plex:latest', labels: { 'rack.enable': 'true' }, ports: [tcp(32400, 32400), tcp(32469, 32469)] })],
    noConfig,
  );
  assert.equal(plex!.name, 'Plex');
  assert.equal(plex!.group, 'Media');
  assert.equal(plex!.path, '/web');
  assert.equal(plex!.widget, 'plex');
  assert.equal(plex!.port, 32400);
  assert.equal(plex!.internal, 'http://plex:32400');
});

test('service id comes from the compose service, not the container name', () => {
  const [immich] = resolveServices(
    [container({ name: 'immich_server', image: 'x/y:1', composeService: 'immich-server', labels: { 'rack.enable': 'true' }, ports: [tcp(2283, 2283)] })],
    noConfig,
  );
  assert.equal(immich!.id, 'immich-server');
  assert.equal(immich!.name, 'Immich');
  assert.equal(immich!.internal, 'http://immich_server:2283');
});

test('rack.yml beats labels and labels beat the catalog', () => {
  const containers = [
    container({
      name: 'sonarr',
      labels: { 'rack.enable': 'true', 'rack.name': 'TV', 'rack.group': 'Media', 'rack.widget': 'none', 'rack.order': '4' },
      ports: [tcp(8989, 8989)],
    }),
  ];
  const [fromLabels] = resolveServices(containers, noConfig);
  assert.equal(fromLabels!.name, 'TV');
  assert.equal(fromLabels!.group, 'Media');
  assert.equal(fromLabels!.widget, null);
  assert.equal(fromLabels!.order, 4);

  const { config } = validateConfig({ services: { sonarr: { name: 'Shows', widget: 'sonarr', order: 1 } } });
  const [fromYaml] = resolveServices(containers, config);
  assert.equal(fromYaml!.name, 'Shows');
  assert.equal(fromYaml!.group, 'Media');
  assert.equal(fromYaml!.widget, 'sonarr');
  assert.equal(fromYaml!.order, 1);
});

test('unknown apps get a title-cased name, group Other and their id as icon', () => {
  const [app] = resolveServices([container({ name: 'my-cool_app', labels: { 'rack.enable': 'true' } })], noConfig);
  assert.equal(app!.name, 'My Cool App');
  assert.equal(app!.group, 'Other');
  assert.equal(app!.icon, 'my-cool_app');
  assert.equal(app!.widget, null);
});

test('containers without the label are ignored; rack.yml entries without a container are static', () => {
  const { config } = validateConfig({ services: { nas: { name: 'NAS', group: 'System', url: 'http://10.0.0.5:5000' } } });
  const result = resolveServices([container({ name: 'hidden-thing' })], config);
  assert.deepEqual(result.map((s) => s.id), ['nas']);
  assert.equal(result[0]!.container, null);
  assert.equal(result[0]!.internal, 'http://10.0.0.5:5000');
});

test('hidden services are dropped', () => {
  const { config } = validateConfig({ services: { plex: { hidden: true } } });
  assert.equal(resolveServices([container({ name: 'plex', labels: { 'rack.enable': 'true' } })], config).length, 0);
});

test('labels for link and health check: rack.url, rack.internal, rack.path', () => {
  const [svc] = resolveServices(
    [container({ name: 'a', labels: { 'rack.enable': 'true', 'rack.url': 'http://a.lan', 'rack.internal': 'http://a:9', 'rack.path': '/x' } })],
    noConfig,
  );
  assert.equal(svc!.url, 'http://a.lan');
  assert.equal(svc!.internal, 'http://a:9');
  assert.equal(svc!.path, '/x');
});

test('derivePorts: lowest published TCP port by default, ignoring UDP and IPv6 duplicates', () => {
  const ports = [
    { PrivatePort: 6881, PublicPort: 6881, Type: 'udp' },
    tcp(9000, 80),
    tcp(9000, 80),
    tcp(8100, 8080),
  ];
  assert.deepEqual(derivePorts(ports, null, null), { publicPort: 8100, privatePort: 8080 });
});

test('derivePorts: explicit port, app default, and nothing published', () => {
  const ports = [tcp(6881, 6881), tcp(8181, 80)];
  assert.deepEqual(derivePorts(ports, 8181, null), { publicPort: 8181, privatePort: 80 });
  assert.deepEqual(derivePorts(ports, null, 80), { publicPort: 8181, privatePort: 80 });
  assert.deepEqual(derivePorts(ports, 7000, null), { publicPort: 7000, privatePort: 7000 });
  assert.deepEqual(derivePorts([{ PrivatePort: 3000, Type: 'tcp' }], null, null), { publicPort: null, privatePort: 3000 });
  assert.deepEqual(derivePorts([], null, null), { publicPort: null, privatePort: null });
});

test('group order: configured first, then Media, Downloads, Photos, System, then alphabetical', () => {
  const names = ['Zeta', 'System', 'Alpha', 'Media', 'Photos', 'Downloads'];
  assert.deepEqual([...names].sort(compareGroups([])), ['Media', 'Downloads', 'Photos', 'System', 'Alpha', 'Zeta']);
  assert.deepEqual([...names].sort(compareGroups(['Photos', 'Zeta'])), ['Photos', 'Zeta', 'Media', 'Downloads', 'System', 'Alpha']);
});
