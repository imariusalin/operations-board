// Barcode classifier. Every ingest adapter sees one flat stream of strings and has to
// work out what each one is: a badge, a task, a picked line, a failed scan, or a
// "no stock" selection.
//
// THIS IS THE FILE YOU RETUNE FIRST when real barcodes arrive. Capture a sample of each
// real barcode type on site (badge, tote, item, location) and encode the rules here.

import type { DeviceKind, FailReason, NoStockPayload, ScanEvent, ScanKind, ScanSource } from './types.js';
import { DESTINATIONS, PRODUCTS, TASKS } from './config.js';

const TASK_CODES = new Set(TASKS.map((t) => t.code));
const productBySku = new Map(PRODUCTS.map((p) => [p.sku, p.name]));

/**
 * What scanners send when the trigger was pulled but nothing decoded.
 * Honeywell's default No Read message is "NR"; Zebra's Transmit No Read is also "NR".
 * For DENSO, set the model's read-error output to one of these strings (or add yours).
 */
const NO_READ = /^(NR|NOREAD|NO[ _-]?READ|ERROR|ERR|NG|<NG>|\?{2,})$/i;

export interface ClassifyInput {
  raw: string;
  stationId: string;
  source: ScanSource;
  device?: DeviceKind;
  ts: number;
  destination?: string;
  /** The device itself said the scan failed (CW45 onFailureEvent, for instance). */
  failed?: boolean;
  noStock?: NoStockPayload;
}

export interface Classification {
  kind: ScanKind;
  badgeId?: string;
  taskCode?: string;
  failReason?: FailReason;
  noStock?: NoStockPayload;
}

/**
 * NS|<sku>|<location>|<qty>|<order>   e.g.  NS|4012007|BC|3|191829455
 * The picker's "no stock" option, if the device sends it as a string.
 */
function parseNoStock(value: string): NoStockPayload | undefined {
  const parts = value.split('|');
  if (parts.length < 5 || parts[0].toUpperCase() !== 'NS') return undefined;
  const [, sku, location, qty, orderId] = parts;
  return {
    sku: sku.trim(),
    productName: productBySku.get(sku.trim()),
    location: location.trim().toUpperCase(),
    qtyNeeded: Math.max(1, parseInt(qty, 10) || 1),
    orderId: orderId.trim(),
  };
}

export function classify(raw: string): Classification {
  const value = raw.trim();

  if (NO_READ.test(value)) return { kind: 'fail', failReason: 'no-read' };

  if (/^B-\d{3,6}$/i.test(value)) return { kind: 'badge', badgeId: value.toUpperCase() };

  const ns = parseNoStock(value);
  if (ns) return { kind: 'nostock', noStock: ns };

  if (value.startsWith('T:')) {
    const code = value.slice(2).toUpperCase();
    if (TASK_CODES.has(code)) return { kind: 'task', taskCode: code };
    // A T: prefix we do not know is a mis-scan of a task card, not a picked line.
    return { kind: 'fail', failReason: 'rejected' };
  }
  if (TASK_CODES.has(value.toUpperCase())) return { kind: 'task', taskCode: value.toUpperCase() };

  // Too short or full of control characters to be any real item label: a bad decode.
  if (value.length < 4 || /[\x00-\x1f]/.test(value)) return { kind: 'fail', failReason: 'rejected' };

  return { kind: 'pick' };
}

let seq = 0;

export function toScanEvent(input: ClassifyInput): ScanEvent {
  let c: Classification;
  if (input.failed) c = { kind: 'fail', failReason: 'device' };
  else if (input.noStock) c = { kind: 'nostock', noStock: input.noStock };
  else c = classify(input.raw);

  return {
    id: `in-${(++seq).toString(36)}`,
    ts: input.ts,
    receivedAt: Date.now(),
    source: input.source,
    device: input.device,
    stationId: input.stationId,
    raw: input.raw,
    kind: c.kind,
    badgeId: c.badgeId,
    taskCode: c.taskCode,
    failReason: c.failReason,
    noStock: c.noStock,
    destination:
      c.kind === 'pick'
        ? input.destination ?? DESTINATIONS[Math.floor(Math.random() * DESTINATIONS.length)]
        : undefined,
  };
}
