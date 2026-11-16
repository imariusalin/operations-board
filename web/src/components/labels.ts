import type { NotableEvent } from '../types';

/** An hour with less rated time than this is shown hollow, not judged high or low. */
export const HOUR_MIN_RATED_MIN = 5;

export const EVENT_LABEL: Record<NotableEvent['kind'], string> = {
  login: 'Badged in',
  logout: 'Badged out',
  move: 'Moved',
  task: 'Task',
  idle_start: 'Went idle',
  idle_end: 'Resumed',
  paused: 'Taken off task',
  resumed: 'Back on task',
  no_stock: 'No stock',
  shift_end: 'Shift ended',
  scanner_lost: 'Scanner lost connection',
  scanner_back: 'Scanner reconnected',
};

export const EVENT_TAG: Record<NotableEvent['kind'], string> = {
  login: 'IN',
  logout: 'OUT',
  move: 'MOVE',
  task: 'TASK',
  idle_start: 'IDLE',
  idle_end: 'BACK',
  paused: 'OFF',
  resumed: 'ON',
  no_stock: 'NO STK',
  shift_end: 'END',
  scanner_lost: 'CONN ✕',
  scanner_back: 'CONN ✓',
};
