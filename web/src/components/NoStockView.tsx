import { useMemo, useState } from 'react';
import type { NoStockRecord } from '../types';
import { clock, hhmm, int, pseudonym } from '../format';
import MobileCollapse from './MobileCollapse';

/**
 * Every "no stock" a picker selected: which product, from which station and location,
 * how many the order needed, and the order / invoice number — grouped per 30 minutes
 * or per hour.
 */

type Slot = 30 | 60;

interface Props {
  records: NoStockRecord[] | null;
  stationIds: string[];
  anonymise: boolean;
}

export default function NoStockView({ records, stationIds, anonymise }: Props) {
  const [slot, setSlot] = useState<Slot>(30);
  const [station, setStation] = useState<string>('all');
  const [openSlot, setOpenSlot] = useState<number | null>(null);

  const rows = useMemo(
    () => (records ?? []).filter((r) => station === 'all' || r.stationId === station),
    [records, station],
  );

  const slots = useMemo(() => {
    const ms = slot * 60_000;
    const map = new Map<number, NoStockRecord[]>();
    for (const r of rows) {
      const k = Math.floor(r.ts / ms) * ms;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return [...map.entries()].sort((a, b) => b[0] - a[0]).map(([start, list]) => ({ start, end: start + ms, list }));
  }, [rows, slot]);

  const byProduct = useMemo(() => {
    const map = new Map<string, { sku: string; name: string; times: number; qty: number; stations: Set<string>; locations: Set<string> }>();
    for (const r of rows) {
      const p = map.get(r.sku) ?? { sku: r.sku, name: r.productName, times: 0, qty: 0, stations: new Set(), locations: new Set() };
      p.times += 1;
      p.qty += r.qtyNeeded;
      p.stations.add(r.stationId);
      p.locations.add(r.location);
      map.set(r.sku, p);
    }
    return [...map.values()].sort((a, b) => b.times - a.times || b.qty - a.qty);
  }, [rows]);

  const maxSlot = Math.max(1, ...slots.map((s) => s.list.length));
  const who = (r: NoStockRecord) => (!r.badgeId ? '—' : anonymise ? pseudonym(r.badgeId) : r.operatorName ?? r.badgeId);

  const exportCsv = () => {
    const head = ['time', 'station', 'location', 'sku', 'product', 'qty_needed', 'order_invoice_id', 'picker'];
    const lines = rows.map((r) => [
      new Date(r.ts).toISOString(), r.stationId, r.location, r.sku, r.productName,
      r.qtyNeeded, r.orderId, who(r),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const blob = new Blob([[head.join(','), ...lines].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `no-stock-${station}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!records) return <div className="view view--single"><p className="muted-note">Loading…</p></div>;

  return (
    <div className="view view--nostock">
      <div className="ns__bar">
        <div className="seg" role="radiogroup" aria-label="Group by">
          {([30, 60] as Slot[]).map((s) => (
            <button key={s} role="radio" aria-checked={slot === s} className={slot === s ? 'is-on' : ''} onClick={() => setSlot(s)}>
              {s === 30 ? '30 min' : '1 hour'}
            </button>
          ))}
        </div>
        <label className="ctl">
          <span>Station</span>
          <select value={station} onChange={(e) => setStation(e.target.value)}>
            <option value="all">All</option>
            {stationIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <span className="ns__count">{int(rows.length)} no stock · {int(rows.reduce((a, r) => a + r.qtyNeeded, 0))} units short</span>
        <button className="btn" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</button>
      </div>

      <section className="panel ns__slots">
        <h3 className="panel__title">
          Per {slot === 30 ? '30 minutes' : 'hour'}
          <span className="panel__hint">newest first · click a row for the lines</span>
        </h3>
        <div className="ns__scroll">
          {slots.length === 0 && <p className="muted-note">No “no stock” selections yet.</p>}
          {slots.map(({ start, end, list }) => {
            const open = openSlot === start;
            const stationsHit = [...new Set(list.map((r) => r.stationId))].sort();
            return (
              <div key={start} className={`slot${open ? ' is-open' : ''}`}>
                <button className="slot__head" onClick={() => setOpenSlot(open ? null : start)} aria-expanded={open}>
                  <span className="slot__time">{hhmm(start)}–{hhmm(end)}</span>
                  <span className="slot__track"><span style={{ width: `${(list.length / maxSlot) * 100}%` }} /></span>
                  <span className="slot__n">{list.length}</span>
                  <span className="slot__stations">{stationsHit.join(' ')}</span>
                </button>
                {open && <Lines list={list} who={who} />}
              </div>
            );
          })}
        </div>
      </section>

      <MobileCollapse title="By product" hint="most frequent first">
      <section className="panel ns__products">
        <h3 className="panel__title">
          By product
          <span className="panel__hint">most frequent first</span>
        </h3>
        <div className="ns__scroll">
          <table className="tbl tbl--cards">
            <thead>
              <tr><th>Product</th><th>SKU</th><th className="num">Times</th><th className="num">Units</th><th>Stations</th><th>Locations</th></tr>
            </thead>
            <tbody>
              {byProduct.map((p) => (
                <tr key={p.sku}>
                  <td data-label="Product">{p.name}</td>
                  <td data-label="SKU" className="mono">{p.sku}</td>
                  <td data-label="Times" className="num">{p.times}</td>
                  <td data-label="Units" className="num">{p.qty}</td>
                  <td data-label="Stations" className="mono">{[...p.stations].sort().join(' ')}</td>
                  <td data-label="Locations" className="mono">{[...p.locations].sort().join(' ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      </MobileCollapse>

      <MobileCollapse title="All lines" hint="newest first">
      <section className="panel ns__log">
        <h3 className="panel__title">
          All lines
          <span className="panel__hint">newest first</span>
        </h3>
        <div className="ns__scroll">
          <Lines list={[...rows].reverse()} who={who} />
        </div>
      </section>
      </MobileCollapse>
    </div>
  );
}

function Lines({ list, who }: { list: NoStockRecord[]; who: (r: NoStockRecord) => string }) {
  return (
    <table className="tbl tbl--cards">
      <thead>
        <tr>
          <th>Time</th><th>Station</th><th>Location</th><th>Product</th><th>SKU</th>
          <th className="num">Needed</th><th>Order / invoice</th><th>Picker</th>
        </tr>
      </thead>
      <tbody>
        {list.map((r) => (
          <tr key={r.id}>
            <td data-label="Time" className="mono">{clock(r.ts)}</td>
            <td data-label="Station" className="mono">{r.stationId}</td>
            <td data-label="Location" className="mono">{r.location}</td>
            <td data-label="Product">{r.productName}</td>
            <td data-label="SKU" className="mono">{r.sku}</td>
            <td data-label="Needed" className="num">{r.qtyNeeded}</td>
            <td data-label="Order / invoice" className="mono">{r.orderId}</td>
            <td data-label="Picker">{who(r)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
