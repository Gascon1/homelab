import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { Service, State } from './types';
import { useRack } from './useRack';
import { Display } from './Display';
import { Icon, Lamp, Segments } from './parts';
import { bytes, clock, linkFor, sinceLabel, STATUS_WORD, uptime } from './format';
import { bestScore } from './fuzzy';
import { pack, sectionWidth, useUnits } from './layout';

interface Target { key: string; kind: 'service' | 'bookmark'; name: string; group: string; href: string | null; svc?: Service; score: number }
type Tone = 'ok' | 'warn' | 'crit';

/* ---------- reading a service's state ---------- */

const isZero = (v: string) => /^0(\.0+)?(?![\d.,])/.test(v.trim());
// Counts that mean "something is going on right now", as opposed to inventory like photos or indexers.
const ACTIVITY = /stream|queue|download|upload|transcod|waiting|active|seeding|request|pulling|playing/i;

function describe(s: Service) {
  const w = s.widget;
  const down = s.status === 'down' || s.status === 'stopped';
  const stats = w?.ok ? w.stats : [];
  const meterOn = !!w?.ok && !!w.meter && w.meter.value > 0.04;
  const busy = !down && (meterOn || stats.some((t) => ACTIVITY.test(t.label) && !isZero(t.value)));
  const attention = !down && (s.status === 'slow' || stats.some((t) => (t.tone === 'warn' || t.tone === 'bad') && !isZero(t.value)));
  const needsSetup = !down && !!w && !w.ok;
  const featured = /^(plex|qbittorrent)$/.test(s.id) || !!w?.meter;
  return { down, stats, busy, attention, needsSetup, featured };
}

/* ---------- tiles ---------- */

function ServiceTile({ s, w, selected, showGroup }: { s: Service; w: number; selected: boolean; showGroup: boolean }) {
  const [open, setOpen] = useState(false);
  const href = linkFor(s);
  const d = describe(s);
  const wide = w >= 2;
  const since = sinceLabel(s.since);
  const meter = !d.down && s.widget?.ok ? s.widget.meter : null;
  const word = STATUS_WORD[s.status];
  const cls = `tile svc st-${s.status}${d.busy ? ' busy' : ''}${d.attention ? ' attn' : ''}${wide ? ' wide' : ''}${d.needsSetup ? ' setup' : ''}`;

  let body: ComponentChildren;
  if (d.down) {
    body = (
      <>
        <p class="alarm">{word}</p>
        <p class="alarm-note">{since ? `Since ${since}. ` : ''}{s.status === 'down' ? 'Check its logs.' : 'Start the container.'}</p>
      </>
    );
  } else if (d.needsSetup) {
    const msg = s.widget?.error ?? 'Stats are not available yet.';
    body = (
      <>
        <p class="lead">
          <button type="button" class="chip" aria-expanded={open} aria-controls={`d-${s.id}`} title={msg} onClick={() => setOpen(!open)}>Needs setup</button>
        </p>
        {s.description && <p class="desc">{s.description}</p>}
        <div class={`detail${open ? ' is-open' : ''}`} role="note" id={`d-${s.id}`}>
          <p>{msg}</p>
          <button type="button" class="chip chip-quiet" onClick={() => setOpen(false)}>Close</button>
        </div>
      </>
    );
  } else if (d.stats.length) {
    const [first, ...rest] = d.stats;
    const m = /^([\d.,]+)\s*(.*)$/.exec(first!.value);
    const num = m ? m[1]! : first!.value;
    const unit = m ? m[2]! : '';
    const zero = isZero(first!.value);
    body = (
      <>
        <p class="lead">
          <span class={`big${zero ? ' zero' : ''} tone-${first!.tone}`} style={{ '--len': Math.max(2, num.length + (unit ? 2.2 : 0)) }}>{num}{unit && <small>{unit}</small>}</span>
          <span class={`big-label${zero ? ' zero' : ''}`}>{first!.label}</span>
        </p>
        {rest.length > 0 && (
          <p class="more">
            {rest.map((t) => (
              <span key={t.label} class={`m${isZero(t.value) ? ' zero' : ''} tone-${t.tone}`}><b>{t.value}</b> {t.label}</span>
            ))}
          </p>
        )}
      </>
    );
  } else {
    body = <p class="desc desc-solo">{s.description ?? ''}</p>;
  }

  return (
    <li class={cls} style={{ gridColumn: `span ${w}` }} data-sel={selected ? '' : undefined}>
      <div class="head">
        <Icon service={s} />
        <h3 class="name">
          {href ? <a class="stretch" href={href} target="_blank" rel="noopener noreferrer">{s.name}<span class="sr">, {word.toLowerCase()}</span></a> : <>{s.name}<span class="sr">, {word.toLowerCase()}</span></>}
        </h3>
        {selected && <kbd class="enter">Enter</kbd>}
        {showGroup && <span class="where">{s.group}</span>}
        <span class="state" aria-hidden="true">
          {s.status !== 'up' && <span class="state-word">{s.status === 'down' ? 'Down' : word}</span>}
          <Lamp status={s.status} />
        </span>
      </div>
      <div class="body">
        <div class="main">{body}</div>
        {s.latencyMs != null && !d.down && <span class="ms">{Math.round(s.latencyMs)} ms</span>}
      </div>
      {meter && <div class="foot"><Segments value={meter.value} count={wide ? 24 : 12} label={meter.label} /></div>}
    </li>
  );
}

