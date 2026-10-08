import { useEffect, useRef, useState } from 'preact/hooks';
import type { State } from './types';

export type Link = 'connecting' | 'live' | 'polling' | 'lost';
export interface Rack { state: State | null; link: Link; lastOk: Date | null }

// Dev only: carry ?scenario=... through to the fixture server.
const qs = import.meta.env.DEV ? (() => {
  const s = new URLSearchParams(location.search).get('scenario');
  return s ? `?scenario=${encodeURIComponent(s)}` : '';
})() : '';

const STATE_URL = `/api/state${qs}`;
const EVENTS_URL = `/api/events${qs}`;

export function useRack(): Rack {
  const [rack, setRack] = useState<Rack>({ state: null, link: 'connecting', lastOk: null });
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let es: EventSource | null = null;
    let pollTimer: number | undefined;
    let retryTimer: number | undefined;
    let backoff = 1000;
    let streaming = false;

    const accept = (state: State, link: Link) => {
      if (!alive.current) return;
      setRack({ state, link, lastOk: new Date() });
    };
    const fail = () => {
      if (!alive.current) return;
      setRack((r) => (r.link === 'lost' ? r : { ...r, link: 'lost' }));
    };

    async function poll() {
      if (streaming || !alive.current) return;
      try {
        const res = await fetch(STATE_URL, { cache: 'no-store' });
        if (!res.ok) throw new Error(String(res.status));
        accept((await res.json()) as State, 'polling');
      } catch {
        if (!streaming) fail();
      }
    }

    function startPolling() {
      if (pollTimer) return;
      void poll();
      pollTimer = window.setInterval(poll, 5000);
    }
    function stopPolling() {
      if (pollTimer) { clearInterval(pollTimer); pollTimer = undefined; }
    }

    function connect() {
      if (!alive.current) return;
      es = new EventSource(EVENTS_URL);
      es.addEventListener('state', (ev) => {
        try {
          const state = JSON.parse((ev as MessageEvent<string>).data) as State;
          streaming = true;
          backoff = 1000;
          stopPolling();
          accept(state, 'live');
        } catch { /* ignore a malformed frame */ }
      });
      es.onerror = () => {
        streaming = false;
        es?.close();
        es = null;
        startPolling();
        retryTimer = window.setTimeout(connect, backoff);
        backoff = Math.min(backoff * 2, 30000);
      };
    }

    // First paint does not wait for the stream.
    void poll().finally(() => { if (alive.current) connect(); });

    return () => {
      alive.current = false;
      es?.close();
      stopPolling();
      clearTimeout(retryTimer);
    };
  }, []);

  return rack;
}
