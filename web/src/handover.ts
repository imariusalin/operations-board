// Everything both handovers are built from. The two reports differ in what they show,
// never in how a figure is worked out: one module computes, the components only lay out.
//
// Two documents, two audiences:
//   'ops'  — supervisor → manager. The shift as it was worked: hours, stations, people,
//            what broke, what was short. No money.
//   'exec' — manager → director. The same shift priced: what the hours cost, what the
//            lost time cost, what the shortages put at risk. No per-station detail.

import type { CostRates, HourCell, HourlyReport, NoStockRecord, NotableEvent, ScheduleMark, Snapshot } from './types';
import { hourLabel } from './format';
import type { ShiftWindow } from './shifts';

const HOUR = 3_600_000;

export type HandoverKind = 'ops' | 'exec';

export const HANDOVER_KINDS: { kind: HandoverKind; label: string; from: string; to: string; title: string }[] = [
  { kind: 'ops', label: 'Supervisor → Manager', from: 'Supervisor', to: 'Manager', title: 'Shift handover' },
  { kind: 'exec', label: 'Manager → Director', from: 'Manager', to: 'Director', title: 'Shift performance & cost review' },
];

export const handoverKind = (k: HandoverKind) => HANDOVER_KINDS.find((h) => h.kind === k) ?? HANDOVER_KINDS[0];

export type Cells = ReturnType<typeof sumCells>;

export function sumCells(cells: HourCell[]) {
  return cells.reduce(
    (a, h) => ({
      picks: a.picks + h.picks,
      fails: a.fails + h.fails,
      noStock: a.noStock + h.noStock,
      ratedMin: a.ratedMin + h.ratedMin,
      staffedMin: a.staffedMin + h.staffedMin,
      pausedMin: a.pausedMin + h.pausedMin,
      idleMin: a.idleMin + h.idleMin,
      breakMin: a.breakMin + h.breakMin,
      disconnects: a.disconnects + h.disconnects,
      disconnectMin: a.disconnectMin + h.disconnectMin,
    }),
    { picks: 0, fails: 0, noStock: 0, ratedMin: 0, staffedMin: 0, pausedMin: 0, idleMin: 0, breakMin: 0, disconnects: 0, disconnectMin: 0 },
  );
}

/** Lines per staffed picker-hour: breaks and staff loss pull it down, which is the point. */
export const perPicker = (c: Cells) => (c.staffedMin > 0 ? c.picks / (c.staffedMin / 60) : 0);
/** Lines per rated hour — the figure a picker is judged on. */
export const ratedRate = (c: Cells) => (c.ratedMin > 0 ? (c.picks / c.ratedMin) * 60 : 0);

/**
 * What the shift cost, and what the lost time inside it cost.
 *
 * The engine puts every staffed minute in exactly one bucket — rated, break, off task
 * or scanner offline — and idle minutes sit inside rated. So these costs add up without
 * counting a single minute twice.
 */
export interface Money {
  rates: CostRates;
  /** Paid picker-hours on the floor. */
  staffedHours: number;
  labourCost: number;
  costPerLine: number;
  /** What a line should cost in labour at target. */
  targetCostPerLine: number;
  /** Labour spent above what this output should have cost. Negative = spent under. */
  labourVariance: number;
  /** Paid time that produced nothing, by cause. */
  lost: { idle: number; offTask: number; offline: number; break_: number };
  lostCost: { idle: number; offTask: number; offline: number; break_: number; recoverable: number };
  /** Lines the recoverable lost hours could have produced at target, and their contribution. */
  linesForegone: number;
  foregoneValue: number;
  /** "No stock": lines, units and the contribution plus handling they put at risk. */
  shortageLines: number;
  shortageUnits: number;
  shortageValue: number;
  /**
   * The cost of this shift's lost time and shortages, in one number: wages paid for
   * time that produced nothing, PLUS the contribution those hours would have earned,
   * PLUS the shortages. Three different pockets, so nothing is counted twice.
   */
  exposure: number;
}

export function money(c: Cells, shortageUnits: number, target: number, rates: CostRates): Money {
  const h = (min: number) => Math.max(0, min) / 60;
  const staffedHours = h(c.staffedMin);
  const labourCost = staffedHours * rates.labourPerHour;
  const targetCostPerLine = rates.labourPerHour / target;
  const lost = { idle: h(c.idleMin), offTask: h(c.pausedMin), offline: h(c.disconnectMin), break_: h(c.breakMin) };
  const cost = (hours: number) => hours * rates.labourPerHour;
  const lostCost = {
    idle: cost(lost.idle), offTask: cost(lost.offTask), offline: cost(lost.offline), break_: cost(lost.break_),
    recoverable: cost(lost.idle + lost.offTask + lost.offline),
  };
  const linesForegone = (lost.idle + lost.offTask + lost.offline) * target;
  const foregoneValue = linesForegone * rates.marginPerLine;
  const shortageValue = c.noStock * (rates.marginPerLine + rates.shortageHandlingPerLine);
  return {
    rates,
    staffedHours,
    labourCost,
    costPerLine: c.picks > 0 ? labourCost / c.picks : 0,
    targetCostPerLine,
    labourVariance: labourCost - c.picks * targetCostPerLine,
    lost,
    lostCost,
    linesForegone,
    foregoneValue,
    shortageLines: c.noStock,
    shortageUnits,
    shortageValue,
    exposure: lostCost.recoverable + foregoneValue + shortageValue,
  };
}

