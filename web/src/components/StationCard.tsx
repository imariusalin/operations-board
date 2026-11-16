import type { StationView } from '../types';
import { hms, int, ms, pct, pct1, pseudonym } from '../format';
import { statusLabel, toneColor, toneOf } from '../status';
import Sparkline from './Sparkline';

interface Props {
  station: StationView;
  anonymise: boolean;
}

export default function StationCard({ station: s, anonymise }: Props) {
  const tone = toneOf(s);
  const color = toneColor(tone);
  const manned = s.status !== 'empty';
  const operator = !s.badgeId ? null : anonymise ? pseudonym(s.badgeId) : s.operatorName ?? s.badgeId;

  // Bar is scaled so target sits at 75% of the track, leaving headroom above it.
  const barPct = Math.min(100, s.attainment * 75);

  return (
    <article className={`card card--${s.status}${tone === 'settling' ? ' card--settling' : ''}`} style={{ ['--accent' as string]: color }}>
      <header className="card__head">
        <div className="card__ident">
          <h2 className="card__name">Station {s.id}</h2>
        </div>
        <span className="pill">{statusLabel(s)}</span>
      </header>
      {!s.scannerOnline && <div className="card__offline">Scanner lost connection — rating paused</div>}

      <div className="card__zone">{s.front[0]}–{s.front[s.front.length - 1]} · {s.aisles[0]}–{s.aisles[s.aisles.length - 1]}</div>

      {manned ? (
        <>
          <div className="rate">
            <span className="rate__value">{int(s.rollingRate)}</span>
            <span className="rate__unit">lines/h</span>
            <span className="rate__target">target {s.targetLinesPerHour}</span>
          </div>

          <div className="barrow">
            <div className="bar" role="img" aria-label={`${pct(s.attainment)} of target`}>
              <div className="bar__fill" style={{ width: `${barPct}%` }} />
              <div className="bar__target" />
            </div>
            <span className="barrow__pct">{tone === 'settling' ? '—' : pct(s.attainment)}</span>
          </div>

          <Sparkline values={s.trend} target={s.targetLinesPerHour} color={color} />

          <div className="who">
            <span className="who__name">{operator}</span>
            <span className="who__badge">{s.badgeId}</span>
            <span className="who__task">{s.paused ? `off task · ${s.pauseReason ?? 'management'}` : s.taskLabel ?? s.taskCode}</span>
          </div>

          <dl className="metrics">
            <div><dt>On station</dt><dd>{hms(s.timeOnStationMs)}</dd></div>
            <div><dt>Lines</dt><dd>{int(s.picks)}</dd></div>
            <div><dt>Fails</dt><dd className={s.failRate >= 0.03 ? 'warn' : undefined}>{s.fails} · {pct1(s.failRate)}</dd></div>
            <div><dt>No stock</dt><dd>{s.noStock}</dd></div>
          </dl>

          <footer className="card__foot">
            {s.paused ? (
              <span className="foot-paused">paused {ms(s.currentPauseMs)}</span>
            ) : s.currentIdleMs > 0 ? (
              <span className="foot-alert">idle {ms(s.currentIdleMs)}</span>
            ) : (
              <span className="foot-muted">last line {ms(s.msSinceLastPick)} ago</span>
            )}
            <span className="foot-muted">idle {hms(s.idleMs)} · avg {int(s.sessionRate)}/h</span>
          </footer>
        </>
      ) : (
        <div className="empty">
          <span className="empty__mark">—</span>
          <p>No operator badged in</p>
          <span className="foot-muted">target {s.targetLinesPerHour} lines/h</span>
        </div>
      )}
    </article>
  );
}
