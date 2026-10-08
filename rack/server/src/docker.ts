import http from 'node:http';

export interface PortMapping {
  PrivatePort: number;
  PublicPort?: number;
  Type?: string;
}

export interface ContainerInfo {
  id: string;
  name: string;
  image: string;
  state: string;
  health: string | null;
  startedAt: string | null;
  labels: Record<string, string>;
  ports: PortMapping[];
  /** com.docker.compose.service, if any. */
  composeService: string | null;
}

export class DockerUnavailable extends Error {
  /** A sentence fit for state.warnings. */
  readonly warning: string;
  constructor(warning: string) {
    super(warning);
    this.warning = warning;
  }
}

function getJson<T>(socketPath: string, path: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: 'GET', timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        if ((res.statusCode ?? 500) >= 400) return reject(new Error(`Docker answered HTTP ${res.statusCode}`));
        try {
          resolve(JSON.parse(body) as T);
        } catch {
          reject(new Error('Docker sent a reply Rack could not read'));
        }
      });
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('Docker took too long to answer')));
    req.on('error', reject);
    req.end();
  });
}

function explain(err: unknown, socketPath: string): DockerUnavailable {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === 'ENOENT') {
    return new DockerUnavailable(
      `Docker is not reachable (no socket at ${socketPath}), so only services listed in rack.yml are shown`,
    );
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new DockerUnavailable(
      `Rack is not allowed to read the Docker socket at ${socketPath}, so only services listed in rack.yml are shown`,
    );
  }
  const reason = err instanceof Error ? err.message : 'unknown error';
  return new DockerUnavailable(`Docker is not answering (${reason}), so container information may be out of date`);
}

interface ListedContainer {
  Id: string;
  Names?: string[];
  Image?: string;
  State?: string;
  Labels?: Record<string, string> | null;
  Ports?: PortMapping[];
}

interface InspectedContainer {
  State?: { StartedAt?: string; Health?: { Status?: string } };
}

/** Lists containers that opted in with rack.enable (or that rack.yml names), inspecting each for start time and health. */
export async function listContainers(socketPath: string, wantedIds: ReadonlySet<string>): Promise<ContainerInfo[]> {
  let listed: ListedContainer[];
  try {
    listed = await getJson<ListedContainer[]>(socketPath, '/containers/json?all=1');
  } catch (err) {
    throw explain(err, socketPath);
  }

  const relevant = listed.filter((c) => {
    const labels = c.Labels ?? {};
    return labels['rack.enable'] === 'true' || wantedIds.has(labels['com.docker.compose.service'] ?? '');
  });

  return Promise.all(
    relevant.map(async (c): Promise<ContainerInfo> => {
      const labels = c.Labels ?? {};
      let startedAt: string | null = null;
      let health: string | null = null;
      try {
        const detail = await getJson<InspectedContainer>(socketPath, `/containers/${encodeURIComponent(c.Id)}/json`);
        const started = detail.State?.StartedAt;
        startedAt = started && !started.startsWith('0001') ? started : null;
        health = detail.State?.Health?.Status ?? null;
      } catch {
        // Start time and health are nice to have; the list result is enough.
      }
      return {
        id: c.Id,
        name: (c.Names?.[0] ?? c.Id).replace(/^\//, ''),
        image: c.Image ?? '',
        state: c.State ?? 'unknown',
        health,
        startedAt,
        labels,
        ports: c.Ports ?? [],
        composeService: labels['com.docker.compose.service'] ?? null,
      };
    }),
  );
}

export interface DerivedPorts {
  /** Port the browser uses (published on the host). */
  publicPort: number | null;
  /** Port inside the container, used for the internal URL. */
  privatePort: number | null;
}

/**
 * Picks the link port and the matching container port.
 * Preference: explicit public port, then the app's default container port if published,
 * then the lowest published TCP port. With nothing published, falls back to the default
 * or lowest exposed port for the internal URL only.
 */
export function derivePorts(
  ports: PortMapping[],
  explicitPublic: number | null,
  defaultPrivate: number | null,
): DerivedPorts {
  const tcp = ports.filter((p) => (p.Type ?? 'tcp') === 'tcp');
  const published = tcp.filter((p) => p.PublicPort).sort((a, b) => a.PublicPort! - b.PublicPort!);

  if (explicitPublic !== null) {
    const hit = published.find((p) => p.PublicPort === explicitPublic);
    return { publicPort: explicitPublic, privatePort: hit?.PrivatePort ?? explicitPublic };
  }
  const preferred = defaultPrivate === null ? undefined : published.find((p) => p.PrivatePort === defaultPrivate);
  const chosen = preferred ?? published[0];
  if (chosen) return { publicPort: chosen.PublicPort!, privatePort: chosen.PrivatePort };

  const exposed = tcp.map((p) => p.PrivatePort).sort((a, b) => a - b);
  return { publicPort: null, privatePort: defaultPrivate ?? exposed[0] ?? null };
}
