import { useEffect, useState } from 'preact/hooks';
import { clock, dateLabel } from './format';
import type { Link } from './useRack';

const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function Display({ title, lines, link, stale }: { title: string; lines: string[]; link: Link; stale: boolean }) {
  const [now, setNow] = useState(() => new Date());
  const [i, setI] = useState(0);
  const [hold, setHold] = useState(false);

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const key = lines.join('\n');
  useEffect(() => setI(0), [key]);

  useEffect(() => {
    if (lines.length < 2 || hold) return;
    const id = setInterval(() => setI((n) => n + 1), reduced() ? 8000 : 5000);
    return () => clearInterval(id);
  }, [key, hold]);

  const idx = lines.length ? i % lines.length : 0;
  const text = lines[idx] ?? '';
  const status = link === 'lost' ? 'Offline' : 'Live';

  return (
    <header class={`display ${stale ? 'is-stale' : ''}`} onMouseEnter={() => setHold(true)} onMouseLeave={() => setHold(false)} onFocusIn={() => setHold(true)} onFocusOut={() => setHold(false)}>
      <div class="glass" aria-hidden="true">
        <div class="vfd-time">
          <span class="vfd-clock">{clock(now).slice(0, 2)}<span class="colon">:</span>{clock(now).slice(3)}</span>
          <span class="vfd-date">{dateLabel(now)}</span>
        </div>
        <p class="vfd-line" key={`${idx}-${text}`}>{text}</p>
        <div class="vfd-meta">
          <span class="vfd-title">{title}</span>
          <span class="vfd-link">{status}</span>
          {lines.length > 1 && (
            <span class="pips">
              {lines.map((_, n) => <i key={n} class={n === idx ? 'on' : ''} />)}
            </span>
          )}
        </div>
      </div>
      <h1 class="sr">{title}</h1>
      <ul class="sr" aria-label="Status">
        {lines.map((l) => <li key={l}>{l}</li>)}
      </ul>
    </header>
  );
}
