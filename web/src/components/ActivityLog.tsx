import type { NotableEvent } from '../types';
import { clock, pseudonym } from '../format';
import { EVENT_TAG as KIND_LABEL } from './labels';


interface Props {
  events: NotableEvent[];
  anonymise: boolean;
}

export default function ActivityLog({ events, anonymise }: Props) {
  const who = (e: NotableEvent) =>
    !e.badgeId ? '' : anonymise ? pseudonym(e.badgeId) : e.operatorName ?? e.badgeId;

  return (
    <section className="panel">
      <h3 className="panel__title">
        Operator activity
        <span className="panel__hint">who did what: badge in / out, moves, off task, no stock, scanner connection</span>
      </h3>
      <ol className="log">
        {events.length === 0 && <li className="log__empty">No activity yet</li>}
        {events.map((e) => (
          <li key={e.id} className={`log__row log__row--${e.kind}`}>
            <span className="log__time">{clock(e.ts)}</span>
            <span className={`log__tag log__tag--${e.kind}`}>{KIND_LABEL[e.kind]}</span>
            <span className="log__body">
              <strong>{who(e)}</strong>{' '}
              {e.kind === 'move' ? (
                <>
                  Station {e.fromStationId} <span className="log__arrow">→</span> {e.stationId}
                </>
              ) : (
                <>Station {e.stationId}</>
              )}
              {e.detail && <span className="log__detail"> · {e.detail}</span>}
              {e.by && <span className="log__by"> · by {e.by}</span>}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
