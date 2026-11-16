import { useCallback, useState } from 'react';
import type { DeviceKind, ScanEvent, StationView } from '../types';
import { sendScan, useKeyboardWedge } from '../useBoard';
import { clock, pseudonym } from '../format';

interface Props {
  stations: StationView[];
  lastScans: ScanEvent[];
  anonymise: boolean;
}

const DEVICE_LABEL: Record<DeviceKind, string> = {
  denso: 'DENSO',
  cw45: 'CW45',
  zebra: 'Zebra',
  other: 'other',
};

/**
 * Proves the ingest path. Wedge mode captures a scanner in keyboard mode (a DENSO
 * handheld, or a CW45 set to keyboard output) anywhere on the page; the manual field
 * does the same thing without hardware. Both post to /api/scan.
 */
export default function ScanPanel({ stations, lastScans, anonymise }: Props) {
  const [stationId, setStationId] = useState(stations[0]?.id ?? 'A');
  const [wedge, setWedge] = useState(false);
  const [manual, setManual] = useState('');
  const [flash, setFlash] = useState<string | null>(null);

  const onScan = useCallback((raw: string) => {
    setFlash(raw);
    setTimeout(() => setFlash(null), 1200);
  }, []);

  useKeyboardWedge(wedge, stationId, onScan);

  const send = async (raw: string) => {
    const res = await sendScan(raw, stationId);
    onScan(`${raw} → ${res.classifiedAs ?? 'rejected'}`);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const raw = manual.trim();
    if (!raw) return;
    await send(raw);
    setManual('');
  };

  const st = stations.find((s) => s.id === stationId);
  const sampleNoStock = `NS|4012007|${st?.aisles[2] ?? 'AC'}|3|191829455`;

  return (
    <section className="panel">
      <h3 className="panel__title">
        Scanner ingest
        <span className="panel__hint">DENSO · Honeywell CW45 · Zebra</span>
      </h3>

      <div className="scan__row">
        <label className="ctl">
          <span>Station</span>
          <select value={stationId} onChange={(e) => setStationId(e.target.value)}>
            {stations.map((s) => <option key={s.id} value={s.id}>Station {s.id}</option>)}
          </select>
        </label>

        <label className="ctl ctl--check">
          <input type="checkbox" checked={wedge} onChange={(e) => setWedge(e.target.checked)} />
          <span>Keyboard wedge</span>
        </label>

        <button className="btn btn--ghost" onClick={() => void send('NR')}>Test: failed scan</button>
        <button className="btn btn--ghost" onClick={() => void send(sampleNoStock)}>Test: no stock</button>
      </div>

      {wedge && (
        <p className="scan__note">
          Listening for scanner bursts. Click anywhere outside a field, then scan — a scanner
          types faster than a human, which is how we tell them apart.
        </p>
      )}

      <form className="scan__form" onSubmit={submit}>
        <input
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="B-1041, T:PICK-STD, NR, NS|sku|loc|qty|order, or any item barcode"
          aria-label="Manual barcode entry"
        />
        <button type="submit">Send</button>
      </form>

      {flash && <div className="scan__flash">captured {flash}</div>}

      <ol className="scans">
        {lastScans.map((s) => (
          <li key={s.id} className="scans__row">
            <span className="scans__time">{clock(s.ts)}</span>
            <span className={`scans__kind scans__kind--${s.kind}`}>{s.kind === 'fail' ? `fail · ${s.failReason}` : s.kind}</span>
            <span className="scans__station">{s.stationId}{s.location ? ` · ${s.location}` : ''}</span>
            <span className="scans__who">
              {!s.operatorBadge ? '—' : anonymise ? pseudonym(s.operatorBadge) : s.operatorName ?? s.operatorBadge}
            </span>
            <code className="scans__raw">{s.raw}</code>
            <span className={`scans__src scans__src--${s.source}`}>{s.device ? DEVICE_LABEL[s.device] : s.source}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}
