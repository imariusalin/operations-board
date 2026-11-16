import type { StationReport, StationView } from '../types';
// The handover and this page add up the same cells, so the sum lives in one place.
import { sumCells } from '../handover';
export { sumCells };
import { hhmm, hourLabel, int, mins, minutes, pct, pct1, pseudonym } from '../format';
import { useStationReport } from '../useBoard';
import { statusLabel, toneColor, toneOf } from '../status';
import HourChart, { type HourBar } from './HourChart';
import { HOUR_MIN_RATED_MIN } from './labels';
import MobileCollapse from './MobileCollapse';

/**
 * One station's whole day. Every day-level number here is the sum of the same hourly
 * cells the Management page sums, so the two pages always agree.
 */

const HOUR = 3_600_000;

interface Props {
  station: StationView;
  stations: StationView[];
  simNow: number;
  anonymise: boolean;
  onPick: (id: string) => void;
  onBack: () => void;
  onOpenMap: (id: string) => void;
}




export default function StationPage({ station: s, stations, simNow, anonymise, onPick, onBack, onOpenMap }: Props) {
  const report = useStationReport(s.id);
  const tone = toneOf(s);
  const name = (badge: string, r?: StationReport) =>
    anonymise ? pseudonym(badge) : r?.operatorNames[badge] ?? badge;

  return (
    <div className="view view--station" style={{ ['--accent' as string]: toneColor(tone) }}>
      <header className="sp__head">
        <button className="btn btn--ghost" onClick={onBack}>← All stations</button>
        <span className="sp__letter">{s.id}</span>
        <div className="sp__ident">
          <h2>Station {s.id}</h2>
          <span>
            Front {s.front[0]}–{s.front[s.front.length - 1]} · Aisles {s.aisles[0]}–{s.aisles[s.aisles.length - 1]}
            {' · '}
            {s.badgeId ? <>now: <b>{anonymise ? pseudonym(s.badgeId) : s.operatorName}</b></> : 'nobody badged in'}
            {!s.scannerOnline && <b className="sp__offline"> · scanner offline</b>}
          </span>
        </div>
        <span className="pill">{statusLabel(s)}</span>
        <button className="btn btn--ghost" onClick={() => onOpenMap(s.id)}>Open on map</button>
        {/* Phones get a dropdown instead of twelve chips; desktop keeps the chips. */}
        <label className="sp__select ctl">
          <span>Station</span>
          <select value={s.id} onChange={(e) => onPick(e.target.value)}>
            {stations.map((x) => <option key={x.id} value={x.id}>Station {x.id} · {statusLabel(x).toLowerCase()}</option>)}
          </select>
        </label>
        <nav className="sp__switch" aria-label="Other stations">
          {stations.map((x) => (
            <button
              key={x.id}
              className={`sp__chip sp__chip--${toneOf(x)}${x.id === s.id ? ' is-on' : ''}`}
              style={{ ['--accent' as string]: toneColor(toneOf(x)) }}
              onClick={() => onPick(x.id)}
              aria-current={x.id === s.id ? 'page' : undefined}
            >
              {x.id}
            </button>
          ))}
        </nav>
      </header>

      {!report ? (
        <p className="muted-note">Loading station history…</p>
      ) : (
        <Body report={report} simNow={simNow} name={(b) => name(b, report)} />
      )}
    </div>
  );
}

