// The top of a screen: the workspace switcher on the left, the screen's own middle
// and right. Content never reads through it: the bar is the background colour, and
// below it a soft eased fade, so text scrolling up dissolves instead of being cut
// at a hard edge. Same in light and dark. Not Liquid Glass — that stays on the tab
// bar, composer and sheets.

import type { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { T, usePalette, useMotion } from '../theme/theme';
import { useStore } from '../state/store';
import { WorkspaceTile } from './Face';
import { ChevronDownIcon } from './Icons';
import { enter, exit } from '../theme/motion';

export const HEADER_H = 64;
const FADE = 32;
// eased, so the fade has no visible start or end
const FADE_STOPS = [1, 0.94, 0.78, 0.5, 0.2, 0];
const alpha = (a: number) => Math.round(a * 255).toString(16).padStart(2, '0').toUpperCase();

export function useHeaderSpace() {
  return useSafeAreaInsets().top + HEADER_H;
}

/** Workspace tile (+ name), opening the switcher. A dot when another workspace needs you. */
export function WorkspaceButton({ withName }: { withName?: boolean }) {
  const p = usePalette();
  const router = useRouter();
  const m = useMotion();
  const { ws, spaces, state, nowCount } = useStore();
  const elsewhere = spaces.some((w) => w.id !== ws.id && (nowCount(w.id) > 0 || (state.unread[w.id] ?? 0) > 0));
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Workspace ${ws.name}. Switch workspace`}
      onPress={() => router.push('/workspaces')}
      hitSlop={8}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.7 : 1 })}
    >
      <View>
        <WorkspaceTile monogram={ws.monogram} size={32} />
        {elsewhere ? (
          <Animated.View entering={enter(m)} exiting={exit(m)} style={{ position: 'absolute', top: -3, right: -3, width: 10, height: 10, borderRadius: 5, backgroundColor: p.signal, borderWidth: 2, borderColor: p.bg }} />
        ) : null}
      </View>
      {withName ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
          <T v="headline">{ws.name}</T>
          <ChevronDownIcon color={p.textMuted} size={16} />
        </View>
      ) : null}
    </Pressable>
  );
}

export function Header({ left, middle, right }: { left?: ReactNode; middle?: ReactNode; right?: ReactNode }) {
  const p = usePalette();
  const top = useSafeAreaInsets().top;
  const h = top + HEADER_H;
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { bottom: undefined, height: h + FADE, zIndex: 10 }]}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, height: h, backgroundColor: p.bg }} />
      <LinearGradient
        pointerEvents="none"
        colors={FADE_STOPS.map((a) => `${p.bg}${alpha(a)}`) as [string, string, ...string[]]}
        locations={FADE_STOPS.map((_, i) => i / (FADE_STOPS.length - 1)) as [number, number, ...number[]]}
        style={{ position: 'absolute', left: 0, right: 0, top: h, height: FADE }}
      />
      <View pointerEvents="box-none" style={{ marginTop: top, height: HEADER_H, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' }}>
        <View style={{ flex: 1, alignItems: 'flex-start' }}>{left}</View>
        {middle ? <View style={{ alignItems: 'center' }}>{middle}</View> : null}
        <View style={{ flex: 1, alignItems: 'flex-end' }}>{right}</View>
      </View>
    </View>
  );
}
