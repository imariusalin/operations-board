import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HourlyReport, NoStockRecord, ScheduleMark, Snapshot } from '../types';
import { hhmm, hourLabel, int, mins, pct, pct1 } from '../format';
import { runningShifts, shiftWindow, type ShiftWindow } from '../shifts';
import HandoverReport from './HandoverReport';
import MobileCollapse from './MobileCollapse';
import { HANDOVER_KINDS, handoverKind, sumCells, type HandoverKind } from '../handover';
import HourChart, { type HourBar } from './HourChart';
import { HOUR_MIN_RATED_MIN } from './labels';

/**
 * The whole day on one screen, for management. Hour by hour from 12:00 to 12:00, with
 * the breaks and the end-of-shift staff losses marked — those are the expected weak
 * points, and this page shows how deep each one actually was.
 */

interface Props {
  snapshot: Snapshot;
  hourly: HourlyReport | null;
  noStock: NoStockRecord[];
  manager: string;
  anonymise: boolean;
}

interface DeptHour {
  picks: number; fails: number; noStock: number;
  staffedMin: number; ratedMin: number; pausedMin: number;
}

const HOUR = 3_600_000;

export default function Management({ snapshot, hourly, noStock, manager, anonymise }: Props) {
  const running = runningShifts(snapshot.shifts, snapshot.simNow);
  const [shiftKey, setShiftKey] = useState<string>(running[0]?.name ?? 'day');
  const [notes, setNotes] = useState('');
  const [kind, setKind] = useState<HandoverKind>('ops');
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const prevTitle = document.title;
    // The browser's print dialog uses the document title as the suggested file name.
    document.title = `${kind === 'exec' ? 'Performance review' : 'Handover'} ${shiftKey} `
      + new Date(snapshot.simNow).toISOString().slice(0, 10);
    // Let the report render before the print dialog snapshots the page.
    const t = setTimeout(() => window.print(), 150);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', done);
      document.title = prevTitle;
    };
  }, [printing, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!hourly) return <div className="view view--single"><p className="muted-note">Loading the day…</p></div>;

  const fullDay: ShiftWindow = {
    name: 'day', label: `Full day ${hhmm(hourly.dayStart)}–${hhmm(hourly.dayStart)}`,
    from: hourly.dayStart, to: hourly.dayStart + 24 * HOUR,
  };
  const windows = [...snapshot.shifts.map((d) => shiftWindow(d, snapshot.simNow)), fullDay];
  const chosen = windows.find((w) => w.name === shiftKey) ?? fullDay;
  const day = sumCells(hourly.stations.flatMap((s) => s.hours));

  const target = hourly.target;
  const nowIndex = Math.floor((snapshot.simNow - hourly.dayStart) / HOUR);

  const dept: DeptHour[] = Array.from({ length: 24 }, (_, i) => {
    const acc: DeptHour = { picks: 0, fails: 0, noStock: 0, staffedMin: 0, ratedMin: 0, pausedMin: 0 };
    for (const st of hourly.stations) {
      const h = st.hours[i];
      acc.picks += h.picks; acc.fails += h.fails; acc.noStock += h.noStock;
      acc.staffedMin += h.staffedMin; acc.ratedMin += h.ratedMin; acc.pausedMin += h.pausedMin;
    }
    return acc;
  });

  const perPicker = (d: DeptHour) => (d.staffedMin > 0 ? d.picks / (d.staffedMin / 60) : 0);
  const marksIn = (i: number) =>
    hourly.schedule.filter((m) => {
      const a = hourly.dayStart + i * HOUR;
      const b = a + HOUR;
      return m.kind === 'loss' ? m.from >= a && m.from < b : m.from < b && m.to > a;
    });

  const perPickerBars: HourBar[] = dept.map((d, i) =>
    d.staffedMin <= 0
      ? { value: null, tip: [] }
      : {
          value: perPicker(d),
          judged: d.staffedMin >= HOUR_MIN_RATED_MIN,
          tip: [
            `${(d.staffedMin / 60).toFixed(1)} pickers on average`,
            `${int(d.picks)} lines total`,
            ...(d.pausedMin > 0 ? [`${Math.round(d.pausedMin)} min off task`] : []),
            ...marksIn(i).map((m) => `⚑ ${m.label}`),
          ],
        },
  );

  const totalBars: HourBar[] = dept.map((d, i) =>
    d.staffedMin <= 0
      ? { value: null, tip: [] }
      : {
          value: d.picks,
          tip: [
            `${(d.staffedMin / 60).toFixed(1)} pickers on average`,
            `${d.fails} fail scans · ${d.noStock} no stock`,
            ...marksIn(i).map((m) => `⚑ ${m.label}`),
          ],
        },
  );

  const sum = dept.reduce(
    (a, d) => ({
      picks: a.picks + d.picks, fails: a.fails + d.fails, noStock: a.noStock + d.noStock,
      staffedMin: a.staffedMin + d.staffedMin, pausedMin: a.pausedMin + d.pausedMin,
    }),
    { picks: 0, fails: 0, noStock: 0, staffedMin: 0, pausedMin: 0 },
  );
  const avg = sum.staffedMin > 0 ? sum.picks / (sum.staffedMin / 60) : 0;

  // The weakest completed hours, and what was going on in each.
  const weak = dept
    .map((d, i) => ({ i, d, rate: perPicker(d) }))
    .filter(({ i, d }) => i < nowIndex && d.staffedMin >= 30)
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 5);

  return (
    <div className="view view--mgmt">
      <section className="mgmt__bar">
        <span className="mgmt__running">
          {running.length ? <>Running now: <b>{running.map((r) => r.label).join(' · ')}</b></> : 'No shift running'}
        </span>
        <label className="ctl">
          <span>Handover for</span>
          <select value={chosen.name} onChange={(e) => setShiftKey(e.target.value)}>
            {windows.map((w) => <option key={w.name} value={w.name}>{w.label}</option>)}
          </select>
        </label>
        <label className="ctl">
          <span>Handover type</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as HandoverKind)}>
            {HANDOVER_KINDS.map((h) => <option key={h.kind} value={h.kind}>{h.label}</option>)}
          </select>
        </label>
        <input
          className="mgmt__notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder={kind === 'exec'
            ? "Manager's summary for the director (printed on the review)"
            : 'Notes for the next shift (printed on the handover)'}
          aria-label="Handover notes"
        />
        <button className="btn" onClick={() => setPrinting(true)}>
          Export {handoverKind(kind).title.toLowerCase()} (PDF)
        </button>
      </section>

      {printing && createPortal(
        <div className="print-root">
          <HandoverReport snapshot={snapshot} hourly={hourly} noStock={noStock} window={chosen}
            kind={kind} notes={notes} manager={manager} anonymise={anonymise} />
        </div>,
        document.body,
      )}

      <section className="tiles tiles--9">
        <Tile label="Lines today" value={int(sum.picks)} sub={`since ${hhmm(hourly.dayStart)}`} />
        <Tile
          label="Lines / picker-hour"
          value={int(avg)}
          sub={`target ${target} · ${pct(avg / target)}`}
          tone={avg >= target ? 'above' : 'below'}
        />
        <Tile label="Pickers now" value={`${snapshot.totals.stationsManned}/${snapshot.totals.stationsTotal}`}
          sub={snapshot.totals.stationsPaused ? `${snapshot.totals.stationsPaused} off task` : 'none off task'} />
        <MobileCollapse title="More figures" hint="fails · no stock · idle · break · offline">
        <Tile label="Fail scans" value={int(sum.fails)} sub={`${pct1(snapshot.totals.failRate)} of scans`} />
        <Tile label="No stock" value={int(sum.noStock)} sub="selections today" />
        <Tile label="Off task" value={mins(day.pausedMin)} sub="picker-time, taken off" />
        <Tile label="Idle" value={mins(day.idleMin)} sub="picker-time, all stations" />
        <Tile label="Break" value={mins(day.breakMin)} sub="picker-time, all stations" />
        <Tile label="Scanner offline" value={mins(day.disconnectMin)} sub={`${day.disconnects} connection drops`} />
        </MobileCollapse>
      </section>

      <section className="panel panel--chart">
        <h3 className="panel__title">
          Lines per picker per hour
          <span className="panel__hint">every hour against {target} · hollow = too little time to judge</span>
        </h3>
        <Legend />
        <HourChart
          bars={perPickerBars}
          dayStart={hourly.dayStart}
          nowIndex={nowIndex}
          marks={hourly.schedule}
          target={target}
          unit="lines per picker"
          height={170}
          labelEvery={1}
          showMarkLabels
        />
      </section>

      <div className="mgmt__row">
        <section className="panel panel--chart">
          <h3 className="panel__title">
            Total lines per hour
            <span className="panel__hint">department output · drops with staff on the floor</span>
          </h3>
          <HourChart
            bars={totalBars}
            dayStart={hourly.dayStart}
            nowIndex={nowIndex}
            marks={hourly.schedule}
            unit="lines"
            height={130}
            labelEvery={2}
          />
        </section>

        <section className="panel">
          <h3 className="panel__title">
            Weak points
            <span className="panel__hint">lowest completed hours</span>
          </h3>
          <ol className="weak">
            {weak.length === 0 && <li className="muted-note">Not enough of the day yet.</li>}
            {weak.map(({ i, d, rate }) => (
              <li key={i}>
                <span className="weak__hour">{hourLabel(hourly.dayStart, i)}</span>
                <span className="weak__rate">{int(rate)}<small>/picker</small></span>
                <span className="weak__why">
                  {marksIn(i).map((m) => m.label).join(' · ') || `${(d.staffedMin / 60).toFixed(1)} pickers, no scheduled event`}
                </span>
              </li>
            ))}
          </ol>
          <h3 className="panel__title panel__title--sub">Scheduled</h3>
          <ul className="sched">
            {hourly.schedule.map((m, k) => <ScheduleRow key={k} m={m} />)}
          </ul>
        </section>
      </div>

      <MobileCollapse title="Stations by hour" hint="12 × 24 grid">
      <section className="panel panel--chart">
        <h3 className="panel__title">
          Stations by hour · lines/h
          <span className="panel__hint">rated time only · pauses, breaks and no-stock time are left out</span>
        </h3>
        <Heatmap hourly={hourly} nowIndex={nowIndex} />
      </section>
      </MobileCollapse>
    </div>
  );
}

