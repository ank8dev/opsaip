import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { useUi } from '../../state/ui';
import { useFocusTrap } from '../../lib/focusTrap';
import { popover } from '../../styles/motion';
import './TaskOverlay.css';

/**
 * The task window: a dialog over the chat. The page behind is dimmed and
 * inert (no focus, no scrolling); the window is as tall as its content and
 * scrolls inside when that is taller than the screen. Esc, a click on the
 * backdrop, the close button and the browser's back button all close it
 * (the last one through lib/overlayHistory.ts, wired in state/ui.tsx).
 * Focus stays inside while it is open and returns to where it was.
 *
 * Motion: the backdrop fades with the `--op-dur-base` / `--op-dur-fast` and
 * `--op-ease-out` / `--op-ease-exit` tokens, and the window uses `popover`
 * from styles/motion.ts, the same entrance and exit as the app's menus. Both
 * must be rendered inside <AnimatePresence> so the exit plays. Reduced motion
 * is already in the tokens.
 */
export function TaskOverlay({ title, label, children }: { title: ReactNode; label: string; children: ReactNode }) {
  const ui = useUi();
  const t = ui.motion;
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const pressedOnBackdrop = useRef(false);

  useFocusTrap(dialog, true, closeButton);

  // Esc closes it, even while typing in the window; the page behind never sees the key.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.isComposing) {
        e.stopPropagation();
        e.preventDefault();
        ui.closeTask();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ui]);

  // The page behind cannot scroll or take focus while the window is open.
  useEffect(() => {
    const root = document.getElementById('root');
    const body = document.body;
    const overflow = body.style.overflow;
    body.style.overflow = 'hidden';
    root?.setAttribute('inert', '');
    return () => {
      body.style.overflow = overflow;
      root?.removeAttribute('inert');
    };
  }, []);

  const win = (
    <motion.div
      className="op-overlay"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1, transition: { duration: t.base, ease: t.easeOut } }}
      exit={{ opacity: 0, transition: { duration: t.fast, ease: t.easeExit } }}
      onPointerDown={(e) => { pressedOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (pressedOnBackdrop.current && e.target === e.currentTarget) ui.closeTask(); }}
    >
      <motion.section
        ref={dialog}
        className="op-overlay-win"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        aria-labelledby={titleId}
        tabIndex={-1}
        {...popover(t, t.dist)}
      >
        <div className="op-overlay-head">
          <button ref={closeButton} type="button" className="op-back" aria-label="Close task" onClick={ui.closeTask}>
            <span />
          </button>
          <span className="op-overlay-title" id={titleId}>{title}</span>
        </div>
        <div className="op-overlay-body">{children}</div>
      </motion.section>
    </motion.div>
  );
  // On the page it goes to <body>, outside #root, so #root can be made inert. Without a document (server rendering in tests) it renders in place.
  return typeof document === 'undefined' ? win : createPortal(win, document.body);
}
