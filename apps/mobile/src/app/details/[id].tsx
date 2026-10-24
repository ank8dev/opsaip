// An approval, opened: everything a phone needs to decide — a short change
// summary, not the full diff. The diff and line comments stay on desktop.

import { useState } from 'react';
import { ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { firstName } from '../../data/shared';
import { useStore } from '../../state/store';
import { T, useMotion, usePalette } from '../../theme/theme';
import { enter, exit } from '../../theme/motion';
import { haptic } from '../../lib/haptics';
import { Button } from '../../components/Button';
import { Face } from '../../components/Face';
import { Spinner } from '../../components/Dots';
import { CheckIcon } from '../../components/Icons';
import { DesktopNote, DiffSummary, Facts, TextAction } from '../../components/thread/parts';
import { timeOf } from '../../lib/time';

const CHECKS: Record<string, string[]> = {
  merge: ['Unit tests · 214 passed', 'Lint and types', 'Preview deploy'],
  dependency: ['License is MIT', 'No known vulnerabilities', 'Builds on the GPU image'],
};

export default function DetailsSheet() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { ws, decisions, decide, notNow } = useStore();
  const [busy, setBusy] = useState(false);
  const item = decisions.find((i) => i.id === id);
  if (!item || item.kind !== 'approval') return null;
  const a = item.approval;
  const owner = ws.members.find((x) => x.id === a.owner);
  const pending = item.state === 'pending';

  const approve = () => {
    setBusy(true);
    setTimeout(() => {
      haptic.success();
      decide(item.id, 'approved');
      router.back();
    }, 650);
  };

  return (
    <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingTop: 28, paddingBottom: 40, gap: 22 }} showsVerticalScrollIndicator={false}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        {owner ? <Face initials={owner.initials} size={36} /> : null}
        <T v="caption" tone="muted">
          {owner ? firstName(owner.name) : 'Your'} · {a.agent} · {timeOf(item.at)}
        </T>
      </View>

      <View style={{ gap: 6 }}>
        <T v="title">{a.title}</T>
        <T v="body" tone="secondary">{a.summary}</T>
      </View>

      <Facts facts={a.facts} all />

      {a.diff ? (
        <View style={{ gap: 10 }}>
          <T v="label" tone="muted">Changes</T>
          <DiffSummary files={a.diff} />
        </View>
      ) : null}

      {a.slack ? (
        <View style={{ gap: 8 }}>
          <T v="label" tone="muted">Message to {a.slack.channel}</T>
          <View style={{ borderRadius: 14, padding: 14, backgroundColor: p.hover }}>
            <T v="body">{a.slack.text}</T>
          </View>
        </View>
      ) : null}

      {a.status ? (
        <View style={{ gap: 8 }}>
          <T v="label" tone="muted">{a.status.tool} {a.status.ref}</T>
          <T v="body">
            <T v="body" tone="muted">{a.status.from} → </T>
            {a.status.to}
          </T>
        </View>
      ) : null}

      {CHECKS[a.kind] ? (
        <View style={{ gap: 8 }}>
          <T v="label" tone="muted">Checks</T>
          {CHECKS[a.kind].map((c) => (
            <View key={c} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <CheckIcon color={p.signal} size={15} strokeWidth={1.8} />
              <T v="callout">{c}</T>
            </View>
          ))}
        </View>
      ) : null}

      {a.kind === 'merge' ? <DesktopNote text="The full diff and line comments are on desktop." /> : null}

      {pending ? (
        <Animated.View key="pending" exiting={exit(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ flex: 1 }}>
            <TextAction
              label="Not now"
              disabled={busy}
              onPress={() => {
                notNow(item.id);
                router.back();
              }}
            />
          </View>
          <Button label={busy ? 'Working…' : a.primary} kind="primary" style={{ minWidth: 140 }} onPress={approve} icon={busy ? <Spinner size={12} /> : undefined} />
        </Animated.View>
      ) : (
        <Animated.View key="done" entering={enter(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <CheckIcon color={p.signal} size={16} strokeWidth={1.8} />
          <T v="calloutMedium">{item.state === 'approved' ? a.done : 'Not now'}</T>
        </Animated.View>
      )}
    </ScrollView>
  );
}