function Body({ report: r, simNow, name }: { report: StationReport; simNow: number; name: (b: string) => string }) {
  const nowIndex = Math.floor((simNow - r.dayStart) / HOUR);
  const t = sumCells(r.hours);
  const rate = t.ratedMin > 0 ? (t.picks / t.ratedMin) * 60 : 0;
  const pickersToday = new Set(r.hours.flatMap((h) => h.pickers));
  const failedLocations = r.locations.filter((l) => l.noStock + l.barcode > 0).length;
  const barcodeFails = r.reasons.noRead + r.reasons.rejected + r.reasons.deviceFail;

  const bars: HourBar[] = r.hours.map((h) => {
    if (h.staffedMin <= 0) return { value: null, tip: [] };
    return {
      value: h.ratedMin > 0 ? (h.picks / h.ratedMin) * 60 : 0,
      judged: h.ratedMin >= HOUR_MIN_RATED_MIN,
      tip: [
        `${h.picks} lines · ${h.pickers.length} picker${h.pickers.length === 1 ? '' : 's'}`,
        ...h.pickers.map((b) => `· ${name(b)}`),
      ],
    };
  });

  const reasons = [
    { key: 'nostock', label: 'Lack of stock', n: r.reasons.noStock, sub: 'picker selected “no stock”' },
    { key: 'barcode', label: 'Barcode didn’t work', n: barcodeFails,
      sub: `${r.reasons.noRead} no-read · ${r.reasons.rejected} rejected · ${r.reasons.deviceFail} device-reported` },
    { key: 'conn', label: 'Scanner lost connection', n: r.reasons.disconnects, sub: `${mins(r.reasons.disconnectMin)} offline` },
  ];
  const maxReason = Math.max(1, ...reasons.map((x) => x.n));

  return (
    <>
      <section className="tiles tiles--8">
        <Tile label="Lines today" value={int(t.picks)} sub={`since ${hhmm(r.dayStart)}`} />
        <Tile label="Lines / rated hour" value={int(rate)} sub={`target ${r.target} · ${pct(rate / r.target)}`} tone={rate >= r.target ? 'above' : 'below'} />
        <Tile label="Pickers today" value={String(pickersToday.size)} sub={`${r.sessions.length} sessions`} />
        <Tile label="Failed locations" value={`${failedLocations} / 14`} sub="8 aisles behind + 6 in front" />
        <MobileCollapse title="More figures" hint="idle · break · off task · offline">
        <Tile label="Idle time" value={mins(t.idleMin)} sub="beyond 90 s between lines" />
        <Tile label="Break time" value={mins(t.breakMin)} sub="scheduled, rating paused" />
        <Tile label="Off task" value={mins(t.pausedMin)} sub="taken off by management" />
        <Tile label="Scanner offline" value={mins(t.disconnectMin)} sub={`${t.disconnects} connection drops`} />
        </MobileCollapse>
      </section>

      <section className="panel panel--chart">
        <h3 className="panel__title">
          Per hour · lines per rated hour
          <span className="panel__hint">hover a bar for who picked here</span>
        </h3>
        <HourChart bars={bars} dayStart={r.dayStart} nowIndex={nowIndex} marks={[]} target={r.target}
          unit="lines/h" height={130} labelEvery={1} />
      </section>

      <div className="sp__row">
        <section className="panel">
          <h3 className="panel__title">Why lines failed <span className="panel__hint">today</span></h3>
          <ul className="reasons">
            {reasons.map((x) => (
              <li key={x.key}>
                <span className="reasons__label">{x.label}</span>
                <span className="reasons__track">
                  <span className={`reasons__fill reasons__fill--${x.key}`} style={{ width: `${(x.n / maxReason) * 100}%` }} />
                </span>
                <span className="reasons__n">{x.n}</span>
                <span className="reasons__sub">{x.sub}</span>
              </li>
            ))}
          </ul>
          <h3 className="panel__title panel__title--sub">Failed locations <span className="panel__hint">no stock + barcode, by location</span></h3>
          <LocationGrid report={r} />
        </section>

        <section className="panel">
          <h3 className="panel__title">Picker history <span className="panel__hint">everyone who worked here today</span></h3>
          <div className="ns__scroll">
            <table className="tbl tbl--cards">
              <thead>
                <tr><th>Picker</th><th>From</th><th>To</th><th className="num">Lines</th><th className="num">Lines/h</th>
                  <th className="num">Fails</th><th className="num">No stock</th><th className="num">Idle</th><th className="num">Off task</th></tr>
              </thead>
              <tbody>
                {[...r.sessions].reverse().map((x) => (
                  <tr key={`${x.badgeId}-${x.from}`}>
                    <td data-label="Picker">{name(x.badgeId)}</td>
                    <td data-label="From" className="mono">{hhmm(x.from)}</td>
                    <td data-label="To" className="mono">{x.to ? hhmm(x.to) : 'now'}</td>
                    <td data-label="Lines" className="num">{int(x.picks)}</td>
                    <td data-label="Lines/h" className={`num ${x.rate >= r.target ? 'ok' : 'low'}`}>{x.rate ? int(x.rate) : '—'}</td>
                    <td data-label="Fails" className="num">{x.fails}</td>
                    <td data-label="No stock" className="num">{x.noStock}</td>
                    <td data-label="Idle" className="num">{minutes(x.idleMs)}</td>
                    <td data-label="Off task" className="num">{minutes(x.pausedMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <MobileCollapse title="Hour by hour" hint="table with totals">
      <section className="panel">
        <h3 className="panel__title">Hour by hour <span className="panel__hint">same figures the Management page adds up</span></h3>
        <div className="ns__scroll">
          <table className="tbl tbl--cards tbl--hours">
            <thead>
              <tr>
                <th>Hour</th><th>Pickers</th><th className="num">Lines</th><th className="num">Lines/h</th>
                <th className="num">Fail scans</th><th className="num">No stock</th><th className="num">Conn. drops</th>
                <th className="num">Idle</th><th className="num">Break</th><th className="num">Off task</th><th className="num">Offline</th>
              </tr>
            </thead>
            <tbody>
              {r.hours.map((h, i) => {
                if (h.staffedMin <= 0) return null;
                const hr = h.ratedMin > 0 ? (h.picks / h.ratedMin) * 60 : 0;
                const judged = h.ratedMin >= HOUR_MIN_RATED_MIN;
                return (
                  <tr key={i}>
                    <td data-label="Hour" className="mono">{hourLabel(r.dayStart, i)}</td>
                    <td data-label="Pickers">{h.pickers.map(name).join(', ') || '—'}</td>
                    <td data-label="Lines" className="num">{int(h.picks)}</td>
                    <td data-label="Lines/h" className={`num ${!judged ? '' : hr >= r.target ? 'ok' : 'low'}`}>{judged ? int(hr) : '—'}</td>
                    <td data-label="Fail scans" className="num">{h.fails}</td>
                    <td data-label="No stock" className="num">{h.noStock}</td>
                    <td data-label="Conn. drops" className="num">{h.disconnects}</td>
                    <td data-label="Idle" className="num">{mins(h.idleMin)}</td>
                    <td data-label="Break" className="num">{mins(h.breakMin)}</td>
                    <td data-label="Off task" className="num">{mins(h.pausedMin)}</td>
                    <td data-label="Offline" className="num">{mins(h.disconnectMin)}</td>
                  </tr>
                );
              })}
              <tr className="tbl__total">
                <td data-label="Hour">Total</td>
                <td data-label="Pickers">{pickersToday.size} pickers</td>
                <td data-label="Lines" className="num">{int(t.picks)}</td>
                <td data-label="Lines/h" className="num">{int(rate)}</td>
                <td data-label="Fail scans" className="num">{t.fails}</td>
                <td data-label="No stock" className="num">{t.noStock}</td>
                <td data-label="Conn. drops" className="num">{t.disconnects}</td>
                <td data-label="Idle" className="num">{mins(t.idleMin)}</td>
                <td data-label="Break" className="num">{mins(t.breakMin)}</td>
                <td data-label="Off task" className="num">{mins(t.pausedMin)}</td>
                <td data-label="Offline" className="num">{mins(t.disconnectMin)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="muted-note">Fail-scan rate today: {pct1(t.fails / Math.max(1, t.fails + t.picks))}.</p>
      </section>
      </MobileCollapse>
    </>
  );
}

/** Aisles behind, positions in front — each with its no-stock and barcode failures. */
function LocationGrid({ report: r }: { report: StationReport }) {
  const L = r.id;
  const aisles = 'ABCDEFGH'.split('').map((a) => `${L}${a}`);
  const front = [1, 2, 3, 4, 5, 6].map((n) => `${L}${n}`);
  const by = new Map(r.locations.map((l) => [l.location, l]));
  const max = Math.max(1, ...r.locations.map((l) => l.noStock + l.barcode));
  const cell = (loc: string) => {
    const l = by.get(loc);
    const total = (l?.noStock ?? 0) + (l?.barcode ?? 0);
    return (
      <span key={loc} className={`loc loc--big${total ? ' loc--hit' : ''}`} style={{ ['--heat' as string]: `${Math.round((total / max) * 100)}%` }}
        title={`${loc}: ${l?.noStock ?? 0} no stock, ${l?.barcode ?? 0} barcode fails`}>
        <b>{loc}</b>
        <i>{total ? `${l!.noStock} · ${l!.barcode}` : ''}</i>
      </span>
    );
  };
  return (
    <div>
      <div className="locs__label">Behind the picker · no stock · barcode</div>
      <div className="locs locs--aisles">{aisles.map(cell)}</div>
      <div className="locs__picker">▲ picker ▼</div>
      <div className="locs locs--front">{front.map(cell)}</div>
      <div className="locs__label">In front</div>
    </div>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className={`tile${tone ? ` tile--${tone}` : ''}`}>
      <span className="tile__label">{label}</span>
      <span className="tile__value">{value}</span>
      {sub && <span className="tile__sub">{sub}</span>}
    </div>
  );
}
