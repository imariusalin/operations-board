// All demo data and every tunable number. Operator names are fictional placeholders —
// do not replace these with real badge numbers or real names without settling the
// data-protection question first.

// ---- The target -----------------------------------------------------------

/**
 * One target for every station in the manual department, in lines per hour.
 * At or above it is good; anything under it is below.
 */
export const TARGET_LINES_PER_HOUR = 206;

// ---- Money ----------------------------------------------------------------

/**
 * Rates for the director-level handover. EVERY FIGURE HERE IS A PLACEHOLDER —
 * finance owns these numbers, and the report is only as honest as they are.
 * Replace them before the report leaves the department, and keep the currency
 * code in sync with whatever finance reports in.
 *
 * The report never invents a rate: if a number is not derived from one of these,
 * it is not shown in money.
 */
export interface CostRates {
  /**
   * true while these are made-up numbers. The director's review then prints a banner
   * saying so and lists every rate it used, so no figure on it can be mistaken for a
   * finance number. Set it to false in the same edit that puts the real rates in.
   */
  placeholder: boolean;
  /** ISO 4217 code, used for formatting only. */
  currency: string;
  /** Fully loaded cost of one picker-hour on the floor (wage + on-costs). */
  labourPerHour: number;
  /** Contribution lost when a line cannot be picked at all. */
  marginPerLine: number;
  /** Downstream handling of one "no stock" line: re-pick, chase, order admin. */
  shortageHandlingPerLine: number;
}

export const COSTS: CostRates = {
  placeholder: true,
  currency: 'EUR',
  labourPerHour: 24.5,
  marginPerLine: 1.15,
  shortageHandlingPerLine: 2.4,
};

/** What one line should cost in labour when the target is met. */
export const targetCostPerLine = (rates: CostRates = COSTS) =>
  rates.labourPerHour / TARGET_LINES_PER_HOUR;

// ---- Stations -------------------------------------------------------------

export type DeviceKind = 'denso' | 'cw45' | 'zebra' | 'other';

export interface StationConfig {
  /** The station letter, A–L. Also the station's id. */
  id: string;
  /** Positions in front of the picker: B1 … B6. */
  front: string[];
  /** Aisles behind the picker: BA … BH. */
  aisles: string[];
  /** Which scanner the simulator pretends this station uses. Real scans say their own. */
  device: DeviceKind;
}

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L'];
const FRONT_COUNT = 6;
const AISLE_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];

export const STATIONS: StationConfig[] = LETTERS.map((L, i) => ({
  id: L,
  front: Array.from({ length: FRONT_COUNT }, (_, n) => `${L}${n + 1}`),
  aisles: AISLE_LETTERS.map((a) => `${L}${a}`),
  // Demo split only: DENSO handhelds on the left leg, Honeywell CW45 wearables on the right.
  device: i < 6 ? 'denso' : 'cw45',
}));

// ---- The day: breaks, staff loss -----------------------------------------

/**
 * The 24-hour axis starts here. 12:00 means the management chart runs 12:00 → 12:00,
 * so the whole night sits in one unbroken line. The simulated shift also starts here.
 */
export const DAY_START = '12:00';

export interface BreakConfig {
  at: string;          // HH:MM
  minutes: number;
  label: string;
  /**
   * true: pickers are on break, so the time is taken out of everyone's rating.
   * false: pickers keep working but flow slows (e.g. the drivers' break) — it still
   * counts, and it shows on the management chart as a weak point.
   */
  pausesRating: boolean;
}

// Durations are assumptions — set them to the real ones.
export const BREAKS: BreakConfig[] = [
  { at: '17:30', minutes: 30, label: 'Break',          pausesRating: true },
  { at: '21:00', minutes: 30, label: 'Drivers break',  pausesRating: false },
  { at: '22:30', minutes: 30, label: 'Break',          pausesRating: true },
];

export interface StaffLossConfig {
  at: string;
  label: string;
}

export const STAFF_LOSSES: StaffLossConfig[] = [
  { at: '20:00', label: 'Loss staff · end shift (some)' },
  { at: '24:00', label: 'Loss staff · end shift (the 4 × 12h)' },
];

// ---- Shifts ----------------------------------------------------------------

export interface ShiftConfig {
  name: string;
  /** HH:MM. An end at or before the start runs past midnight. */
  start: string;
  end: string;
}

/** The shifts that can be running. Several can overlap (19:00–24:00 is Late and Night). */
export const SHIFTS: ShiftConfig[] = [
  { name: 'Day',   start: '08:00', end: '14:00' },
  { name: 'Late',  start: '14:00', end: '24:00' },
  { name: 'Night', start: '19:00', end: '03:00' },
];

// ---- Operators -------------------------------------------------------------

export interface OperatorConfig {
  badgeId: string;
  name: string;
  /** Multiplier applied to the target. >1 runs above target, <1 below. */
  skill: number;
  /** HH:MM they finish, if they leave before the end of the 24h axis. */
  shiftEnd?: string;
  /** Simulator only: chance an item scan fails to read (dirty label, bad angle). */
  failRate: number;
}

