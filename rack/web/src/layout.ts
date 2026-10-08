import { useEffect, useState } from 'preact/hooks';

/** Number of equal columns in the master grid: 8 on big screens, 6 on laptops, 4 on tablets, 2 on phones. */
export function useUnits(): 2 | 4 | 6 | 8 {
  const pick = () => (window.innerWidth < 760 ? 2 : window.innerWidth < 1200 ? 4 : window.innerWidth < 1750 ? 6 : 8);
  const [u, setU] = useState<2 | 4 | 6 | 8>(pick);
  useEffect(() => {
    const on = () => setU(pick());
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return u;
}

/**
 * Fit items of the given widths into rows of `total` columns, then hand each row's
 * leftover columns back to its items so every row is a full rectangle.
 * `fromEnd` gives the spare columns to the last items first.
 */
export function pack(widths: number[], total: number, fromEnd = false): number[] {
  const out = widths.map((w) => Math.max(1, Math.min(w, total)));
  const rows: number[][] = [];
  let cur: number[] = [];
  let sum = 0;
  out.forEach((w, i) => {
    if (sum + w > total) { rows.push(cur); cur = []; sum = 0; }
    cur.push(i);
    sum += w;
  });
  if (cur.length) rows.push(cur);
  for (const row of rows) {
    let spare = total - row.reduce((n, i) => n + out[i]!, 0);
    const order = fromEnd ? [...row].reverse() : row;
    for (let k = 0; spare > 0; k = (k + 1) % order.length, spare--) out[order[k]!]!++;
  }
  return out;
}

/** Columns a group wants for a given tile area: one row when it is short, otherwise rows of at most four. */
export const sectionWidth = (area: number, units: number) =>
  Math.min(units, area <= 6 ? Math.max(1, area) : Math.ceil(area / Math.ceil(area / 4)));
