import { cur, cur2, curSigned, hhmm, hrs, int, mins, pct, pct1 } from '../format';
import { perPicker, ratedRate, type Figures } from '../handover';
import HandoverHead, { HandoverSign, Kpi, PlaceholderBanner, RatesNote } from './HandoverParts';

/**
 * Manager → Director. The same shift, priced. No station letters and no picker names:
 * a director is deciding about staffing, equipment and stock, so every section ends in
 * money or in a decision.
 *
 * One A4 page of summary, a second of detail. Rates come from the board's config and
 * are placeholders until finance sets them — see RatesNote.
 */

interface Props {
  f: Figures;
  simNow: number;
  notes: string;
  from: string;
}

export default function HandoverExec({ f, simNow, notes, from }: Props) {
  const { all, target, money: m } = f;
  const cy = m.rates.currency;
  const attainment = perPicker(all) / target;
  const ratedAttainment = ratedRate(all) / target;

  // Priced causes, worst first — this is the order a director wants to argue about.
  const causes = [
    { label: 'Idle (no scan for over 90 s)', short: 'Idle time', hours: m.lost.idle, cost: m.lostCost.idle, owner: 'Supervision' },
    { label: 'Taken off task by management', short: 'Off task', hours: m.lost.offTask, cost: m.lostCost.offTask, owner: 'Planning' },
    { label: 'Scanner offline', short: 'Scanner offline', hours: m.lost.offline, cost: m.lostCost.offline, owner: 'IT / devices' },
  ].sort((a, b) => b.cost - a.cost);

  // The worst completed hours, priced at the same rate, so "a bad hour" has a number on it.
  // Expected output leaves out scheduled break time: a break is planned, so pricing it as
  // a shortfall would make every break hour look like the worst hour of the shift.
  const weakPriced = f.weak.map(({ i, cells }) => {
    const productiveHours = Math.max(0, (cells.staffedMin - cells.breakMin) / 60);
    const shortfall = Math.max(0, productiveHours * target - cells.picks);
    return {
      i, cells,
      rate: perPicker(cells),
      shortfall,
      value: shortfall * m.rates.marginPerLine,
      why: f.marksIn(i).map((x) => x.label).join(', '),
    };
  });

  return (
    <article className="ho ho--exec">
      <HandoverHead kind="exec" f={f} simNow={simNow} by={from} />
      <PlaceholderBanner rates={m.rates} />

      <section className="ho__kpis ho__kpis--4">
        <Kpi label="Lines out" value={int(all.picks)} sub={`${f.pickerCount} pickers · ${hrs(m.staffedHours)}`} />
        <Kpi label="Attainment" value={pct(attainment)} sub={`per picker-hour vs ${target}`} good={attainment >= 1} />
        <Kpi label="Cost per line" value={cur2(m.costPerLine, cy)} sub={`target ${cur2(m.targetCostPerLine, cy)}`} good={m.costPerLine <= m.targetCostPerLine} />
        <Kpi label="Labour cost" value={cur(m.labourCost, cy)} sub={`${curSigned(m.labourVariance, cy)} vs target`} good={m.labourVariance <= 0} />
        <Kpi label="Paid, non-producing" value={hrs(m.lost.idle + m.lost.offTask + m.lost.offline)} sub={cur(m.lostCost.recoverable, cy)} good={false} />
        <Kpi label="Lines foregone" value={int(m.linesForegone)} sub={`${cur(m.foregoneValue, cy)} contribution`} />
        <Kpi label="Stock shortages" value={int(m.shortageLines)} sub={`${int(m.shortageUnits)} units · ${cur(m.shortageValue, cy)}`} />
        <Kpi label="Total exposure" value={cur(m.exposure, cy)} sub="lost time + contribution + shortages" good={false} />
      </section>

      {notes.trim() && (
        <section className="ho__notes">
          <h2>Manager's summary</h2>
          <p>{notes}</p>
        </section>
      )}

      <section className="ho__two ho__block">
        <div>
          <h2>Where the paid hours went</h2>
          <table className="ho__tbl">
            <thead><tr><th>Bucket</th><th className="n">Hours</th><th className="n">Share</th><th className="n">Cost</th></tr></thead>
            <tbody>
              <tr>
                <td>Producing (rated, minus idle)</td>
                <td className="n">{hrs(Math.max(0, (all.ratedMin - all.idleMin) / 60))}</td>
                <td className="n">{pct(Math.max(0, all.ratedMin - all.idleMin) / Math.max(1, all.staffedMin))}</td>
                <td className="n">{cur(Math.max(0, (all.ratedMin - all.idleMin) / 60) * m.rates.labourPerHour, cy)}</td>
              </tr>
              <tr>
                <td>Scheduled break <small>planned</small></td>
                <td className="n">{hrs(m.lost.break_)}</td>
                <td className="n">{pct(all.breakMin / Math.max(1, all.staffedMin))}</td>
                <td className="n">{cur(m.lostCost.break_, cy)}</td>
              </tr>
              {causes.map((c) => (
                <tr key={c.label}>
                  <td>{c.label}</td>
                  <td className="n">{hrs(c.hours)}</td>
                  <td className="n">{pct((c.hours * 60) / Math.max(1, all.staffedMin))}</td>
                  <td className="n low">{cur(c.cost, cy)}</td>
                </tr>
              ))}
              <tr className="ho__tbl-total">
                <td>Paid picker-hours</td>
                <td className="n">{hrs(m.staffedHours)}</td>
                <td className="n">100%</td>
                <td className="n">{cur(m.labourCost, cy)}</td>
              </tr>
            </tbody>
          </table>
          <p className="ho__foot">
            Each staffed minute sits in exactly one bucket. Break is planned and paid; the three below it are the
            recoverable ones, and they carry the owner named in the action list.
          </p>
        </div>

        <div>
          <h2>Where the money is</h2>
          <table className="ho__tbl">
            <thead><tr><th>Exposure</th><th className="n">Volume</th><th className="n">Value</th><th>Owner</th></tr></thead>
            <tbody>
              {causes.map((c) => (
                <tr key={c.label}>
                  <td>{c.short}</td>
                  <td className="n">{hrs(c.hours)}</td>
                  <td className="n">{cur(c.cost, cy)}</td>
                  <td>{c.owner}</td>
                </tr>
              ))}
              <tr className="ho__tbl-sub">
                <td>Wages paid for non-producing time</td>
                <td className="n">{hrs(m.lost.idle + m.lost.offTask + m.lost.offline)}</td>
                <td className="n">{cur(m.lostCost.recoverable, cy)}</td>
                <td />
              </tr>
              <tr>
                <td>Lines not picked <small>contribution</small></td>
                <td className="n">{int(m.linesForegone)} lines</td>
                <td className="n">{cur(m.foregoneValue, cy)}</td>
                <td>Operations</td>
              </tr>
              <tr>
                <td>Stock shortages <small>margin + handling</small></td>
                <td className="n">{int(m.shortageLines)} lines</td>
                <td className="n">{cur(m.shortageValue, cy)}</td>
                <td>Stock control</td>
              </tr>
              <tr className="ho__tbl-total">
                <td>Total exposure</td>
                <td className="n" />
                <td className="n">{cur(m.exposure, cy)}</td>
                <td />
              </tr>
            </tbody>
          </table>
          <p className="ho__foot">
            Three separate pockets, so nothing is counted twice: wages already paid for time that produced nothing,
            the contribution those same hours would have earned at target, and the shortages. It is what the shift
            exposed, not a saving that drops out automatically — recovering it needs the owners above to act.
          </p>
        </div>
      </section>

      <section className="ho__block">
        <h2>Output and cost, hour by hour</h2>
        <table className="ho__tbl">
          <thead>
            <tr>
              <th>Hour</th><th className="n">Pickers</th><th className="n">Lines</th><th className="n">/picker-h</th>
              <th className="n">Attainment</th><th className="n">Labour</th><th className="n">Cost / line</th>
              <th className="n">Lost h</th><th className="n">Lost cost</th><th>Events</th>
            </tr>
          </thead>
          <tbody>
            {f.idx.map((i) => {
              const d = f.deptHour(i);
              const pp = perPicker(d);
              const labour = (d.staffedMin / 60) * m.rates.labourPerHour;
              const lostH = (d.idleMin + d.pausedMin + d.disconnectMin) / 60;
              return (
                <tr key={i}>
                  <td>{f.hourLabelAt(i)}</td>
                  <td className="n">{(d.staffedMin / 60).toFixed(1)}</td>
                  <td className="n">{int(d.picks)}</td>
                  <td className={`n ${pp >= target ? 'good' : 'low'}`}>{int(pp)}</td>
                  <td className={`n ${pp >= target ? 'good' : 'low'}`}>{pct(pp / target)}</td>
                  <td className="n">{cur(labour, cy)}</td>
                  <td className="n">{d.picks > 0 ? cur2(labour / d.picks, cy) : '—'}</td>
                  <td className="n">{lostH > 0 ? hrs(lostH) : '—'}</td>
                  <td className="n">{lostH > 0 ? cur(lostH * m.rates.labourPerHour, cy) : '—'}</td>
                  <td className="ev">{f.marksIn(i).map((x) => x.label).join(' · ')}</td>
                </tr>
              );
            })}
            <tr className="ho__tbl-total">
              <td>Shift</td>
              <td className="n">{(all.staffedMin / 60).toFixed(1)}</td>
              <td className="n">{int(all.picks)}</td>
              <td className="n">{int(perPicker(all))}</td>
              <td className="n">{pct(attainment)}</td>
              <td className="n">{cur(m.labourCost, cy)}</td>
              <td className="n">{cur2(m.costPerLine, cy)}</td>
              <td className="n">{hrs(m.lost.idle + m.lost.offTask + m.lost.offline)}</td>
              <td className="n">{cur(m.lostCost.recoverable, cy)}</td>
              <td />
            </tr>
          </tbody>
        </table>
      </section>

      <section className="ho__page">
        <h2>Worst hours, priced</h2>
        <table className="ho__tbl">
          <thead>
            <tr><th>Hour</th><th className="n">Lines / picker-h</th><th className="n">Shortfall vs target</th>
              <th className="n">Contribution</th><th>What was going on</th></tr>
          </thead>
          <tbody>
            {weakPriced.length === 0 && <tr><td colSpan={5}>Not enough of the shift has run to judge an hour.</td></tr>}
            {weakPriced.map((w) => (
              <tr key={w.i}>
                <td>{f.hourLabelAt(w.i)}</td>
                <td className="n low">{int(w.rate)}</td>
                <td className="n">{int(w.shortfall)} lines</td>
                <td className="n">{cur(w.value, cy)}</td>
                <td>{w.why || `${(w.cells.staffedMin / 60).toFixed(1)} pickers, no scheduled event`}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="ho__foot">
          Ranked on lines per staffed picker-hour, so a thin hour ranks low whatever the reason. The shortfall prices only
          the time pickers were on the floor and not on a scheduled break.
        </p>

        <section className="ho__two ho__block">
          <div>
            <h2>Service &amp; stock impact</h2>
            <table className="ho__tbl">
              <thead><tr><th>Product</th><th className="n">Lines</th><th className="n">Units</th><th className="n">At risk</th></tr></thead>
              <tbody>
                {f.topProducts.length === 0 && <tr><td colSpan={4}>Nothing reported short in this shift.</td></tr>}
                {f.topProducts.slice(0, 8).map((p) => (
                  <tr key={p.sku}>
                    <td>{p.name}</td>
                    <td className="n">{p.times}</td>
                    <td className="n">{p.qty}</td>
                    <td className="n">{cur(p.times * (m.rates.marginPerLine + m.rates.shortageHandlingPerLine), cy)}</td>
                  </tr>
                ))}
                {f.topProducts.length > 0 && (
                  <tr className="ho__tbl-total">
                    <td>All shortages</td>
                    <td className="n">{int(m.shortageLines)}</td>
                    <td className="n">{int(m.shortageUnits)}</td>
                    <td className="n">{cur(m.shortageValue, cy)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="ho__foot">Order and invoice numbers for every line are in the board's No stock export.</p>
          </div>

          <div>
            <h2>Equipment &amp; quality</h2>
            <table className="ho__tbl">
              <tbody>
                <tr><td>Scanner connection drops</td><td className="n">{all.disconnects}</td></tr>
                <tr><td>Time with a scanner offline</td><td className="n">{mins(all.disconnectMin)}</td></tr>
                <tr><td>Cost of that time</td><td className="n">{cur(m.lostCost.offline, cy)}</td></tr>
                <tr><td>Failed scans (label or read)</td><td className="n">{int(all.fails)}</td></tr>
                <tr><td>Share of all scans</td><td className="n">{pct1(all.fails / Math.max(1, all.fails + all.picks))}</td></tr>
                <tr><td>Rated-hour attainment</td><td className={`n ${ratedAttainment >= 1 ? 'good' : 'low'}`}>{pct(ratedAttainment)}</td></tr>
              </tbody>
            </table>

            <h2>Decisions asked of the director</h2>
            <ol className="ho__list">
              <li>
                Accept or challenge the {cur(m.exposure, cy)} exposure, and whether the recoverable
                {' '}{hrs(m.lost.idle + m.lost.offTask + m.lost.offline)} is a staffing or an equipment problem.
              </li>
              <li>
                {m.lostCost.offline > 0
                  ? `Device reliability: ${all.disconnects} drops cost ${cur(m.lostCost.offline, cy)} this shift.`
                  : 'Device reliability: no connection drops this shift.'}
              </li>
              <li>
                {m.shortageLines > 0
                  ? `Stock availability: ${int(m.shortageLines)} short lines, ${cur(m.shortageValue, cy)} at risk.`
                  : 'Stock availability: nothing reported short this shift.'}
              </li>
            </ol>
          </div>
        </section>

        <RatesNote kind="exec" rates={m.rates} target={target} />
        <p className="ho__foot">
          Scheduled events in this shift: {f.marks.length === 0 ? 'none' : f.marks.map((x) => `${hhmm(x.from)} ${x.label}`).join(' · ')}.
        </p>
      </section>

      <HandoverSign kind="exec" by={from} />
    </article>
  );
}
