// Canonical event + view shapes. The web app has a mirrored copy in web/src/types.ts —
// keep them in sync (a prototype trade-off; promote to a shared package when this grows).

/** Every ingest source normalises to this shape. Simulator, HTTP, keyboard wedge, serial. */
export type ScanSource = 'simulator' | 'http' | 'wedge' | 'serial';

/** Which physical scanner sent it, when the source knows. */
export type DeviceKind = 'denso' | 'cw45' | 'zebra' | 'other';

/**
 * badge   — operator badge
 * task    — task selection
 * pick    — a picked line (item scan that decoded)
 * fail    — a scan that did not work: no-read from the scanner, or a rejected barcode
 * nostock — the picker selected "no stock"
 */
export type ScanKind = 'badge' | 'task' | 'pick' | 'fail' | 'nostock';

export type FailReason = 'no-read' | 'rejected' | 'device';

export interface NoStockPayload {
  sku: string;
  productName?: string;
  location: string;
  qtyNeeded: number;
  orderId: string;
}

export interface ScanEvent {
  id: string;
  /** Simulated epoch ms — metrics are computed on this clock. */
  ts: number;
  /** Real epoch ms the server received it. */
  receivedAt: number;
  source: ScanSource;
  device?: DeviceKind;
  stationId: string;
  /** The raw barcode string as the scanner delivered it. */
  raw: string;
  kind: ScanKind;
  badgeId?: string;
  taskCode?: string;
  destination?: string;
  failReason?: FailReason;
  noStock?: NoStockPayload;
  /** Where the picker was picking from, when the source knows (e.g. "BC", "B4"). */
  location?: string;
  /** Who was badged in at the station when the scan arrived (filled in by the engine). */
  operatorName?: string;
  operatorBadge?: string;
}

/**
 * above  — at or over the 206 target (good)
 * below  — under it
 * idle   — no line for longer than the idle threshold
 * paused — taken off task by management; rating stopped, station still occupied
 * break  — scheduled break; rating stopped for everyone
 * empty  — nobody badged in
 */
export type StationStatus = 'above' | 'below' | 'idle' | 'paused' | 'break' | 'empty';

export interface StationView {
  id: string;
  front: string[];
  aisles: string[];
  targetLinesPerHour: number;
  status: StationStatus;

  operatorName?: string;
  badgeId?: string;
  taskCode?: string;
  taskLabel?: string;

  /** ms since badge-in on this station (wall time). */
  timeOnStationMs: number;
  /** Time that counts towards the rating: on station minus pauses, breaks, no-stock allowance. */
  ratedMs: number;
  picks: number;
  /** lines/h over the rolling window of rated time — the headline number. */
  rollingRate: number;
  /** lines/h across the whole session's rated time. */
  sessionRate: number;
  /** rollingRate / target. */
  attainment: number;
  /** Too few picks so far for the rate to mean anything. */
  settling: boolean;
  avgSecPerLine: number;
  idleMs: number;
  currentIdleMs: number;
  msSinceLastPick: number;
  trend: number[];

  /** Taken off task by management. */
  paused: boolean;
  pauseReason?: string;
  /** Length of the current pause, 0 if not paused. */
  currentPauseMs: number;
  /** All pause time this session. */
  pausedMs: number;

  /** Scans that did not work, this session. */
  fails: number;
  /** fails ÷ (fails + picks). */
  failRate: number;
  /** "No stock" selections this session. */
  noStock: number;
  /** Time credited back for those no-stocks. */
  allowanceMs: number;
  /** false while the station's scanner has lost its connection. */
  scannerOnline: boolean;
}

export type NotableKind =
  | 'login'
  | 'logout'
  | 'move'
  | 'task'
  | 'idle_start'
  | 'idle_end'
  | 'paused'
  | 'resumed'
  | 'no_stock'
  | 'shift_end'
  | 'scanner_lost'
  | 'scanner_back';