function BookmarkTile({ name, href, group, selected, w }: { name: string; href: string; group: string; selected: boolean; w: number }) {
  let host = href;
  try { host = new URL(href).host; } catch { /* keep raw */ }
  return (
    <li class="tile svc bookmark" style={{ gridColumn: `span ${w}` }} data-sel={selected ? '' : undefined}>
      <div class="head">
        <span class="icon icon-mono" aria-hidden="true">{name.charAt(0).toUpperCase()}</span>
        <h3 class="name"><a class="stretch" href={href} target="_blank" rel="noopener noreferrer">{name}</a></h3>
        {selected && <kbd class="enter">Enter</kbd>}
        <span class="where">{group}</span>
      </div>
      <div class="body"><div class="main"><p class="desc desc-solo">{host}</p></div></div>
    </li>
  );
}

interface HostTileData { key: string; kind: 'gauge' | 'fact'; label: string; big: string; unit?: string; v?: number; tone: Tone; detail: string }

const toneOf = (p: number, warn: number, crit: number): Tone => (p >= crit ? 'crit' : p >= warn ? 'warn' : 'ok');
const toneNote: Record<Tone, string> = { ok: '', warn: 'Getting full. ', crit: 'Nearly full. ' };
/** "5.6 of 8.0 TB" when both sides share a unit. */
function pair(used: number, total: number): string {
  const a = bytes(used), b = bytes(total);
  const [an, au] = a.split(' '), [, bu] = b.split(' ');
  return au === bu ? `${an} of ${b}` : `${a} of ${b}`;
}

function hostTiles(host: State['host']): HostTileData[] {
  const out: HostTileData[] = [];
  if (host.cpu) {
    const p = host.cpu.percent;
    out.push({ key: 'cpu', kind: 'gauge', label: 'Processor', big: String(Math.round(p)), unit: '%', v: p / 100, tone: toneOf(p, 70, 90), detail: `${host.cpu.cores} cores` });
  }
  if (host.memory) {
    const p = (host.memory.usedBytes / host.memory.totalBytes) * 100;
    const tone = toneOf(p, 80, 92);
    out.push({ key: 'mem', kind: 'gauge', label: 'Memory', big: String(Math.round(p)), unit: '%', v: p / 100, tone, detail: `${toneNote[tone]}${pair(host.memory.usedBytes, host.memory.totalBytes)}` });
  }
  for (const dk of host.disks) {
    const p = (dk.usedBytes / dk.totalBytes) * 100;
    const tone = toneOf(p, 80, 92);
    out.push({ key: `disk:${dk.path}`, kind: 'gauge', label: `Disk, ${dk.label}`, big: String(Math.round(p)), unit: '%', v: p / 100, tone, detail: `${toneNote[tone]}${pair(dk.usedBytes, dk.totalBytes)}` });
  }
  if (host.uptimeSeconds != null) {
    const u = uptime(host.uptimeSeconds);
    const [n, ...rest] = u.split(' ');
    out.push({ key: 'up', kind: 'fact', label: 'Uptime', big: n!, unit: rest.join(' '), tone: 'ok', detail: 'Since last restart' });
  }
  if (host.load) out.push({ key: 'load', kind: 'fact', label: 'Load', big: host.load[0].toFixed(2), tone: 'ok', detail: `${host.load[1].toFixed(2)} 5 min, ${host.load[2].toFixed(2)} 15 min` });
  if (host.tempC != null) {
    const t = host.tempC;
    out.push({ key: 'temp', kind: 'fact', label: 'Temperature', big: String(Math.round(t)), unit: '°C', tone: t >= 85 ? 'crit' : t >= 70 ? 'warn' : 'ok', detail: t >= 85 ? 'Running hot' : t >= 70 ? 'Warm' : 'Normal' });
  }
  return out;
}

