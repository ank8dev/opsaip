import type { ReactNode } from 'react';
import { Pressable, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { T, usePalette, useMotion } from '../theme/theme';

import { springTo, enter, exit } from '../theme/motion';
import { Swap } from './Animated';

type Kind = 'primary' | 'secondary' | 'quiet';

/** Lime fill for the one main action, a hairline outline for the rest. Black on lime, never white. */
export function Button({
  label,
  onPress,
  kind = 'secondary',
  icon,
  style,
  small,
  disabled,
}: {
  label: string;
  onPress?: () => void;
  kind?: Kind;
  icon?: ReactNode;
  style?: StyleProp<ViewStyle>;
  small?: boolean;
  disabled?: boolean;
}) {
  const p = usePalette();
  const m = useMotion();
  const pressed = useSharedValue(0);
  const anim = useAnimatedStyle(() => ({
    transform: [{ scale: 1 - pressed.value * 0.035 }],
    opacity: 1 - pressed.value * 0.12,
  }));
  const bg = kind === 'primary' ? p.accent : 'transparent';
  const border = kind === 'secondary' ? p.border : 'transparent';
  const tone = kind === 'primary' ? 'onAccent' : kind === 'quiet' ? 'secondary' : 'text';
  const h = small ? 32 : 40;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => (pressed.value = springTo(1, 'small'))}
      onPressOut={() => (pressed.value = springTo(0, 'small'))}
      hitSlop={6}
      style={style}
    >
      <Animated.View
        style={[
          {
            height: h,
            paddingHorizontal: small ? 12 : 16,
            borderRadius: h / 2,
            backgroundColor: bg,
            borderWidth: 1,
            borderColor: border,
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
          },
          anim,
        ]}
      >
        {icon ? (
          <Animated.View entering={enter(m)} exiting={exit(m)}>
            {icon}
          </Animated.View>
        ) : null}
        <Swap id={label}>
          <T v={small ? 'label' : 'calloutMedium'} tone={tone} numberOfLines={1}>
            {label}
          </T>
        </Swap>
      </Animated.View>
    </Pressable>
  );
}

/** A small rounded chip: quick replies and suggestions. */
export function Chip({ label, onPress, selected }: { label: string; onPress?: () => void; selected?: boolean }) {
  const p = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => ({
        height: 34,
        paddingHorizontal: 14,
        borderRadius: 17,
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: selected ? 'transparent' : p.border,
        backgroundColor: selected ? p.tintBg : pressed ? p.hover : p.surface,
      })}
    >
      <T v="callout" style={{ color: selected ? p.tintFg : p.text }}>
        {label}
      </T>
    </Pressable>
  );
}
