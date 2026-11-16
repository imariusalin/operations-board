import type { StationStatus, StationView } from './types';

export const STATUS_LABEL: Record<StationStatus, string> = {
  above: 'ABOVE TARGET',
  below: 'BELOW TARGET',
  idle: 'IDLE',
  paused: 'OFF TASK · PAUSED',
  break: 'ON BREAK',
  empty: 'UNMANNED',
};

/**
 * The colour a station wears. While settling, above/below is withheld — an operator
 * who badged in twenty seconds ago has not earned a verdict yet.
 */
export function toneOf(s: StationView): StationStatus | 'settling' {
  if (s.settling && (s.status === 'above' || s.status === 'below')) return 'settling';
  return s.status;
}

export const toneColor = (t: StationStatus | 'settling') =>
  `var(--st-${t === 'settling' ? 'empty' : t})`;

export function statusLabel(s: StationView): string {
  return toneOf(s) === 'settling' ? 'SETTLING' : STATUS_LABEL[s.status];
}
