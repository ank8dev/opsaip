// Keeps Tab inside an open dialog. Pure helpers plus one hook.

import { useEffect, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]', 'button:not([disabled])', 'input:not([disabled]):not([type="hidden"])', 'select:not([disabled])',
  'textarea:not([disabled])', '[tabindex]:not([tabindex="-1"])',
].join(',');

/**
 * Where Tab (or Shift+Tab) should go, or null to let the browser move focus.
 * Only the ends need help: Tab on the last element wraps to the first, Shift+Tab
 * on the first wraps to the last; focus that is outside the list comes back in.
 */
export function trapTarget<T>(items: readonly T[], active: T | null, shift: boolean): T | null {
  if (items.length === 0) return null;
  const at = active === null ? -1 : items.indexOf(active);
  if (at === -1) return shift ? items[items.length - 1] : items[0];
  if (!shift && at === items.length - 1) return items[0];
  if (shift && at === 0) return items[items.length - 1];
  return null;
}

/** The elements inside `root` that Tab can reach, in order. */
export function focusables(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hasAttribute('hidden') && el.getAttribute('aria-hidden') !== 'true');
}

/**
 * While `active`: focus moves into `root` (to `initial`, or its first control),
 * Tab stays inside, and when it ends focus returns to where it was.
 */
export function useFocusTrap(root: RefObject<HTMLElement | null>, active: boolean, initial?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = root.current;
    if (!active || !node) return;
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (initial?.current ?? focusables(node)[0] ?? node).focus({ preventScroll: true });

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const to = trapTarget(focusables(node), document.activeElement instanceof HTMLElement ? document.activeElement : null, e.shiftKey);
      if (to) { e.preventDefault(); to.focus(); }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, [root, active, initial]);
}
