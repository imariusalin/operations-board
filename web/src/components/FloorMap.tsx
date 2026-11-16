import type { ScheduleMark, StationView, BoardTotals } from '../types';
import { MOBILE_PORTRAIT_QUERY, useMediaQuery } from '../useBoard';
import { int, pct } from '../format';
import { toneColor, toneOf } from '../status';

/**
 * The manual department as a U. Six stations down the left leg (A at the top to F at
 * the bottom), six up the right leg (G at the bottom to L at the top). The bottom of
 * the U is only the connecting aisle — no stations sit on it.
 *
 * Two layouts exist because an SVG keeps its aspect ratio: a portrait phone gets a
 * taller U. Only the geometry differs; nodes and interaction are shared.
 */

interface Layout {
  key: 'wide' | 'tall';
  w: number;
  h: number;
  leftX: number;
  rightX: number;
  /** y of the top station and the bottom station on each leg. */
  topY: number;
  bottomY: number;
  /** y of the connecting aisle along the bottom. */
  baseY: number;
  corner: number;
  labelOffset: number;
  labelDy: number;
}

const WIDE: Layout = {
  key: 'wide', w: 900, h: 600,
  leftX: 180, rightX: 720, topY: 70, bottomY: 440, baseY: 520, corner: 70,
  labelOffset: 44, labelDy: 14,
};

const TALL: Layout = {
  key: 'tall', w: 500, h: 780,
  leftX: 120, rightX: 380, topY: 70, bottomY: 620, baseY: 710, corner: 60,
  labelOffset: 42, labelDy: 17,
};

const R = 27;
const CIRC = 2 * Math.PI * R;
/** Attainment shown as a full ring at this value, so over-performance has headroom. */
const RING_MAX = 1.25;

function uPath(l: Layout): string {
  const top = l.topY - 30;
  return [
    `M ${l.leftX} ${top}`,
    `L ${l.leftX} ${l.baseY - l.corner}`,
    `Q ${l.leftX} ${l.baseY} ${l.leftX + l.corner} ${l.baseY}`,
    `L ${l.rightX - l.corner} ${l.baseY}`,
    `Q ${l.rightX} ${l.baseY} ${l.rightX} ${l.baseY - l.corner}`,
    `L ${l.rightX} ${top}`,
  ].join(' ');
}

interface Node { x: number; y: number; side: 'left' | 'right' }

/** Stations 0–5 down the left leg; 6–11 up the right leg, starting from the bottom. */
function nodesFor(l: Layout, n: number): Node[] {
  const perLeg = Math.ceil(n / 2);
  const step = perLeg > 1 ? (l.bottomY - l.topY) / (perLeg - 1) : 0;
  return Array.from({ length: n }, (_, i) =>
    i < perLeg
      ? { x: l.leftX, y: l.topY + i * step, side: 'left' as const }
      : { x: l.rightX, y: l.bottomY - (i - perLeg) * step, side: 'right' as const },
  );
}

