// Workspace switcher, Slack-style: your team workspaces and your personal space.
// A native sheet (Liquid Glass on iOS 26).

import { Pressable, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import { useStore } from '../state/store';
import { T, useMotion, usePalette } from '../theme/theme';
import { listIn } from '../theme/motion';
import { WorkspaceTile } from '../components/Face';
import { CheckIcon } from '../components/Icons';
import { DesktopNote } from '../components/thread/parts';

export default function WorkspacesSheet() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { ws, spaces, state, nowCount, switchTo } = useStore();

  return (
    <ScrollView contentContainerStyle={{ paddingTop: 28, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
      <View style={{ paddingHorizontal: 24, gap: 4, marginBottom: 16 }}>
        <T v="title">Workspaces</T>
        <T v="callout" tone="secondary">Your teams, and a space that is only yours.</T>
      </View>

      {spaces.map((w, i) => {
        const active = w.id === ws.id;
        const needs = nowCount(w.id);
        const fresh = state.unread[w.id] ?? 0;
        const running = w.tasks.filter((t) => t.status === 'Working').length;
        const who = w.kind === 'personal' ? 'Just you' : `${w.members.length} people`;
        const sub = [who, `${running} running`, needs ? `${needs} need you now` : null].filter(Boolean).join(' · ');
        return (
          <Animated.View key={w.id} entering={listIn(m, i)}>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
              onPress={() => {
                switchTo(w.id);
                router.back();
              }}
              style={({ pressed }) => ({
                flexDirection: 'row', alignItems: 'center', gap: 14, marginHorizontal: 12, paddingHorizontal: 12, paddingVertical: 12,
                borderRadius: 16, backgroundColor: pressed ? p.hover : active ? p.hover : 'transparent',
              })}
            >
              <WorkspaceTile monogram={w.monogram} size={44} active={active} />
              <View style={{ flex: 1, gap: 2 }}>
                <T v="headline">{w.name}</T>
                <T v="monoSmall" tone="muted" numberOfLines={1}>{sub}</T>
              </View>
              {active ? (
                <CheckIcon color={p.text} size={20} strokeWidth={1.8} />
              ) : needs || fresh ? (
                <View style={{ minWidth: 22, height: 22, borderRadius: 11, paddingHorizontal: 6, backgroundColor: p.accent, alignItems: 'center', justifyContent: 'center' }}>
                  <T v="monoSmall" tone="onAccent">{needs || fresh}</T>
                </View>
              ) : null}
            </Pressable>
          </Animated.View>
        );
      })}

      <View style={{ paddingHorizontal: 24, marginTop: 20 }}>
        <DesktopNote text="Create or join a workspace on desktop. Leave one in Settings." />
      </View>
    </ScrollView>
  );
}
