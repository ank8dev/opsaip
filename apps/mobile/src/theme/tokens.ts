// Opsaip design tokens for the phone. A mirror of apps/web/src/styles/tokens.css:
// same graphite neutrals, the one lime accent, the same "Fluid" motion numbers.
// Change a value there, change it here. Components read these, never raw values.

import { Easing } from 'react-native-reanimated';

export const lime = {
  50: '#F3FBDF',
  200: '#DAEF9F',
  500: '#B4DC47', // the accent
  700: '#5B721D',
  900: '#20290A',
} as const;

export interface Palette {
  scheme: 'dark' | 'light';
  bg: string;
  surface: string;
  raised: string;
  border: string;
  borderControl: string;
  text: string;
  textSecondary: string;
  textMuted: string;
  accent: string;
  accentPressed: string;
  onAccent: string;       // black on lime, never white
  signal: string;         // "live": working agents, presence
  tintBg: string;         // quiet lime: your own messages
  tintFg: string;
  error: string;
  hover: string;
  track: string;
  glow: string;
  glowOpacity: number;
  /** Laid over Liquid Glass so text on it keeps its contrast. */
  glassTint: string;
}

export const dark: Palette = {
  scheme: 'dark',
  bg: '#0B0B0B',
  surface: '#141414',
  raised: '#1C1C1C',
  border: '#2A2A2A',
  borderControl: '#6B6B6B',
  text: '#EDEDED',
  textSecondary: '#A3A3A3',
  textMuted: '#8A8A8A',
  accent: lime[500],
  accentPressed: '#A7D232',
  onAccent: '#0B0B0B',
  signal: lime[500],
  tintBg: lime[900],
  tintFg: lime[200],
  error: '#FF5A4E',
  hover: 'rgba(255, 255, 255, 0.05)',
  track: 'rgba(255, 255, 255, 0.07)',
  glow: lime[500],
  glowOpacity: 0.1,
  glassTint: 'rgba(16, 16, 16, 0.42)',
};

export const light: Palette = {
  scheme: 'light',
  bg: '#FAFAFA',
  surface: '#FFFFFF',
  raised: '#F2F2F2',
  border: '#E3E3E3',
  borderControl: '#8A8A8A',
  text: '#111111',
  textSecondary: '#525252',
  textMuted: '#6B6B6B',
  accent: lime[500],
  accentPressed: '#9BC22E',
  onAccent: '#0B0B0B',
  signal: lime[700], // lime-500 on white is too faint, so "live" turns to deep lime
  tintBg: lime[50],
  tintFg: lime[700],
  error: '#C4302A',
  hover: 'rgba(0, 0, 0, 0.045)',
  track: 'rgba(0, 0, 0, 0.07)',
  glow: lime[500],
  glowOpacity: 0.4,
  glassTint: 'rgba(255, 255, 255, 0.38)',
};

// ---- Type ----

export const font = {
  sans: 'InstrumentSans_400Regular',
  sansMedium: 'InstrumentSans_500Medium',
  mono: 'DMMono_400Regular',
  monoMedium: 'DMMono_500Medium',
} as const;

// ---- Space and shape: the web's 4px rhythm ----

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 20, xxl: 24, xxxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 14, xl: 18, pill: 999 } as const;

// ---- Motion: "Fluid" — long, glassy, blurred on entry ----

export const motion = {
  fast: 260,   // small: chips, buttons, toggles, colour changes
  base: 480,   // medium: menus, cards, sheets, rows
  slow: 720,   // large: screen transitions, the brief
  exitRatio: 0.7, // leaving is quicker than arriving
  stagger: 35, // between items of a list or menu
  enterStep: 90, // between sections of a screen revealing in turn
  dist: 12,    // how far things travel when they appear
  scaleFrom: 0.96,
  blur: 8,     // px the web starts from; see Appear for the phone's equivalent
} as const;

/** Every animation names its size; the size sets the duration. */
export type MotionSize = 'small' | 'medium' | 'large';

/** The timing curves as cubic-bezier control points, for the web (CSS / Web Animations). */
export const curve = {
  out: [0.32, 0.72, 0, 1],    // things appearing
  exit: [0.32, 0, 0.67, 0],   // things leaving
  spring: [0.32, 0.72, 0, 1], // place or size changes; settles, never overshoots
  inOut: [0.65, 0, 0.35, 1],  // colour changes
} as const;

export const ease = {
  out: Easing.bezier(...curve.out),
  exit: Easing.bezier(...curve.exit),
  spring: Easing.bezier(...curve.spring),
  inOut: Easing.bezier(...curve.inOut),
};
