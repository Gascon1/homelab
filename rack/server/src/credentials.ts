import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export type SecretKey = 'plex' | 'sonarr' | 'radarr' | 'prowlarr' | 'seerr' | 'immich';

export const SECRET_ENV: Record<SecretKey, string> = {
  plex: 'RACK_PLEX_TOKEN',
  sonarr: 'RACK_SONARR_API_KEY',
  radarr: 'RACK_RADARR_API_KEY',
  prowlarr: 'RACK_PROWLARR_API_KEY',
  seerr: 'RACK_SEERR_API_KEY',
  immich: 'RACK_IMMICH_API_KEY',
};

export const parseArrApiKey = (xml: string): string | null => xml.match(/<ApiKey>\s*([^<\s]+)\s*<\/ApiKey>/)?.[1] ?? null;

export const parsePlexToken = (xml: string): string | null => xml.match(/PlexOnlineToken="([^"]+)"/)?.[1] ?? null;

export function parseSeerrKey(json: string): string | null {
  try {
    const key = (JSON.parse(json) as { main?: { apiKey?: unknown } }).main?.apiKey;
    return typeof key === 'string' && key ? key : null;
  } catch {
    return null;
  }
}

const DISCOVERY: Partial<Record<SecretKey, { file: string[]; parse: (text: string) => string | null }>> = {
  sonarr: { file: ['sonarr', 'config.xml'], parse: parseArrApiKey },
  radarr: { file: ['radarr', 'config.xml'], parse: parseArrApiKey },
  prowlarr: { file: ['prowlarr', 'config.xml'], parse: parseArrApiKey },
  plex: { file: ['plex', 'Library', 'Application Support', 'Plex Media Server', 'Preferences.xml'], parse: parsePlexToken },
  seerr: { file: ['seerr', 'settings.json'], parse: parseSeerrKey },
};

/** Looks up secrets from the environment first, then from the read-only appdata mounts. Files are re-read on every call so new keys are picked up. */
export class Secrets {
  private readonly vars: Record<string, string | undefined>;
  private readonly appdataDir: string;

  constructor(vars: Record<string, string | undefined>, appdataDir: string) {
    this.vars = vars;
    this.appdataDir = appdataDir;
  }

  get(key: SecretKey): string | null {
    const fromEnv = this.vars[SECRET_ENV[key]]?.trim();
    if (fromEnv) return fromEnv;
    const source = DISCOVERY[key];
    if (!source) return null;
    try {
      return source.parse(readFileSync(join(this.appdataDir, ...source.file), 'utf8'));
    } catch {
      return null;
    }
  }

  qbittorrentLogin(): { username: string; password: string } | null {
    const username = this.vars.RACK_QBITTORRENT_USERNAME;
    const password = this.vars.RACK_QBITTORRENT_PASSWORD;
    return username && password ? { username, password } : null;
  }
}
