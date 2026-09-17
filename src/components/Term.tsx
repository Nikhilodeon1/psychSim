import { useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { GLOSSARY } from '../data/glossary';

const EDGE = 12; // keep tooltips this far from the window edge

/** A term with a dotted underline; hover, focus or tap shows its definition. */
export function Term({ term, children }: { term: string; children?: ReactNode }) {
  const id = useId();
  const tipRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const entry = GLOSSARY[term];

  // Once visible, nudge the tooltip sideways so it never runs past the window edge.
  useLayoutEffect(() => {
    if (!open || !tipRef.current) return;
    const r = tipRef.current.getBoundingClientRect();
    const baseLeft = r.left - shift;
    const overRight = baseLeft + r.width - (window.innerWidth - EDGE);
    const overLeft = EDGE - baseLeft;
    setShift(overRight > 0 ? -overRight : overLeft > 0 ? overLeft : 0);
  }, [open]);

  if (!entry) return <>{children ?? term}</>;
  return (
    <span className="term" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        className="term-btn"
        aria-describedby={id}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
      >
        {children ?? term}
      </button>
      <span
        role="tooltip"
        id={id}
        ref={tipRef}
        className={`term-tip${open ? ' open' : ''}`}
        style={{ transform: `translateX(${shift}px)` }}
      >
        {entry.full && <b>{entry.full}. </b>}
        {entry.def}
      </span>
    </span>
  );
}
