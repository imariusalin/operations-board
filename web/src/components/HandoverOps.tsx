import { hhmm, int, mins, pct, pct1, pseudonym } from '../format';
import { perPicker, ratedRate, type Figures } from '../handover';
import HandoverHead, { HandoverSign, Kpi, RatesNote } from './HandoverParts';

/**
 * Supervisor → Manager. The shift as it was actually worked: every started hour, every
 * station, who was on it, what broke and what was short. No money — the supervisor hands
 * over the floor, not the P&L.
 *
 * Laid out for A4 portrait. Section order is deliberate: the manager reads the top of
 * page one standing up, and the detail tables only when something looks wrong.
 */

interface Props {
  f: Figures;
  simNow: number;
  notes: string;
  from: string;
  anonymise: boolean;
}

export default function HandoverOps({ f, simNow, notes, from, anonymise }: Props) {
  const { all, target } = f;
  const who = (badge?: string, nameStr?: string) => (!badge ? '—' : anonymise ? pseudonym(badge) : nameStr ?? badge);

  return (
    <article className="ho">
      <HandoverHead kind="ops" f={f} simNow={simNow} by={from} />

      <section className="ho__kpis ho__kpis--5">
        <Kpi label="Lines" value={int(all.picks)} />
        <Kpi label="Lines / picker-hour" value={int(perPicker(all))} sub={pct(perPicker(all) / target)} good={perPicker(all) >= target} />
        <Kpi label="Lines / rated hour" value={int(ratedRate(all))} sub={pct(ratedRate(all) / target)} good={ratedRate(all) >= target} />
        <Kpi label="Pickers" value={String(f.pickerCount)} sub={`${(all.staffedMin / 60).toFixed(1)} picker-hours`} />
        <Kpi label="Fail scans" value={int(all.fails)} sub={pct1(all.fails / Math.max(1, all.fails + all.picks))} />
        <Kpi label="No stock" value={int(all.noStock)} sub={`${int(f.shortageUnits)} units short`} />
        <Kpi label="Idle" value={mins(all.idleMin)} sub="picker-time" />
        <Kpi label="Break" value={mins(all.breakMin)} sub="picker-time" />
        <Kpi label="Off task" value={mins(all.pausedMin)} sub="picker-time" />
        <Kpi label="Scanner offline" value={mins(all.disconnectMin)} sub={`${all.disconnects} drops`} />
      </section>

      {notes.trim() && (
        <section className="ho__notes">
          <h2>Notes for the next shift</h2>
          <p>{notes}</p>
        </section>
      )}

      <section className="ho__block">
        <h2>Hour by hour</h2>
        <table className="ho__tbl">
          <thead>
            <tr>
              <th>Hour</th><th className="n">Pickers</th><th className="n">Lines</th><th className="n">/picker-h</th>
              <th className="n">/rated h</th><th className="n">Fails</th><th className="n">No stock</th><th className="n">Idle</th>
              <th className="n">Break</th><th className="n">Off task</th><th className="n">Offline</th><th>Events</th>
            </tr>
          </thead>
          <tbody>
            {f.idx.map((i) => {
              const d = f.deptHour(i);
              const pp = perPicker(d);
              return (
                <tr key={i}>
                  <td>{f.hourLabelAt(i)}</td>
                  <td className="n">{(d.staffedMin / 60).toFixed(1)} <small>({f.hourPickers(i)})</small></td>
                  <td className="n">{int(d.picks)}</td>
                  <td className={`n ${pp >= target ? 'good' : 'low'}`}>{int(pp)}</td>
                  <td className={`n ${ratedRate(d) >= target ? 'good' : 'low'}`}>{int(ratedRate(d))}</td>
                  <td className="n">{d.fails}</td>
                  <td className="n">{d.noStock}</td>
                  <td className="n">{mins(d.idleMin)}</td>
                  <td className="n">{mins(d.breakMin)}</td>
                  <td className="n">{mins(d.pausedMin)}</td>
                  <td className="n">{mins(d.disconnectMin)}</td>
                  <td className="ev">{f.marksIn(i).map((m) => m.label).join(' · ')}</td>
                </tr>
              );
            })}
            <tr className="ho__tbl-total">
              <td>Total</td>
              <td className="n">{(all.staffedMin / 60).toFixed(1)}</td>
              <td className="n">{int(all.picks)}</td>
              <td className="n">{int(perPicker(all))}</td>
              <td className="n">{int(ratedRate(all))}</td>
              <td className="n">{all.fails}</td>
              <td className="n">{all.noStock}</td>
              <td className="n">{mins(all.idleMin)}</td>
              <td className="n">{mins(all.breakMin)}</td>
              <td className="n">{mins(all.pausedMin)}</td>
              <td className="n">{mins(all.disconnectMin)}</td>
              <td />
            </tr>
          </tbody>
        </table>
        <p className="ho__foot">
          Pickers = average on the floor that hour. /picker-h counts every staffed minute, so breaks and staff loss show as
          dips. /rated h leaves out break, off-task, scanner-offline and no-stock time — the figure pickers are rated on.
        </p>
      </section>

      <section className="ho__two ho__block">
        <div>
          <h2>Stations</h2>
          <table className="ho__tbl">
            <thead>
              <tr><th>St.</th><th className="n">Pickers</th><th className="n">Lines</th><th className="n">/rated h</th>
                <th className="n">Fails</th><th className="n">No stock</th><th className="n">Idle</th><th className="n">Offline</th></tr>
            </thead>
            <tbody>
              {f.stations.map((r) => (
                <tr key={r.id}>
                  <td><b>{r.id}</b></td>
                  <td className="n">{r.pickers}</td>
                  <td className="n">{int(r.cells.picks)}</td>
                  <td className={`n ${r.cells.ratedMin < 5 ? '' : r.rate >= target ? 'good' : 'low'}`}>
                    {r.cells.ratedMin < 5 ? '—' : int(r.rate)}
                  </td>
                  <td className="n">{r.cells.fails}</td>
                  <td className="n">{r.cells.noStock}</td>
                  <td className="n">{mins(r.cells.idleMin)}</td>
                  <td className="n">{mins(r.cells.disconnectMin)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <h2>Weak points</h2>
          <ol className="ho__list">
            {f.weak.length === 0 && <li>Not enough data in this shift yet.</li>}
            {f.weak.map(({ i, cells }) => (
              <li key={i}>
                <b>{f.hourLabelAt(i)}</b> · {int(perPicker(cells))} lines/picker-h ·{' '}
                {f.marksIn(i).map((m) => m.label).join(', ') || `${(cells.staffedMin / 60).toFixed(1)} pickers, no scheduled event`}
              </li>
            ))}
          </ol>

          <h2>Scheduled in this shift</h2>
          <ul className="ho__list">
            {f.marks.length === 0 && <li>None.</li>}
            {f.marks.map((m, k) => (
              <li key={k}><b>{hhmm(m.from)}{m.to > m.from ? `–${hhmm(m.to)}` : ''}</b> · {m.label}</li>
            ))}
          </ul>

          <h2>Taken off task</h2>
          <ul className="ho__list">
            {f.offTask.length === 0 && <li>Nobody.</li>}
            {f.offTask.slice().reverse().map((e) => (
              <li key={e.id}>
                <b>{hhmm(e.ts)}</b> · {who(e.badgeId, e.operatorName)} · St. {e.stationId} ·{' '}
                {e.kind === 'paused' ? `off task${e.detail ? ` (${e.detail})` : ''}` : `back on task${e.detail ? ` (${e.detail})` : ''}`}
                {e.by ? ` · by ${e.by}` : ''}
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="ho__page">
        <h2>No stock · {f.shortages.length} lines, {int(f.shortageUnits)} units short</h2>
        <table className="ho__tbl">
          <thead><tr><th>Product</th><th>SKU</th><th className="n">Times</th><th className="n">Units</th><th>Locations</th></tr></thead>
          <tbody>
            {f.topProducts.length === 0 && <tr><td colSpan={5}>Nothing reported short in this shift.</td></tr>}
            {f.topProducts.slice(0, 20).map((p) => (
              <tr key={p.sku}>
                <td>{p.name}</td><td>{p.sku}</td><td className="n">{p.times}</td><td className="n">{p.qty}</td>
                <td>{p.locations.join(' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ho__foot">
          {f.topProducts.length > 20 && `${f.topProducts.length - 20} further products not shown. `}
          Full list with order / invoice numbers: No stock tab → Export CSV.
        </p>
        <RatesNote kind="ops" />
      </section>

      <HandoverSign kind="ops" by={from} />
    </article>
  );
}
