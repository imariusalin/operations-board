import { useState } from 'react';
import type { Snapshot, StationStatus } from '../types';
import type { ConnState } from '../useBoard';

export type View = 'map' | 'mgmt' | 'grid' | 'station' | 'nostock' | 'activity' | 'scanner';

const NAV: { id: View; label: string; short: string; icon: string }[] = [
  { id: 'map', label: 'Floor map', short: 'Floor', icon: '▣' },
  { id: 'mgmt', label: 'Management', short: 'Manage', icon: '◷' },
  { id: 'grid', label: 'All stations', short: 'Stations', icon: '▦' },
  { id: 'nostock', label: 'No stock', short: 'No stock', icon: '⊘' },
  { id: 'activity', label: 'Activity', short: 'Activity', icon: '≡' },
  { id: 'scanner', label: 'Scanner', short: 'Scanner', icon: '⌁' },
];

const LEGEND: { status: StationStatus; label: string }[] = [
  { status: 'above', label: 'At / above 206' },
  { status: 'below', label: 'Below 206' },
  { status: 'idle', label: 'Idle' },
  { status: 'paused', label: 'Off task (paused)' },
  { status: 'break', label: 'On break' },
  { status: 'empty', label: 'Unmanned' },
];

const SPEEDS = [1, 5, 10, 30, 60, 180];

interface Props {
  snapshot: Snapshot;
  conn: ConnState;
  view: View;
  onView: (v: View) => void;
  anonymise: boolean;
  onAnonymise: (v: boolean) => void;
  onSpeed: (v: number) => void;
  manager: string;
  onManager: (v: string) => void;
  /** Drawer state. Used from the compact and medium brackets. */
  open?: boolean;
  onClose?: () => void;
}

export default function Sidebar({
  snapshot, conn, view, onView, anonymise, onAnonymise, onSpeed, manager, onManager, open = false, onClose,
}: Props) {
  const [boardOpen, setBoardOpen] = useState(false);
  const counts = snapshot.stations.reduce<Record<string, number>>((acc, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1;
    return acc;
  }, {});

  // Picking a view closes the phone drawer and the tablet Board menu.
  const pick = (v: View) => {
    onView(v);
    onClose?.();
    setBoardOpen(false);
  };

  return (
    <nav className={`side${open ? ' is-open' : ''}${boardOpen ? ' is-board' : ''}`}>
      <div className="side__brand">
        <span className="side__mark">◱</span>
        <div className="side__brandtext">
          <h1>Ops Live Board</h1>
          <p>Manual dept · A–L · target 206</p>
        </div>
        <button className="side__close" onClick={onClose} aria-label="Close menu">×</button>
      </div>

      <ul className="side__nav">
        {NAV.map((item) => (
          <li key={item.id}>
            <button
              className={`side__navbtn${view === item.id || (view === 'station' && item.id === 'grid') ? ' is-active' : ''}`}
              onClick={() => pick(item.id)}
              aria-current={view === item.id ? 'page' : undefined}
            >
              <span className="side__navicon">{item.icon}</span>
              <span className="side__navlabel">{item.label}</span>
              <span className="side__navshort">{item.short}</span>
            </button>
          </li>
        ))}
      </ul>

      <div className="side__panel">
      <div className="side__section">
        <h2>Status</h2>
        <ul className="side__legend">
          {LEGEND.map((l) => (
            <li key={l.status}>
              <span className={`side__swatch side__swatch--${l.status}`} />
              <span className="side__legend-label">{l.label}</span>
              <span className="side__legend-count">{counts[l.status] ?? 0}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="side__section">
        <h2>Documents</h2>
        <ul className="side__docs">
          <li><a href="/how-it-works" target="_blank" rel="noreferrer">How it works (PDF)</a></li>
          <li><a href="/sample-handover" target="_blank" rel="noreferrer">Sample handover (PDF)</a></li>
        </ul>
      </div>

      <div className="side__foot">
        <div className={`conn conn--${conn}`}>
          <span className="conn__dot" />
          {conn === 'open' ? 'live' : conn === 'connecting' ? 'connecting' : 'reconnecting'}
        </div>

        <label className="ctl">
          <span>Speed</span>
          <select value={snapshot.speed} onChange={(e) => onSpeed(Number(e.target.value))}>
            {SPEEDS.map((s) => (
              <option key={s} value={s}>{s}×</option>
            ))}
          </select>
        </label>

        <label className="ctl ctl--stack">
          <span>Manager on duty</span>
          <input
            className="side__input"
            value={manager}
            onChange={(e) => onManager(e.target.value)}
            placeholder="Your name"
            aria-label="Manager on duty"
          />
        </label>

        <label className="ctl ctl--check">
          <input type="checkbox" checked={anonymise} onChange={(e) => onAnonymise(e.target.checked)} />
          <span>Pseudonymise</span>
        </label>
      </div>
      </div>

      <button
        type="button"
        className="side__board"
        onClick={() => setBoardOpen((v) => !v)}
        aria-expanded={boardOpen}
      >
        <span aria-hidden="true">{boardOpen ? '▴' : '▾'}</span>
        Board
      </button>
    </nav>
  );
}
