import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';

import { OPERATORS, STATIONS, TASKS } from './config.js';
import { Engine, atClock, dayStartFor } from './engine.js';
import { Simulator } from './simulator.js';
import { toScanEvent } from './classify.js';
import type { DeviceKind, NoStockPayload, ServerMessage } from './types.js';

const PORT = Number(process.env.PORT ?? 5174);
/** How far into the shift the server fast-forwards before opening. HH:MM. */
const WARM_TO = process.env.WARM_TO ?? '20:45';

// ---- clock ---------------------------------------------------------------
// The board runs on a simulated clock so a whole night is watchable in minutes.
// Metrics are computed on sim time, so rates still read as real lines/hour.

const shiftStart = dayStartFor(new Date());
let simNow = shiftStart;
let speed = 10;
let lastRealTick = Date.now();

const engine = new Engine(shiftStart);
const simulator = new Simulator(engine);
let simulatorEnabled = true;

// ---- warm up -------------------------------------------------------------
// Fast-forward so the board opens on a night already in progress, with the first
// break and the 20:00 staff loss already on the management chart.

simulator.seed(simNow);
{
  const until = atClock(shiftStart, WARM_TO);
  const STEP = 2_000;
  while (simNow < until) {
    simNow += STEP;
    simulator.step(simNow, STEP);
    engine.tick(simNow);
  }
}

// ---- server --------------------------------------------------------------

const app = Fastify({ logger: false });

// ---- documents -----------------------------------------------------------
// The PDFs in /docs, opened in the browser at a short address.

const DOCS: Record<string, { file: string; name: string }> = {
  '/how-it-works': { file: 'Ops_Live_Board_How_It_Works.pdf', name: 'How it works.pdf' },
  '/sample-handover': { file: 'sample-handover.pdf', name: 'Sample handover.pdf' },
  '/how-it-works-technical': { file: 'Ops_Live_Board_How_It_Works_technical.pdf', name: 'How it works - technical.pdf' },
  '/project-flow': { file: 'Ops_Live_Board_Project_Flow.pdf', name: 'Project flow.pdf' },
};

for (const [route, doc] of Object.entries(DOCS)) {
  app.get(route, async (_req, reply) => {
    try {
      const pdf = await readFile(fileURLToPath(new URL(`../../docs/${doc.file}`, import.meta.url)));
      return reply
        .header('content-type', 'application/pdf')
        .header('content-disposition', `inline; filename="${doc.name}"`)
        .send(pdf);
    } catch {
      return reply.code(404).send({ error: `docs/${doc.file} not found` });
    }
  });
}

app.get('/api/health', async () => ({ ok: true, simNow, speed }));
app.get('/api/state', async () => engine.snapshot(simNow, speed));
app.get('/api/hourly', async () => engine.hourly(simNow));
app.get('/api/nostock', async () => ({ simNow, records: engine.noStock() }));

app.get<{ Params: { id: string } }>('/api/station/:id', async (req, reply) => {
  const report = engine.stationReport(req.params.id, simNow);
  return report ?? reply.code(404).send({ error: `unknown station ${req.params.id}` });
});

/**
 * Scanner connection status. A CW45 app reports its ring scanner's Bluetooth link here;
 * a DENSO base station or MDM heartbeat can do the same.
 * Body: { stationId, connected: boolean, detail? }
 */
app.post<{ Body: { stationId?: string; connected?: boolean; detail?: string } }>(
  '/api/device',
  async (req, reply) => {
    const { stationId, connected, detail } = req.body ?? {};
    if (!stationId || typeof connected !== 'boolean') {
      return reply.code(400).send({ error: 'stationId and connected are required' });
    }
    if (!STATIONS.some((s) => s.id === stationId)) return reply.code(404).send({ error: `unknown station ${stationId}` });
    engine.setConnection(stationId, connected, simNow, detail?.slice(0, 80));
    broadcast(engine.snapshot(simNow, speed));
    return { online: engine.isOnline(stationId) };
  },
);

app.get('/api/config', async () => ({
  stations: STATIONS,
  tasks: TASKS,
  operators: OPERATORS.map((o) => ({ badgeId: o.badgeId, name: o.name })),
}));

const DEVICES: DeviceKind[] = ['denso', 'cw45', 'zebra', 'other'];
const asDevice = (d: unknown): DeviceKind | undefined =>
  DEVICES.includes(d as DeviceKind) ? (d as DeviceKind) : undefined;

/**
 * Real-scanner ingest. DENSO (keyboard wedge via the board, or its own HTTP client),
 * Honeywell CW45 (small Android app or an intent-to-HTTP bridge), Zebra DataWedge.
 *
 * Body: { raw, stationId, source?, device?, status?: 'fail', noStock? }
 *   status 'fail'  — the device reported a failed decode (CW45 onFailureEvent).
 *   noStock        — the picker chose "no stock": { sku, location, qtyNeeded, orderId }.
 */