export interface NotableEvent {
  id: string;
  ts: number;
  kind: NotableKind;
  stationId: string;
  badgeId?: string;
  operatorName?: string;
  fromStationId?: string;
  taskCode?: string;
  detail?: string;
  /** Who performed it, when it was not the picker (e.g. the manager who paused them). */
  by?: string;
}

export interface BoardTotals {
  stationsTotal: number;
  stationsManned: number;
  stationsIdle: number;
  stationsPaused: number;
  linesTotal: number;
  boardRate: number;
  boardTarget: number;
  boardAttainment: number;
  idleMsTotal: number;
  failsTotal: number;
  failRate: number;
  noStockTotal: number;
}

export interface DestinationCount {
  destination: string;
  count: number;
}

export interface ScheduleMark {
  /** Epoch ms (sim clock). */
  from: number;
  to: number;
  label: string;
  kind: 'break' | 'flow' | 'loss';
}

/** Rates the director-level handover prices time and shortages with. Set in config.ts. */
export interface CostRates {
  /** true while the rates are invented. The review then prints them, labelled. */
  placeholder: boolean;
  currency: string;
  labourPerHour: number;
  marginPerLine: number;
  shortageHandlingPerLine: number;
}

export interface Snapshot {
  type: 'snapshot';
  simNow: number;
  realNow: number;
  shiftStartedAt: number;
  /** Start of the 24h axis. */
  dayStart: number;
  target: number;
  speed: number;
  stations: StationView[];
  totals: BoardTotals;
  destinations: DestinationCount[];
  events: NotableEvent[];
  lastScans: ScanEvent[];
  schedule: ScheduleMark[];
  /** The break running right now, if any. */
  activeMark?: ScheduleMark;
  shifts: ShiftDef[];
  /** Cost rates for the handover. Placeholders until finance sets them. */
  rates: CostRates;
}

export interface ShiftDef {
  name: string;
  start: string;
  end: string;
}

export interface NoStockRecord extends NoStockPayload {
  id: string;
  ts: number;
  stationId: string;
  badgeId?: string;
  operatorName?: string;
  productName: string;
}

/** One hour of one station. Minutes are rounded to 0.1. */
export interface HourCell {
  picks: number;
  fails: number;
  noStock: number;
  /** Minutes that counted towards the rating. */
  ratedMin: number;
  /** Minutes someone was badged in, whether rated or not. */
  staffedMin: number;
  pausedMin: number;
  /** Minutes over the idle threshold while rated. */
  idleMin: number;
  /** Minutes badged in during a scheduled break that pauses the rating. */
  breakMin: number;
  /** Times the scanner lost its connection (counted in the hour it dropped). */
  disconnects: number;
  /** Minutes badged in with the scanner offline. */
  disconnectMin: number;
  /** Badges of everyone who picked at least one line here in the hour. */
  pickers: string[];
}

export interface HourlyReport {
  dayStart: number;
  simNow: number;
  target: number;
  stations: { id: string; hours: HourCell[] }[];
  schedule: ScheduleMark[];
}

export interface SessionSummary {
  badgeId: string;
  operatorName: string;
  from: number;
  /** Undefined while still badged in. */
  to?: number;
  picks: number;
  ratedMs: number;
  rate: number;
  fails: number;
  noStock: number;
  idleMs: number;
  pausedMs: number;
}

export interface LocationFailures {
  location: string;
  noStock: number;
  barcode: number;
}

/** Everything about one station today. Totals agree with /api/hourly by construction. */
export interface StationReport {
  id: string;
  dayStart: number;
  simNow: number;
  target: number;
  hours: HourCell[];
  sessions: SessionSummary[];
  reasons: {
    noStock: number;
    noRead: number;
    rejected: number;
    deviceFail: number;
    disconnects: number;
    disconnectMin: number;
  };
  locations: LocationFailures[];
  operatorNames: Record<string, string>;
}

export type ServerMessage = Snapshot;
