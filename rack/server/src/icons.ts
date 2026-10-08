import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ICON_FALLBACKS } from './catalog.ts';

const SLUG = /^[a-z0-9-]+$/;
const MISS_TTL_MS = 60 * 60 * 1000;
const MAX_ICON_BYTES = 1024 * 1024;

export interface Icon {
  contentType: string;
  body: Buffer;
}

export const isValidSlug = (slug: string): boolean => slug.length <= 80 && SLUG.test(slug);

const FORMATS = [
  { dir: 'svg', ext: 'svg', contentType: 'image/svg+xml' },
  { dir: 'png', ext: 'png', contentType: 'image/png' },
] as const;

export class IconStore {
  private readonly cacheDir: string;
  private readonly cdn: string;
  private readonly misses = new Map<string, number>();
  private readonly inflight = new Map<string, Promise<Icon | null>>();

  constructor(configDir: string, cdn: string) {
    this.cacheDir = join(configDir, 'icons');
    this.cdn = cdn;
  }

  /** Returns the icon for a validated slug, or null when it does not exist. */
  get(slug: string): Promise<Icon | null> {
    if (!isValidSlug(slug)) return Promise.resolve(null);
    const missedAt = this.misses.get(slug);
    if (missedAt !== undefined && Date.now() - missedAt < MISS_TTL_MS) return Promise.resolve(null);

    let pending = this.inflight.get(slug);
    if (!pending) {
      pending = this.load(slug).finally(() => this.inflight.delete(slug));
      this.inflight.set(slug, pending);
    }
    return pending;
  }

  private async load(slug: string): Promise<Icon | null> {
    const cached = await this.fromDisk(slug);
    if (cached) return cached;

    const candidates = [slug, ICON_FALLBACKS[slug]].filter((s): s is string => Boolean(s));
    for (const candidate of candidates) {
      for (const format of FORMATS) {
        const body = await this.download(`${this.cdn}/${format.dir}/${candidate}.${format.ext}`);
        if (!body) continue;
        await this.toDisk(slug, format.ext, body);
        return { contentType: format.contentType, body };
      }
    }
    this.misses.set(slug, Date.now());
    return null;
  }

  private async fromDisk(slug: string): Promise<Icon | null> {
    for (const format of FORMATS) {
      try {
        return { contentType: format.contentType, body: await readFile(join(this.cacheDir, `${slug}.${format.ext}`)) };
      } catch {
        // not cached in this format
      }
    }
    return null;
  }

  private async toDisk(slug: string, ext: string, body: Buffer): Promise<void> {
    try {
      await mkdir(this.cacheDir, { recursive: true });
      await writeFile(join(this.cacheDir, `${slug}.${ext}`), body);
    } catch {
      // A read-only or missing config dir only costs us the cache.
    }
  }

  private async download(url: string): Promise<Buffer | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return null;
      const body = Buffer.from(await res.arrayBuffer());
      return body.length > 0 && body.length <= MAX_ICON_BYTES ? body : null;
    } catch {
      return null;
    }
  }
}
