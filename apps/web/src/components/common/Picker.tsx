// A select that opens Opsaip's own listbox instead of the system list.
// The native <select> stays the source of truth (forms, screen readers,
// keyboard focus). Phones (coarse pointers) keep the system picker, which suits thumbs.

import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useMotionTokens } from '../../state/ui';
import { popover } from '../../styles/motion';

export interface PickerOption {
  value: string;
  label: string;
  /** Second line, e.g. a role or owner. */
  detail?: string;
  /** Shown before the text, e.g. a face. */
  lead?: ReactNode;
  disabled?: boolean;
}

interface PickerProps {
  id?: string;
  ariaLabel: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  className?: string;
  /** Text inside the closed select, if different from the label. */
  display?: (o: PickerOption) => string;
}

const finePointer = () => !window.matchMedia || window.matchMedia('(pointer: fine)').matches;

export function Picker({ id, ariaLabel, value, options, onChange, className, display }: PickerProps) {
  const t = useMotionTokens();
  const listId = useId();
  const selRef = useRef<HTMLSelectElement>(null);
  const lbRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState({ left: 0, top: 0, maxHeight: 320, minWidth: 220, up: false });
  const typed = useRef({ text: '', timer: 0 });

  const selectedIndex = Math.max(0, options.findIndex((o) => o.value === value));

  function openList() {
    setActive(selectedIndex);
    setOpen(true);
  }
  function close(refocus: boolean) {
    setOpen(false);
    if (refocus) selRef.current?.focus({ preventScroll: true });
  }
  function choose(i: number) {
    const o = options[i];
    if (!o || o.disabled) return;
    close(true);
    if (o.value !== value) onChange(o.value);
  }
  function move(d: number, from = active) {
    const n = options.length;
    let i = from;
    for (let s = 0; s < n; s++) {
      i = (i + d + n) % n;
      if (!options[i].disabled) return setActive(i);
    }
  }

  // Open toward the side with more room, inside the window.
  useLayoutEffect(() => {
    if (!open || !selRef.current) return;
    const r = selRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 12;
    const above = r.top - 12;
    const natural = Math.min(lbRef.current?.scrollHeight ?? 320, 320);
    const up = below < natural && above > below;
    const maxHeight = Math.max(120, Math.min(320, up ? above : below));
    const width = Math.min(Math.max(r.width, 220), 340);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    const height = Math.min(natural, maxHeight);
    setPlace({ left, top: up ? r.top - 6 - height : r.bottom + 6, maxHeight, minWidth: width, up });
  }, [open]);

  // Keep the active row in view, and the list focused while open.
  useEffect(() => {
    if (!open) return;
    lbRef.current?.focus({ preventScroll: true });
  }, [open]);
  useEffect(() => {
    const lb = lbRef.current;
    const row = lb?.children[active] as HTMLElement | undefined;
    if (!lb || !row) return;
    if (row.offsetTop < lb.scrollTop) lb.scrollTop = row.offsetTop - 4;
    else if (row.offsetTop + row.offsetHeight > lb.scrollTop + lb.clientHeight)
      lb.scrollTop = row.offsetTop + row.offsetHeight - lb.clientHeight + 4;
  }, [active, open]);

  // Close on a click elsewhere, page scroll or resize.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const n = e.target as Node;
      if (!lbRef.current?.contains(n) && n !== selRef.current) close(false);
    };
    const onScroll = (e: Event) => {
      if (!(e.target instanceof Node && lbRef.current?.contains(e.target))) close(false);
    };
    const onResize = () => close(false);
    document.addEventListener('mousedown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open]);

  function onSelectKey(e: KeyboardEvent<HTMLSelectElement>) {
    if (!finePointer()) return;
    if (['Enter', ' ', 'ArrowDown', 'ArrowUp', 'F4'].includes(e.key)) {
      e.preventDefault();
      openList();
    }
  }

  function onListKey(e: KeyboardEvent<HTMLDivElement>) {
    const k = e.key;
    if (k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); move(k === 'ArrowDown' ? 1 : -1); return; }
    if (k === 'Home') { e.preventDefault(); move(1, options.length - 1); return; }
    if (k === 'End') { e.preventDefault(); move(-1, 0); return; }
    if (k === 'Enter' || (k === ' ' && !typed.current.text)) { e.preventDefault(); choose(active); return; }
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
    if (k === 'Tab') { e.preventDefault(); close(true); return; }
    // Type to jump to an option
    if (k.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      const ty = typed.current;
      ty.text += k.toLowerCase();
      window.clearTimeout(ty.timer);
      ty.timer = window.setTimeout(() => { ty.text = ''; }, 700);
      const n = options.length;
      const start = active + (ty.text.length === 1 ? 1 : 0);
      for (let s = 0; s < n; s++) {
        const j = (start + s) % n;
        if (!options[j].disabled && options[j].label.toLowerCase().startsWith(ty.text)) { setActive(j); break; }
      }
    }
  }

  const dy = place.up ? 6 : -6;

  return (
    <span className={`op-pickwrap ${className ?? ''}`} data-open={open}>
      <select
        ref={selRef}
        id={id}
        className="op-pick"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onMouseDown={(e) => {
          if (!finePointer() || e.button !== 0) return;
          e.preventDefault(); // no system list
          selRef.current?.focus({ preventScroll: true });
          if (open) close(true); else openList();
        }}
        onKeyDown={onSelectKey}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {display ? display(o) : o.label}
          </option>
        ))}
      </select>
      {createPortal(
        <AnimatePresence>
          {open && (
            <motion.div
              ref={lbRef}
              id={listId}
              className="op-lb"
              role="listbox"
              tabIndex={-1}
              aria-label={ariaLabel}
              aria-activedescendant={`${listId}-${active}`}
              style={{
                left: place.left,
                top: place.top,
                maxHeight: place.maxHeight,
                minWidth: place.minWidth,
                transformOrigin: place.up ? 'bottom left' : 'top left',
              }}
              onMouseDown={(e) => e.preventDefault()}
              onKeyDown={onListKey}
              {...popover(t, dy)}
            >
              {options.map((o, i) => (
                <div
                  key={o.value}
                  id={`${listId}-${i}`}
                  role="option"
                  className={`op-lb-opt${o.lead ? ' op-lb-face' : ''}${o.detail ? ' op-lb-two' : ''}`}
                  aria-selected={o.value === value}
                  aria-disabled={o.disabled || undefined}
                  data-active={i === active || undefined}
                  onPointerMove={() => { if (!o.disabled && i !== active) setActive(i); }}
                  onClick={() => choose(i)}
                >
                  {o.lead}
                  <span className="op-lb-txt">
                    <span className="op-lb-t">{o.label}</span>
                    {o.detail && <span className="op-lb-d">{o.detail}</span>}
                  </span>
                  <span className="op-check" />
                </div>
              ))}
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </span>
  );
}

/** Shorthand for plain string options. */
export const opts = (pairs: [string, string][]): PickerOption[] => pairs.map(([value, label]) => ({ value, label }));
