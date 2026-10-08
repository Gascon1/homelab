import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

export interface StaticFile {
  status: 200 | 404;
  contentType: string;
  cacheControl: string;
  body: Buffer;
}

const NOT_FOUND: StaticFile = {
  status: 404,
  contentType: 'text/plain; charset=utf-8',
  cacheControl: 'no-store',
  body: Buffer.from('Not found'),
};

/** Maps a URL path to a file inside root, or null if it would escape root. */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const full = normalize(join(root, decoded));
  const base = normalize(root);
  return full === base || full.startsWith(base + sep) ? full : null;
}

async function readFileIfPresent(path: string): Promise<Buffer | null> {
  try {
    if (!(await stat(path)).isFile()) return null;
    return await readFile(path);
  } catch {
    return null;
  }
}

/** Serves a file from root; unknown paths without a file extension fall back to index.html (SPA). */
export async function serveStatic(root: string, urlPath: string): Promise<StaticFile> {
  const target = resolveInside(root, urlPath);
  if (!target) return NOT_FOUND;

  const direct = await readFileIfPresent(target);
  if (direct) {
    const ext = extname(target).toLowerCase();
    return {
      status: 200,
      contentType: TYPES[ext] ?? 'application/octet-stream',
      cacheControl: urlPath.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
      body: direct,
    };
  }

  if (extname(urlPath) !== '') return NOT_FOUND;
  const index = await readFileIfPresent(join(root, 'index.html'));
  return index
    ? { status: 200, contentType: TYPES['.html']!, cacheControl: 'no-cache', body: index }
    : NOT_FOUND;
}