interface Props {
  stations: StationView[];
  totals: BoardTotals;
  target: number;
  activeMark?: ScheduleMark;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export default function FloorMap({ stations, totals, target, activeMark, selectedId, onSelect }: Props) {
  const layout = useMediaQuery(MOBILE_PORTRAIT_QUERY) ? TALL : WIDE;
  const nodes = nodesFor(layout, stations.length);
  const path = uPath(layout);
  const cx = (layout.leftX + layout.rightX) / 2;
  const cy = (layout.topY + layout.bottomY) / 2;
  const bannerW = layout.key === 'wide' ? 240 : 150;
  const boardTone = totals.boardAttainment >= 1 ? 'above' : 'below';

  return (
    <div className={`map map--${layout.key}`}>
      <svg className="map__svg" viewBox={`0 0 ${layout.w} ${layout.h}`} role="group" aria-label="Department floor map">
        <rect x="0" y="0" width={layout.w} height={layout.h} fill="transparent" onClick={() => onSelect(null)} />

        <path d={path} className="map__aisle" />
        <path d={path} className="map__aisle-inner" />

        <text x={cx} y={layout.baseY + 4} className="map__legend" textAnchor="middle" dominantBaseline="central">
          AISLE
        </text>

        {/* Department summary in the middle of the U — readable from across the floor. */}
        <g className="map__centre" pointerEvents="none">
          <text x={cx} y={cy - 64} className="map__centre-label" textAnchor="middle">MANUAL DEPARTMENT</text>
          <text x={cx} y={cy - 14} className={`map__centre-value map__centre-value--${boardTone}`} textAnchor="middle">
            {int(totals.boardRate / Math.max(1, totals.boardTarget / target))}
          </text>
          <text x={cx} y={cy + 16} className="map__centre-sub" textAnchor="middle">
            avg lines/h per picker · target {target}
          </text>
          <text x={cx} y={cy + 40} className="map__centre-sub" textAnchor="middle">
            {pct(totals.boardAttainment)} · {totals.stationsManned}/{totals.stationsTotal} manned
            {totals.stationsPaused > 0 ? ` · ${totals.stationsPaused} off task` : ''}
          </text>
          {activeMark && (
            <g>
              <rect x={cx - bannerW / 2} y={cy + 58} width={bannerW} height={26} rx={6} className={`map__mark map__mark--${activeMark.kind}`} />
              <text x={cx} y={cy + 71} className="map__mark-text" textAnchor="middle" dominantBaseline="central">
                {activeMark.label.toUpperCase()}
                {layout.key === 'wide' ? ` · rating ${activeMark.kind === 'break' ? 'paused' : 'running'}` : ''}
              </text>
            </g>
          )}
        </g>

        {stations.map((s, i) => (
          <StationNode
            key={s.id}
            station={s}
            node={nodes[i]}
            layout={layout}
            selected={s.id === selectedId}
            onSelect={onSelect}
          />
        ))}
      </svg>
    </div>
  );
}

function StationNode({ station: s, node, layout, selected, onSelect }: {
  station: StationView;
  node: Node;
  layout: Layout;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const tone = toneOf(s);
  const filled = Math.max(0, Math.min(1, s.attainment / RING_MAX));
  const manned = s.status !== 'empty';

  const out = node.side === 'left' ? -1 : 1;
  const lx = node.x + out * layout.labelOffset;
  const ly = node.y - layout.labelDy / 2;
  const anchor = node.side === 'left' ? 'end' : 'start';

  let second = 'unmanned';
  if (s.status === 'paused') second = 'off task';
  else if (s.status === 'break') second = 'break';
  else if (manned) second = tone === 'settling' ? 'settling' : pct(s.attainment);

  return (
    <g
      className={`node node--${tone}${selected ? ' node--selected' : ''}`}
      style={{ ['--accent' as string]: toneColor(tone) }}
      onClick={(e) => { e.stopPropagation(); onSelect(s.id); }}
      role="button"
      tabIndex={0}
      aria-label={`Station ${s.id}, ${s.status}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(s.id); }}
    >
      {selected && <circle cx={node.x} cy={node.y} r={R + 9} className="node__halo" />}
      <circle cx={node.x} cy={node.y} r={R} className="node__plate" />
      <circle cx={node.x} cy={node.y} r={R} className="node__track" />
      {manned && (
        <circle
          cx={node.x} cy={node.y} r={R}
          className="node__ring"
          strokeDasharray={`${filled * CIRC} ${CIRC}`}
          transform={`rotate(-90 ${node.x} ${node.y})`}
        />
      )}
      <text x={node.x} y={node.y} className="node__letter" textAnchor="middle" dominantBaseline="central">
        {s.id}
      </text>
      {s.status === 'paused' && (
        <text x={node.x + 19} y={node.y - 19} className="node__badge" textAnchor="middle" dominantBaseline="central">❚❚</text>
      )}

      <text x={lx} y={ly} className="node__label" textAnchor={anchor} dominantBaseline="middle">
        <tspan className="node__label-name">{manned ? `${int(s.rollingRate)}/h` : '—'}</tspan>
        <tspan x={lx} dy={layout.labelDy} className="node__label-rate">{second}</tspan>
      </text>
    </g>
  );
}
