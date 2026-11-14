// The browser's back button closes an open overlay (the task window), and
// closing the overlay any other way removes its history entry, so "back" never
// needs two presses. Pure logic over a History-like object, so it is tested
// with a fake. The overlay's own state lives in the caller.

export interface HistoryLike {
  pushState(state: unknown, title: string): void;
  back(): void;
}

export interface OverlayHistory {
  /** The overlay opened: add one history entry (once, however often this is called). */
  opened(): void;
  /** The overlay was closed by the app (Esc, backdrop, button): remove its entry. */
  closed(): void;
  /** A popstate event arrived. True if the overlay must close now (the back button was pressed). */
  popped(): boolean;
}

export function createOverlayHistory(history: HistoryLike): OverlayHistory {
  let pushed = false;
  // popstate events caused by our own back() that must not close anything.
  let ignore = 0;
  return {
    opened() {
      if (pushed) return;
      try {
        history.pushState({ opsaipOverlay: true }, '');
        pushed = true;
      } catch {
        // History blocked (sandboxed frame): the overlay still works, just without the back button.
      }
    },
    closed() {
      if (!pushed) return;
      pushed = false;
      ignore += 1;
      history.back();
    },
    popped() {
      if (ignore > 0) {
        ignore -= 1;
        return false;
      }
      if (!pushed) return false;
      pushed = false;
      return true;
    },
  };
}
