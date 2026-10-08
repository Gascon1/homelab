import { formatCount } from './format.ts';
import type { Status } from './types.ts';
import type { DisplayLine } from './widgets/types.ts';

export const MAX_SENTENCE = 48;
const MAX_LINES = 5;

export interface DisplayInput {
  name: string;
  status: Status;
  lines: DisplayLine[];
}

/** No trailing full stop and at most MAX_SENTENCE characters. Capitalisation is left alone so "qBittorrent" stays intact. */
export function tidy(text: string): string {
  const out = text.trim().replace(/[.\s]+$/, '');
  return out.length <= MAX_SENTENCE ? out : `${out.slice(0, MAX_SENTENCE - 1).trimEnd()}…`;
}

function problemFor({ name, status }: DisplayInput): string | null {
  switch (status) {
    case 'down':
      return `${name} is not responding`;
    case 'stopped':
      return `${name} is stopped`;
    case 'slow':
      return `${name} is slow to respond`;
    default:
      return null;
  }
}

/** Problems first, then live activity, then a fallback when nothing is wrong. Input order is kept within each kind. */
export function buildDisplay(services: DisplayInput[]): string[] {
  const problems: string[] = [];
  const activity: string[] = [];
  for (const service of services) {
    const status = problemFor(service);
    if (status) problems.push(status);
    for (const line of service.lines) (line.kind === 'problem' ? problems : activity).push(line.text);
  }

  let shownProblems = problems;
  if (problems.length > MAX_LINES) {
    const hidden = problems.length - (MAX_LINES - 1);
    shownProblems = [...problems.slice(0, MAX_LINES - 1), `And ${formatCount(hidden)} more problems`];
  }

  const lines = [...shownProblems, ...activity];
  if (problems.length === 0) {
    if (services.length === 0) lines.push('No services to show yet');
    else if (services.some((s) => s.status === 'unknown')) lines.push('Checking your services');
    else lines.push(services.length === 1 ? 'Your service is up' : `All ${formatCount(services.length)} services are up`);
  }
  return lines.slice(0, MAX_LINES).map(tidy);
}