function ScheduleRow({ m }: { m: ScheduleMark }) {
  return (
    <li className={`sched__row sched__row--${m.kind}`}>
      <span className="sched__time">{hhmm(m.from)}{m.to > m.from ? `–${hhmm(m.to)}` : ''}</span>
      <span>{m.label}</span>
      <span className="sched__kind">
        {m.kind === 'break' ? 'rating paused' : m.kind === 'flow' ? 'slower flow' : 'staff leave'}
      </span>
    </li>
  );
}

function Heatmap({ hourly, nowIndex }: { hourly: HourlyReport; nowIndex: number }) {
  const target = hourly.target;
  return (
    <div className="heat" role="table" aria-label="Lines per hour by station">
      <div className="heat__row heat__row--head" role="row">
        <span role="columnheader" />
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} role="columnheader" className={i === nowIndex ? 'is-now' : undefined}>
            {hourLabel(hourly.dayStart, i).slice(0, 2)}
          </span>
        ))}
      </div>
      {hourly.stations.map((st) => (
        <div key={st.id} className="heat__row" role="row">
          <span role="rowheader" className="heat__station">{st.id}</span>
          {st.hours.map((h, i) => {
            if (i > nowIndex || h.staffedMin <= 0) return <span key={i} role="cell" className="heat__cell heat__cell--none" />;
            const judged = h.ratedMin >= HOUR_MIN_RATED_MIN;
            const rate = h.ratedMin > 0 ? (h.picks / h.ratedMin) * 60 : 0;
            const tone = !judged ? 'unjudged' : rate >= target ? 'above' : 'below';
            // Strength grows with distance from the target, so "just under" reads lighter than "far under".
            const strength = judged ? Math.min(1, Math.abs(rate - target) / (target * 0.3)) : 0;
            return (
              <span
                key={i}
                role="cell"
                className={`heat__cell heat__cell--${tone}${h.pausedMin >= 5 ? ' heat__cell--paused' : ''}`}
                style={{ ['--s' as string]: (0.18 + strength * 0.55).toFixed(2) }}
                title={`${st.id} ${hourLabel(hourly.dayStart, i)} · ${int(rate)} lines/h · ${h.picks} lines in ${Math.round(h.ratedMin)} rated min${h.pausedMin > 0 ? ` · ${Math.round(h.pausedMin)} min off task` : ''}${h.fails ? ` · ${h.fails} fails` : ''}${h.noStock ? ` · ${h.noStock} no stock` : ''}`}
              >
                {judged ? int(rate) : ''}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function Legend() {
  return (
    <div className="legend">
      <span><i className="legend__sw legend__sw--above" />at or above target</span>
      <span><i className="legend__sw legend__sw--below" />below target</span>
      <span><i className="legend__sw legend__sw--break" />break · rating paused</span>
      <span><i className="legend__sw legend__sw--flow" />drivers break</span>
      <span><i className="legend__sw legend__sw--loss" />staff leave</span>
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
