// The bottom of the app: navigation and input, kept apart.
//
//   composer  full width, one line at rest (see Composer.tsx). Thread only.
//   mode menu Task · Message · Agent · Announce, over a dimmed screen.
//   tab bar   Thread · Team · Settings, a Liquid Glass bar like the system's.
//
// The composer rides the keyboard frame by frame (react-native-keyboard-controller,
// in Expo Go); the tab bar slides away under it.

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View, type LayoutChangeEvent, type TextInputInstance } from 'react-native';
import Animated, { useAnimatedReaction, useAnimatedStyle, useDerivedValue, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useReanimatedKeyboardAnimation } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { T, useMotion, usePalette } from '../theme/theme';
import { font } from '../theme/tokens';
import { enter, exit, exitDuration, fadeTo, springTo } from '../theme/motion';
import { useStore } from '../state/store';
import { haptic } from '../lib/haptics';
import { Glass } from './Glass';
import { Composer, LINE, ModeMenu } from './Composer';
import { useRouter } from 'expo-router';
import type { Mode } from '../data/types';
import { NEEDS_PICK } from '../lib/compose';
import { GearIcon, MessageIcon, TeamIcon } from './Icons';
import { Swap } from './Animated';

const TAB_H = 62;
const GAP = 10;
const SIDE = 16;
const TABS = [
  { name: 'index', label: 'Thread' },
  { name: 'team', label: 'Team' },
  { name: 'settings', label: 'Settings' },
] as const;

// ---- What the screens need to know about the dock: how much of the bottom it covers ----

const DockSpace = createContext<SharedValue<number> | null>(null);

export function DockSpaceProvider({ children }: { children: ReactNode }) {
  const space = useSharedValue(TAB_H + LINE + 40);
  return <DockSpace.Provider value={space}>{children}</DockSpace.Provider>;
}

/** Height from the bottom of the screen to the top of the dock, keyboard included. */
export function useDockSpace(): SharedValue<number> {
  const v = useContext(DockSpace);
  if (!v) throw new Error('useDockSpace outside DockSpaceProvider');
  return v;
}

// ---- The dock ----

export function Dock({ state, navigateToTab }: BottomTabBarProps) {
  const m = useMotion();
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const store = useStore();
  const space = useDockSpace();
  const kb = useReanimatedKeyboardAnimation();

  const route = state.routes[state.index]?.name ?? 'index';
  const onThread = route === 'index';
  const [menu, setMenu] = useState(false);
  const [chipX, setChipX] = useState(60);
  const router = useRouter();

  // choosing a mode: the menu collapses into the chip first; a mode that needs someone
  // then slides the picker up
  const pick = (mode: Mode) => {
    store.setMode(mode);
    setMenu(false);
    if (NEEDS_PICK.includes(mode)) setTimeout(() => router.push('/compose/to'), exitDuration('medium'));
  };
  const [colH, setColH] = useState(LINE);

  const restBottom = Math.max(insets.bottom - 6, 12);
  const composerBottom = restBottom + TAB_H + GAP;

  const toTab = (name: string) => {
    const r = state.routes.find((x) => x.name === name);
    if (r) navigateToTab(r.key);
  };

  // the composer sits 8pt above the keyboard; the tab bar slides down under it
  const lift = useDerivedValue(() => kb.height.value + kb.progress.value * (composerBottom - 8));
  const shown = useSharedValue(onThread ? 1 : 0);
  useEffect(() => {
    shown.value = fadeTo(onThread ? 1 : 0, 'medium');
  }, [onThread, m.slow, m.base, shown]);
  const colHv = useSharedValue(LINE);
  useEffect(() => {
    colHv.value = springTo(colH, 'medium');
  }, [colH, m.base, colHv]);

  useAnimatedReaction(
    () => restBottom + TAB_H + 12 + shown.value * (GAP + colHv.value - lift.value),
    (v) => space.set(v),
  );

  const composerStyle = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ translateY: lift.value + (1 - shown.value) * 20 }],
  }));
  const barStyle = useAnimatedStyle(() => ({ transform: [{ translateY: kb.progress.value * (TAB_H + restBottom + 24) }] }));

  // something asked the composer to focus (a teammate's "Give task", a prefilled draft)
  const input = useRef<TextInputInstance>(null);
  const tick = store.state.focusTick;
  useEffect(() => {
    if (!tick) return;
    if (!onThread) toTab('index');
    const t = setTimeout(() => input.current?.focus(), onThread ? 40 : 420);
    return () => clearTimeout(t);
    // only when the tick changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return (
    <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
      {menu ? (
        <Animated.View entering={enter(m, 'medium')} exiting={exit(m, 'medium')} style={[StyleSheet.absoluteFill, { backgroundColor: p.scheme === 'dark' ? 'rgba(0,0,0,0.35)' : 'rgba(0,0,0,0.12)' }]}>
          <Pressable accessibilityLabel="Close the menu" style={StyleSheet.absoluteFill} onPress={() => setMenu(false)} />
        </Animated.View>
      ) : null}
      <Animated.View pointerEvents={onThread ? 'box-none' : 'none'} style={[{ position: 'absolute', left: 0, right: 0, bottom: composerBottom }, composerStyle]}>
        {menu ? <ModeMenu originX={chipX} onPick={pick} /> : null}
        <Composer
          inputRef={input}
          visible={onThread}
          onHeight={setColH}
          onChip={setChipX}
          onMenu={() => {
            haptic.select();
            setMenu((x) => !x);
          }}
        />
      </Animated.View>

      <Animated.View style={[{ position: 'absolute', left: SIDE, right: SIDE, bottom: restBottom }, barStyle]}>
        <TabBar index={state.index} onGo={(name, i) => {
          setMenu(false);
          if (state.index === i) return;
          haptic.select();
          toTab(name);
        }} />
      </Animated.View>
    </View>
  );
}

