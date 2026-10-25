// What the agent writes into the thread besides decisions: its own questions with
// quick replies, a word from another workspace, runs you started, and messages.

import { useEffect } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue, withDelay } from 'react-native-reanimated';
import type { ThreadItem } from '../../data/types';
import { useStore } from '../../state/store';
import { T, useMotion, usePalette } from '../../theme/theme';
import { radius } from '../../theme/tokens';
import { enter, exit, layout, pulse, AMBIENT } from '../../theme/motion';
import { StatusDot } from '../Dots';
import { WorkspaceTile } from '../Face';
import { CheckIcon, ChevronRightIcon } from '../Icons';
import { MODE_LABEL } from '../../lib/compose';
import { useSettings } from '../../state/settings';
import { Replies } from './parts';

type Of<K extends ThreadItem['kind']> = Extract<ThreadItem, { kind: K }>;

// ---- The agent asks you something of its own ----

export function AskMessage({ item }: { item: Of<'ask'> }) {
  const { reply } = useStore();
  return (
    <View style={{ gap: 12, paddingRight: 28 }}>
      <T v="body">{item.text}</T>
      <Replies options={item.options} picked={item.answer} onPick={(o) => reply(item.id, o)} />
    </View>
  );
}

// ---- A step of the landing page's guided tour ----

export function GuideMessage({ item }: { item: Of<'guide'> }) {
  const { pickGuide } = useStore();
  return (
    <View style={{ gap: 12, paddingRight: 28 }}>
      <T v="body">{item.text}</T>
      {item.options.length ? <Replies options={item.options} picked={item.answer} onPick={(o) => pickGuide(item.id, o)} /> : null}
    </View>
  );
}

// ---- From your personal space: a word about a team workspace ----

export function Elsewhere({ item }: { item: Of<'elsewhere'> }) {
  const p = usePalette();
  const { spaces, nowCount, switchTo } = useStore();
  const { elsewhere } = useSettings().settings;
  const m = useMotion();
  const w = spaces.find((x) => x.id === item.from);
  if (!w) return null;
  const n = nowCount(w.id);
  return elsewhere.on ? (
    <Animated.View entering={enter(m, 'medium')} exiting={exit(m, 'medium')}>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${w.name}`}
      onPress={() => switchTo(w.id)}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 14,
        borderRadius: radius.lg, backgroundColor: pressed ? p.raised : p.surface,
      })}
    >
      <WorkspaceTile monogram={w.monogram} size={26} />
      <T v="callout" numberOfLines={1} style={{ flex: 1 }}>
        <T v="calloutMedium">{w.name}</T>
        <T v="callout" tone="secondary">{n ? ` · ${n} ${n === 1 ? 'approval' : 'approvals'} waiting` : ' · all clear'}</T>
      </T>
      <T v="label" tone="secondary">Open</T>
      <ChevronRightIcon color={p.textMuted} size={14} />
    </Pressable>
    </Animated.View>
  ) : null;
}

// ---- What you sent, being carried out ----

const RUN_STATE: Record<Of<'run'>['state'], string> = { queued: 'starting', working: 'working', asking: 'asks you', done: 'done' };

export function RunCard({ item }: { item: Of<'run'> }) {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { answerRun } = useStore();
  const last = item.steps[item.steps.length - 1];
  const tone = item.state === 'working' ? 'signal' : item.state === 'asking' ? 'text' : 'muted';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint="Opens the run"
      onPress={() => router.push({ pathname: '/run/[id]', params: { id: item.id } })}
      style={({ pressed }) => ({ borderRadius: radius.xl, backgroundColor: pressed ? p.raised : p.surface, padding: 16, gap: 10 })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <StatusDot status={item.state === 'done' ? 'Done' : item.state === 'asking' ? 'Needs you' : item.state === 'working' ? 'Working' : 'Queued'} />
        <T v="caption" tone="muted" numberOfLines={1} style={{ flex: 1 }}>{item.by}</T>
        <Animated.View key={item.state} entering={enter(m)} exiting={exit(m)}>
          <T v="monoSmall" tone={tone}>{RUN_STATE[item.state]}</T>
        </Animated.View>
      </View>
      <T v="calloutMedium" numberOfLines={2}>{item.title}</T>
      <View style={{ minHeight: 18 }}>
        {item.state === 'done' && item.result ? (
          <Animated.View key="result" entering={enter(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <CheckIcon color={p.signal} size={14} strokeWidth={1.8} />
            <T v="callout" tone="secondary" style={{ flex: 1 }}>{item.result}</T>
          </Animated.View>
        ) : last ? (
          <Animated.View key={last.text} entering={enter(m)} exiting={exit(m)}>
            <T v="monoSmall" tone="muted" numberOfLines={1}>{last.text}</T>
          </Animated.View>
        ) : null}
      </View>
      {item.question ? (
        <Animated.View entering={enter(m)} layout={layout(m)} style={{ gap: 12, paddingTop: 4 }}>
          <T v="body">{item.question.text}</T>
          <Replies options={item.question.options} picked={item.question.answer} onPick={(o) => answerRun(item.id, o)} />
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

// ---- Messages ----

export function AgentMessage({ text }: { text: string }) {
  return (
    <View style={{ paddingRight: 28 }}>
      <T v="body">{text}</T>
    </View>
  );
}

export function UserMessage({ item }: { item: Of<'user'> }) {
  const p = usePalette();
  return (
    <View style={{ alignItems: 'flex-end', paddingLeft: 56, gap: 6 }}>
      {item.to ? (
        <T v="caption" tone="muted">{item.mode ? `${MODE_LABEL[item.mode]} · ` : ''}{item.to}</T>
      ) : null}
      <View style={{ backgroundColor: p.tintBg, borderRadius: 20, borderTopRightRadius: 6, paddingHorizontal: 14, paddingVertical: 10, gap: 8 }}>
        <T v="body" style={{ color: p.tintFg }}>{item.text}</T>
        {item.attachments?.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {item.attachments.map((a) => (
              <View key={a.id} style={{ paddingHorizontal: 8, height: 22, borderRadius: 6, justifyContent: 'center', backgroundColor: p.hover }}>
                <T v="monoSmall" style={{ color: p.tintFg }}>{a.label}</T>
              </View>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  );
}

/** Opsaip is writing: three dots that rise and fall in turn. */
export function Typing() {
  const p = usePalette();
  return (
    <View accessibilityLabel="Opsaip is writing" style={{ flexDirection: 'row', gap: 5, height: 22, alignItems: 'center' }}>
      {[0, 1, 2].map((i) => (
        <Bead key={i} i={i} color={p.textSecondary} />
      ))}
    </View>
  );
}

function Bead({ i, color }: { i: number; color: string }) {
  const m = useMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    if (m.reduced) {
      v.value = 0.6;
      return;
    }
    v.value = withDelay(
      i * 140,
      pulse(0, 1, AMBIENT.typing, m.reduced),
    );
  }, [i, m.reduced, v]);
  const s = useAnimatedStyle(() => ({ opacity: 0.35 + v.value * 0.65, transform: [{ translateY: -v.value * 3 }] }));
  return <Animated.View style={[{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }, s]} />;
}
