import type { ShiftDef } from './types';

const HOUR = 3_600_000;

export interface ShiftWindow {
  name: string;
  label: string;
  from: number;
  to: number;
}

function at(base: number, hhmm: string, dayOffset: number): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(0, 0, 0, 0);
  return d.getTime() + (dayOffset * 24 + h) * HOUR + m * 60_000;
}

export const shiftLabel = (s: ShiftDef) => `${s.name} ${s.start}–${s.end}`;

/**
 * The occurrence of a shift that matters right now: the one running, or else the most
 * recent one that has started. A shift whose end is at or before its start runs past midnight.
 */
export function shiftWindow(s: ShiftDef, now: number): ShiftWindow {
  const candidates = [-1, 0, 1].map((off) => {
    const from = at(now, s.start, off);
    let to = at(now, s.end, off);
    if (to <= from) to += 24 * HOUR;
    return { from, to };
  });
  const running = candidates.find((c) => now >= c.from && now < c.to);
  const started = candidates.filter((c) => c.from <= now).sort((a, b) => b.from - a.from)[0];
  const w = running ?? started ?? candidates[0];
  return { name: s.name, label: shiftLabel(s), ...w };
}

export function runningShifts(defs: ShiftDef[], now: number): ShiftWindow[] {
  return defs.map((d) => shiftWindow(d, now)).filter((w) => now >= w.from && now < w.to);
}