// ---- Tab bar ----

function TabBar({ index, onGo }: { index: number; onGo: (name: string, index: number) => void }) {
  const p = usePalette();
  const m = useMotion();
  const store = useStore();
  const [w, setW] = useState(0);
  const itemW = w ? (w - 8) / TABS.length : 0;
  const sel = useSharedValue(index);
  useEffect(() => {
    sel.value = springTo(index, 'medium');
  }, [index, sel]);
  const capsule = useAnimatedStyle(() => ({ width: itemW, transform: [{ translateX: sel.value * itemW }] }));
  const badge = store.nowCount(store.ws.id);

  return (
    <Glass radius={TAB_H / 2} interactive style={{ height: TAB_H }}>
      <View onLayout={(e: LayoutChangeEvent) => setW(e.nativeEvent.layout.width)} style={styles.tabs}>
        {itemW ? <Animated.View style={[styles.capsule, { backgroundColor: p.scheme === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)' }, capsule]} /> : null}
        {TABS.map((t, i) => (
          <Pressable key={t.name} accessibilityRole="tab" accessibilityState={{ selected: index === i }} accessibilityLabel={t.label} onPress={() => onGo(t.name, i)} style={styles.tabItem}>
            {/* muted and active looks cross-fade as the capsule passes */}
            <TabFace name={t.name} label={t.label} color={p.textMuted} sel={sel} i={i} active={false} />
            <TabFace name={t.name} label={t.label} color={p.text} sel={sel} i={i} active />
            {t.name === 'index' && badge ? (
              <Animated.View entering={enter(m)} exiting={exit(m)} style={[styles.badge, { backgroundColor: p.accent }]}>
                <Swap id={badge}>
                  <T v="monoSmall" tone="onAccent" style={{ fontSize: 10, lineHeight: 12 }}>{badge}</T>
                </Swap>
              </Animated.View>
            ) : null}
          </Pressable>
        ))}
      </View>
    </Glass>
  );
}

function TabFace({ name, label, color, sel, i, active }: { name: string; label: string; color: string; sel: SharedValue<number>; i: number; active: boolean }) {
  const s = useAnimatedStyle(() => {
    const near = Math.max(0, 1 - Math.abs(sel.value - i));
    return { opacity: active ? near : 1 - near };
  });
  return (
    <Animated.View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }, s]}>
      {name === 'index' ? <MessageIcon color={color} size={22} /> : name === 'team' ? <TeamIcon color={color} size={22} /> : <GearIcon color={color} size={22} />}
      <T v="caption" style={{ color, fontSize: 10, lineHeight: 12, marginTop: 3, fontFamily: font.sansMedium }}>{label}</T>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  tabs: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  capsule: { position: 'absolute', left: 4, top: 4, bottom: 4, borderRadius: (TAB_H - 8) / 2 },
  tabItem: { flex: 1, height: TAB_H - 8, alignItems: 'center', justifyContent: 'center' },
  badge: {
    position: 'absolute', top: 2, left: '50%', marginLeft: 6, minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 4,
    alignItems: 'center', justifyContent: 'center',
  },
});
