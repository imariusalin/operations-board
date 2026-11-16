import { useState, type ReactNode } from 'react';

/**
 * Collapsible on phones, invisible on desktop.
 *
 * Above the mobile bracket the wrapper and the body are `display: contents` and the
 * toggle is hidden, so the children lay out exactly as if this component were not
 * there. Inside the mobile bracket the toggle shows and the body folds away.
 */
export default function MobileCollapse({
  title, hint, defaultOpen = false, children,
}: {
  title: string;
  hint?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`mc${open ? ' is-open' : ''}`}>
      <button className="mc__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span>{title}</span>
        {hint && <small>{hint}</small>}
        <i aria-hidden="true">{open ? '▴' : '▾'}</i>
      </button>
      <div className="mc__body">{children}</div>
    </div>
  );
}
