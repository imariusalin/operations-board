import { cur2, hhmm } from '../format';
import { handoverKind, type Figures, type HandoverKind } from '../handover';
import type { CostRates } from '../types';

/** The bits both handovers share: masthead, KPI tile, sign-off strip, rates footnote. */

export default function HandoverHead({ kind, f, simNow, by }: {
  kind: HandoverKind; f: Figures; simNow: number; by: string;
}) {
  const k = handoverKind(kind);
  return (
    <header className="ho__head">
      <div>
        <div className="ho__kicker">Manual department · {k.label}</div>
        <h1>{k.title} · {f.window.label}</h1>
        <div className="ho__meta">
          Data covered {f.covered} · generated {new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}
          {' '}(board time {hhmm(simNow)}){by ? ` · by ${by}` : ''}
        </div>
      </div>
      <div className="ho__target">Target<br /><b>{f.target}</b><br />lines/h</div>
    </header>
  );
}

export function Kpi({ label, value, sub, good }: { label: string; value: string; sub?: string; good?: boolean }) {
  return (
    <div className={`ho__kpi${good === undefined ? '' : good ? ' good' : ' low'}`}>
      <span>{label}</span>
      <b>{value}</b>
      {sub && <small>{sub}</small>}
    </div>
  );
}

/** Who hands over to whom. Printed on the last page of each document. */
export function HandoverSign({ kind, by }: { kind: HandoverKind; by: string }) {
  const k = handoverKind(kind);
  return (
    <footer className="ho__sign">
      <div>{k.from} (handed over): {by || '____________________'}</div>
      <div>{k.to} (received): ____________________</div>
      <div>Time: ________</div>
    </footer>
  );
}

/**
 * Printed across the top of the director's review while the rates are invented. It is
 * deliberately loud: the sheet below it carries euro totals, and a reader has no other
 * way to tell a configured guess from a finance figure.
 */
export function PlaceholderBanner({ rates }: { rates: CostRates }) {
  if (!rates.placeholder) return null;
  return (
    <section className="ho__flag">
      <b>Placeholder rates — not finance figures.</b>
      Every amount on this sheet is derived from the four assumed rates listed at the foot of the last page.
      Treat the money as the shape of the problem, not its size, until finance sets the rates.
    </section>
  );
}

/** Where the numbers come from. The director's copy has to say it; the floor copy says less. */
export function RatesNote({ kind, rates, target }: { kind: HandoverKind; rates?: CostRates; target?: number }) {
  if (kind === 'ops' || !rates) {
    return (
      <p className="ho__foot ho__foot--note">
        Every figure is the sum of the same hourly cells the Management page shows, so this sheet and the board agree.
      </p>
    );
  }
  const cy = rates.currency;
  return (
    <div className="ho__foot ho__foot--note">
      <b>{rates.placeholder ? 'Rates used (placeholders, not set by finance)' : 'Rates used'}</b>
      <ul className="ho__rates">
        <li>Picker-hour, fully loaded: <b>{cur2(rates.labourPerHour, cy)}</b></li>
        <li>Contribution per line: <b>{cur2(rates.marginPerLine, cy)}</b></li>
        <li>Handling per shortage line: <b>{cur2(rates.shortageHandlingPerLine, cy)}</b></li>
        <li>Target cost per line: <b>{cur2(rates.labourPerHour / Math.max(1, target ?? 1), cy)}</b> <small>labour ÷ target</small></li>
      </ul>
      Operational time and volume are priced at these rates, not with actuals from finance. Labour is costed on staffed
      picker-hours; foregone lines value the recoverable lost hours at target rate. No minute is counted in two causes.
    </div>
  );
}
