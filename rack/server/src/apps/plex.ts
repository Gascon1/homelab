import { formatCount, plural } from '../format.ts';
import { secretFinder } from './credentials.ts';
import { getJson } from './http.ts';
import { defineWidget, type App } from './types.ts';

interface Sessions {
  MediaContainer?: { size?: number; Metadata?: { TranscodeSession?: unknown }[] };
}

const TOKEN_ENV = 'RACK_PLEX_TOKEN';
const parsePlexToken = (xml: string): string | null => xml.match(/PlexOnlineToken="([^"]+)"/)?.[1] ?? null;

/** Seconds into a four-minute loop; plex streams come and go. */
const STREAMS = [0, 0, 1, 2, 2, 1, 0, 0];

export const plex: App = {
  id: 'plex',
  match: ['plex'],
  name: 'Plex',
  group: 'Media',
  icon: 'plex',
  path: '/web',
  port: 32400,
  widget: defineWidget<string>({
    intervalMs: 10_000,
    credential: {
      hint: TOKEN_ENV,
      purpose: 'who is watching',
      find: secretFinder(TOKEN_ENV, {
        path: ['plex', 'Library', 'Application Support', 'Plex Media Server', 'Preferences.xml'],
        parse: parsePlexToken,
      }),
    },
    async fetch({ baseUrl, credential, http }) {
      const data = await getJson<Sessions>(http, `${baseUrl}/status/sessions`, { 'X-Plex-Token': credential });
      const sessions = data.MediaContainer?.Metadata ?? [];
      const streams = sessions.length || data.MediaContainer?.size || 0;
      const transcodes = sessions.filter((s) => s.TranscodeSession).length;
      return {
        stats: [
          { label: streams === 1 ? 'stream' : 'streams', value: formatCount(streams), tone: streams > 0 ? 'good' : 'normal' },
          { label: transcodes === 1 ? 'transcode' : 'transcodes', value: formatCount(transcodes), tone: 'normal' },
        ],
        lines: streams > 0 ? [{ text: `Plex is playing to ${plural(streams, 'screen')}`, kind: 'activity' }] : [],
      };
    },
  }),
  demo: {
    image: 'lscr.io/linuxserver/plex:latest',
    baseLatencyMs: 38,
    credential: 'demo',
    serve({ path, seconds }) {
      if (path !== '/status/sessions') return null;
      const streams = STREAMS[Math.floor((seconds % 240) / 30)]!;
      return {
        MediaContainer: {
          size: streams,
          Metadata: Array.from({ length: streams }, (_, i) => (streams === 2 && i === 0 ? { TranscodeSession: {} } : {})),
        },
      };
    },
  },
};
