import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CredentialSource } from './types.ts';

/**
 * Builds a credential lookup: the env var first, then (optionally) a file under the appdata mount.
 * Files are re-read on every call so keys created after Rack started are picked up.
 */
export function secretFinder(
  envVar: string,
  file?: { path: string[]; parse: (text: string) => string | null },
): (source: CredentialSource) => string | null {
  return ({ vars, appdataDir }) => {
    const fromEnv = vars[envVar]?.trim();
    if (fromEnv) return fromEnv;
    if (!file) return null;
    try {
      return file.parse(readFileSync(join(appdataDir, ...file.path), 'utf8'));
    } catch {
      return null;
    }
  };
}
