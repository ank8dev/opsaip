// The motion system. Every animation in the app comes from here; components never
// pick their own timings.
//
//   sizes      small 260ms (chips, buttons, toggles) · medium 480ms (menus, cards,
//              rows, sheets) · large 720ms (screens, the brief)
//   enter      fade (timing) + scale 0.96 → 1 (spring) + a short rise; medium and
//              large things also come out of a blur (<Appear>)
//   exit       ~70% of the enter duration, fade + slight shrink, never blurred
//   origin     things grow from where they were triggered: a menu from its chip
//   lists      new rows push the others aside, removed rows let the gap close —
//              every row carries `layout(m)`
//   touch      anything you touch or drag moves on a spring that settles without
//              overshoot; only fades use timing curves
//   reduced    "Reduce motion" (system or Settings): opacity only, no movement,
//              no scale, no blur
//
// All of it runs on the UI thread (Reanimated worklets and layout animations).

import { useEffect, useState, type ReactNode } from 'react';
import { Platform, StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { LinearTransition, useAnimatedProps, useSharedValue, withDelay, withRepeat, withSequence, withSpring, withTiming, type EntryExitAnimationFunction } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';
import { ease, motion, type MotionSize } from './tokens';
import { useMotion, usePalette } from './theme';

type M = ReturnType<typeof useMotion>;

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

// ---- Enter and exit ----

interface EnterOptions {
  delay?: number;
  /** Rise from this far below (positive) or above (negative). Default: a short rise. */
  dist?: number;
}

/** Fade in, scale 0.96 → 1 and rise a little. Reduced motion: fade only. */
export function enter(m: M, size: MotionSize = 'small', { delay = 0, dist }: EnterOptions = {}): EntryExitAnimationFunction {
  const d = duration(size);
  const reduced = m.reduced;
  const y = reduced ? 0 : dist ?? (size === 'small' ? 4 : motion.dist);
  const from = reduced ? 1 : motion.scaleFrom;
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ translateY: y }, { scale: from }] },
      animations: {
        opacity: withDelay(delay, withTiming(1, fade(d))),
        transform: [{ translateY: withDelay(delay, withSpring(0, spring(d))) }, { scale: withDelay(delay, withSpring(1, spring(d))) }],
      },
    };
  };
}

/** Leave: quicker than arriving, a fade and a slight shrink, no blur. */
export function exit(m: M, size: MotionSize = 'small'): EntryExitAnimationFunction {
  const d = exitDuration(size);
  const reduced = m.reduced;
  return () => {
    'worklet';
    const cfg = { duration: d, easing: ease.exit };
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: { opacity: withTiming(0, cfg), transform: [{ scale: withTiming(reduced ? 1 : 0.97, cfg) }] },
    };
  };
}

/** One item of a list or menu, in turn. */
export const listIn = (m: M, i = 0, size: MotionSize = 'medium') => enter(m, size, { delay: i * motion.stagger, dist: m.reduced ? 0 : 8 });

/** Grow out of the point it was opened from (set `transformOrigin` on the same view). */
export function grow(m: M): EntryExitAnimationFunction {
  const d = duration('medium');
  const reduced = m.reduced;
  return () => {
    'worklet';
    return {
      initialValues: { opacity: 0, transform: [{ scale: reduced ? 1 : 0.3 }] },
      animations: { opacity: withTiming(1, fade(d * 0.6)), transform: [{ scale: withSpring(1, spring(d)) }] },
    };
  };
}

/** The reverse of `grow`: collapse back into the point it came from. */
export function shrink(m: M): EntryExitAnimationFunction {
  const d = exitDuration('medium');
  const reduced = m.reduced;
  return () => {
    'worklet';
    const cfg = { duration: d, easing: ease.exit };
    return {
      initialValues: { opacity: 1, transform: [{ scale: 1 }] },
      animations: { opacity: withTiming(0, cfg), transform: [{ scale: withTiming(reduced ? 1 : 0.3, cfg) }] },
    };
  };
}

/** Place and size changes: a spring that settles. Reduced motion: a quick fade-free move. */
export const layout = (m: M, size: MotionSize = 'medium') =>
  m.reduced ? LinearTransition.duration(1) : LinearTransition.springify(duration(size)).dampingRatio(1);

// ---- Out of a blur ----

const AnimatedBlur = Animated.createAnimatedComponent(BlurView);
const BLUR_FROM = 34; // expo-blur intensity that reads like the web's 8px start

/**
 * Medium and large things appear out of a blur while they fade, scale and rise.
 * React Native cannot blur a view's own pixels on iOS, so a native blur lies over
 * the content and clears. iOS only; elsewhere, and with reduced motion, no blur.
 */
export function Appear({
  children,
  delay = 0,
  style,
  radius = 0,
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
  const p = usePalette();
  const [blurring, setBlurring] = useState(Platform.OS === 'ios' && !m.reduced);
  const intensity = useSharedValue(BLUR_FROM);

  useEffect(() => {
    if (!blurring) return;
    intensity.value = withDelay(
      delay,
      withTiming(0, fade(duration(size)), (done) => {
        if (done) scheduleOnRN(setBlurring, false);
      }),
    );
    // runs once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const blurProps = useAnimatedProps(() => ({ intensity: intensity.value }));

  return (
    <Animated.View entering={enter(m, size, { delay, dist })} style={style}>
      {children}
      {blurring ? (
        <AnimatedBlur
          pointerEvents="none"
          animatedProps={blurProps}
          tint={p.scheme}
          style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
        />
      ) : null}
    </Animated.View>
  );
}
