import type { HourlyReport, NoStockRecord, Snapshot } from '../types';
import { figures, type HandoverKind } from '../handover';
import type { ShiftWindow } from '../shifts';
import HandoverOps from './HandoverOps';
import HandoverExec from './HandoverExec';

/**
 * The shift handover, laid out for A4. Rendered off-screen and printed — the browser's
 * "Save as PDF" turns it into the file.
 *
 * Two documents, one set of figures:
 *   ops  — supervisor → manager: how the shift was worked.
 *   exec — manager → director: what the shift cost.
 *
 * Both are computed in ../handover from the same hourly cells the Management and Station
 * pages use, so no two sheets can disagree.
 */

interface Props {
  snapshot: Snapshot;
  hourly: HourlyReport;
  noStock: NoStockRecord[];
  window: ShiftWindow;
  kind: HandoverKind;
  notes: string;
  /** Name of the person handing over: the supervisor, or the manager. */
  manager: string;
  anonymise: boolean;
}

export default function HandoverReport({ snapshot, hourly, noStock, window: w, kind, notes, manager, anonymise }: Props) {
  // The director's copy leads on the worst hours, so it asks for more of them.
  const f = figures(snapshot, hourly, noStock, w, kind === 'exec' ? 5 : 3);

  return kind === 'exec'
    ? <HandoverExec f={f} simNow={snapshot.simNow} notes={notes} from={manager} />
    : <HandoverOps f={f} simNow={snapshot.simNow} notes={notes} from={manager} anonymise={anonymise} />;
}
