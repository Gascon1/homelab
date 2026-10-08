import type { Widget } from '../types.ts';
import { HttpError } from './http.ts';
import { MissingCredential, type DisplayLine, type WidgetContext, type WidgetModule } from './types.ts';

export interface WidgetOutcome {
  widget: Widget;
  lines: DisplayLine[];
}

function describeFailure(err: unknown, module: WidgetModule, name: string): string {
  if (err instanceof MissingCredential) return `Add ${err.envText} to .env to see ${err.what}`;
  if (err instanceof HttpError) {
    if ((err.status === 401 || err.status === 403) && module.credentialHint) {
      return `${name} did not accept the credentials; check ${module.credentialHint}`;
    }
    return `${name} answered with an error (HTTP ${err.status})`;
  }
  if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
    return `${name} took too long to answer`;
  }
  return `Could not read details from ${name}`;
}

/** Runs one widget; never throws and never includes secrets in its output. */
export async function runWidget(module: WidgetModule, ctx: WidgetContext): Promise<WidgetOutcome> {
  try {
    const data = await module.fetch(ctx);
    return {
      widget: { type: module.type, ok: true, error: null, stats: data.stats, meter: data.meter ?? null },
      lines: data.lines ?? [],
    };
  } catch (err) {
    return {
      widget: { type: module.type, ok: false, error: describeFailure(err, module, ctx.name), stats: [], meter: null },
      lines: [],
    };
  }
}

export function unknownWidget(type: string): WidgetOutcome {
  return {
    widget: { type, ok: false, error: `Rack has no widget called "${type}"`, stats: [], meter: null },
    lines: [],
  };
}
