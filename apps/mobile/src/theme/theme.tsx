import { createContext, useContext, type ReactNode } from 'react';
import { Text, useColorScheme, type TextProps, type TextStyle } from 'react-native';
import { useReducedMotion } from 'react-native-reanimated';
import { useSettings } from '../state/settings';
import { dark, font, light, motion, type Palette } from './tokens';

const ThemeContext = createContext<Palette>(dark);

/** Follows the phone's light / dark setting unless Settings picks one. Dark is the default, like the web app. */
export function ThemeRoot({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const { appearance } = useSettings().settings;
  const scheme = appearance === 'system' ? system : appearance;
  return <ThemeContext.Provider value={scheme === 'light' ? light : dark}>{children}</ThemeContext.Provider>;
}

export const usePalette = () => useContext(ThemeContext);

/** Motion durations and whether to reduce motion (phone setting or Settings). Reduced motion keeps
 * the fades and drops movement, scale and blur — the helpers in theme/motion read `reduced`. */
export function useMotion() {
  const system = useReducedMotion();
  const { reduceMotion } = useSettings().settings;
  const reduced = system || reduceMotion;
  return reduced ? { ...motion, dist: 0, reduced } : { ...motion, reduced };
}

// ---- Type scale: Instrument Sans for the interface, DM Mono for IDs, times and logs ----

export const variants = {
  display: { fontFamily: font.sansMedium, fontSize: 30, lineHeight: 36, letterSpacing: -0.6 },
  title: { fontFamily: font.sansMedium, fontSize: 22, lineHeight: 28, letterSpacing: -0.3 },
  headline: { fontFamily: font.sansMedium, fontSize: 16, lineHeight: 22, letterSpacing: -0.15 },
  body: { fontFamily: font.sans, fontSize: 16, lineHeight: 23 },
  callout: { fontFamily: font.sans, fontSize: 14, lineHeight: 20 },
  calloutMedium: { fontFamily: font.sansMedium, fontSize: 14, lineHeight: 20 },
  caption: { fontFamily: font.sans, fontSize: 12, lineHeight: 16 },
  label: { fontFamily: font.sansMedium, fontSize: 12, lineHeight: 16, letterSpacing: 0.24 },
  mono: { fontFamily: font.mono, fontSize: 12, lineHeight: 16 },
  monoSmall: { fontFamily: font.mono, fontSize: 11, lineHeight: 15 },
} satisfies Record<string, TextStyle>;

export type TextVariant = keyof typeof variants;
type Tone = 'text' | 'secondary' | 'muted' | 'signal' | 'error' | 'onAccent' | 'tint';

export function T({ v = 'body', tone = 'text', style, ...rest }: TextProps & { v?: TextVariant; tone?: Tone }) {
  const p = usePalette();
  const color = {
    text: p.text,
    secondary: p.textSecondary,
    muted: p.textMuted,
    signal: p.signal,
    error: p.error,
    onAccent: p.onAccent,
    tint: p.tintFg,
  }[tone];
  return <Text {...rest} allowFontScaling maxFontSizeMultiplier={1.4} style={[variants[v], { color }, style]} />;
}
