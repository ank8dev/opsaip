// The parts of the motion system that are the same on every platform: sizes,
// durations, the spring and fade configs, and animating a value (worklets, which
// Reanimated runs on the web too). motion.tsx (phone) and motion.web.tsx (web)
// both re-export this; components import from './motion'.

import { withRepeat, withSequence, withSpring, withTiming } from 'react-native-reanimated';
import { ease, motion, type MotionSize } from './tokens';
import type { useMotion } from './theme';

export type M = ReturnType<typeof useMotion>;

export const duration = (size: MotionSize) => (size === 'small' ? motion.fast : size === 'medium' ? motion.base : motion.slow);
export const exitDuration = (size: MotionSize) => Math.round(duration(size) * motion.exitRatio);

/** A spring that takes about `ms` and settles without overshoot. */
export const spring = (ms: number) => ({ duration: ms, dampingRatio: 1 });

/** Fades and colour changes: a timing curve. */
export const fade = (ms: number) => ({ duration: ms, easing: ease.out });

// ---- Animating a value (worklet-safe) ----

/** Move a value you touched or that changed place: a spring of the given size. */
export function springTo(v: number, size: MotionSize = 'medium') {
  'worklet';
  return withSpring(v, spring(duration(size)));
}

/** Fade a value (opacity, colour progress): a timing curve of the given size. */
export function fadeTo(v: number, size: MotionSize = 'small') {
  'worklet';
  return withTiming(v, fade(duration(size)));
}

/** Ambient loops: the rhythm of things that wait or work, not of things you did. */
export const AMBIENT = {
  breathe: 900, // the brief's skeleton while Opsaip writes
  typing: 420,  // the three dots
  spin: 1100,   // the working ring
  listen: 700,  // the mic ring while "listening"
} as const;

/** Breathe between two values forever. Reduced motion: hold the upper value. */
export function pulse(lo: number, hi: number, ms: number, reduced: boolean) {
  'worklet';
  if (reduced) return withTiming(hi, { duration: 1 });
  return withRepeat(withSequence(withTiming(hi, { duration: ms, easing: ease.inOut }), withTiming(lo, { duration: ms, easing: ease.inOut })), -1, false);
}