function HostTile({ t, w }: { t: HostTileData; w: number }) {
  return (
    <li class={`tile host host-${t.kind} tone-${t.tone}`} style={{ gridColumn: `span ${w}` }}>
      <div class="hbody">
        <p class="hlabel">{t.label}</p>
        <p class="hnum">{t.big}{t.unit && <small>{t.unit}</small>}{t.tone !== 'ok' && <span class="sr">{t.tone === 'crit' ? ', critical' : ', getting high'}</span>}</p>
        <p class="hdetail">{t.detail}</p>
      </div>
      {t.kind === 'gauge' && (
        <div class="well"><Segments value={t.v ?? 0} count={10} tone={t.tone} label={t.label} /></div>
      )}
    </li>
  );
}

/* ---------- sections ---------- */

type TileNode = { key: string; base: number; hostTile?: HostTileData; svc?: Service };

function Section({ title, summary, summaryTone, span, children }: { title: string; summary?: string; summaryTone?: string; span: number; children: ComponentChildren }) {
  return (
    <section class="grp" style={{ gridColumn: `span ${span}` }} aria-label={title}>
      <header class="grp-head">
        <h2>{title}</h2>
        {summary && <span class={`grp-sum ${summaryTone ?? ''}`}>{summary}</span>}
      </header>
      {children}
    </section>
  );
}

function summarise(svcs: Service[]): { text: string; tone: string } {
  const bad = svcs.filter((s) => s.status === 'down' || s.status === 'stopped');
  if (bad.length) return { text: `${bad.length} ${bad.length === 1 ? 'needs' : 'need'} attention`, tone: 'is-bad' };
  const busy = svcs.filter((s) => describe(s).busy).length;
  const attn = svcs.filter((s) => describe(s).attention).length;
  if (attn) return { text: `${attn} to look at`, tone: 'is-warn' };
  return busy ? { text: `${busy} busy`, tone: 'is-busy' } : { text: 'All quiet', tone: '' };
}

