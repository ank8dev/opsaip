// Upcoming reminders, from every workspace. Swipe right to snooze an hour, left to
// delete. Tap one to open its workspace and the decision itself.

import { useRef } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useRouter } from 'expo-router';
import { openTitle } from '../data/types';
import { useStore, type Reminder } from '../state/store';
import { T, useMotion, usePalette } from '../theme/theme';
import { radius } from '../theme/tokens';
import { exit, layout, enter } from '../theme/motion';
import { haptic } from '../lib/haptics';
import { clock, dayOf } from '../lib/time';
import { workspaces } from '../mocks/workspaces';
import { Group, SheetPage, SheetTitle } from '../components/Sheet';
import { BellIcon, ClockIcon, CloseIcon } from '../components/Icons';

const when = (at: number) => {
  const d = new Date(at);
  const day = dayOf(at);
  return `${day === 'Today' ? '' : `${day} `}${clock(d.getHours(), d.getMinutes())}`;
};

export default function RemindersSheet() {
  const p = usePalette();
  const m = useMotion();
  const { reminders } = useStore();
  return (
    <SheetPage>
      <SheetTitle
        title="Reminders"
        sub={reminders.length ? 'Swipe right to snooze an hour, left to delete.' : undefined}
        lead={<View style={{ width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface }}><BellIcon color={p.text} size={22} /></View>}
      />
      {reminders.length ? (
        <View style={{ gap: 8 }}>
          {reminders.map((r) => (
            <Animated.View key={r.item.id} layout={layout(m)} exiting={exit(m)}>
              <ReminderRow r={r} />
            </Animated.View>
          ))}
        </View>
      ) : (
        <Animated.View entering={enter(m, 'medium')}>
        <Group>
          <View style={{ padding: 18, gap: 4 }}>
            <T v="calloutMedium">No reminders</T>
            <T v="callout" tone="secondary">When you say “Not now” to a decision, pick a time and it shows up here.</T>
          </View>
        </Group>
        </Animated.View>
      )}
    </SheetPage>
  );
}

function ReminderRow({ r }: { r: Reminder }) {
  const p = usePalette();
  const router = useRouter();
  const store = useStore();
  const ref = useRef<SwipeableMethods>(null);
  const ws = workspaces.find((w) => w.id === r.wsId);

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      leftThreshold={64}
      rightThreshold={64}
      overshootLeft={false}
      overshootRight={false}
      onSwipeableWillOpen={() => haptic.light()}
      onSwipeableOpen={(dir) => {
        // "left" means the left actions opened: a swipe to the right
        if (dir === 'left') store.snoozeReminder(r.wsId, r.item.id, r.at + 60 * 60_000);
        else store.deleteReminder(r.wsId, r.item.id);
        ref.current?.close();
      }}
      renderLeftActions={(progress) => <Action progress={progress} label="+1 hour" color={p.tintBg} fg={p.tintFg} icon={<ClockIcon color={p.tintFg} size={16} />} />}
      renderRightActions={(progress) => <Action progress={progress} label="Delete" color={p.error} fg="#FFFFFF" icon={<CloseIcon color="#FFFFFF" size={16} />} right />}
    >
      <Pressable
        onPress={() => {
          haptic.select();
          router.back();
          store.switchTo(r.wsId);
          setTimeout(() => store.openItem(r.item.id), 400);
        }}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, borderRadius: radius.lg, backgroundColor: pressed ? p.raised : p.surface })}
      >
        <ClockIcon color={p.textSecondary} size={18} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="callout" numberOfLines={2}>{openTitle(r.item)}</T>
          <T v="caption" tone="muted">{ws?.name}</T>
        </View>
        <T v="calloutMedium">{when(r.at)}</T>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function Action({ progress, label, color, fg, icon, right }: { progress: SharedValue<number>; label: string; color: string; fg: string; icon: React.ReactNode; right?: boolean }) {
  const reveal = useAnimatedStyle(() => ({ opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0.7, 1]) }));
  return (
    <Animated.View style={[{ width: 110, justifyContent: 'center', alignItems: right ? 'flex-end' : 'flex-start' }, reveal]}>
      <View style={{ height: 52, borderRadius: 26, paddingHorizontal: 16, backgroundColor: color, flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 6 }}>
        {icon}
        <T v="label" style={{ color: fg }}>{label}</T>
      </View>
    </Animated.View>
  );
}
