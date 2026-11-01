import type { Widget } from '../types.ts';
import { HttpError } from './http.ts';
import { MissingCredential, type App, type CredentialSource, type DisplayLine, type HttpPort } from './types.ts';

export interface WidgetOutcome {
  widget: Widget;
  lines: DisplayLine[];
}

/** Finds the credential an app's widget needs. */
export type CredentialLookup = (app: App) => unknown;

/** Looks credentials up in the environment, then the appdata mounts, as each app declares. */
export function envCredentials(source: CredentialSource): CredentialLookup {
  return (app) => app.widget?.credential?.find(source) ?? null;
}

export interface ServiceTarget {
  serviceId: string;
  /** Display name, used in error sentences. */
  name: string;
  baseUrl: string;
}

function describeFailure(err: unknown, app: App, name: string): string {
  const credential = app.widget?.credential;
  if (err instanceof MissingCredential && credential) return `Add ${credential.hint} to .env to see ${credential.purpose}`;
  if (err instanceof HttpError) {
    if ((err.status === 401 || err.status === 403) && credential) {
      return `${name} did not accept the credentials; check ${credential.hint}`;
    }
    return `${name} answered with an error (HTTP ${err.status})`;
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `${name} took too long to answer`;
  }
  return `Could not read details from ${name}`;
}

export function failedWidget(type: string, error: string): WidgetOutcome {
  return { widget: { type, ok: false, error, stats: [], meter: null, busy: false, attention: false }, lines: [] };
}

/** Runs apps' widgets: finds the credential, keeps per-service memory, and turns every failure into a plain sentence. */
export class AppRunner {
  private readonly http: HttpPort;
  private readonly credentials: CredentialLookup;
  private readonly memory = new Map<string, Record<string, unknown>>();

  constructor(http: HttpPort, credentials: CredentialLookup) {
    this.http = http;
    this.credentials = credentials;
  }

  /** Runs one widget; never throws and never includes secrets in its output. */
  async run(app: App, target: ServiceTarget): Promise<WidgetOutcome> {
    const widget = app.widget;
    if (!widget) return failedWidget(app.id, `Rack has no widget for ${target.name}`);
    try {
      const credential = widget.credential ? this.credentials(app) : null;
      if (widget.credential && !widget.credential.optional && credential == null) throw new MissingCredential();
      let memory = this.memory.get(target.serviceId);
      if (!memory) this.memory.set(target.serviceId, (memory = {}));
      const data = await widget.fetch({ ...target, credential, http: this.http, memory });
      return {
        widget: { type: app.id, ok: true, error: null, stats: data.stats, meter: data.meter ?? null, busy: data.busy, attention: data.attention },
        lines: data.lines ?? [],
      };
    } catch (err) {
      return failedWidget(app.id, describeFailure(err, app, target.name));
    }
  }

  forgetExcept(serviceIds: ReadonlySet<string>): void {
    for (const id of this.memory.keys()) if (!serviceIds.has(id)) this.memory.delete(id);
  }
}

export function unknownWidget(type: string): WidgetOutcome {
  return failedWidget(type, `Rack has no widget called "${type}"`);
}