app.post<{ Body: {
  raw?: string; stationId?: string; source?: string; device?: string;
  status?: string; noStock?: NoStockPayload; location?: string;
} }>('/api/scan', async (req, reply) => {
  const { raw, stationId, status, noStock } = req.body ?? {};
  if (!stationId || (!raw && status !== 'fail' && !noStock)) {
    return reply.code(400).send({ error: 'stationId and raw are required' });
  }
  if (!STATIONS.some((s) => s.id === stationId)) {
    return reply.code(404).send({ error: `unknown station ${stationId}` });
  }
  const source = req.body.source === 'wedge' ? 'wedge' : 'http';
  const event = toScanEvent({
    raw: raw ?? (status === 'fail' ? 'NR' : 'NS'),
    stationId, source, ts: simNow,
    device: asDevice(req.body.device),
    failed: status === 'fail',
    noStock,
  });
  if (req.body.location) event.location = String(req.body.location).toUpperCase().slice(0, 12);
  engine.handle(event);
  broadcast(engine.snapshot(simNow, speed));
  return { accepted: true, classifiedAs: event.kind };
});

/** Same as a no-stock scan, for systems that post JSON rather than a barcode string. */
app.post<{ Body: Partial<NoStockPayload> & { stationId?: string; device?: string } }>(
  '/api/nostock',
  async (req, reply) => {
    const b = req.body ?? {};
    if (!b.stationId || !b.sku || !b.location || !b.orderId) {
      return reply.code(400).send({ error: 'stationId, sku, location and orderId are required' });
    }
    if (!STATIONS.some((s) => s.id === b.stationId)) {
      return reply.code(404).send({ error: `unknown station ${b.stationId}` });
    }
    const noStock: NoStockPayload = {
      sku: String(b.sku), productName: b.productName, location: String(b.location).toUpperCase(),
      qtyNeeded: Math.max(1, Number(b.qtyNeeded) || 1), orderId: String(b.orderId),
    };
    engine.handle(toScanEvent({
      raw: `NS|${noStock.sku}|${noStock.location}|${noStock.qtyNeeded}|${noStock.orderId}`,
      stationId: b.stationId, source: 'http', ts: simNow, device: asDevice(b.device), noStock,
    }));
    broadcast(engine.snapshot(simNow, speed));
    return { accepted: true };
  },
);

/** "Take off task by management": { paused: true, reason? } pauses, { paused: false } resumes. */
app.post<{ Params: { id: string }; Body: { paused?: boolean; reason?: string; by?: string } }>(
  '/api/station/:id/pause',
  async (req, reply) => {
    const { id } = req.params;
    if (!STATIONS.some((s) => s.id === id)) return reply.code(404).send({ error: `unknown station ${id}` });
    if (typeof req.body?.paused !== 'boolean') return reply.code(400).send({ error: 'paused must be true or false' });
    engine.setPaused(id, req.body.paused, simNow, req.body.reason?.slice(0, 80), req.body.by?.slice(0, 60));
    broadcast(engine.snapshot(simNow, speed));
    return { paused: engine.isPaused(id) };
  },
);

app.post<{ Body: { speed?: number; simulator?: boolean } }>('/api/control', async (req, reply) => {
  const body = req.body ?? {};
  if (typeof body.speed === 'number') {
    if (body.speed < 0 || body.speed > 600) {
      return reply.code(400).send({ error: 'speed must be between 0 and 600' });
    }
    speed = body.speed;
  }
  if (typeof body.simulator === 'boolean') simulatorEnabled = body.simulator;
  return { speed, simulator: simulatorEnabled };
});

// ---- websocket -----------------------------------------------------------

const clients = new Set<WebSocket>();

function broadcast(msg: ServerMessage) {
  const payload = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

await app.listen({ port: PORT, host: '::' });

const wss = new WebSocketServer({ server: app.server, path: '/ws' });

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(engine.snapshot(simNow, speed)));
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

// ---- tick ----------------------------------------------------------------

const TICK_MS = 100;
const PUSH_EVERY_MS = 500;
let sincePush = 0;

setInterval(() => {
  const realNow = Date.now();
  const realDt = realNow - lastRealTick;
  lastRealTick = realNow;

  // Advance in slices of at most 2 sim-seconds so high speeds stay as accurate as warmup.
  let remaining = realDt * speed;
  while (remaining > 0) {
    const step = Math.min(2_000, remaining);
    remaining -= step;
    simNow += step;
    if (simulatorEnabled) simulator.step(simNow, step);
    engine.tick(simNow);
  }

  sincePush += realDt;
  if (sincePush >= PUSH_EVERY_MS) {
    sincePush = 0;
    if (clients.size > 0) broadcast(engine.snapshot(simNow, speed));
  }
}, TICK_MS);

console.log(`ops-live-board server on http://localhost:${PORT}  (ws://localhost:${PORT}/ws)`);
console.log(`day starts ${new Date(shiftStart).toLocaleTimeString()}, warmed up to ${new Date(simNow).toLocaleTimeString()}, speed ${speed}x`);
