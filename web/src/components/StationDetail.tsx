import { useState } from 'react';
import type { HourlyReport, NoStockRecord, NotableEvent, StationView } from '../types';
import { clock, hms, int, minutes, ms, pct, pct1, pseudonym } from '../format';
import { sendPause } from '../useBoard';
import { statusLabel, toneColor, toneOf } from '../status';
import Sparkline from './Sparkline';
import HourChart, { type HourBar } from './HourChart';
import { HOUR_MIN_RATED_MIN, EVENT_LABEL } from './labels';

const REASONS = ['Rating conversation', 'Other discussion', 'Training', 'Other'];

interface Props {
  station: StationView | null;
  events: NotableEvent[];
  hourly: HourlyReport | null;
  noStock: NoStockRecord[];
  simNow: number;
  anonymise: boolean;
  onClose: () => void;
}

export default function StationDetail({ station: s, events, hourly, noStock, simNow, anonymise, onClose }: Props) {
  if (!s) {
    return (
      <aside className="detail detail--empty">
        <div className="detail__prompt">
          <span className="detail__prompt-mark">◎</span>
          <p>Select a station on the map</p>
          <span>Click any letter to see who is there, how they are running, and their hour-by-hour.</span>
        </div>
      </aside>
    );
  }

  const tone = toneOf(s);
  const color = toneColor(tone);
  const manned = s.status !== 'empty';
  const operator = !s.badgeId ? null : anonymise ? pseudonym(s.badgeId) : s.operatorName ?? s.badgeId;
  const mine = s.badgeId ? events.filter((e) => e.badgeId === s.badgeId).slice(0, 8) : [];
  const stationNoStock = noStock.filter((r) => r.stationId === s.id);

  return (
    <aside className="detail" style={{ ['--accent' as string]: color }}>
      <header className="detail__head">
        <div className="detail__ident">
          <span className="detail__letter">{s.id}</span>
          <div>
            <h2>Station {s.id}</h2>
            <span className="detail__sub">
              Front {s.front[0]}–{s.front[s.front.length - 1]} · Aisles {s.aisles[0]}–{s.aisles[s.aisles.length - 1]}
            </span>
          </div>
        </div>
        <button className="detail__close" onClick={onClose} aria-label="Close station detail">×</button>
      </header>

      <span className="pill detail__pill">{statusLabel(s)}</span>
      {!s.scannerOnline && <div className="card__offline">Scanner lost connection — rating paused until it is back</div>}

      {manned ? (
        <>
          <section className="detail__who">
            <span className="detail__who-label">Occupied by</span>
            <span className="detail__who-name">{operator}</span>
            <span className="detail__who-meta">{s.badgeId} · {s.taskLabel ?? s.taskCode}</span>
          </section>

          <OffTask station={s} />

          <section className="detail__rate">
            <div className="detail__rate-main">
              <span className="detail__rate-value">{int(s.rollingRate)}</span>
              <span className="detail__rate-unit">lines / h</span>
            </div>
            <div className="detail__rate-side">
              <span className="detail__rate-att">{tone === 'settling' ? '—' : pct(s.attainment)}</span>
              <span className="detail__rate-target">of {s.targetLinesPerHour} target</span>
            </div>
          </section>

          <Sparkline values={s.trend} target={s.targetLinesPerHour} color={color} height={44} />
        </>
      ) : (
        <div className="detail__unmanned">
          <p>No operator badged in</p>
          <span>Target {s.targetLinesPerHour} lines/h when manned.</span>
        </div>
      )}

      {hourly && <StationHours station={s} hourly={hourly} simNow={simNow} />}

      {manned && (
        <dl className="detail__metrics">
          <Metric label="Time on station" value={hms(s.timeOnStationMs)} />
          <Metric label="Rated time" value={hms(s.ratedMs)} />
          <Metric label="Lines this session" value={int(s.picks)} />
          <Metric label="Seconds / line" value={s.avgSecPerLine > 0 ? s.avgSecPerLine.toFixed(1) : '—'} />
          <Metric label="Fail scans" value={`${s.fails} · ${pct1(s.failRate)}`} warn={s.failRate >= 0.03} />
          <Metric label="No stock" value={`${s.noStock} · +${Math.round(s.allowanceMs / 1000)}s`} />
          <Metric label="Idle time" value={hms(s.idleMs)} warn={s.idleMs > 0} />
          <Metric label="Off task (paused)" value={hms(s.pausedMs)} />
          <Metric label="Session average" value={`${int(s.sessionRate)}/h`} />
          <Metric
            label="Last line"
            value={s.currentIdleMs > 0 ? `idle ${ms(s.currentIdleMs)}` : `${ms(s.msSinceLastPick)} ago`}
            warn={s.currentIdleMs > 0}
          />
        </dl>
      )}

      <LocationLayout station={s} records={stationNoStock} />

      {manned && (
        <section className="detail__history">
          <h3>Operator history</h3>
          <ol>
            {mine.length === 0 && <li className="detail__history-empty">No events yet this shift</li>}
            {mine.map((e) => (
              <li key={e.id}>
                <span className="detail__history-time">{clock(e.ts)}</span>
                <span className="detail__history-kind">{EVENT_LABEL[e.kind]}</span>
                <span className="detail__history-where">
                  {e.kind === 'move' ? `${e.fromStationId} → ${e.stationId}` : e.stationId}
                  {e.detail ? ` · ${e.detail}` : ''}
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </aside>
  );
}

/**
 * "Take off task by management". ON is normal work. Switching it OFF pauses this
 * person's rating — the station stays occupied by them — until it is switched back ON.
 */
function OffTask({ station: s }: { station: StationView }) {
  const [pending, setPending] = useState(false);
  const onTask = !s.paused;

  const toggle = async () => {
    setPending(true);
    await sendPause(s.id, onTask, onTask ? s.pauseReason ?? REASONS[0] : undefined);
    setPending(false);
  };

  return (
    <section className={`offtask${onTask ? '' : ' is-off'}`}>
      <div className="offtask__row">
        <span className="offtask__title">Take off task by management</span>
        <button
          className="switch"
          role="switch"
          aria-checked={onTask}
          aria-label="Take off task by management"
          disabled={pending}
          onClick={toggle}
        >
          <span className="switch__text">{onTask ? 'ON' : 'OFF'}</span>
          <span className="switch__knob" />
        </button>
      </div>

      {onTask ? (
        <p className="offtask__hint">On task, rating running. Switch OFF to pause the rating; the station stays occupied.</p>
      ) : (
        <>
          <p className="offtask__hint offtask__hint--off">
            Off task for {minutes(s.currentPauseMs)}. Rating paused; it does not count against them. Switch back ON when they return.
          </p>
          <div className="offtask__reasons" role="radiogroup" aria-label="Reason">
            {REASONS.map((r) => (
              <button
                key={r}
                role="radio"
                aria-checked={s.pauseReason === r}
                className={`chip${s.pauseReason === r ? ' is-on' : ''}`}
                onClick={() => void sendPause(s.id, true, r)}
              >
                {r}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

/** This station's lines/h for every hour of the day, judged against the target. */
function StationHours({ station: s, hourly, simNow }: { station: StationView; hourly: HourlyReport; simNow: number }) {
  const row = hourly.stations.find((r) => r.id === s.id);
  if (!row) return null;
  const nowIndex = Math.floor((simNow - hourly.dayStart) / 3_600_000);

  const bars: HourBar[] = row.hours.map((h) => {
    if (h.staffedMin <= 0) return { value: null, tip: [] };
    const rate = h.ratedMin > 0 ? (h.picks / h.ratedMin) * 60 : 0;
    const tip = [
      `${h.picks} lines in ${Math.round(h.ratedMin)} rated min`,
      ...(h.pausedMin > 0 ? [`${Math.round(h.pausedMin)} min off task`] : []),
      ...(h.fails > 0 ? [`${h.fails} fail scans`] : []),
      ...(h.noStock > 0 ? [`${h.noStock} no stock`] : []),
    ];
    return { value: rate, judged: h.ratedMin >= HOUR_MIN_RATED_MIN, tip };
  });

  const judged = bars.filter((b, i) => i <= nowIndex && b.value !== null && b.judged !== false);
  const low = judged.filter((b) => b.value! < hourly.target).length;

  return (
    <section className="detail__hours">
      <h3>
        Per hour · lines/h
        <span>{judged.length - low} high · {low} low</span>
      </h3>
      <HourChart
        bars={bars}
        dayStart={hourly.dayStart}
        nowIndex={nowIndex}
        marks={hourly.schedule}
        target={hourly.target}
        unit="lines/h"
        height={84}
        labelEvery={4}
      />
    </section>
  );
}

/**
 * The picker's world: positions in front (B1–B6), aisles behind (BA–BH). Each shows
 * how many "no stock" selections came from it today.
 */
function LocationLayout({ station: s, records }: { station: StationView; records: NoStockRecord[] }) {
  const counts = new Map<string, number>();
  for (const r of records) counts.set(r.location, (counts.get(r.location) ?? 0) + 1);
  const max = Math.max(1, ...counts.values());

  const cell = (loc: string) => {
    const n = counts.get(loc) ?? 0;
    return (
      <span
        key={loc}
        className={`loc${n > 0 ? ' loc--hit' : ''}`}
        style={{ ['--heat' as string]: `${Math.round((n / max) * 100)}%` }}
        title={`${loc}: ${n} no stock today`}
      >
        <b>{loc}</b>
        <i>{n > 0 ? n : ''}</i>
      </span>
    );
  };

  return (
    <section className="detail__locs">
      <h3>
        Locations · no stock today
        <span>{records.length} total</span>
      </h3>
      <div className="locs__label">Behind the picker</div>
      <div className="locs locs--aisles">{s.aisles.map(cell)}</div>
      <div className="locs__picker">▲ picker ▼</div>
      <div className="locs locs--front">{s.front.map(cell)}</div>
      <div className="locs__label">In front</div>
    </section>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd className={warn ? 'warn' : undefined}>{value}</dd>
    </div>
  );
}
