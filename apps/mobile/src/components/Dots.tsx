// Status is shape and motion, not colour: a spinning ring = working, hollow =
// waiting for a person, filled = done, red = failed (the only colour besides lime).
// Same as the web's StatusDot. A change of status cross-fades, never cuts.

import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import type { TaskStatus } from '../data/shared';
import { usePalette, useMotion } from '../theme/theme';
import { enter, exit, AMBIENT } from '../theme/motion';

const SPIN = Easing.bezier(0.5, 0.15, 0.5, 0.85);

/** The working ring: a quiet track with a lime arc going round. */
export function Spinner({ size = 12 }: { size?: number }) {
  const p = usePalette();
  const m = useMotion();
  const turn = useSharedValue(0);
  useEffect(() => {
    if (m.reduced) {
      turn.value = 45;
      return;
    }
    turn.value = withRepeat(withTiming(360, { duration: AMBIENT.spin, easing: SPIN }), -1, false);
    return () => cancelAnimation(turn);
  }, [m.reduced, turn]);
  const spin = useAnimatedStyle(() => ({ transform: [{ rotate: `${turn.value}deg` }] }));
  const r = size / 2 - 0.75;
  const c = size / 2;
  return (
    <View style={{ width: size, height: size }}>
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Circle cx={c} cy={c} r={r} stroke={p.border} strokeWidth={1.5} fill="none" />
      </Svg>
      <Animated.View style={[StyleSheet.absoluteFill, spin]}>
        <Svg width={size} height={size}>
          <Path d={`M ${c} ${c - r} A ${r} ${r} 0 0 1 ${c + r} ${c}`} stroke={p.signal} strokeWidth={1.5} strokeLinecap="round" fill="none" />
        </Svg>
      </Animated.View>
    </View>
  );
}

export function StatusDot({ status, size = 16 }: { status: TaskStatus; size?: number }) {
  const p = usePalette();
  const m = useMotion();
  const dot = (style: object) => <View style={[{ width: 8, height: 8, borderRadius: 4 }, style]} />;
  const inner =
    status === 'Working' ? <Spinner size={11} />
    : status === 'Needs you' ? dot({ borderWidth: 1.5, borderColor: p.text })
    : status === 'Failed' ? dot({ backgroundColor: p.error })
    : status === 'Queued' ? dot({ borderWidth: 1.5, borderColor: p.borderControl })
    : dot({ backgroundColor: p.textSecondary });
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <Animated.View key={status} entering={enter(m)} exiting={exit(m)} style={{ position: 'absolute' }}>
        {inner}
      </Animated.View>
    </View>
  );
}

/** "Live" presence: a small solid lime dot. */
export function LiveDot({ size = 8 }: { size?: number }) {
  const p = usePalette();
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: p.signal }} />;
}
