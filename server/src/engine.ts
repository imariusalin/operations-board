// The engine turns a flat stream of scans into attributed, per-operator, per-station
// metrics. It knows nothing about where the scans came from — simulator, HTTP post from
// a DENSO or CW45, or a keyboard wedge all land here.
//
// One idea runs through every number below: RATED TIME. A picker is only measured on
// time they could actually pick. Management pauses, scheduled breaks and the no-stock
// allowance are cut out of the clock before any rate is computed.

import {
  BREAKS, COSTS, DAY_START, DESTINATIONS, HOUR_MIN_RATED_MS, IDLE_THRESHOLD_MS, MAX_EVENTS,
  MAX_SCANS, NO_STOCK_ALLOWANCE_MAX_MS, NO_STOCK_ALLOWANCE_MIN_MS, NO_STOCK_ALLOWANCE_MS,
  OPERATORS, PRODUCTS, ROLLING_WINDOW_MS, SETTLE_MIN_MS, SETTLE_MIN_PICKS, SHIFTS, STAFF_LOSSES,
  STATIONS, TARGET_LINES_PER_HOUR, TASKS, TREND_POINTS, TREND_SAMPLE_MS,
  type StationConfig,
} from './config.js';
import type {
  BoardTotals, DestinationCount, HourCell, HourlyReport, LocationFailures, NoStockRecord,
  NotableEvent, NotableKind, ScanEvent, ScheduleMark, SessionSummary, Snapshot,
  StationReport, StationStatus, StationView,
} from './types.js';

let seq = 0;
const nextId = (p: string) => `${p}-${(++seq).toString(36)}`;

const HOUR = 3_600_000;
export { HOUR_MIN_RATED_MS };

interface Interval { from: number; to?: number }

interface Session {
  id: string;
  badgeId: string;
  operatorName: string;
  stationId: string;
  taskCode: string;
  startedAt: number;
  endedAt?: number;
  picks: number;
  /** Timestamps of picks, pruned to a little more than any rolling window needs. */
  recentPicks: number[];
  lastPickAt: number;
  idleMs: number;
  idleOpen: boolean;
  trend: number[];
  lastTrendAt: number;

  paused: boolean;
  pauseReason?: string;
  pauses: Interval[];
  allowances: Interval[];
  fails: number;
  noStock: number;
}

interface HourAcc {
  picks: number; fails: number; noStock: number;
  ratedMs: number; staffedMs: number; pausedMs: number;
  idleMs: number; breakMs: number; disconnects: number; disconnectMs: number;
  pickers: Set<string>;
}

interface StationStats {
  noRead: number; rejected: number; deviceFail: number; disconnects: number;
  locations: Map<string, { noStock: number; barcode: number }>;
}

const stationById = new Map<string, StationConfig>(STATIONS.map((s) => [s.id, s]));
const operatorByBadge = new Map(OPERATORS.map((o) => [o.badgeId, o]));
const taskByCode = new Map(TASKS.map((t) => [t.code, t]));
const productBySku = new Map(PRODUCTS.map((p) => [p.sku, p.name]));

/** Absolute sim time of an HH:MM on the 24h axis that starts at dayStart. */
export function atClock(dayStart: number, hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  const midnight = new Date(dayStart);
  midnight.setHours(0, 0, 0, 0);
  let t = midnight.getTime() + h * HOUR + m * 60_000;
  if (t < dayStart) t += 24 * HOUR;
  return t;
}

