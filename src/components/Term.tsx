import { useId } from 'react';
import type { ReactNode } from 'react';
import { GLOSSARY } from '../data/glossary';

/** A term with a dotted underline; hover, focus or tap shows its definition. */
export function Term({ term, children }: { term: string; children?: ReactNode }) {
  const id = useId();
  const entry = GLOSSARY[term];
  if (!entry) return <>{children ?? term}</>;
  return (
    <span className="term">
      <button type="button" className="term-btn" aria-describedby={id}>
        {children ?? term}
      </button>
      <span role="tooltip" id={id} className="term-tip">
        {entry.full && <b>{entry.full}. </b>}
        {entry.def}
      </span>
    </span>
  );
}
