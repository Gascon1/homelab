export const WIDGET_TIMEOUT_MS = 5000;

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number) {
    super(`HTTP ${status}`);
    this.status = status;
  }
}

export interface RawResponse {
  status: number;
  headers: Headers;
  body: string;
}

export interface RequestOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Performs a request with a 5 s budget covering the body too. Does not throw on non-2xx. */
export async function request(url: string, options: RequestOptions = {}): Promise<RawResponse> {
  const res = await fetch(url, { ...options, signal: AbortSignal.timeout(WIDGET_TIMEOUT_MS), redirect: 'manual' });
  return { status: res.status, headers: res.headers, body: await res.text() };
}

export async function getJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await request(url, { headers: { Accept: 'application/json', ...headers } });
  if (res.status < 200 || res.status >= 300) throw new HttpError(res.status);
  return JSON.parse(res.body) as T;
}
