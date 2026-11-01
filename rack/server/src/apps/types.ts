import type { Stat } from '../types.ts';

export interface DisplayLine {
  text: string;
  kind: 'problem' | 'activity';
}

/** What an app's widget returns on success; the runner wraps it into a Widget. */
export interface WidgetData {
  stats: Stat[];
  meter?: { label: string; value: number };
  lines?: DisplayLine[];
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

/** The seam for talking to an app over HTTP: the real network, a demo, or a test double. */
export type HttpPort = (url: string, options?: RequestOptions) => Promise<RawResponse>;

/** Where credentials are looked up: the environment first, then the read-only appdata mounts. */
export interface CredentialSource {
  vars: Record<string, string | undefined>;
  appdataDir: string;
}

/** How one app's credential is found, and how it is described to the user. */
export interface Credential<C> {
  /** Env var(s) named in "check ..." sentences. */
  hint: string;
  /** What the credential unlocks, as in "Add ... to .env to see <purpose>". */
  purpose: string;
  /** When true, fetch runs even without a credential and decides whether it needs one (throw MissingCredential). */
  optional?: boolean;
  find(source: CredentialSource): C | null;
}

export interface WidgetContext<C> {
  serviceId: string;
  /** Display name, used in error sentences. */
  name: string;
  baseUrl: string;
  /** Found by the runner. Null only for apps whose credential is optional or that have none. */
  credential: C;
  http: HttpPort;
  /** Scratch space that lives as long as the service, for sessions and rolling windows. */
  memory: Record<string, unknown>;
}

export interface AppWidget<C = unknown> {
  intervalMs: number;
  credential?: Credential<C>;
  fetch(ctx: WidgetContext<C>): Promise<WidgetData>;
}

/** Fixtures that let the demo play this app without a real upstream. */
export interface AppDemo {
  image: string;
  /** Typical response time in the demo. */
  baseLatencyMs: number;
  /** Docker health status shown on the container, if the image has a healthcheck. */
  containerHealth?: string;
  /** Stand-in credential, so the widget runs. */
  credential?: unknown;
  /** Periods when the app misbehaves. */
  outage?(seconds: number): 'down' | 'slow' | null;
  /** The JSON the real app would answer with; null for a path the app does not have. */
  serve(request: { method: string; path: string; seconds: number }): unknown;
}

/** Everything Rack knows about one app. Add or change an app by editing its module only. */
export interface App {
  /** Also the widget type named in rack.yml and `rack.widget`. */
  id: string;
  /** Matched against the compose service id and the image name. */
  match: string[];
  name: string;
  group: string;
  icon: string;
  /** Icon to try when `icon` has no image on the CDN. */
  iconFallback?: string;
  path?: string;
  /** The app's default port inside its container. */
  port?: number;
  /** Null for apps Rack lists but cannot read. */
  widget: AppWidget | null;
  demo?: AppDemo;
}

/** Thrown by a widget that cannot work without a credential the user has not provided. */
export class MissingCredential extends Error {
  constructor() {
    super('missing credential');
  }
}

/** Types a widget's credential once, then erases it so apps with different credentials share one list. */
export function defineWidget<C>(widget: AppWidget<C>): AppWidget {
  return widget as AppWidget;
}
