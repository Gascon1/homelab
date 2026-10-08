import { useEffect, useState } from 'preact/hooks';
import type { Service, Status } from './types';

export function Lamp({ status }: { status: Status }) {
  return (
    <svg class={`lamp lamp-${status}`} viewBox="0 0 18 18" width="18" height="18" aria-hidden="true" focusable="false">
      {status === 'down' ? (
        <>
          <path class="lamp-fill" d="M9 1.5 16.5 9 9 16.5 1.5 9Z" />
          <path d="M9 5.5v4.2M9 11.6v1.2" stroke="var(--face)" stroke-width="1.9" stroke-linecap="round" />
        </>
      ) : status === 'stopped' ? (
        <>
          <circle class="lamp-ring" cx="9" cy="9" r="6.2" />
          <path d="M6 9h6" class="lamp-bar" />
        </>
      ) : status === 'unknown' ? (
        <circle class="lamp-ring lamp-dashed" cx="9" cy="9" r="6.2" />
      ) : (
        <circle class="lamp-fill" cx="9" cy="9" r="6.2" />
      )}
    </svg>
  );
}

export function Icon({ service }: { service: Service }) {
  const [bad, setBad] = useState(false);
  useEffect(() => setBad(false), [service.icon]);
  if (!service.icon || bad) {
    return <span class="icon icon-mono" aria-hidden="true">{service.name.trim().charAt(0).toUpperCase()}</span>;
  }
  return <img class="icon" src={service.icon} alt="" width="24" height="24" loading="lazy" decoding="async" onError={() => setBad(true)} />;
}

export function Segments({ value, count, tone = 'ok', label }: { value: number; count: number; tone?: 'ok' | 'warn' | 'crit'; label?: string }) {
  const v = Math.max(0, Math.min(1, value));
  const lit = v === 0 ? 0 : Math.max(1, Math.round(v * count));
  return (
    <span
      class={`segs segs-${tone}`}
      style={{ '--n': count }}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(v * 100)}
    >
      {Array.from({ length: count }, (_, i) => <i key={i} class={i < lit ? 'on' : ''} />)}
    </span>
  );
}

export function Trace({ history }: { history: (number | null)[] }) {
  const W = 72, H = 18;
  const vals = history.filter((v): v is number => v != null);
  if (history.length < 2 || vals.length === 0) return <span class="trace" aria-hidden="true" />;
  const max = Math.max(80, ...vals);
  const step = W / (history.length - 1);
  const y = (v: number) => (H - 3 - (v / max) * (H - 6)).toFixed(1);
  let d = '';
  let pen = false;
  const fails: number[] = [];
  history.forEach((v, i) => {
    const x = (i * step).toFixed(1);
    if (v == null) { pen = false; fails.push(i * step); return; }
    d += `${pen ? 'L' : 'M'}${x} ${y(v)}`;
    pen = true;
  });
  return (
    <svg class="trace" viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true" focusable="false">
      <path d={d} class="trace-line" />
      {fails.map((x) => <path key={x} d={`M${x.toFixed(1)} ${H - 6}V${H}`} class="trace-fail" />)}
    </svg>
  );
}
