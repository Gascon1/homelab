import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Service, State } from './types';
import { useRack } from './useRack';
import { Display } from './Display';
import { Icon, Lamp, Segments, Trace } from './parts';
import { bytes, clock, linkFor, sinceLabel, statusSentence, STATUS_WORD, uptime } from './format';
import { bestScore } from './fuzzy';

interface Target { key: string; kind: 'service' | 'bookmark'; name: string; group: string; href: string | null; svc?: Service; score: number }

const readTheme = (): 'light' | 'dark' => {
  const a = document.documentElement.getAttribute('data-theme');
  if (a === 'light' || a === 'dark') return a;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

function Readouts({ s }: { s: Service }) {
  const sentence = statusSentence(s);
  if (sentence) return <p class={`says says-${s.status}`}>{sentence}</p>;
  const w = s.widget;
  if (w && !w.ok) return <p class="says says-setup">{w.error ?? 'Stats are not available yet.'}</p>;
  if (w && w.stats.length) {
    return (
      <p class="stats">
        {w.stats.map((st) => (
          <span key={st.label} class={`stat tone-${st.tone}`}>
            <b>{st.value}</b> {st.label}
          </span>
        ))}
      </p>
    );
  }
  return s.description ? <p class="says says-desc">{s.description}</p> : <p class="says" />;
}

function Unit({ s, i, selected, showGroup }: { s: Service; i: number; selected: boolean; showGroup: boolean }) {
  const href = linkFor(s);
  const down = s.status === 'down' || s.status === 'stopped';
  const meter = !down && s.widget?.ok ? s.widget.meter : null;
  const body = (
    <>
      <span class="id">
        <Lamp status={s.status} />
        <Icon service={s} />
        <span class="name">
          {s.name}
          <span class="sr">, {STATUS_WORD[s.status].toLowerCase()}</span>
        </span>
        {showGroup && <span class="where">{s.group}</span>}
        {selected && <kbd class="enter">Enter</kbd>}
      </span>
      <span class="read"><Readouts s={s} /></span>
      <span class="gear">
        <span class="gear-meter">{meter && <Segments value={meter.value} count={8} label={meter.label} />}</span>
        <span class="ms">{s.latencyMs != null && !down ? <>{Math.round(s.latencyMs)}<small> ms</small></> : <span aria-hidden="true">no reply</span>}</span>
        <Trace history={s.history} />
      </span>
    </>
  );
  return (
    <li class={`unit st-${s.status}`} style={{ '--i': i }} data-sel={selected ? '' : undefined} data-key={s.id}>
      {href ? <a class="face" href={href}>{body}</a> : <div class="face">{body}</div>}
    </li>
  );
}

function BookmarkRow({ name, href, group, selected }: { name: string; href: string; group: string; selected: boolean }) {
  let host = href;
  try { host = new URL(href).host; } catch { /* keep raw */ }
  return (
    <li class="unit unit-bookmark" data-sel={selected ? '' : undefined}>
      <a class="face" href={href}>
        <span class="id"><span class="icon icon-mono" aria-hidden="true">{name.charAt(0).toUpperCase()}</span><span class="name">{name}</span><span class="where">{group}</span>{selected && <kbd class="enter">Enter</kbd>}</span>
        <span class="read"><p class="says says-desc">{host}</p></span>
      </a>
    </li>
  );
}

function Meters({ host }: { host: State['host'] }) {
  const tone = (p: number, w = 75, c = 90) => (p >= c ? 'crit' : p >= w ? 'warn' : 'ok') as 'ok' | 'warn' | 'crit';
  const cells: { label: string; v: number; text: string; tone: 'ok' | 'warn' | 'crit'; detail?: string }[] = [];
  if (host.cpu) cells.push({ label: 'CPU', v: host.cpu.percent / 100, text: `${Math.round(host.cpu.percent)}%`, tone: tone(host.cpu.percent, 70, 90) });
  if (host.memory) {
    const p = (host.memory.usedBytes / host.memory.totalBytes) * 100;
    cells.push({ label: 'Memory', v: p / 100, text: `${Math.round(p)}%`, tone: tone(p, 80, 92), detail: `${bytes(host.memory.usedBytes)} of ${bytes(host.memory.totalBytes)}` });
  }
  for (const d of host.disks) {
    const p = (d.usedBytes / d.totalBytes) * 100;
    cells.push({ label: d.label, v: p / 100, text: `${Math.round(p)}%`, tone: tone(p, 80, 92), detail: `${bytes(d.usedBytes)} of ${bytes(d.totalBytes)}` });
  }
  const facts: string[] = [];
  if (host.uptimeSeconds != null) facts.push(`Up ${uptime(host.uptimeSeconds)}`);
  if (host.load) facts.push(`Load ${host.load.map((n) => n.toFixed(2)).join(' ')}`);
  if (host.tempC != null) facts.push(`${Math.round(host.tempC)} °C`);
  if (!cells.length && !facts.length) return null;
  return (
    <section class="host" aria-label="This machine">
      <ul class="dials">
        {cells.map((c) => (
          <li key={c.label} class="dial">
            <span class="dial-label">{c.label}</span>
            <Segments value={c.v} count={20} tone={c.tone} label={c.label} />
            <span class={`dial-val dial-${c.tone}`}>{c.text}{c.tone !== 'ok' && <span class="sr">{c.tone === 'crit' ? ', critical' : ', getting full'}</span>}</span>
            {c.detail && <span class="dial-detail">{c.detail}</span>}
          </li>
        ))}
      </ul>
      {facts.length > 0 && <p class="facts">{facts.map((f) => <span key={f}>{f}</span>)}</p>}
    </section>
  );
}

export function App() {
  const { state, link, lastOk } = useRack();
  const [query, setQuery] = useState('');
  const [sel, setSel] = useState<number | null>(null);
  const [warm, setWarm] = useState(true);
  const [theme, setTheme] = useState<'light' | 'dark'>(readTheme);
  const input = useRef<HTMLInputElement>(null);
  const stale = link === 'lost' && !!state;

  useEffect(() => { const t = setTimeout(() => setWarm(false), 3200); return () => clearTimeout(t); }, []);

  // Title reflects problems.
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

  useEffect(() => setSel(q ? 0 : null), [q]);
  useEffect(() => {
    if (sel == null) return;
    document.querySelector('[data-sel]')?.scrollIntoView({ block: 'nearest' });
  }, [sel, results]);

  // Type anywhere, or press /, to jump into the launcher.
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

  const open = (t: Target | undefined, newTab: boolean) => {
    if (!t?.href) return;
    if (newTab) window.open(t.href, '_blank', 'noopener');
    else window.location.assign(t.href);
  };

  const onInputKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!results.length) return;
      const d = e.key === 'ArrowDown' ? 1 : -1;
      setSel((s) => (((s ?? (d > 0 ? -1 : 0)) + d + results.length) % results.length));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      open(results[sel ?? 0], e.ctrlKey || e.metaKey);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setQuery('');
      input.current?.blur();
    }
  };

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('rack-theme', next); } catch { /* storage unavailable */ }
  };

  // Display sentences, with connection trouble first.
  const lines = useMemo(() => {
    if (!state) {
      return link === 'lost'
        ? ['Cannot reach the server', 'Check that the Rack container is running']
        : ['Warming up'];
    }
    if (link === 'lost') return ['Lost connection to the server', `Showing how it looked at ${lastOk ? clock(lastOk) : sinceLabel(state.generatedAt) ?? 'the last update'}`, ...state.display.slice(0, 1)];
    return state.display.length ? state.display : ['Nothing to report'];
  }, [state, link, lastOk]);

  let unitIndex = 0;
  const empty = state && flat.length === 0;
  const bookmarkGroups = useMemo(() => {
    const m = new Map<string, { name: string; url: string }[]>();
    for (const b of state?.bookmarks ?? []) {
      const g = b.group ?? 'Links';
      m.set(g, [...(m.get(g) ?? []), b]);
    }
    return [...m.entries()];
  }, [state]);

  return (
    <div class={`cabinet ${warm ? 'warm' : ''} ${stale ? 'stale' : ''}`}>
      <div class="rack">
        <Display title={state?.title ?? 'Homelab'} lines={lines} link={link} stale={stale} />

        <div class="launcher">
          <span class="launcher-label" aria-hidden="true">Find</span>
          <label class="launcher-box">
            <span class="sr">Find a service</span>
            <input
              ref={input}
              type="text"
              value={query}
              placeholder="Find a service"
              autocomplete="off"
              autocapitalize="off"
              spellcheck={false}
              enterkeyhint="go"
              aria-controls="results"
              onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
              onKeyDown={onInputKey}
            />
            {query ? <kbd class="key">Esc</kbd> : <kbd class="key">/</kbd>}
          </label>
        </div>

        {state?.warnings.length ? (
          <aside class="notice" aria-label="Notices">
            {state.warnings.map((w) => <p key={w}>{w}</p>)}
          </aside>
        ) : null}

        {stale && <p class="notice notice-stale" role="status">Lost connection to the server. What you see is from {lastOk ? clock(lastOk) : 'earlier'} and may be out of date. Retrying.</p>}

        <main id="results" class="bays">
          {!state && link === 'lost' && (
            <p class="empty">The server did not answer. Check that the Rack container is running, then reload this page. It keeps trying in the background.</p>
          )}
          {empty && (
            <p class="empty">Nothing in the rack yet. Add the label <code>rack.enable=true</code> to a container and it appears here.</p>
          )}
          {q ? (
            <section class="bay bay-results" aria-label="Matches">
              <h2 class="legend">{results.length ? `${results.length} ${results.length === 1 ? 'match' : 'matches'}` : 'No matches'}</h2>
              {results.length ? (
                <ul class="units" role="list">
                  {results.map((t, n) => t.kind === 'service' && t.svc
                    ? <Unit key={t.key} s={t.svc} i={n} selected={sel === n} showGroup />
                    : <BookmarkRow key={t.key} name={t.name} href={t.href ?? '#'} group={t.group} selected={sel === n} />)}
                </ul>
              ) : (
                <p class="empty empty-inline">Nothing matches “{q}”. Press Escape to see everything again.</p>
              )}
            </section>
          ) : (
            state?.groups.map((g) => (
              <section key={g.name} class="bay" aria-labelledby={`g-${g.name}`}>
                <h2 class="legend" id={`g-${g.name}`}>{g.name}</h2>
                <ul class="units" role="list">
                  {g.services.map((s) => <Unit key={s.id} s={s} i={unitIndex++} selected={false} showGroup={false} />)}
                </ul>
              </section>
            ))
          )}
        </main>

        {!q && bookmarkGroups.length > 0 && (
          <nav class="links" aria-label="Bookmarks">
            {bookmarkGroups.map(([name, items]) => (
              <section key={name} class="bay bay-links">
                <h2 class="legend">{name}</h2>
                <ul class="chips" role="list">
                  {items.map((b) => <li key={b.url}><a href={b.url}>{b.name}</a></li>)}
                </ul>
              </section>
            ))}
          </nav>
        )}

        {state && <Meters host={state.host} />}

        <footer class="base">
          <button type="button" class="theme" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Switch to the silver face' : 'Switch to the black face'}>
            {theme === 'dark' ? 'Silver face' : 'Black face'}
          </button>
        </footer>
      </div>
    </div>
  );
}
