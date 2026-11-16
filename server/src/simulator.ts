// Stands in for real hardware. It produces the same ScanEvent shape the HTTP and
// keyboard-wedge adapters produce, so the engine and the UI cannot tell the difference.
// Delete this file and the board still works — it just waits for real scans.

import {
  DESTINATIONS, OPERATORS, PRODUCTS, SIM_DISCONNECT_PER_MIN, STATIONS, TARGET_LINES_PER_HOUR, TASKS,
} from './config.js';
import { atClock, type Engine } from './engine.js';
import type { ScanEvent } from './types.js';

let seq = 0;
const nextId = () => `sim-${(++seq).toString(36)}`;

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];

type Mode = 'working' | 'micro' | 'stall' | 'nostock';

interface SimStation {
  credit: number;
  mode: Mode;
  modeUntil: number;
  drift: number;
}

/** Simulated people work in bursts with pauses; this lifts their working pace so
 *  their averages land around the target rather than all under it. */
const PACE = 1.15;

/** About one line in this many comes up short on the shelf. */
const NO_STOCK_ONE_IN = 140;

const stationById = new Map(STATIONS.map((s) => [s.id, s]));
const opByBadge = new Map(OPERATORS.map((o) => [o.badgeId, o]));

/** Most picks come from the aisles behind; some from the front positions. */
function pickLocation(st: { aisles: string[]; front: string[] }): string {
  return Math.random() < 0.75 ? pick(st.aisles) : pick(st.front);
}

/** Looks like a GS1 element string off a DataMatrix - GTIN, batch, serial. */
function gs1(): string {
  const gtin = `0${Math.floor(rand(5400000000000, 5499999999999))}`;
  const batch = `L${Math.floor(rand(1000, 9999))}`;
  const serial = String(Math.floor(rand(1, 99999999))).padStart(8, '0');
  return `01${gtin}10${batch}21${serial}`;
}

export class Simulator {
  private stations = new Map<string, SimStation>();
  private nextRotationAt = 0;
  private bench: string[] = [];
  private shiftEnds: { badgeId: string; at: number; label: string }[] = [];
  /** stationId -> when its dropped scanner reconnects. */
  private reconnectAt = new Map<string, number>();

  constructor(private engine: Engine) {
    for (const s of STATIONS) {
      this.stations.set(s.id, { credit: 0, mode: 'working', modeUntil: 0, drift: rand(0.95, 1.05) });
    }
  }

  /** Every station manned from the start of the shift; two operators on the bench. */
  seed(now: number) {
    const ops = [...OPERATORS];
    for (const st of STATIONS) {
      const op = ops.shift()!;
      this.signIn(op.badgeId, st.id, now);
    }
    this.bench = ops.map((o) => o.badgeId);
    this.nextRotationAt = now + rand(25, 50) * 60_000;

    for (const o of OPERATORS) {
      if (!o.shiftEnd) continue;
      this.shiftEnds.push({
        badgeId: o.badgeId,
        at: atClock(this.engine.dayStart, o.shiftEnd),
        label: o.shiftEnd === '24:00' ? 'end of 12h shift' : 'end of shift',
      });
    }
  }

