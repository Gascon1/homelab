import type { Secrets } from '../credentials.ts';
import type { Stat } from '../types.ts';

export interface DisplayLine {
  text: string;
  kind: 'problem' | 'activity';
}

/** What a widget module returns on success; the runner wraps it into a Widget. */
export interface WidgetData {
  stats: Stat[];
  meter?: { label: string; value: number };
  lines?: DisplayLine[];
}

export interface WidgetContext {
  serviceId: string;
  /** Display name, used in error sentences. */
  name: string;
  baseUrl: string;
  secrets: Secrets;
}

export interface WidgetModule {
  type: string;
  intervalMs: number;
  /** Env var(s) named in the "credentials rejected" sentence, or null for key-less widgets. */
  credentialHint: string | null;
  fetch(ctx: WidgetContext): Promise<WidgetData>;
}

/** Thrown by a widget that cannot work without a credential the user has not provided. */
export class MissingCredential extends Error {
  readonly envText: string;
  readonly what: string;
  constructor(envText: string, what: string) {
    super(`missing ${envText}`);
    this.envText = envText;
    this.what = what;
  }
}