// 14 operators for 12 stations, so there is a bench and rotations have somewhere to go.
// Three finish at 20:00, four are on 12-hour shifts and finish at 24:00.
export const OPERATORS: OperatorConfig[] = [
  { badgeId: 'B-1041', name: 'M. Albescu',    skill: 1.16, failRate: 0.008 },
  { badgeId: 'B-1042', name: 'D. Constantin', skill: 1.10, failRate: 0.012, shiftEnd: '24:00' },
  { badgeId: 'B-1043', name: 'R. Nagy',       skill: 1.12, failRate: 0.010, shiftEnd: '20:00' },
  { badgeId: 'B-1044', name: 'S. Ilie',       skill: 1.03, failRate: 0.015 },
  { badgeId: 'B-1045', name: 'T. Vasilescu',  skill: 0.97, failRate: 0.020, shiftEnd: '24:00' },
  { badgeId: 'B-1046', name: 'L. Marin',      skill: 1.01, failRate: 0.011 },
  { badgeId: 'B-1047', name: 'C. Dobre',      skill: 0.95, failRate: 0.025, shiftEnd: '20:00' },
  { badgeId: 'B-1048', name: 'P. Stan',       skill: 1.05, failRate: 0.009, shiftEnd: '24:00' },
  { badgeId: 'B-1049', name: 'A. Radu',       skill: 0.90, failRate: 0.030 },
  { badgeId: 'B-1050', name: 'G. Lupu',       skill: 0.86, failRate: 0.035, shiftEnd: '24:00' },
  { badgeId: 'B-1051', name: 'I. Farkas',     skill: 0.92, failRate: 0.018, shiftEnd: '20:00' },
  { badgeId: 'B-1052', name: 'V. Neagu',      skill: 0.84, failRate: 0.040 },
  { badgeId: 'B-1053', name: 'E. Barbu',      skill: 1.06, failRate: 0.010 },
  { badgeId: 'B-1054', name: 'N. Toma',       skill: 0.94, failRate: 0.016 },
];

export const TASKS: { code: string; label: string }[] = [
  { code: 'PICK-STD',    label: 'Standard Pick' },
  { code: 'PICK-PHARMA', label: 'Pharma Pick' },
  { code: 'PICK-RTN',    label: 'Returns Handling' },
  { code: 'REPL',        label: 'Replenishment' },
  { code: 'MAN-REG',     label: 'Manual Registration' },
];

export const DESTINATIONS = [
  'LANE-A1', 'LANE-A2', 'LANE-B1', 'LANE-B2',
  'LANE-C1', 'CHUTE-07', 'CHUTE-08', 'CONSOL-1', 'CONSOL-2', 'DIRECT',
];

/** Fictional catalogue for the simulator's no-stock events. */
export const PRODUCTS: { sku: string; name: string }[] = [
  ['4012001', 'Paracetamol 500 mg · 20 tab'], ['4012002', 'Ibuprofen 400 mg · 30 tab'],
  ['4012003', 'Vitamin C 1000 mg · 20 eff'], ['4012004', 'Saline nasal spray 20 ml'],
  ['4012005', 'Cough syrup 150 ml'],         ['4012006', 'Plasters assorted · 40'],
  ['4012007', 'Hand gel 500 ml'],            ['4012008', 'Magnesium 375 mg · 30 tab'],
  ['4012009', 'Throat lozenges · 24'],       ['4012010', 'Antiseptic cream 30 g'],
  ['4012011', 'Elastic bandage 8 cm'],       ['4012012', 'Thermometer digital'],
  ['4012013', 'Eye drops 10 ml'],            ['4012014', 'Probiotic · 10 caps'],
  ['4012015', 'Omega-3 · 60 caps'],          ['4012016', 'Sun cream SPF50 200 ml'],
  ['4012017', 'Zinc 25 mg · 30 tab'],        ['4012018', 'Gauze swabs · 100'],
  ['4012019', 'Antacid · 24 chew'],          ['4012020', 'Iron + folic · 30 tab'],
  ['4012021', 'Allergy relief · 10 tab'],    ['4012022', 'Lip balm 4.8 g'],
  ['4012023', 'Face masks · 50'],            ['4012024', 'Nitrile gloves M · 100'],
  ['4012025', 'Oral rehydration · 10 sach'], ['4012026', 'Calcium + D3 · 30 tab'],
  ['4012027', 'Insect repellent 100 ml'],    ['4012028', 'Cold & flu · 12 sach'],
  ['4012029', 'Wound spray 50 ml'],          ['4012030', 'Baby wipes · 64'],
].map(([sku, name]) => ({ sku, name }));

// ---- Metric tuning ---------------------------------------------------------

/** Window for the headline lines/hour figure, in *rated* time (pauses and breaks skipped). */
export const ROLLING_WINDOW_MS = 10 * 60 * 1000;

/**
 * A gap longer than this counts as idle. Only the excess beyond the threshold is
 * accumulated, so normal pick cadence is never scored as idle time.
 */
export const IDLE_THRESHOLD_MS = 90 * 1000;

/**
 * Time credited back to the picker for every "no stock": look for it, come back,
 * select the option, mark the paper, put the tote aside. Agreed range is 5–10 s.
 */
export const NO_STOCK_ALLOWANCE_MS = 8_000;
export const NO_STOCK_ALLOWANCE_MIN_MS = 5_000;
export const NO_STOCK_ALLOWANCE_MAX_MS = 10_000;

/** How often a rolling-rate sample is appended to each station's sparkline. */
export const TREND_SAMPLE_MS = 60 * 1000;
export const TREND_POINTS = 40;

/** A session needs this many picks OR this much rated time before it gets a verdict. */
export const SETTLE_MIN_PICKS = 8;
export const SETTLE_MIN_MS = 90 * 1000;

/** An hour with less rated time than this is shown, but not judged high or low. */
export const HOUR_MIN_RATED_MS = 5 * 60 * 1000;

/**
 * Simulator only: scanner connection drops. The CW45 talks to its wearable scanner
 * over Bluetooth, so those drop more often than the corded DENSO units.
 * Chance per station per simulated minute.
 */
export const SIM_DISCONNECT_PER_MIN: Record<DeviceKind, number> = {
  denso: 0.0015, cw45: 0.004, zebra: 0.002, other: 0.002,
};

export const MAX_EVENTS = 300;
export const MAX_SCANS = 40;
