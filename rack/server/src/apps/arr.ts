import { formatCount } from '../format.ts';
import { secretFinder } from './credentials.ts';
import type { Credential } from './types.ts';

/** Shared by the *arr apps: the same config.xml layout and the same paged-count reply. */
export interface Paged {
  totalRecords?: number;
}

const parseArrApiKey = (xml: string): string | null => xml.match(/<ApiKey>\s*([^<\s]+)\s*<\/ApiKey>/)?.[1] ?? null;

/** The API key lives in the app's own config.xml, under /appdata/<app>/. */
export function arrCredential(app: string, envVar: string): Credential<string> {
  return {
    hint: envVar,
    purpose: 'queue and library stats',
    find: secretFinder(envVar, { path: [app, 'config.xml'], parse: parseArrApiKey }),
  };
}

export const count = (n: number | undefined): string => formatCount(n ?? 0);
