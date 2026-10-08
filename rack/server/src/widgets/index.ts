import { flaresolverr } from './flaresolverr.ts';
import { immich } from './immich.ts';
import { netdata } from './netdata.ts';
import { plex } from './plex.ts';
import { createQbittorrent } from './qbittorrent.ts';
import { prowlarr, radarr, sonarr } from './arr.ts';
import { seerr } from './seerr.ts';
import type { WidgetModule } from './types.ts';

export function createWidgetRegistry(): Map<string, WidgetModule> {
  const modules = [plex, seerr, sonarr, radarr, prowlarr, createQbittorrent(), flaresolverr, immich, netdata];
  return new Map(modules.map((m) => [m.type, m]));
}