export interface ShortageProduct {
  sku: string; name: string; times: number; qty: number; locations: string[];
}

export interface Figures {
  window: ShiftWindow;
  target: number;
  /** Hours of the 24h axis inside the window that have actually started. */
  idx: number[];
  covered: string;
  deptHour: (i: number) => Cells;
  /** Distinct badges that picked at least one line in hour i. */
  hourPickers: (i: number) => number;
  all: Cells;
  pickerCount: number;
  stations: { id: string; cells: Cells; rate: number; pickers: number }[];
  weak: { i: number; cells: Cells }[];
  marks: ScheduleMark[];
  marksIn: (i: number) => ScheduleMark[];
  shortages: NoStockRecord[];
  shortageUnits: number;
  topProducts: ShortageProduct[];
  offTask: NotableEvent[];
  money: Money;
  hourLabelAt: (i: number) => string;
}

export function figures(
  snapshot: Snapshot,
  hourly: HourlyReport,
  noStock: NoStockRecord[],
  w: ShiftWindow,
  weakCount = 3,
): Figures {
  const { dayStart } = hourly;
  const idx = Array.from({ length: 24 }, (_, i) => i).filter((i) => {
    const a = dayStart + i * HOUR;
    return a < w.to && a + HOUR > w.from && a <= snapshot.simNow;
  });

  const deptHour = (i: number) => sumCells(hourly.stations.map((s) => s.hours[i]));
  const hourPickers = (i: number) => new Set(hourly.stations.flatMap((s) => s.hours[i].pickers)).size;
  const all = sumCells(idx.flatMap((i) => hourly.stations.map((s) => s.hours[i])));
  const pickerCount = new Set(idx.flatMap((i) => hourly.stations.flatMap((s) => s.hours[i].pickers))).size;

  const marksIn = (i: number) => {
    const a = dayStart + i * HOUR;
    return hourly.schedule.filter((m) => (m.kind === 'loss' ? m.from >= a && m.from < a + HOUR : m.from < a + HOUR && m.to > a));
  };

  const stations = hourly.stations.map((st) => {
    const cells = sumCells(idx.map((i) => st.hours[i]));
    return {
      id: st.id,
      cells,
      rate: ratedRate(cells),
      pickers: new Set(idx.flatMap((i) => st.hours[i].pickers)).size,
    };
  });

  const weak = idx
    .map((i) => ({ i, cells: deptHour(i) }))
    .filter(({ cells }) => cells.staffedMin >= 30)
    .sort((a, b) => perPicker(a.cells) - perPicker(b.cells))
    .slice(0, weakCount);

  const shortages = noStock.filter((r) => r.ts >= w.from && r.ts < w.to);
  const shortageUnits = shortages.reduce((a, r) => a + r.qtyNeeded, 0);

  const byProduct = new Map<string, ShortageProduct & { locs: Set<string> }>();
  for (const r of shortages) {
    const p = byProduct.get(r.sku) ?? { sku: r.sku, name: r.productName, times: 0, qty: 0, locations: [], locs: new Set<string>() };
    p.times += 1;
    p.qty += r.qtyNeeded;
    p.locs.add(r.location);
    byProduct.set(r.sku, p);
  }
  const topProducts: ShortageProduct[] = [...byProduct.values()]
    .map((p) => ({ sku: p.sku, name: p.name, times: p.times, qty: p.qty, locations: [...p.locs].sort() }))
    .sort((a, b) => b.times - a.times || b.qty - a.qty);

  return {
    window: w,
    target: hourly.target,
    idx,
    covered: idx.length > 0
      ? `${hourLabel(dayStart, idx[0])}–${hourLabel(dayStart, idx[idx.length - 1] + 1)}`
      : 'no data yet',
    deptHour,
    hourPickers,
    all,
    pickerCount,
    stations,
    weak,
    marks: hourly.schedule.filter((m) => m.from < w.to && (m.to > w.from || m.from >= w.from)),
    marksIn,
    shortages,
    shortageUnits,
    topProducts,
    offTask: snapshot.events.filter((e) => (e.kind === 'paused' || e.kind === 'resumed') && e.ts >= w.from && e.ts < w.to),
    money: money(all, shortageUnits, hourly.target, snapshot.rates),
    hourLabelAt: (i: number) => hourLabel(dayStart, i),
  };
}
