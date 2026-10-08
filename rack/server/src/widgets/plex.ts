import { SECRET_ENV } from '../credentials.ts';
import { formatCount, plural } from '../format.ts';
import { getJson } from './http.ts';
import { MissingCredential, type WidgetModule } from './types.ts';

interface Sessions {
  MediaContainer?: { size?: number; Metadata?: { TranscodeSession?: unknown }[] };
}

export const plex: WidgetModule = {
  type: 'plex',
  intervalMs: 10_000,
  credentialHint: SECRET_ENV.plex,
  async fetch({ baseUrl, secrets }) {
    const token = secrets.get('plex');
    if (!token) throw new MissingCredential(SECRET_ENV.plex, 'who is watching');
    const data = await getJson<Sessions>(`${baseUrl}/status/sessions`, { 'X-Plex-Token': token });
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
};
