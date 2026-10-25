// The main screen: one thread with the Opsaip agent, who works like a manager. It
// writes a short brief, asks where to start, and hands you one decision at a time.
// Then it goes quiet until something needs you.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Keyboard, Pressable, ScrollView, View, type ScrollViewInstance } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useFocusEffect, useRouter } from 'expo-router';
import type { Bucket, ThreadItem } from '../../data/types';
import { inStream, useRunning, useStore } from '../../state/store';
import { T, useMotion, usePalette } from '../../theme/theme';
import { radius } from '../../theme/tokens';
import { Appear, enter, exit, layout, pulse, AMBIENT } from '../../theme/motion';
import { Header, WorkspaceButton, useHeaderSpace } from '../../components/Header';
import { useDockSpace } from '../../components/Dock';
import { Baton } from '../../components/Baton';
import { GearIcon } from '../../components/Icons';
import { Brief } from '../../components/thread/Brief';
import { Queue } from '../../components/thread/Queue';
import { AgentMessage, AskMessage, Elsewhere, GuideMessage, RunCard, Typing, UserMessage } from '../../components/thread/Cards';

export default function ThreadScreen() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const store = useStore();
  const { ws, thread, writing, state } = store;
  const top = useHeaderSpace();
  const space = useDockSpace();
  const scroll = useRef<ScrollViewInstance>(null);
  const rows = useRef<Record<string, number>>({});

  const typing = state.typing === ws.id;
  const total = state.threads[ws.id]?.length ?? 0;
  const done = !writing && thread.length === total && !typing;
  const stream = thread.filter(inStream);

  // Items present when a workspace opens arrive in a quick stagger; later ones arrive alone.
  // only when the workspace changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const firstIds = useMemo(() => new Set(thread.map((i) => i.id)), [ws.id]);

  // Follow the conversation once the brief is out: new lines and "writing…" scroll into view.
  // A new line keeps growing for a moment as it lays out (chips wrap, cards expand), so the thread
  // stays pinned to its end for a short while after, until you scroll yourself.
  const revealed = useRef<Record<string, boolean>>({});
  const follow = useRef(0);
  const count = stream.length;
  useEffect(() => {
    if (!revealed.current[ws.id]) {
      if (done) revealed.current[ws.id] = true;
      return;
    }
    follow.current = Date.now() + 1500;
    const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 120);
    return () => clearTimeout(t);
  }, [count, typing, ws.id, done]);

  // Back from a screen the tour opened: its next step waits at the end of the thread.
  const touring = state.tour.seen.length > 0;
  useFocusEffect(
    useCallback(() => {
      if (!touring) return;
      const t = setTimeout(() => scroll.current?.scrollToEnd({ animated: false }), 60);
      return () => clearTimeout(t);
    }, [touring]),
  );

  useEffect(() => {
    const sub = Keyboard.addListener('keyboardWillShow', () => setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 60));
    return () => sub.remove();
  }, []);

  // Starting the queue brings it up under the header, so the open card is in view.
  const toQueue = () => {
    follow.current = 0;
    setTimeout(() => {
      const y = rows.current.queue;
      if (y !== undefined) scroll.current?.scrollTo({ y: Math.max(y - top - 64, 0), animated: true });
    }, 140);
  };
  const open = (bucket: Bucket) => {
    store.goTo(bucket);
    toQueue();
  };
  const started = store.started;
  const wasStarted = useRef(started);
  useEffect(() => {
    if (started && !wasStarted.current) toQueue();
    wasStarted.current = started;
    // only when the queue opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);

  const spacer = useAnimatedStyle(() => ({ height: space.value + 16 }));

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView
        ref={scroll}
        key={ws.id}
        keyboardDismissMode="interactive"
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        onContentSizeChange={() => { if (Date.now() < follow.current) scroll.current?.scrollToEnd({ animated: true }); }}
        onScrollBeginDrag={() => (follow.current = 0)}
        contentContainerStyle={{ paddingTop: top + 12, paddingHorizontal: 16, gap: 24 }}
      >
        {writing ? <WritingBrief /> : null}
        {stream.map((item, i) => {
          const staggered = firstIds.has(item.id);
          return (
            <Animated.View key={item.id} layout={layout(m)} onLayout={(e) => (rows.current[item.id] = e.nativeEvent.layout.y)}>
              <Appear delay={staggered ? Math.min(i, 8) * m.stagger * 1.5 : 0} radius={radiusOf(item)} dist={item.kind === 'user' ? 12 : undefined}>
                <Row item={item} onOpen={open} />
              </Appear>
            </Animated.View>
          );
        })}
        {typing ? (
          <Animated.View entering={enter(m)} exiting={exit(m)}>
            <Typing />
          </Animated.View>
        ) : null}
        <Animated.View style={spacer} />
      </ScrollView>

      <Header
        left={<WorkspaceButton />}
        middle={<AgentTitle />}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="Settings" onPress={() => router.navigate('/settings')} hitSlop={10} style={({ pressed }) => ({ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
            <GearIcon color={p.textSecondary} size={22} />
          </Pressable>
        }
      />
    </View>
  );
}

function Row({ item, onOpen }: { item: ThreadItem; onOpen: (bucket: Bucket) => void }) {
  switch (item.kind) {
    case 'brief': return <Brief at={item.at} onOpen={onOpen} />;
    case 'ask': return <AskMessage item={item} />;
    case 'guide': return <GuideMessage item={item} />;
    case 'queue': return <Queue />;
    case 'elsewhere': return <Elsewhere item={item} />;
    case 'agent': return <AgentMessage text={item.text} />;
    case 'user': return <UserMessage item={item} />;
    case 'run': return <RunCard item={item} />;
    default: return null;
  }
}

const radiusOf = (item: ThreadItem) => (item.kind === 'brief' ? radius.xl + 4 : item.kind === 'agent' || item.kind === 'ask' || item.kind === 'guide' || item.kind === 'queue' ? 0 : radius.lg);

/** The agent's name in the header, with the baton as its face and what it is doing now. */
function AgentTitle() {
  const m = useMotion();
  const { ws, state, writing } = useStore();
  const running = useRunning();
  const typing = state.typing === ws.id;
  const status = writing ? 'Writing your brief…' : typing ? 'Writing…' : running ? `Conducting ${running} ${running === 1 ? 'agent' : 'agents'}` : 'Quiet';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 }}>
      {/* room around the baton for its beat and the flick of a cue; nothing clips it */}
      <View style={{ width: 30, height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <Baton height={28} live={running > 0 || writing} quick={writing || typing} cue={state.cueTick} />
      </View>
      <View>
        <T v="headline">Opsaip</T>
        {/* the status cross-fades in a box tall enough for descenders; no overflow clipping */}
        <View style={{ height: 18, minWidth: 140 }}>
          <Animated.View key={status} entering={enter(m)} exiting={exit(m)} style={{ position: 'absolute', left: 0, top: 0 }}>
            <T v="caption" tone={running ? 'signal' : 'muted'} numberOfLines={1} style={{ lineHeight: 18 }}>{status}</T>
          </Animated.View>
        </View>
      </View>
    </View>
  );
}

/** Loading: the outline of the brief, breathing, while Opsaip writes it. */
function WritingBrief() {
  const p = usePalette();
  const m = useMotion();
  const v = useSharedValue(0.4);
  useEffect(() => {
    if (m.reduced) return;
    v.value = pulse(0.4, 1, AMBIENT.breathe, m.reduced);
  }, [m.reduced, v]);
  const breathe = useAnimatedStyle(() => ({ opacity: v.value }));
  const bar = (w: number | `${number}%`, h = 12) => <View style={{ width: w, height: h, borderRadius: h / 2, backgroundColor: p.raised }} />;
  return (
    <Animated.View entering={enter(m)} exiting={exit(m)} style={{ borderRadius: radius.xl + 4, backgroundColor: p.surface, padding: 20, gap: 14 }}>
      <T v="mono" tone="muted">Writing your morning brief…</T>
      <Animated.View style={[{ gap: 12 }, breathe]}>
        {bar('46%', 24)}
        {bar('88%')}
        <View style={{ height: 8 }} />
        {bar('34%', 10)}
        {bar('30%', 10)}
        {bar('38%', 10)}
      </Animated.View>
    </Animated.View>
  );
}
