// Small state changes that would otherwise snap: a chip that becomes selected, a
// checkmark that comes and goes, a label that is replaced. All on the motion system.

import { useEffect, type ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useMotion, usePalette, variants, type TextVariant } from '../theme/theme';
import { enter, exit, fadeTo, layout } from '../theme/motion';
import { CheckIcon } from './Icons';

/** A chip whose background and text cross to the lime tint when selected. */
export function SelectChip({
  label,
  on,
  onPress,
  disabled,
  v = 'calloutMedium',
  height = 36,
}: {
  label: string;
  on: boolean;
  onPress: () => void;
  disabled?: boolean;
  v?: TextVariant;
  height?: number;
}) {
  const p = usePalette();
  const sel = useSharedValue(on ? 1 : 0);
  const pressed = useSharedValue(0);
  useEffect(() => {
    sel.value = fadeTo(on ? 1 : 0, 'small');
  }, [on, sel]);
  const off = p.hover;
  const press = p.raised;
  const tint = p.tintBg;
  const fg = p.text;
  const tintFg = p.tintFg;
  const box = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(sel.value, [0, 1], [interpolateColor(pressed.value, [0, 1], [off, press]), tint]),
  }));
  const text = useAnimatedStyle(() => ({ color: interpolateColor(sel.value, [0, 1], [fg, tintFg]) }));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => pressed.set(fadeTo(1, 'small'))}
      onPressOut={() => pressed.set(fadeTo(0, 'small'))}
    >
      <Animated.View style={[{ height, paddingHorizontal: height / 2 - 2, borderRadius: height / 2, justifyContent: 'center' }, box]}>
        <Animated.Text allowFontScaling maxFontSizeMultiplier={1.4} style={[variants[v], text]}>{label}</Animated.Text>
      </Animated.View>
    </Pressable>
  );
}

/** A checkmark that appears and leaves instead of snapping. Keeps its space. */
export function Check({ on, size = 18, color }: { on: boolean; size?: number; color?: string }) {
  const p = usePalette();
  const m = useMotion();
  return (
    <Animated.View style={{ width: size, height: size }}>
      {on ? (
        <Animated.View entering={enter(m)} exiting={exit(m)}>
          <CheckIcon color={color ?? p.signal} size={size} strokeWidth={1.8} />
        </Animated.View>
      ) : null}
    </Animated.View>
  );
}

/** Content that is replaced by other content in place: the old fades out, the new fades in. */
export function Swap({ id, children, style }: { id: string | number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const m = useMotion();
  return (
    <Animated.View layout={layout(m, 'small')} style={style}>
      <Animated.View key={id} entering={enter(m)} exiting={exit(m)}>
        {children}
      </Animated.View>
    </Animated.View>
  );
}
