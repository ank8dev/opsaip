import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useMotionTokens } from '../../state/ui';
import { popover } from '../../styles/motion';
import { AgentsIcon, AnnounceIcon, MessageIcon, TaskIcon } from '../common/Icons';

export type ComposeMode = 'task' | 'message' | 'agent' | 'announce';

export const MODES: { key: ComposeMode; title: string; description: string; Icon: typeof TaskIcon }[] = [
  { key: 'task', title: 'Task', description: 'Assign work to a teammate', Icon: TaskIcon },
  { key: 'message', title: 'Message', description: 'Write to one teammate on Slack', Icon: MessageIcon },
  { key: 'agent', title: 'Agent', description: 'Start Claude Code or Codex', Icon: AgentsIcon },
  { key: 'announce', title: 'Announce', description: 'Tell the whole team on Slack', Icon: AnnounceIcon },
];

interface ModeMenuProps {
  mode: ComposeMode;
  onChange: (m: ComposeMode) => void;
}

/** One button that shows the current mode and opens a menu of all four. */
export function ModeMenu({ mode, onChange }: ModeMenuProps) {
  const t = useMotionTokens();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [pos, setPos] = useState({ left: 0, bottom: 0 });
  const current = MODES.find((m) => m.key === mode) ?? MODES[0];

  // The composer sits at the bottom, so the menu opens upward from the button.
  // It is rendered into <body>: the composer's ring clips anything inside it.
  function openMenu() {
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    setOpen(true);
  }
  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) btnRef.current?.focus({ preventScroll: true });
  }

  useEffect(() => {
    if (!open) return;
    const i = MODES.findIndex((m) => m.key === mode);
    itemRefs.current[Math.max(0, i)]?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => {
      const n = e.target as Node;
      if (!menuRef.current?.contains(n) && !btnRef.current?.contains(n)) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('pointerdown', onDown);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize', onResize);
    };
  }, [open, mode]);

  function onItemKey(e: KeyboardEvent, i: number) {
    const n = MODES.length;
    const go = (j: number) => itemRefs.current[(j + n) % n]?.focus();
    if (e.key === 'ArrowDown') { e.preventDefault(); go(i + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); go(i - 1); }
    else if (e.key === 'Home') { e.preventDefault(); go(0); }
    else if (e.key === 'End') { e.preventDefault(); go(n - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === 'Tab') close(false);
  }

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        className="op-modebtn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Mode: ${current.title}`}
        onClick={() => (open ? close(false) : openMenu())}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); openMenu(); }
        }}
      >
        <current.Icon className="op-mode-ico" />
        <span>{current.title}</span>
        <span className="op-modebtn-chev" aria-hidden="true" />
      </button>
      {createPortal(
      <AnimatePresence>
        {open && (
          <motion.div
            ref={menuRef}
            className="op-menu"
            role="menu"
            aria-label="Mode"
            style={{ left: pos.left, bottom: pos.bottom, transformOrigin: 'bottom left' }}
            {...popover(t, 4)}
          >
            {MODES.map((m, i) => (
              <button
                key={m.key}
                ref={(el) => { itemRefs.current[i] = el; }}
                type="button"
                className="op-menu-item"
                role="menuitemradio"
                aria-checked={m.key === mode}
                tabIndex={-1}
                onClick={() => { onChange(m.key); close(false); }}
                onKeyDown={(e) => onItemKey(e, i)}
              >
                <m.Icon className="op-mode-ico" />
                <span className="op-menu-t">{m.title}</span>
                <span className="op-check" aria-hidden="true" />
                <span className="op-menu-d">{m.description}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>,
      document.body,
      )}
    </>
  );
}
