import type { DestinationCount } from '../types';
import { int } from '../format';

export default function Destinations({ items }: { items: DestinationCount[] }) {
  const max = Math.max(1, ...items.map((d) => d.count));

  return (
    <section className="panel">
      <h3 className="panel__title">
        Destinations
        <span className="panel__hint">volume routed, this shift</span>
      </h3>
      <ul className="dests">
        {items.map((d) => (
          <li key={d.destination} className="dests__row">
            <span className="dests__name">{d.destination}</span>
            <span className="dests__track">
              <span className="dests__fill" style={{ width: `${(d.count / max) * 100}%` }} />
            </span>
            <span className="dests__count">{int(d.count)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
