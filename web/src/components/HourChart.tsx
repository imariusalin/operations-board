import { useState } from 'react';
import type { ScheduleMark } from '../types';
import { hourLabel, int } from '../format';

/**
 * 24 hourly columns on the day axis (12:00 → 12:00). Built in HTML rather than SVG so
 * bars keep crisp rounded tops and text never stretches at any width.
 *
 * With a `target`, each bar is judged: at or above → good, under → below. Without
 * one, bars are a single neutral hue (plain magnitude).
 */

export interface HourBar {
  /** null = no data for this hour (future, or nobody there). */
  value: number | null;
  /** false = too little time in the hour to judge; drawn hollow. */
  judged?: boolean;
  tip: string[];
}

interface Props {
  bars: HourBar[];
  dayStart: number;
  /** Index of the hour we are in now; later hours are drawn as future. */
  nowIndex: number;
  marks: ScheduleMark[];
  target?: number;
  unit: string;
  height?: number;
  /** Show every nth hour label. */
  labelEvery?: number;
  /** Write each mark's label above the plot. */
  showMarkLabels?: boolean;
}

const HOUR = 3_600_000;

export default function HourChart({
  bars, dayStart, nowIndex, marks, target, unit, height = 120, labelEvery = 3, showMarkLabels = false,
}: Props) {
  const [hover, setHover] = useState<number | null>(null);
  const values = bars.map((b) => b.value ?? 0);
  const max = Math.max(target ? target * 1.3 : 1, ...values) || 1;
  const yPct = (v: number) => Math.min(100, (v / max) * 100);
  const dayEnd = dayStart + 24 * HOUR;
  const xPct = (t: number) => ((t - dayStart) / (dayEnd - dayStart)) * 100;

  return (
    <div className="hc" onMouseLeave={() => setHover(null)}>
      {showMarkLabels && (
        <div className="hc__marks-row">
          {marks.map((m, i) => (
            <span
              key={i}
              className={`hc__mark-label hc__mark-label--${m.kind}`}
              style={{ left: `${xPct(m.from + (m.to - m.from) / 2)}%` }}
            >
              {m.kind === 'loss' ? '▼ ' : ''}{m.label}
            </span>
          ))}
        </div>
      )}

      <div className="hc__plot" style={{ height }}>
        {/* Breaks and the drivers' break as bands, staff loss as a line. Behind the bars. */}
        {marks.map((m, i) =>
          m.kind === 'loss' ? (
            <div key={i} className="hc__loss" style={{ left: `${xPct(m.from)}%` }} title={m.label} />
          ) : (
            <div
              key={i}
              className={`hc__band hc__band--${m.kind}`}
              style={{ left: `${xPct(m.from)}%`, width: `${xPct(m.to) - xPct(m.from)}%` }}
              title={m.label}
            />
          ),
        )}

        {target !== undefined && (
          <div className="hc__target" style={{ bottom: `${yPct(target)}%` }}>
            <span>{target}</span>
          </div>
        )}

        <div className="hc__cols">
          {bars.map((b, i) => {
            const future = i > nowIndex;
            const tone =
              b.value === null || future ? 'none'
              : target === undefined ? 'neutral'
              : b.judged === false ? 'unjudged'
              : b.value >= target ? 'above' : 'below';
            return (
              <div
                key={i}
                className={`hc__col${hover === i ? ' is-hover' : ''}${i === nowIndex ? ' is-now' : ''}`}
                onMouseEnter={() => setHover(i)}
                onClick={() => setHover(i)}
              >
                {b.value !== null && !future && (
                  <div className={`hc__bar hc__bar--${tone}`} style={{ height: `${Math.max(1.5, yPct(b.value))}%` }} />
                )}
              </div>
            );
          })}
        </div>

        {hover !== null && (
          <div
            className={`hc__tip${hover > 15 ? ' hc__tip--left' : ''}`}
            style={{ left: `${((hover + 0.5) / 24) * 100}%` }}
          >
            <strong>{hourLabel(dayStart, hover)}–{hourLabel(dayStart, hover + 1)}</strong>
            {hover > nowIndex ? <span>not reached yet</span>
              : bars[hover].value === null ? <span>no data</span>
              : (
                <>
                  <span>{int(bars[hover].value!)} {unit}</span>
                  {bars[hover].tip.map((t, k) => <span key={k}>{t}</span>)}
                </>
              )}
          </div>
        )}
      </div>

      <div className="hc__axis">
        {bars.map((_, i) => (
          <span key={i}>{i % labelEvery === 0 ? hourLabel(dayStart, i).slice(0, 2) : ''}</span>
        ))}
      </div>
    </div>
  );
}
