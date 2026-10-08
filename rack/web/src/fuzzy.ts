/** Score a query against one string. 0 = no match, higher is better. */
export function score(query: string, text: string): number {
  const q = query.toLowerCase().replace(/\s+/g, '');
  const t = text.toLowerCase();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 90 - Math.min(t.length - q.length, 20) * 0.1;
  const words = t.split(/[\s\-_./]+/);
  if (words.some((w) => w.startsWith(q))) return 75;
  const at = t.indexOf(q);
  if (at >= 0) return 60 - Math.min(at, 20) * 0.5;
  // subsequence, rewarding tight runs
  let ti = 0, run = 0, best = 0, total = 0;
  for (const ch of q) {
    const f = t.indexOf(ch, ti);
    if (f < 0) return 0;
    run = f === ti ? run + 1 : 0;
    best = Math.max(best, run);
    total += f - ti;
    ti = f + 1;
  }
  return Math.max(1, 30 + best * 2 - total * 0.5);
}

export function bestScore(query: string, fields: { text: string | null | undefined; weight: number }[]): number {
  let out = 0;
  for (const f of fields) {
    if (!f.text) continue;
    out = Math.max(out, score(query, f.text) * f.weight);
  }
  return out;
}