  step(simNow: number, simDt: number) {
    const inBreak = this.engine.inRatingBreak(simNow);
    const flow = this.engine.activeMark(simNow);
    // The drivers' break: pickers keep going, but totes arrive slower.
    const flowFactor = flow?.kind === 'flow' ? 0.62 : 1;

    for (const st of STATIONS) {
      const sim = this.stations.get(st.id)!;
      const badge = this.badgeAt(st.id);

      // Scanner connection: drops now and then, comes back after 20 s – 2.5 min.
      const back = this.reconnectAt.get(st.id);
      if (back !== undefined) {
        if (simNow >= back) {
          this.reconnectAt.delete(st.id);
          this.engine.setConnection(st.id, true, simNow);
        }
        continue;
      }
      if (badge && !inBreak && Math.random() < SIM_DISCONNECT_PER_MIN[st.device] * (simDt / 60_000)) {
        this.engine.setConnection(st.id, false, simNow,
          st.device === 'cw45' ? 'CW45 ↔ 8675i Bluetooth link dropped' : 'scanner offline');
        this.reconnectAt.set(st.id, simNow + rand(20, 150) * 1000);
        continue;
      }

      if (!badge || inBreak || this.engine.isPaused(st.id)) continue;

      if (simNow >= sim.modeUntil) this.rollMode(sim, simNow);
      if (sim.mode !== 'working') continue;

      sim.drift = Math.min(1.12, Math.max(0.88, sim.drift + rand(-0.012, 0.012)));
      const op = opByBadge.get(badge);
      const effRate = TARGET_LINES_PER_HOUR * PACE * (op?.skill ?? 1) * sim.drift * flowFactor;

      sim.credit += (effRate * simDt) / 3_600_000;
      while (sim.credit >= 1) {
        sim.credit -= 1;

        // A scan that does not read. The picker rescans, which costs a little time.
        if (Math.random() < (op?.failRate ?? 0.01)) {
          const rejected = Math.random() < 0.2;
          this.emit({
            kind: 'fail', stationId: st.id, raw: rejected ? '0' : 'NR',
            failReason: rejected ? 'rejected' : 'no-read', ts: simNow,
            device: st.device, location: pickLocation(st),
          });
          sim.credit -= 0.15;
        }

        // Shelf is empty: look for it, come back, select the option, mark the paper,
        // put the tote aside. 5–10 seconds lost.
        if (Math.random() < 1 / NO_STOCK_ONE_IN) {
          this.emitNoStock(st.id, simNow);
          sim.mode = 'nostock';
          sim.modeUntil = simNow + rand(5, 10) * 1000;
          sim.credit = 0;
          break;
        }

        this.emit({
          kind: 'pick', stationId: st.id, raw: gs1(),
          destination: pick(DESTINATIONS), ts: simNow, device: st.device,
        });
      }
    }

    for (let i = this.shiftEnds.length - 1; i >= 0; i--) {
      const e = this.shiftEnds[i];
      if (simNow >= e.at) {
        this.shiftEnds.splice(i, 1);
        this.bench = this.bench.filter((b) => b !== e.badgeId);
        this.engine.endShift(e.badgeId, simNow, e.label);
      }
    }

    if (simNow >= this.nextRotationAt) {
      this.rotate(simNow);
      this.nextRotationAt = simNow + rand(30, 70) * 60_000;
    }
  }

  private emitNoStock(stationId: string, ts: number) {
    const st = stationById.get(stationId)!;
    const product = pick(PRODUCTS);
    // Most shortages are in the aisles behind the picker; some at the front positions.
    const location = pickLocation(st);
    const qty = Math.random() < 0.6 ? 1 + Math.floor(rand(0, 3)) : 2 + Math.floor(rand(0, 10));
    const orderId = String(Math.floor(rand(191_000_000, 192_999_999)));
    this.emit({
      kind: 'nostock', stationId, ts, device: st.device,
      raw: `NS|${product.sku}|${location}|${qty}|${orderId}`,
      noStock: { sku: product.sku, productName: product.name, location, qtyNeeded: qty, orderId },
    });
  }

  private rollMode(sim: SimStation, now: number) {
    if (sim.mode !== 'working') {
      sim.mode = 'working';
      sim.modeUntil = now + rand(3, 11) * 60_000;
      return;
    }
    const r = Math.random();
    if (r < 0.35) {
      sim.mode = 'micro';
      sim.modeUntil = now + rand(20, 80) * 1000;
    } else if (r < 0.48) {
      sim.mode = 'stall';
      sim.modeUntil = now + rand(2.5, 6) * 60_000;
    } else {
      sim.modeUntil = now + rand(3, 9) * 60_000;
    }
  }

  /** A bench operator takes over a station; the person they relieve goes to the bench. */
  private rotate(now: number) {
    if (this.bench.length === 0) return;
    const candidates = this.engine.activeBadges().filter((b) => {
      const st = this.engine.stationOf(b);
      return st && !this.engine.isPaused(st);
    });
    if (candidates.length === 0) return;
    const out = pick(candidates);
    const stationId = this.engine.stationOf(out)!;
    const incoming = this.bench.shift()!;
    this.signIn(incoming, stationId, now);
    this.bench.push(out);
  }

  private signIn(badge: string, stationId: string, now: number) {
    this.emit({ kind: 'badge', stationId, badgeId: badge, raw: badge, ts: now });
    const task = Math.random() < 0.7 ? 'PICK-STD' : pick(TASKS).code;
    this.emit({ kind: 'task', stationId, taskCode: task, raw: `T:${task}`, ts: now });
  }

  private badgeAt(stationId: string): string | undefined {
    for (const badge of this.engine.activeBadges()) {
      if (this.engine.stationOf(badge) === stationId) return badge;
    }
    return undefined;
  }

  private emit(partial: Omit<ScanEvent, 'id' | 'receivedAt' | 'source'>) {
    this.engine.handle({ id: nextId(), receivedAt: Date.now(), source: 'simulator', ...partial });
  }
}
