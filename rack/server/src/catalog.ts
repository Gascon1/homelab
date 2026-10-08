export interface CatalogEntry {
  /** Matched against the compose service id and the image name. */
  match: string[];
  name: string;
  group: string;
  icon: string;
  widget: string | null;
  path?: string;
  /** The app's default port inside its container. */
  port?: number;
}

export const CATALOG: CatalogEntry[] = [
  { match: ['plex'], name: 'Plex', group: 'Watch', icon: 'plex', widget: 'plex', path: '/web', port: 32400 },
  { match: ['seerr', 'overseerr', 'jellyseerr'], name: 'Seerr', group: 'Watch', icon: 'seerr', widget: 'seerr', port: 5055 },
  { match: ['sonarr'], name: 'Sonarr', group: 'Fetch', icon: 'sonarr', widget: 'sonarr', port: 8989 },
  { match: ['radarr'], name: 'Radarr', group: 'Fetch', icon: 'radarr', widget: 'radarr', port: 7878 },
  { match: ['prowlarr'], name: 'Prowlarr', group: 'Fetch', icon: 'prowlarr', widget: 'prowlarr', port: 9696 },
  { match: ['qbittorrent'], name: 'qBittorrent', group: 'Fetch', icon: 'qbittorrent', widget: 'qbittorrent', port: 8080 },
  { match: ['flaresolverr'], name: 'FlareSolverr', group: 'Fetch', icon: 'flaresolverr', widget: 'flaresolverr', port: 8191 },
  { match: ['immich-server'], name: 'Immich', group: 'Keep', icon: 'immich', widget: 'immich', port: 2283 },
  { match: ['filebrowser'], name: 'File Browser', group: 'Keep', icon: 'filebrowser', widget: null, port: 80 },
  { match: ['netdata'], name: 'Netdata', group: 'Machine', icon: 'netdata', widget: 'netdata', port: 19999 },
];

/** Used when an icon slug has no image on the CDN. */
export const ICON_FALLBACKS: Record<string, string> = { seerr: 'overseerr' };

export const DEFAULT_GROUP_ORDER = ['Watch', 'Fetch', 'Keep', 'Machine'];

/** "ghcr.io/immich-app/immich-server:release@sha256:..." becomes "immich-server". */
export function imageBaseName(image: string): string {
  const withoutDigest = image.split('@')[0] ?? image;
  const last = withoutDigest.split('/').pop() ?? withoutDigest;
  return last.split(':')[0]!.toLowerCase();
}

export function findCatalogEntry(serviceId: string, image: string): CatalogEntry | null {
  const keys = [serviceId.toLowerCase(), imageBaseName(image)];
  for (const key of keys) {
    const hit = CATALOG.find((entry) => entry.match.includes(key));
    if (hit) return hit;
  }
  return null;
}
