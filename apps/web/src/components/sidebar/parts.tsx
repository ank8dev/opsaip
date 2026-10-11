// Small building blocks shared by the sidebar sections.

import { useState, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { useMotionTokens, useUi } from '../../state/ui';
import { listItem } from '../../styles/motion';

/** True when the search is empty or `text` contains it. */
export function useSearchHit() {
  const q = useUi().query.trim().toLowerCase();
  return (...parts: (string | undefined)[]) => !q || parts.join(' ').toLowerCase().includes(q);
}

/** How a section is shown: on its own, or inside "search everything". */
export type SectionMode = 'one' | 'all';

export function SectionLabel({ mode, children }: { mode: SectionMode; children: ReactNode }) {
  return mode === 'all' ? <div className="op-sv-label">{children}</div> : null;
}

interface GroupProps {
  label: string;
  count?: number | string;
  fail?: boolean;
  note?: string;
  hidden?: boolean;
  children: ReactNode;
}

/** A group label with its count, then a list of rows. */
export function Group({ label, count, fail, note, hidden, children }: GroupProps) {
  return (
    <section className={`op-group${fail ? ' op-group-fail' : ''}`} aria-label={label} hidden={hidden}>
      <div className="op-group-h">
        <span>{label}</span>
        {count != null && <span className="op-group-n">{count}</span>}
      </div>
      {note && <p className="op-mcp-note">{note}</p>}
      <ul className="op-plist">{children}</ul>
    </section>
  );
}

interface RowProps {
  index: number;
  hidden?: boolean;
  children: ReactNode;
}

/** A list row that drops in when its section opens. */
export function Row({ index, hidden, children }: RowProps) {
  const t = useMotionTokens();
  return (
    <motion.li className="op-li" hidden={hidden} {...listItem(t, index)}>
      {children}
    </motion.li>
  );
}

interface ExpandRowProps extends Omit<RowProps, 'children'> {
  /** The row's visible content; it becomes the toggle button. */
  summary: ReactNode;
  summaryClass?: string;
  /** Shown below the row when it is open. */
  details: ReactNode;
}

/** A row that opens its details in place. */
export function ExpandRow({ index, hidden, summary, summaryClass = '', details }: ExpandRowProps) {
  const t = useMotionTokens();
  const [open, setOpen] = useState(false);
  return (
    <motion.li className="op-li" hidden={hidden} data-open={open} {...listItem(t, index)}>
      <button type="button" className={`op-person ${summaryClass}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        {summary}
      </button>
      <div className="op-more">
        <div className="op-more-clip">
          <div className="op-more-in">{details}</div>
        </div>
      </div>
    </motion.li>
  );
}