export function dayStartFor(base: Date): number {
  const [h, m] = DAY_START.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** Sum of the parts of [a, b] covered by the given intervals (open ones end at b). */
function coveredMs(intervals: Interval[], a: number, b: number): number {
  const clipped: [number, number][] = [];
  for (const iv of intervals) {
    const from = Math.max(a, iv.from);
    const to = Math.min(b, iv.to ?? b);
    if (to > from) clipped.push([from, to]);
  }
  if (clipped.length === 0) return 0;
  clipped.sort((x, y) => x[0] - y[0]);
  let total = 0;
  let [cs, ce] = clipped[0];
  for (let i = 1; i < clipped.length; i++) {
    const [s, e] = clipped[i];
    if (s <= ce) ce = Math.max(ce, e);
    else { total += ce - cs; cs = s; ce = e; }
  }
  return total + (ce - cs);
}

export class Engine {
  private active = new Map<string, Session>();
  private whereIs = new Map<string, string>();
  private events: NotableEvent[] = [];
  private scans: ScanEvent[] = [];
  private destinations = new Map<string, number>();
  private noStockLog: NoStockRecord[] = [];
  private linesTotal = 0;
  private failsTotal = 0;
  private lastTickAt: number;

  readonly dayStart: number;
  readonly schedule: ScheduleMark[];
  /** Breaks that take time out of everyone's rating. */
  private ratingBreaks: Interval[];
  private hours = new Map<string, HourAcc[]>();
  /** Per station: when its scanner was offline. Taken out of the rating like a pause. */
  private offline = new Map<string, Interval[]>();
  private stats = new Map<string, StationStats>();
  private history: Session[] = [];
  private names = new Map<string, string>(OPERATORS.map((o) => [o.badgeId, o.name]));

  constructor(public shiftStartedAt: number) {
    this.dayStart = shiftStartedAt;
    this.lastTickAt = shiftStartedAt;

    this.schedule = [
      ...BREAKS.map((b): ScheduleMark => {
        const from = atClock(this.dayStart, b.at);
        return { from, to: from + b.minutes * 60_000, label: b.label, kind: b.pausesRating ? 'break' : 'flow' };
      }),
      ...STAFF_LOSSES.map((l): ScheduleMark => {
        const at = atClock(this.dayStart, l.at);
        return { from: at, to: at, label: l.label, kind: 'loss' };
      }),
    ].sort((a, b) => a.from - b.from);

    this.ratingBreaks = this.schedule
      .filter((m) => m.kind === 'break')
      .map((m) => ({ from: m.from, to: m.to }));

    for (const s of STATIONS) {
      this.hours.set(s.id, Array.from({ length: 24 }, () => ({
        picks: 0, fails: 0, noStock: 0, ratedMs: 0, staffedMs: 0, pausedMs: 0,
        idleMs: 0, breakMs: 0, disconnects: 0, disconnectMs: 0, pickers: new Set<string>(),
      })));
      this.offline.set(s.id, []);
      this.stats.set(s.id, { noRead: 0, rejected: 0, deviceFail: 0, disconnects: 0, locations: new Map() });
    }
  }

  // ---- time helpers ----------------------------------------------------

  private hourOf(stationId: string, ts: number): HourAcc | undefined {
    const i = Math.floor((ts - this.dayStart) / HOUR);
    if (i < 0 || i > 23) return undefined;
    return this.hours.get(stationId)?.[i];
  }

  inRatingBreak(ts: number): boolean {
    return this.ratingBreaks.some((b) => ts >= b.from && ts < (b.to ?? Infinity));
  }

  activeMark(ts: number): ScheduleMark | undefined {
    return this.schedule.find((m) => m.kind !== 'loss' && ts >= m.from && ts < m.to);
  }

  /** Wall time in [a, b] that counts towards this session's rating. */
  private ratedBetween(s: Session, a: number, b: number): number {
    if (b <= a) return 0;
    return (b - a) - coveredMs(this.excludedFor(s), a, b);
  }

  private excludedFor(s: Session): Interval[] {
    return [...s.pauses, ...s.allowances, ...this.ratingBreaks, ...(this.offline.get(s.stationId) ?? [])];
  }

  isOnline(stationId: string): boolean {
    const iv = this.offline.get(stationId);
    const last = iv?.[iv.length - 1];
    return !last || last.to !== undefined;
  }

  /** Walk back from `now` until `windowMs` of rated time is covered (or the session starts). */
  private ratedWindowStart(s: Session, now: number, windowMs: number): number {
    const excluded = this.excludedFor(s)
      .map((iv) => ({ from: Math.max(iv.from, s.startedAt), to: Math.min(iv.to ?? now, now) }))
      .filter((iv) => iv.to > iv.from)
      .sort((x, y) => y.to - x.to);

    let cursor = now;
    let need = windowMs;
    for (const iv of excluded) {
      if (iv.from >= cursor) continue;
      const end = Math.min(iv.to, cursor);
      const free = cursor - end;
      if (free >= need) return cursor - need;
      need -= free;
      cursor = Math.min(cursor, iv.from);
    }
    return Math.max(s.startedAt, cursor - need);
  }

  // ---- ingest ----------------------------------------------------------

  handle(ev: ScanEvent): NotableEvent[] {
    // Stamp who was at the station, so every scan in the log has a person on it.
    const at = this.active.get(ev.stationId);
    if (ev.kind === 'badge' && ev.badgeId) {
      ev.operatorBadge = ev.badgeId;
      ev.operatorName = this.names.get(ev.badgeId) ?? ev.badgeId;
    } else if (at) {
      ev.operatorBadge = at.badgeId;
      ev.operatorName = at.operatorName;
    }

    this.scans.unshift(ev);
    if (this.scans.length > MAX_SCANS) this.scans.length = MAX_SCANS;

    switch (ev.kind) {
      case 'badge': return this.handleBadge(ev);
      case 'task': return this.handleTask(ev);
      case 'pick': return this.handlePick(ev);
      case 'fail': return this.handleFail(ev);
      case 'nostock': return this.handleNoStock(ev);
      default: return [];
    }
  }

  private handleBadge(ev: ScanEvent): NotableEvent[] {
    const badgeId = ev.badgeId;
    const station = stationById.get(ev.stationId);
    if (!badgeId || !station) return [];
    const operatorName = operatorByBadge.get(badgeId)?.name ?? badgeId;
    const raised: NotableEvent[] = [];
    const currentStation = this.whereIs.get(badgeId);

    if (currentStation === ev.stationId) {
      this.endSession(ev.stationId, ev.ts);
      raised.push(this.raise('logout', ev.ts, station.id, { badgeId, operatorName }));
      return raised;
    }

    let fromStation: string | undefined;
    if (currentStation) {
      fromStation = currentStation;
      this.endSession(currentStation, ev.ts);
    }

    const sitting = this.active.get(ev.stationId);
    if (sitting) {
      this.endSession(ev.stationId, ev.ts);
      raised.push(this.raise('logout', ev.ts, station.id, {
        badgeId: sitting.badgeId, operatorName: sitting.operatorName, detail: 'displaced',
      }));
    }

    this.active.set(ev.stationId, {
      id: nextId('sess'),
      badgeId, operatorName,
      stationId: ev.stationId,
      taskCode: ev.taskCode ?? 'PICK-STD',
      startedAt: ev.ts,
      picks: 0, recentPicks: [], lastPickAt: ev.ts,
      idleMs: 0, idleOpen: false,
      trend: [], lastTrendAt: ev.ts,
      paused: false, pauses: [], allowances: [],
      fails: 0, noStock: 0,
    });
    this.whereIs.set(badgeId, ev.stationId);

    raised.push(
      fromStation
        ? this.raise('move', ev.ts, station.id, { badgeId, operatorName, fromStationId: fromStation })
        : this.raise('login', ev.ts, station.id, { badgeId, operatorName }),
    );
    return raised;
  }

  private handleTask(ev: ScanEvent): NotableEvent[] {
    const session = this.active.get(ev.stationId);
    if (!session || !ev.taskCode) return [];
    session.taskCode = ev.taskCode;
    return [this.raise('task', ev.ts, ev.stationId, {
      badgeId: session.badgeId, operatorName: session.operatorName,
      taskCode: ev.taskCode, detail: taskByCode.get(ev.taskCode)?.label,
    })];
  }

  private handlePick(ev: ScanEvent): NotableEvent[] {
    const session = this.active.get(ev.stationId);
    if (!session) return []; // a pick with nobody badged in is unattributable

    const raised: NotableEvent[] = [];
    const ratedGap = this.ratedBetween(session, session.lastPickAt, ev.ts);
    if (ratedGap > IDLE_THRESHOLD_MS) {
      session.idleMs += ratedGap - IDLE_THRESHOLD_MS;
      if (session.idleOpen) {
        session.idleOpen = false;
        raised.push(this.raise('idle_end', ev.ts, ev.stationId, {
          badgeId: session.badgeId, operatorName: session.operatorName,
          detail: `${Math.round((ratedGap - IDLE_THRESHOLD_MS) / 1000)}s idle`,
        }));
      }
    }

    session.picks += 1;
    session.lastPickAt = ev.ts;
    session.recentPicks.push(ev.ts);
    this.linesTotal += 1;
    const h = this.hourOf(ev.stationId, ev.ts);
    if (h) {
      h.picks += 1;
      h.pickers.add(session.badgeId);
    }

    const dest = ev.destination ?? DESTINATIONS[0];
    this.destinations.set(dest, (this.destinations.get(dest) ?? 0) + 1);
    return raised;
  }

  private handleFail(ev: ScanEvent): NotableEvent[] {
    this.failsTotal += 1;
    const h = this.hourOf(ev.stationId, ev.ts);
    if (h) h.fails += 1;
    const session = this.active.get(ev.stationId);
    if (session) session.fails += 1;
    const st = this.stats.get(ev.stationId);
    if (st) {
      if (ev.failReason === 'rejected') st.rejected += 1;
      else if (ev.failReason === 'device') st.deviceFail += 1;
      else st.noRead += 1;
      if (ev.location) this.locStat(st, ev.location).barcode += 1;
    }
    return [];
  }

  private handleNoStock(ev: ScanEvent): NotableEvent[] {
    const ns = ev.noStock;
    if (!ns) return [];
    const session = this.active.get(ev.stationId);
    const productName = ns.productName ?? productBySku.get(ns.sku) ?? ns.sku;

    this.noStockLog.push({
      ...ns, productName,
      id: nextId('ns'), ts: ev.ts, stationId: ev.stationId,
      badgeId: session?.badgeId, operatorName: session?.operatorName,
    });
    const h = this.hourOf(ev.stationId, ev.ts);
    if (h) h.noStock += 1;
    const st = this.stats.get(ev.stationId);
    if (st) this.locStat(st, ns.location).noStock += 1;

    if (!session) return [];
    session.noStock += 1;
    // Credit the picker the time a no-stock really costs. It runs forward from the
    // selection: back to the station, mark the paper, put the tote aside.
    const allow = Math.min(NO_STOCK_ALLOWANCE_MAX_MS, Math.max(NO_STOCK_ALLOWANCE_MIN_MS, NO_STOCK_ALLOWANCE_MS));
    session.allowances.push({ from: ev.ts, to: ev.ts + allow });

    return [this.raise('no_stock', ev.ts, ev.stationId, {
      badgeId: session.badgeId, operatorName: session.operatorName,
      detail: `${productName} · ${ns.location} · ×${ns.qtyNeeded} · order ${ns.orderId}`,
    })];
  }

  private locStat(st: StationStats, loc: string) {
    let l = st.locations.get(loc);
    if (!l) st.locations.set(loc, (l = { noStock: 0, barcode: 0 }));
    return l;
  }

  // ---- scanner connection ------------------------------------------------

  /**
   * The scanner at a station lost (or regained) its connection — Bluetooth to a CW45's
   * ring scanner, Wi-Fi, a cable. Offline time is taken out of the picker's rating:
   * they cannot scan, and it is not their doing.
   */
  setConnection(stationId: string, connected: boolean, now: number, detail?: string): NotableEvent | null {
    const iv = this.offline.get(stationId);
    if (!iv || this.isOnline(stationId) === connected) return null;
    const s = this.active.get(stationId);
    if (!connected) {
      iv.push({ from: now });
      const h = this.hourOf(stationId, now);
      if (h) h.disconnects += 1;
      this.stats.get(stationId)!.disconnects += 1;
      return this.raise('scanner_lost', now, stationId, {
        badgeId: s?.badgeId, operatorName: s?.operatorName, detail,
      });
    }
    const open = iv[iv.length - 1];
    open.to = now;
    return this.raise('scanner_back', now, stationId, {
      badgeId: s?.badgeId, operatorName: s?.operatorName,
      detail: `offline ${Math.max(1, Math.round((now - open.from) / 1000))}s`,
    });
  }

  // ---- management ------------------------------------------------------

  /**
   * "Take off task by management". The station stays occupied by the same person;
   * only the rating stops until it is switched back on.
   */
  setPaused(stationId: string, paused: boolean, now: number, reason?: string, by?: string): NotableEvent | null {
    const s = this.active.get(stationId);
    if (!s) return null;
    if (s.paused === paused) {
      // Already off task: just update why.
      if (paused && reason) s.pauseReason = reason;
      return null;
    }
    if (paused) {
      s.paused = true;
      s.pauseReason = reason;
      s.pauses.push({ from: now });
      return this.raise('paused', now, stationId, {
        badgeId: s.badgeId, operatorName: s.operatorName, detail: reason, by,
      });
    }
    const open = s.pauses[s.pauses.length - 1];
    if (open && open.to === undefined) open.to = now;
    s.paused = false;
    s.pauseReason = undefined;
    return this.raise('resumed', now, stationId, {
      badgeId: s.badgeId, operatorName: s.operatorName, by,
      detail: open ? `off task ${Math.round((now - open.from) / 60_000)} min` : undefined,
    });
  }

  isPaused(stationId: string): boolean {
    return this.active.get(stationId)?.paused ?? false;
  }

  /** Operator leaves at the end of their shift (the simulator calls this; real life badges out). */
  endShift(badgeId: string, now: number, label: string) {
    const stationId = this.whereIs.get(badgeId);
    if (!stationId) return;
    const s = this.active.get(stationId)!;
    this.endSession(stationId, now);
    this.raise('shift_end', now, stationId, { badgeId, operatorName: s.operatorName, detail: label });
  }

  private endSession(stationId: string, at: number) {
    const session = this.active.get(stationId);
    if (!session) return;
    const open = session.pauses[session.pauses.length - 1];
    if (open && open.to === undefined) open.to = at;
    const ratedGap = this.ratedBetween(session, session.lastPickAt, at);
    if (ratedGap > IDLE_THRESHOLD_MS) session.idleMs += ratedGap - IDLE_THRESHOLD_MS;
    session.endedAt = at;
    this.history.push(session);
    this.active.delete(stationId);
    this.whereIs.delete(session.badgeId);
  }

  private raise(
    kind: NotableKind, ts: number, stationId: string, rest: Partial<NotableEvent> = {},
  ): NotableEvent {
    const ev: NotableEvent = { id: nextId('ev'), ts, kind, stationId, ...rest };
    this.events.unshift(ev);
    if (this.events.length > MAX_EVENTS) this.events.length = MAX_EVENTS;
    return ev;
  }

  // ---- clock -----------------------------------------------------------

  tick(now: number): NotableEvent[] {
    const raised: NotableEvent[] = [];
    const dt = Math.max(0, now - this.lastTickAt);
    this.lastTickAt = now;
    const inBreak = this.inRatingBreak(now);

    for (const [stationId, s] of this.active) {
      const h = this.hourOf(stationId, now);
      const ratedGap = this.ratedBetween(s, s.lastPickAt, now);
      if (h && dt > 0) {
        // Every staffed minute lands in exactly one bucket, in this order, so the
        // station page and the management page add up to the same totals.
        h.staffedMs += dt;
        const lastAllow = s.allowances[s.allowances.length - 1];
        const inAllowance = lastAllow && now >= lastAllow.from && now < (lastAllow.to ?? 0);
        if (s.paused) h.pausedMs += dt;
        else if (inBreak) h.breakMs += dt;
        else if (!this.isOnline(stationId)) h.disconnectMs += dt;
        else if (!inAllowance) {
          h.ratedMs += dt;
          if (ratedGap > IDLE_THRESHOLD_MS) h.idleMs += Math.min(dt, ratedGap - IDLE_THRESHOLD_MS);
        }
      }

      if (!s.idleOpen && ratedGap > IDLE_THRESHOLD_MS) {
        s.idleOpen = true;
        raised.push(this.raise('idle_start', now, stationId, {
          badgeId: s.badgeId, operatorName: s.operatorName,
        }));
      }

      // Sparkline samples only while the rating is running, so a pause or a break
      // shows as a gap in time, not as a cliff.
      if (now - s.lastTrendAt >= TREND_SAMPLE_MS) {
        s.lastTrendAt = now;
        if (!s.paused && !inBreak) {
          s.trend.push(Math.round(this.rollingRate(s, now)));
          if (s.trend.length > TREND_POINTS) s.trend.shift();
        }
      }

      // Keep enough history for a window stretched by a long pause.
      const cutoff = now - 6 * HOUR;
      while (s.recentPicks.length && s.recentPicks[0] < cutoff) s.recentPicks.shift();
      if (s.allowances.length > 400) s.allowances.splice(0, s.allowances.length - 400);
    }
    return raised;
  }

  // ---- derived ---------------------------------------------------------

  private rollingRate(s: Session, now: number): number {
    const start = this.ratedWindowStart(s, now, ROLLING_WINDOW_MS);
    const span = this.ratedBetween(s, start, now);
    if (span < 60_000) return this.sessionRate(s, now);
    let n = 0;
    for (let i = s.recentPicks.length - 1; i >= 0 && s.recentPicks[i] >= start; i--) n++;
    return (n / span) * HOUR;
  }

  private sessionRate(s: Session, now: number): number {
    const rated = this.ratedBetween(s, s.startedAt, now);
    return rated < 1000 ? 0 : (s.picks / rated) * HOUR;
  }

  private viewFor(station: StationConfig, now: number): StationView {
    const s = this.active.get(station.id);
    const base = {
      id: station.id, front: station.front, aisles: station.aisles,
      targetLinesPerHour: TARGET_LINES_PER_HOUR,
    };

    if (!s) {
      return {
        ...base, status: 'empty', timeOnStationMs: 0, ratedMs: 0, picks: 0,
        rollingRate: 0, sessionRate: 0, attainment: 0, settling: false, avgSecPerLine: 0,
        idleMs: 0, currentIdleMs: 0, msSinceLastPick: 0, trend: [],
        paused: false, currentPauseMs: 0, pausedMs: 0,
        fails: 0, failRate: 0, noStock: 0, allowanceMs: 0,
        scannerOnline: this.isOnline(station.id),
      };
    }

    const rolling = this.rollingRate(s, now);
    const attainment = rolling / TARGET_LINES_PER_HOUR;
    const ratedGap = this.ratedBetween(s, s.lastPickAt, now);
    const currentIdleMs = ratedGap > IDLE_THRESHOLD_MS ? ratedGap - IDLE_THRESHOLD_MS : 0;
    const timeOnStationMs = now - s.startedAt;
    const ratedMs = this.ratedBetween(s, s.startedAt, now);

    const pausedMs = coveredMs(s.pauses, s.startedAt, now);
    const openPause = s.paused ? s.pauses[s.pauses.length - 1] : undefined;

    let status: StationStatus;
    if (s.paused) status = 'paused';
    else if (this.inRatingBreak(now)) status = 'break';
    else if (currentIdleMs > 0) status = 'idle';
    else if (attainment >= 1) status = 'above';
    else status = 'below';

    return {
      ...base,
      status,
      operatorName: s.operatorName,
      badgeId: s.badgeId,
      taskCode: s.taskCode,
      taskLabel: taskByCode.get(s.taskCode)?.label,
      timeOnStationMs,
      ratedMs,
      picks: s.picks,
      rollingRate: rolling,
      sessionRate: this.sessionRate(s, now),
      attainment,
      settling: s.picks < SETTLE_MIN_PICKS && ratedMs < SETTLE_MIN_MS,
      avgSecPerLine: s.picks > 0 ? Math.max(0, ratedMs - s.idleMs - currentIdleMs) / s.picks / 1000 : 0,
      idleMs: s.idleMs + currentIdleMs,
      currentIdleMs,
      msSinceLastPick: now - s.lastPickAt,
      trend: s.trend.slice(),
      paused: s.paused,
      pauseReason: s.pauseReason,
      currentPauseMs: openPause ? now - openPause.from : 0,
      pausedMs,
      fails: s.fails,
      failRate: s.fails + s.picks > 0 ? s.fails / (s.fails + s.picks) : 0,
      noStock: s.noStock,
      allowanceMs: coveredMs(s.allowances, s.startedAt, now),
      scannerOnline: this.isOnline(station.id),
    };
  }

  snapshot(now: number, speed: number): Snapshot {
    const stations = STATIONS.map((st) => this.viewFor(st, now));
    const manned = stations.filter((s) => s.status !== 'empty');
    // Paused stations and stations on break are not producing and not being judged,
    // so they come out of both sides of the board rate.
    const rated = manned.filter((s) => s.status !== 'paused' && s.status !== 'break');
    const boardRate = rated.reduce((a, s) => a + s.rollingRate, 0);
    const boardTarget = rated.length * TARGET_LINES_PER_HOUR;

    const totals: BoardTotals = {
      stationsTotal: stations.length,
      stationsManned: manned.length,
      stationsIdle: stations.filter((s) => s.status === 'idle').length,
      stationsPaused: stations.filter((s) => s.status === 'paused').length,
      linesTotal: this.linesTotal,
      boardRate,
      boardTarget,
      boardAttainment: boardTarget > 0 ? boardRate / boardTarget : 0,
      idleMsTotal: stations.reduce((a, s) => a + s.idleMs, 0),
      failsTotal: this.failsTotal,
      failRate: this.failsTotal + this.linesTotal > 0
        ? this.failsTotal / (this.failsTotal + this.linesTotal) : 0,
      noStockTotal: this.noStockLog.length,
    };

    const destinations: DestinationCount[] = [...this.destinations.entries()]
      .map(([destination, count]) => ({ destination, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);

    return {
      type: 'snapshot',
      simNow: now,
      realNow: Date.now(),
      shiftStartedAt: this.shiftStartedAt,
      dayStart: this.dayStart,
      target: TARGET_LINES_PER_HOUR,
      speed,
      stations,
      totals,
      destinations,
      events: this.events.slice(0, 80),
      lastScans: this.scans.slice(0, 14),
      schedule: this.schedule,
      activeMark: this.activeMark(now),
      shifts: SHIFTS,
      rates: COSTS,
    };
  }

  hourly(now: number): HourlyReport {
    const r1 = (ms: number) => Math.round(ms / 6_000) / 10;
    return {
      dayStart: this.dayStart,
      simNow: now,
      target: TARGET_LINES_PER_HOUR,
      schedule: this.schedule,
      stations: STATIONS.map((st) => ({
        id: st.id,
        hours: this.cells(st.id),
      })),
    };
  }

  private cells(stationId: string): HourCell[] {
    const r1 = (ms: number) => Math.round(ms / 6_000) / 10;
    return this.hours.get(stationId)!.map((h): HourCell => ({
      picks: h.picks, fails: h.fails, noStock: h.noStock,
      ratedMin: r1(h.ratedMs), staffedMin: r1(h.staffedMs), pausedMin: r1(h.pausedMs),
      idleMin: r1(h.idleMs), breakMin: r1(h.breakMs),
      disconnects: h.disconnects, disconnectMin: r1(h.disconnectMs),
      pickers: [...h.pickers],
    }));
  }

  private summarise(s: Session, now: number): SessionSummary {
    const end = s.endedAt ?? now;
    const ratedMs = this.ratedBetween(s, s.startedAt, end);
    return {
      badgeId: s.badgeId, operatorName: s.operatorName,
      from: s.startedAt, to: s.endedAt,
      picks: s.picks, ratedMs,
      rate: ratedMs > 60_000 ? (s.picks / ratedMs) * HOUR : 0,
      fails: s.fails, noStock: s.noStock,
      idleMs: s.idleMs, pausedMs: coveredMs(s.pauses, s.startedAt, end),
    };
  }

  /** One station's whole day: hours, every picker who worked there, why lines failed. */
  stationReport(stationId: string, now: number): StationReport | null {
    const st = this.stats.get(stationId);
    if (!st) return null;
    const hours = this.cells(stationId);
    const sessions = [
      ...this.history.filter((s) => s.stationId === stationId),
      ...(this.active.has(stationId) ? [this.active.get(stationId)!] : []),
    ].sort((a, b) => a.startedAt - b.startedAt).map((s) => this.summarise(s, now));

    const locations: LocationFailures[] = [...st.locations.entries()]
      .map(([location, v]) => ({ location, ...v }))
      .sort((a, b) => b.noStock + b.barcode - (a.noStock + a.barcode));

    return {
      id: stationId, dayStart: this.dayStart, simNow: now, target: TARGET_LINES_PER_HOUR,
      hours, sessions, locations,
      reasons: {
        noStock: hours.reduce((a, h) => a + h.noStock, 0),
        noRead: st.noRead, rejected: st.rejected, deviceFail: st.deviceFail,
        disconnects: hours.reduce((a, h) => a + h.disconnects, 0),
        disconnectMin: Math.round(hours.reduce((a, h) => a + h.disconnectMin, 0) * 10) / 10,
      },
      operatorNames: Object.fromEntries(this.names),
    };
  }

  noStock(): NoStockRecord[] {
    return this.noStockLog.slice();
  }

  // ---- for the simulator ------------------------------------------------

  emptyStations(): string[] {
    return STATIONS.filter((s) => !this.active.has(s.id)).map((s) => s.id);
  }

  activeBadges(): string[] {
    return [...this.whereIs.keys()];
  }

  stationOf(badgeId: string): string | undefined {
    return this.whereIs.get(badgeId);
  }
}
