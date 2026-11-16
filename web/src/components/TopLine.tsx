import { useState } from 'react';
import type { Snapshot } from '../types';
import { clock, int, pct, pct1 } from '../format';
import { runningShifts } from '../shifts';

const TITLES: Record<string, string> = {
  map: 'Department floor',
  mgmt: 'Management · 24 hours',
  grid: 'All stations',
  nostock: 'No stock',
  station: 'Station',
  activity: 'Operator activity',
  scanner: 'Scanner ingest',
};

interface Props {
  snapshot: Snapshot;
  view: string;
  /** Drawer state — the button itself is only visible in the mobile bracket. */
  menuOpen?: boolean;
  onMenu?: () => void;
}

export default function TopLine({ snapshot, view, menuOpen = false, onMenu }: Props) {
  const t = snapshot.totals;
  const tone = t.boardAttainment >= 1 ? 'above' : 'below';
  // Phones only: the less urgent stats fold away behind a toggle. No effect on desktop.
  const [more, setMore] = useState(false);

  return (
    <header className={`topline${more ? ' is-expanded' : ''}`}>
      <button
        className="topline__burger"
        onClick={onMenu}
        aria-label={menuOpen ? 'Close menu' : 'Open menu'}
        aria-expanded={menuOpen}
      >
        <span />
        <span />
        <span />
      </button>

      <h2 className="topline__title">{TITLES[view] ?? ''}</h2>

      <button className="topline__more" onClick={() => setMore((v) => !v)} aria-expanded={more}>
        {more ? 'Less ▴' : 'More ▾'}
      </button>

      <div className="topline__stats">
        <Stat label="Time" value={clock(snapshot.simNow)} sub={snapshot.activeMark ? snapshot.activeMark.label : 'no break now'} />
        <Stat
          label="Shift running"
          value={runningShifts(snapshot.shifts, snapshot.simNow).map((r) => r.name).join(' + ') || '—'}
          sub={runningShifts(snapshot.shifts, snapshot.simNow).map((r) => r.label.split(' ')[1]).join(' · ') || 'between shifts'}
        />
        <Stat extra label="Manned" value={`${t.stationsManned}/${t.stationsTotal}`} sub={`${t.stationsIdle} idle · ${t.stationsPaused} off task`} />
        <Stat extra label="Lines" value={int(t.linesTotal)} sub="today" />
        <Stat extra label="Fail scans" value={int(t.failsTotal)} sub={pct1(t.failRate)} />
        <Stat extra label="No stock" value={int(t.noStockTotal)} sub="today" />
        <Stat label="Attainment" value={pct(t.boardAttainment)} sub={`vs ${snapshot.target}/h · 10 min`} tone={tone} />
      </div>
    </header>
  );
}

function Stat({ label, value, sub, tone, extra }: { label: string; value: string; sub?: string; tone?: string; extra?: boolean }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}${extra ? ' stat--extra' : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {sub && <span className="stat__sub">{sub}</span>}
    </div>
  );
}
