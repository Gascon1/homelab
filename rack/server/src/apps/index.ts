import { flaresolverr } from './flaresolverr.ts';
import { immich } from './immich.ts';
import { netdata } from './netdata.ts';
import { plex } from './plex.ts';
import { prowlarr } from './prowlarr.ts';
import { qbittorrent } from './qbittorrent.ts';
import { radarr } from './radarr.ts';
import { seerr } from './seerr.ts';
import { sonarr } from './sonarr.ts';
import type { App } from './types.ts';

export { AppRunner, envCredentials, failedWidget, unknownWidget, type CredentialLookup, type WidgetOutcome } from './run.ts';
export { request } from './http.ts';
export type { App, DisplayLine, HttpPort, RawResponse } from './types.ts';

/** Every app Rack knows. Order matters: the first match wins and the demo plays them in this order. */
export const APPS: App[] = [plex, seerr, sonarr, radarr, prowlarr, qbittorrent, flaresolverr, immich, netdata];

export const DEFAULT_GROUP_ORDER = ['Media', 'Downloads', 'Photos', 'System'];

/** "ghcr.io/immich-app/immich-server:release@sha256:..." becomes "immich-server". */
export function imageBaseName(image: string): string {
  const withoutDigest = image.split('@')[0] ?? image;
  const last = withoutDigest.split('/').pop() ?? withoutDigest;
  return last.split(':')[0]!.toLowerCase();
}

/** The app behind a compose service id or an image name, if Rack knows it. */
export function findApp(serviceId: string, image: string): App | null {
  const keys = [serviceId.toLowerCase(), imageBaseName(image)];
  for (const key of keys) {
    const hit = APPS.find((app) => app.match.includes(key));
    if (hit) return hit;
  }
  return null;
}

/** The app that answers to a widget type such as "sonarr" (from rack.yml or a `rack.widget` label). */
export function appForWidget(type: string): App | null {
  return APPS.find((app) => app.id === type && app.widget) ?? null;
}

/** Another icon slug to try when this one has no image on the CDN. */
export function iconFallback(slug: string): string | undefined {
  return APPS.find((app) => app.icon === slug)?.iconFallback;
}
