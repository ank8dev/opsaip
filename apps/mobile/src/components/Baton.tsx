// The Conductor: the one baton in Opsaip, and the agent's face in the thread.
// Exactly one per screen. Drawn from brand/components/baton-symbol.svg.
//
//   rest     nothing running: still, the tip dot muted
//   conduct  agents running: a 4/4 bar on repeat — down, left, right, up — tip lit lime
//   tempo    while Opsaip is writing, the bar is quicker
//   cue      Opsaip speaks up: an upbeat flick and the tip flashes
//
// It turns around the grip, settles and never overshoots (Fluid). Reduced motion:
// no beats, only the light.

import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { cancelAnimation, useAnimatedStyle, useSharedValue, withRepeat, withSequence, withTiming, type SharedValue } from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';
import { useMotion, usePalette } from '../theme/theme';
import { ease } from '../theme/tokens';
import { fadeTo, springTo } from '../theme/motion';

const VIEW = { x: -13.25, y: 45.43, w: 65.9, h: 83.57 };
const STICK = 'M-7.88 122.91 Q-9.25 125 -6.75 125 L0.2 125 Q2.7 125 4.07 122.91 L37.49 71.9 Q38.86 69.81 36.36 69.81 L29.4 69.81 Q26.9 69.81 25.53 71.9 Z';
const TIP = { x: 41.65, y: 56.43, r: 7 };
const GRIP = { x: -1.5, y: 124 };

// One bar: [degrees, ms] — clockwise lowers the tip
const BAR: [number, number][] = [
  [8, 340],   // downbeat
  [-1, 260],  // rebound
  [-6, 420],  // two: left
  [5, 420],   // three: right
  [-3, 520],  // four: up
  [0, 360],   // breathe
];

function play(beat: SharedValue<number>, speed: number) {
  const steps = BAR.map(([deg, ms]) => withTiming(deg, { duration: ms * speed, easing: ease.inOut }));
  beat.value = withRepeat(withSequence(...steps), -1, false);
}

export function Baton({ height = 30, live, quick, cue = 0 }: { height?: number; live: boolean; quick?: boolean; cue?: number }) {
  const p = usePalette();
  const m = useMotion();
  const s = height / VIEW.h;
  const width = VIEW.w * s;
  const tip = { x: (TIP.x - VIEW.x) * s, y: (TIP.y - VIEW.y) * s, r: TIP.r * s };
  const grip = { x: (GRIP.x - VIEW.x) * s, y: (GRIP.y - VIEW.y) * s };

  const beat = useSharedValue(0);
  const flick = useSharedValue(0);
  const light = useSharedValue(live ? 1 : 0);
  const flash = useSharedValue(0);

  // conducting
  useEffect(() => {
    light.value = fadeTo(live ? 1 : 0, 'medium');
    if (!live || m.reduced) {
      cancelAnimation(beat);
      beat.value = springTo(0, 'large');
      return;
    }
    play(beat, quick ? 0.6 : 1);
    return () => cancelAnimation(beat);
  }, [live, quick, m.reduced, m.base, m.slow, beat, light]);

  // a cue: the upbeat flick and the tip flashing
  useEffect(() => {
    if (!cue) return;
    flash.value = withSequence(fadeTo(1, 'small'), fadeTo(0, 'large'));
    if (m.reduced) return;
    flick.value = withSequence(
      withTiming(-16, { duration: 180, easing: ease.out }),
      springTo(0, 'large'),
    );
  }, [cue, m.reduced, m.fast, m.slow, flick, flash]);

  const turn = useAnimatedStyle(() => ({
    transform: [{ rotate: `${beat.value + flick.value}deg` }],
  }));
  const lit = useAnimatedStyle(() => ({ opacity: light.value }));
  const halo = useAnimatedStyle(() => ({
    opacity: light.value * (0.18 + flash.value * 0.32),
    transform: [{ scale: 1 + flash.value * 0.9 }],
  }));

  const haloSize = tip.r * 2 * 2.6;

  return (
    <View style={{ width, height }} accessibilityRole="image" accessibilityLabel={live ? 'Opsaip is conducting agents' : 'Opsaip is resting'}>
      <Animated.View style={[{ width, height, transformOrigin: [grip.x, grip.y, 0] }, turn]}>
        <Animated.View
          style={[
            {
              position: 'absolute', left: tip.x - haloSize / 2, top: tip.y - haloSize / 2,
              width: haloSize, height: haloSize, borderRadius: haloSize / 2, backgroundColor: p.glow,
            },
            halo,
          ]}
        />
        <Svg width={width} height={height} viewBox={`${VIEW.x} ${VIEW.y} ${VIEW.w} ${VIEW.h}`}>
          <Path d={STICK} fill={p.text} />
          <Circle cx={TIP.x} cy={TIP.y} r={TIP.r} fill={p.textMuted} />
        </Svg>
        <Animated.View
          style={[
            {
              position: 'absolute', left: tip.x - tip.r, top: tip.y - tip.r,
              width: tip.r * 2, height: tip.r * 2, borderRadius: tip.r, backgroundColor: p.signal,
            },
            lit,
          ]}
        />
      </Animated.View>
    </View>
  );
}
