// Motion tokens for the Motion library, read from tokens.css at runtime.
// tokens.css stays the single source: change a duration there and both the
// CSS transitions and the Motion animations follow. Reduced motion (OS or
// Settings) already sets the CSS durations to 1ms, so it reaches Motion too.

export type Bezier = [number, number, number, number];

export interface MotionTokens {
  fast: number;    // seconds
  base: number;
  slow: number;
  baton: number;
  stagger: number;
  enterStep: number;
  dist: number;    // px
  blur: number;    // px
  scaleFrom: number;
  easeOut: Bezier;
  easeExit: Bezier;
  easeSpring: Bezier;
  easeBaton: Bezier;
  reduced: boolean;
}

const FALLBACK_EASE: Bezier = [0.32, 0.72, 0, 1];

function seconds(v: string): number {
  const n = parseFloat(v);
  if (Number.isNaN(n)) return 0;
  return v.trim().endsWith('ms') ? n / 1000 : n;
}

function bezier(v: string): Bezier {
  const m = v.match(/cubic-bezier\(([^)]+)\)/);
  if (!m) return FALLBACK_EASE;
  const parts = m[1].split(',').map((x) => parseFloat(x));
  return parts.length === 4 && parts.every((x) => !Number.isNaN(x)) ? (parts as Bezier) : FALLBACK_EASE;
}

export function readMotionTokens(): MotionTokens {
  const s = getComputedStyle(document.documentElement);
  const get = (name: string) => s.getPropertyValue(name);
  const slow = seconds(get('--op-dur-slow'));
  return {
    fast: seconds(get('--op-dur-fast')),
    base: seconds(get('--op-dur-base')),
    slow,
    baton: seconds(get('--op-dur-baton')),
    stagger: seconds(get('--op-stagger')),
    enterStep: seconds(get('--op-enter-step')),
    dist: parseFloat(get('--op-dist')) || 0,
    blur: parseFloat(get('--op-blur')) || 0,
    scaleFrom: parseFloat(get('--op-scale-from')) || 1,
    easeOut: bezier(get('--op-ease-out')),
    easeExit: bezier(get('--op-ease-exit')),
    easeSpring: bezier(get('--op-ease-spring')),
    easeBaton: bezier(get('--op-ease-baton')),
    reduced: slow < 0.01,
  };
}

// ---- Ready-made gestures, so every component moves the same way ----

/** First-load entrance: rise from below, out of a blur. `step` = order on the page. */
export function rise(t: MotionTokens, step = 0) {
  return {
    initial: { opacity: 0, y: t.dist, filter: `blur(${t.blur}px)` },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: t.slow, ease: t.easeOut, delay: step * t.enterStep },
  };
}

/** A view sliding in sideways: forward (1) or back (-1). */
export function slideIn(t: MotionTokens, dir: 1 | -1 = 1) {
  return {
    initial: { opacity: 0, x: t.dist * dir, filter: `blur(${t.blur}px)` },
    animate: { opacity: 1, x: 0, filter: 'blur(0px)' },
    transition: { duration: t.slow, ease: t.easeOut },
  };
}

/** A list row dropping in, one after another. */
export function listItem(t: MotionTokens, i: number) {
  return {
    initial: { opacity: 0, y: -t.dist / 2, filter: `blur(${t.blur / 2}px)` },
    animate: { opacity: 1, y: 0, filter: 'blur(0px)' },
    transition: { duration: t.slow, ease: t.easeOut, delay: i * t.stagger + 0.06 },
  };
}

/** A floating menu: in from a slight offset and scale, out quicker. */
export function popover(t: MotionTokens, dy: number) {
  return {
    initial: { opacity: 0, y: dy, scale: t.scaleFrom, filter: `blur(${t.blur / 2}px)` },
    animate: { opacity: 1, y: 0, scale: 1, filter: 'blur(0px)', transition: { duration: t.base, ease: t.easeOut } },
    exit: { opacity: 0, y: dy, scale: 0.98, filter: 'blur(0px)', transition: { duration: t.fast, ease: t.easeExit } },
  };
}