export function App() {
  const { state, link, lastOk } = useRack();
  const units = useUnits();
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [warm, setWarm] = useState(true);
  const input = useRef<HTMLInputElement>(null);
  const stale = link === 'lost' && !!state;

  useEffect(() => { const t = setTimeout(() => setWarm(false), 1600); return () => clearTimeout(t); }, []);

  useEffect(() => {
    const all = state?.groups.flatMap((g) => g.services) ?? [];
    const down = all.filter((s) => s.status === 'down').length;
    const stopped = all.filter((s) => s.status === 'stopped').length;
    const parts = [down && `${down} down`, stopped && `${stopped} stopped`].filter(Boolean);
    const name = state?.title ?? 'Rack';
    document.title = link === 'lost' ? `Offline, ${name}` : parts.length ? `${parts.join(', ')}, ${name}` : name;
  }, [state, link]);

  const flat = useMemo(() => state?.groups.flatMap((g) => g.services) ?? [], [state]);

  const q = query.trim();
  const results = useMemo<Target[]>(() => {
    if (!q || !state) return [];
    const out: Target[] = [];
    for (const s of flat) {
      const sc = bestScore(q, [{ text: s.name, weight: 1 }, { text: s.id, weight: 0.9 }, { text: s.group, weight: 0.5 }, { text: s.description, weight: 0.4 }]);
      if (sc > 0) out.push({ key: `s:${s.id}`, kind: 'service', name: s.name, group: s.group, href: linkFor(s), svc: s, score: sc });
    }
    for (const b of state.bookmarks) {
      const sc = bestScore(q, [{ text: b.name, weight: 1 }, { text: b.group, weight: 0.5 }]);
      if (sc > 0) out.push({ key: `b:${b.group}:${b.name}`, kind: 'bookmark', name: b.name, group: b.group ?? 'Links', href: b.url, score: sc * 0.95 });
    }
    return out.sort((a, b) => b.score - a.score);
  }, [q, state, flat]);

  const resultWidths = useMemo(() => results.map(() => 2), [results]);

  useEffect(() => setSel(q ? 0 : null), [q]);
  useEffect(() => {
    if (sel == null) return;
    document.querySelector('[data-sel]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, results]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return;
      if (e.key === '/') { e.preventDefault(); input.current?.focus(); return; }
      if (e.key.length === 1 && e.key !== ' ') input.current?.focus();
      else if (e.key === 'Escape' && query) setQuery('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [query]);

  // Both Enter and Ctrl/Cmd+Enter open in a new tab.
  const open = (t: Target | undefined) => {
    if (t?.href) window.open(t.href, '_blank', 'noopener,noreferrer');
  };

  const onInputKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setSel((s) => (((s ?? (d > 0 ? -1 : 0)) + d + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(results[sel ?? 0]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      input.current?.blur();
    }
  };

  const lines = useMemo(() => {
    if (!state) {
      return link === 'lost'
        ? ['Cannot reach the server', 'Check that the Rack container is running']
        : ['Warming up'];
    }
    if (link === 'lost') return ['Lost connection to the server', `Showing how it looked at ${lastOk ? clock(lastOk) : sinceLabel(state.generatedAt) ?? 'the last update'}`, ...state.display.slice(0, 1)];
    return state.display.length ? state.display : ['Nothing to report'];
  }, [state, link, lastOk]);

  const empty = !!state && flat.length === 0;

  /* Build the sections: groups (System, or the older Machine, also carries the host meters), then bookmark groups. */
  const bookmarkGroups = useMemo(() => {
    const m = new Map<string, { name: string; url: string }[]>();
    for (const b of state?.bookmarks ?? []) {
      const g = b.group ?? 'Links';
      m.set(g, [...(m.get(g) ?? []), b]);
    }
    return [...m.entries()].map(([name, items]) => ({ name, items }));
  }, [state]);

  const plan = useMemo(() => {
    if (!state) return { sections: [], links: 0 };
    const host = hostTiles(state.host);
    /* The host meters live in the System group; configs from before the rename say Machine. */
    const isHostGroup = (name: string) => name === 'System' || name === 'Machine';
    const hostName = state.groups.find((g) => g.name === 'System')?.name ?? state.groups.find((g) => g.name === 'Machine')?.name;
    const groups = state.groups.map((g) => ({ name: g.name, svcs: g.services, host: g.name === hostName ? host : [] }));
    if (host.length && !groups.some((g) => isHostGroup(g.name))) groups.push({ name: 'System', svcs: [], host });
    const prepared = groups.map((g) => {
      const few = g.svcs.length + g.host.length <= 2;
      const nodes: TileNode[] = [
        ...[...g.svcs].sort((a, b) => Number(describe(b).featured) - Number(describe(a).featured))
          .map((s) => ({ key: s.id, svc: s, base: units === 2 ? 2 : describe(s).featured && !few ? 2 : 1 })),
        ...g.host.map((h) => ({ key: h.key, hostTile: h, base: 1 })),
      ];
      return { ...g, nodes, area: nodes.reduce((n, t) => n + t.base, 0) };
    });
    /* A group with one tile gets two columns at 8, so the second row is Photos 2 + System 4 + Links 2. */
    const want = prepared.map((g) => (units === 2 ? 2 : units === 8 && g.area === 1 ? 2 : sectionWidth(g.area, units)));
    if (bookmarkGroups.length) want.push(2);
    const spans = pack(want, units, true);
    const sections = prepared.map((g, i) => {
      const T = spans[i]!;
      return { ...g, T, widths: pack(g.nodes.map((n) => n.base), T, true) };
    });
    return { sections, links: bookmarkGroups.length ? spans[spans.length - 1]! : 0 };
  }, [state, units, bookmarkGroups]);
  const sections = plan.sections;

  const displaySpan = units === 8 ? 6 : units === 6 ? 4 : units === 4 ? 3 : 2;
  const findSpan = units - displaySpan || units;

  const total = flat.length;
  const downCount = flat.filter((s) => s.status === 'down' || s.status === 'stopped').length;

  return (
    <div class={`page ${warm ? 'warm' : ''} ${stale ? 'stale' : ''}`}>
      <div class="board" style={{ '--u': units }}>
        <section class="cell-display" style={{ gridColumn: `span ${displaySpan}` }}>
          <Display title={state?.title ?? 'Homelab'} lines={lines} link={link} stale={stale} />
        </section>

        <section class="cell-find" style={{ gridColumn: `span ${findSpan}` }} aria-label="Find">
          <label class="find-box">
            <span class="find-label">Find a service</span>
            <span class="find-row">
              <input
                ref={input}
                type="text"
                value={query}
                placeholder="Start typing"
                autocomplete="off"
                autocapitalize="off"
                spellcheck={false}
                enterkeyhint="go"
                aria-controls="results"
                onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
                onKeyDown={onInputKey}
              />
              {query ? <kbd class="key">Esc</kbd> : <kbd class="key">/</kbd>}
            </span>
          </label>
          <p class="find-sum" role="status">
            {state ? (downCount ? `${downCount} of ${total} services need attention` : `${total} services, all running`) : 'Connecting'}
          </p>
        </section>

        {state?.warnings.length ? (
          <aside class="notice" style={{ gridColumn: '1 / -1' }} aria-label="Notices">
            {state.warnings.map((w) => <p key={w}>{w}</p>)}
          </aside>
        ) : null}

        {stale && <p class="notice notice-stale" style={{ gridColumn: '1 / -1' }} role="status">Lost connection to the server. What you see is from {lastOk ? clock(lastOk) : 'earlier'} and may be out of date. Retrying.</p>}

        {!state && link === 'lost' && (
          <p class="empty" style={{ gridColumn: '1 / -1' }}>The server did not answer. Check that the Rack container is running, then reload this page. It keeps trying in the background.</p>
        )}
        {empty && (
          <p class="empty" style={{ gridColumn: '1 / -1' }}>Nothing here yet. Add the label <code>rack.enable=true</code> to a container and it appears here.</p>
        )}

        <main id="results" class="main" style={{ gridColumn: '1 / -1' }}>
          {q ? (
            <div class="board board-inner" style={{ '--u': units }}>
              <Section title={results.length ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : 'No matches'} span={units}>
                {results.length ? (
                  <ul class="tiles" role="list" style={{ '--t': units }}>
                    {results.map((t, n) => t.kind === 'service' && t.svc
                      ? <ServiceTile key={t.key} s={t.svc} w={resultWidths[n]!} selected={sel === n} showGroup />
                      : <BookmarkTile key={t.key} name={t.name} href={t.href ?? '#'} group={t.group} selected={sel === n} w={resultWidths[n]!} />)}
                  </ul>
                ) : (
                  <p class="empty empty-inline">Nothing matches “{q}”. Press Escape to see everything again.</p>
                )}
              </Section>
            </div>
          ) : (
            <div class="board board-inner" style={{ '--u': units }}>
              {sections.map((g) => {
                const sum = summarise(g.svcs);
                return (
                  <Section key={g.name} title={g.name} span={g.T} summary={g.svcs.length ? sum.text : undefined} summaryTone={sum.tone}>
                    <ul class="tiles" role="list" style={{ '--t': g.T }}>
                      {g.nodes.map((n, i) => n.svc
                        ? <ServiceTile key={n.key} s={n.svc} w={g.widths[i]!} selected={false} showGroup={false} />
                        : <HostTile key={n.key} t={n.hostTile!} w={g.widths[i]!} />)}
                    </ul>
                  </Section>
                );
              })}
              {plan.links > 0 && (
                <Section title="Links" span={plan.links}>
                  <nav class="tile links" aria-label="Bookmarks">
                    {bookmarkGroups.map((b) => (
                      <div key={b.name} class="mark-group">
                        <h3>{b.name}</h3>
                        <ul role="list">
                          {b.items.map((i) => <li key={i.url}><a href={i.url} target="_blank" rel="noopener noreferrer">{i.name}</a></li>)}
                        </ul>
                      </div>
                    ))}
                  </nav>
                </Section>
              )}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
