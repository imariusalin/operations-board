import { useCallback, useEffect, useRef, useState } from 'react';
import type { HourlyReport, NoStockRecord, Snapshot, StationReport } from './types';

export type ConnState = 'connecting' | 'open' | 'closed';

export function useBoard() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [conn, setConn] = useState<ConnState>('connecting');
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);

  useEffect(() => {
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      setConn('connecting');
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => !disposed && setConn('open');
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data) as Snapshot;
        if (msg.type === 'snapshot') setSnapshot(msg);
      };
      ws.onclose = () => {
        if (disposed) return;
        setConn('closed');
        retryRef.current = window.setTimeout(connect, 1500);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => {
      disposed = true;
      if (retryRef.current) clearTimeout(retryRef.current);
      wsRef.current?.close();
    };
  }, []);

  return { snapshot, conn };
}

export async function sendScan(raw: string, stationId: string, source: 'http' | 'wedge' = 'http') {
  const res = await fetch('/api/scan', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw, stationId, source }),
  });
  return res.json();
}

/** "Take off task by management" — true pauses the rating, false switches it back on. */
export async function sendPause(stationId: string, paused: boolean, reason?: string) {
  await fetch(`/api/station/${encodeURIComponent(stationId)}/pause`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ paused, reason, by: getManager() || undefined }),
  });
}

// ---- who is using the board ---------------------------------------------
// The manager's name, kept in this browser only, so pauses and handovers say who did them.

const MANAGER_KEY = 'ops-board-manager';
let managerCache: string | null = null;

export function getManager(): string {
  if (managerCache !== null) return managerCache;
  try {
    managerCache = localStorage.getItem(MANAGER_KEY) ?? '';
  } catch {
    managerCache = '';
  }
  return managerCache;
}

export function useManager(): [string, (v: string) => void] {
  const [name, setName] = useState(getManager);
  const set = useCallback((v: string) => {
    managerCache = v;
    setName(v);
    try {
      localStorage.setItem(MANAGER_KEY, v);
    } catch {
      /* storage blocked — keep it for this session only */
    }
  }, []);
  return [name, set];
}

/** Polls a JSON endpoint while the component that needs it is mounted. */
function usePoll<T>(url: string, everyMs: number): T | null {
  const [data, setData] = useState<T | null>(null);
  useEffect(() => {
    let alive = true;
    setData(null);
    const load = async () => {
      try {
        const res = await fetch(url);
        if (res.ok && alive) setData(await res.json());
      } catch {
        /* server restarting — keep the last good data */
      }
    };
    void load();
    const id = setInterval(load, everyMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [url, everyMs]);
  return data;
}

export const useHourly = () => usePoll<HourlyReport>('/api/hourly', 2000);
export const useStationReport = (id: string) =>
  usePoll<StationReport>(`/api/station/${encodeURIComponent(id)}`, 2000);
export const useNoStock = () =>
  usePoll<{ simNow: number; records: NoStockRecord[] }>('/api/nostock', 2000);

export async function sendControl(body: { speed?: number; simulator?: boolean }) {
  await fetch('/api/control', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * Keyboard-wedge capture. A Zebra scanner in HID mode types its payload far faster
 * than a person can, then sends Enter - so we buffer keystrokes and accept the buffer
 * as a scan only if the whole burst arrived inside MAX_BURST_MS.
 *
 * This is what lets a real scanner drive the board today, with no drivers and no
 * device provisioning: plug it in, click into the page, scan.
 */
export function useKeyboardWedge(
  enabled: boolean,
  stationId: string,
  onScan: (raw: string) => void,
) {
  const buf = useRef('');
  const startedAt = useRef(0);
  const lastKeyAt = useRef(0);

  const MAX_BURST_MS = 500;   // whole barcode must arrive within this
  const MAX_GAP_MS = 60;      // ...and no two keys further apart than this
  const MIN_LENGTH = 3;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Never swallow keys the user is deliberately typing into a field.
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;

      const now = performance.now();

      if (e.key === 'Enter') {
        const value = buf.current;
        const burst = now - startedAt.current;
        buf.current = '';
        if (value.length >= MIN_LENGTH && burst <= MAX_BURST_MS) {
          e.preventDefault();
          onScan(value);
          void sendScan(value, stationId, 'wedge');
        }
        return;
      }

      if (e.key.length !== 1) return; // ignore modifiers, arrows, F-keys

      if (now - lastKeyAt.current > MAX_GAP_MS) {
        buf.current = '';
        startedAt.current = now;
      }
      lastKeyAt.current = now;
      buf.current += e.key;
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [enabled, stationId, onScan]);
}

export function useNow(intervalMs = 250) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return useCallback(() => Date.now(), []);
}

/**
 * Live match against a CSS media query. Used where a layout choice cannot be made
 * in CSS alone — the floor map swaps its whole path geometry on narrow portrait
 * screens, and that lives in the SVG, not in a stylesheet.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}

/** The mobile bracket: anything this narrow gets the phone layout. */
export const MOBILE_QUERY = '(max-width: 839px)';
/** Narrow and taller than wide — the only case the tall floor-map path is used. */
export const MOBILE_PORTRAIT_QUERY = '(max-width: 839px) and (orientation: portrait)';
