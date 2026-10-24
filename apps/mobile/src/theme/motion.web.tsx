// The motion system on the web: the same names, signatures and numbers as
// motion.tsx, played by the browser (webMotion.ts) instead of Reanimated's
// layout animations, which can't run custom enter/exit worklets on the web and
// scale content during layout changes. Metro picks this file for the web build
// only, so the phone app never loads it.
//
// The helpers return a description of the motion typed as the Reanimated config
// the components already pass to `entering`, `exiting` and `layout`.

import { type ReactNode } from 'react';
import { type StyleProp, type ViewStyle } from 'react-native';
import Animated, { type EntryExitAnimationFunction, type LinearTransition } from 'react-native-reanimated';
import { duration, exitDuration, type M } from './motionBase';
import { curve, motion, type MotionSize } from './tokens';
import { useMotion } from './theme';
import { install, layoutMotion, tracks, type Track } from './webMotion';

export * from './motionBase';

install();

type Entering = EntryExitAnimationFunction;
const as = <T,>(v: unknown) => v as T;

// ---- Enter and exit ----

interface EnterOptions {
  delay?: number;
  /** Rise from this far below (positive) or above (negative). Default: a short rise. */
  dist?: number;
}

/** The tracks of `enter`, with `blur` px to come out of (Appear). */
function enterTracks(m: M, size: MotionSize, { delay = 0, dist }: EnterOptions, blur = 0): Track[] {
  const d = duration(size);
  const list: Track[] = [{ ms: d, delay, curve: curve.out, frame: (p) => ({ opacity: p }) }];
  if (m.reduced) return list;
  const y = dist ?? (size === 'small' ? 4 : motion.dist);
  const from = motion.scaleFrom;
  list.push({ ms: d, delay, curve: 'spring', add: true, frame: (p) => ({ transform: `translateY(${y * (1 - p)}px) scale(${from + (1 - from) * p})` }) });
  if (blur) list.push({ ms: d, delay, curve: curve.out, frame: (p) => ({ filter: `blur(${blur * (1 - p)}px)` }) });
  return list;
}

/** Fade in, scale 0.96 → 1 and rise a little. Reduced motion: fade only. */
export function enter(m: M, size: MotionSize = 'small', options: EnterOptions = {}): Entering {
  return as<Entering>(tracks('enter', enterTracks(m, size, options)));
}

/** Leave: quicker than arriving, a fade and a slight shrink, no blur. */
export function exit(m: M, size: MotionSize = 'small'): Entering {
  const d = exitDuration(size);
  const list: Track[] = [{ ms: d, delay: 0, curve: curve.exit, frame: (p) => ({ opacity: 1 - p }) }];
  if (!m.reduced) list.push({ ms: d, delay: 0, curve: curve.exit, add: true, frame: (p) => ({ transform: `scale(${1 - 0.03 * p})` }) });
  return as<Entering>(tracks('exit', list));
}

/** One item of a list or menu, in turn. */
export const listIn = (m: M, i = 0, size: MotionSize = 'medium') => enter(m, size, { delay: i * motion.stagger, dist: m.reduced ? 0 : 8 });

/** Grow out of the point it was opened from (set `transformOrigin` on the same view). */
export function grow(m: M): Entering {
  const d = duration('medium');
  const list: Track[] = [{ ms: d * 0.6, delay: 0, curve: curve.out, frame: (p) => ({ opacity: p }) }];
  if (!m.reduced) list.push({ ms: d, delay: 0, curve: 'spring', add: true, frame: (p) => ({ transform: `scale(${0.3 + 0.7 * p})` }) });
  return as<Entering>(tracks('enter', list));
}

/** The reverse of `grow`: collapse back into the point it came from. */
export function shrink(m: M): Entering {
  const d = exitDuration('medium');
  const list: Track[] = [{ ms: d, delay: 0, curve: curve.exit, frame: (p) => ({ opacity: 1 - p }) }];
  if (!m.reduced) list.push({ ms: d, delay: 0, curve: curve.exit, add: true, frame: (p) => ({ transform: `scale(${1 - 0.7 * p})` }) });
  return as<Entering>(tracks('exit', list));
}

/** Place and size changes: a spring that settles, moving the view, never scaling it. Reduced motion: none. */
export const layout = (m: M, size: MotionSize = 'medium') => as<LinearTransition>(layoutMotion(duration(size), m.reduced));

// ---- Out of a blur ----

/**
 * Medium and large things appear out of a blur while they fade, scale and rise.
 * The web can blur the view's own pixels: `motion.blur` px clearing on the fade
 * curve, where the phone lays a native blur over the content. Reduced motion: no blur.
 */
export function Appear({
  children,
  delay = 0,
  style,
  dist,
  size = 'medium',
}: {
  children: ReactNode;
  delay?: number;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  dist?: number;
  size?: Exclude<MotionSize, 'small'>;
}) {
  const m = useMotion();
  const entering = as<Entering>(tracks('enter', enterTracks(m, size, { delay, dist }, m.reduced ? 0 : motion.blur)));
  return (
    <Animated.View entering={entering} style={style}>
      {children}
    </Animated.View>
  );
}
