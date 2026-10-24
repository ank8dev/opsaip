// Liquid Glass, used sparingly: the dock (tabs + composer) and sheet backgrounds.
// Never on cards or messages.
//
//   liquid  iOS 26+ (expo-glass-effect, included in Expo Go)
//   blur    older iOS: a system material blur with a hairline edge
//   solid   Android, or when "Reduce Transparency" is on: a raised surface
//
// Text on glass sits on a light tint so it always keeps its contrast.

import { useEffect, useState, type ReactNode } from 'react';
import { AccessibilityInfo, Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { GlassContainer, GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { usePalette } from '../theme/theme';

export type GlassMode = 'liquid' | 'blur' | 'solid';

const LIQUID = Platform.OS === 'ios' && isLiquidGlassAvailable() && isGlassEffectAPIAvailable();

export function useGlassMode(): GlassMode {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    if (Platform.OS !== 'ios') return;
    AccessibilityInfo.isReduceTransparencyEnabled().then(setReduce).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceTransparencyChanged', setReduce);
    return () => sub.remove();
  }, []);
  if (reduce || Platform.OS !== 'ios') return 'solid';
  return LIQUID ? 'liquid' : 'blur';
}

export const hasLiquidGlass = LIQUID;

interface Props {
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
  radius: number;
  interactive?: boolean;
  /** Fade the glass itself in and out (opacity would switch the effect off). */
  visible?: boolean;
}

export function Glass({ children, style, radius, interactive, visible = true }: Props) {
  const p = usePalette();
  const mode = useGlassMode();

  if (mode === 'liquid') {
    return (
      <GlassView
        glassEffectStyle={{ style: visible ? 'regular' : 'none', animate: true, animationDuration: 0.48 }}
        colorScheme={p.scheme}
        tintColor={p.glassTint}
        isInteractive={interactive}
        style={[{ borderRadius: radius }, style]}
      >
        {children}
      </GlassView>
    );
  }

  if (mode === 'blur') {
    return (
      <View style={[{ borderRadius: radius, overflow: 'hidden' }, style]}>
        {visible ? (
          <>
            <BlurView
              tint={p.scheme === 'dark' ? 'systemChromeMaterialDark' : 'systemChromeMaterialLight'}
              intensity={90}
              style={StyleSheet.absoluteFill}
            />
            <View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: radius, borderWidth: StyleSheet.hairlineWidth, borderColor: p.border }]} />
          </>
        ) : null}
        {children}
      </View>
    );
  }

  return (
    <View
      style={[
        { borderRadius: radius, backgroundColor: visible ? p.raised : 'transparent', borderWidth: visible ? 1 : 0, borderColor: p.border },
        style,
      ]}
    >
      {children}
    </View>
  );
}

/** Lets neighbouring glass shapes melt into each other on iOS 26; a plain row elsewhere. */
export function GlassGroup({ children, style, spacing = 12 }: { children: ReactNode; style?: StyleProp<ViewStyle>; spacing?: number }) {
  const mode = useGlassMode();
  if (mode === 'liquid') return <GlassContainer spacing={spacing} style={style}>{children}</GlassContainer>;
  return <View style={style}>{children}</View>;
}
