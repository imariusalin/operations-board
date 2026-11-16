import { useState } from 'react';
import { sendControl, useBoard, useHourly, useManager, useNoStock } from './useBoard';
import Sidebar, { type View } from './components/Sidebar';
import TopLine from './components/TopLine';
import FloorMap from './components/FloorMap';
import StationDetail from './components/StationDetail';
import StationCard from './components/StationCard';
import ActivityLog from './components/ActivityLog';
import ScanPanel from './components/ScanPanel';
import Destinations from './components/Destinations';
import Management from './components/Management';
import NoStockView from './components/NoStockView';
import StationPage from './components/StationPage';

export default function App() {
  const { snapshot, conn } = useBoard();
  const hourly = useHourly();
  const noStock = useNoStock();
  const [view, setView] = useState<View>('map');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [anonymise, setAnonymise] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [pageId, setPageId] = useState<string>('A');
  const [manager, setManager] = useManager();

  if (!snapshot) {
    return (
      <div className="boot">
        <div className="boot__spinner" />
        <p>Connecting to board…</p>
        <span>Is the server running on :5174?</span>
      </div>
    );
  }

  const selected = snapshot.stations.find((s) => s.id === selectedId) ?? null;

  const openOnMap = (id: string) => {
    setSelectedId(id);
    setView('map');
  };

  /** Clicking a card in All stations opens that station's own page. */
  const openStation = (id: string) => {
    setPageId(id);
    setView('station');
  };

  const pageStation = snapshot.stations.find((s) => s.id === pageId) ?? snapshot.stations[0];
  // The grid mirrors the floor: the left leg A–F, then the right leg G–L from the bottom up.
  const left = snapshot.stations.slice(0, 6);
  const right = snapshot.stations.slice(6);

  return (
    <div className="shell">
      <Sidebar
        snapshot={snapshot}
        conn={conn}
        view={view}
        onView={setView}
        anonymise={anonymise}
        onAnonymise={setAnonymise}
        onSpeed={(speed) => void sendControl({ speed })}
        manager={manager}
        onManager={setManager}
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
      />

      {menuOpen && <button className="scrim" onClick={() => setMenuOpen(false)} aria-label="Close menu" />}

      <div className="content">
        <TopLine snapshot={snapshot} view={view} menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />

        {view === 'map' && (
          <div className="view view--map">
            <FloorMap
              stations={snapshot.stations}
              totals={snapshot.totals}
              target={snapshot.target}
              activeMark={snapshot.activeMark}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <StationDetail
              station={selected}
              events={snapshot.events}
              hourly={hourly}
              noStock={noStock?.records ?? []}
              simNow={snapshot.simNow}
              anonymise={anonymise}
              onClose={() => setSelectedId(null)}
            />
          </div>
        )}

        {view === 'mgmt' && (
          <Management snapshot={snapshot} hourly={hourly} noStock={noStock?.records ?? []} manager={manager} anonymise={anonymise} />
        )}

        {view === 'grid' && (
          <div className="view view--groups">
            {[{ title: 'Left side · A–F', hint: 'top to bottom', list: left },
              { title: 'Right side · G–L', hint: 'bottom to top', list: right }].map((g) => (
              <section key={g.title} className="grid-group">
                <h3 className="grid-group__title">{g.title}<span>{g.hint} · click a station for its full day</span></h3>
                <div className="grid-group__cards">
                  {g.list.map((s) => (
                    <button key={s.id} className="cardbtn" onClick={() => openStation(s.id)} aria-label={`Open station ${s.id}`}>
                      <StationCard station={s} anonymise={anonymise} />
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        {view === 'station' && pageStation && (
          <StationPage
            station={pageStation}
            stations={snapshot.stations}
            simNow={snapshot.simNow}
            anonymise={anonymise}
            onPick={setPageId}
            onBack={() => setView('grid')}
            onOpenMap={openOnMap}
          />
        )}

        {view === 'nostock' && (
          <NoStockView
            records={noStock?.records ?? null}
            stationIds={snapshot.stations.map((s) => s.id)}
            anonymise={anonymise}
          />
        )}

        {view === 'activity' && (
          <div className="view view--single">
            <ActivityLog events={snapshot.events} anonymise={anonymise} />
          </div>
        )}

        {view === 'scanner' && (
          <div className="view view--scanner">
            <ScanPanel stations={snapshot.stations} lastScans={snapshot.lastScans} anonymise={anonymise} />
            <Destinations items={snapshot.destinations} />
          </div>
        )}
      </div>
    </div>
  );
}
