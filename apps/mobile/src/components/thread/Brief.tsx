// The morning brief: a greeting, one sentence, and how the agent sorted your day —
// Now, Today, Can wait — with live counts. No item appears here and again below:
// a row opens that stage in the queue. Failed runs are one line that opens on tap.

import { useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import type { Bucket } from '../../data/types';
import { BUCKETS, BUCKET_LABEL } from '../../data/types';
import { firstName, greeting } from '../../data/shared';
import { useStore } from '../../state/store';
import { T, useMotion, usePalette } from '../../theme/theme';
import { radius } from '../../theme/tokens';
import { enter, exit, layout, springTo } from '../../theme/motion';
import { haptic } from '../../lib/haptics';
import { StatusDot } from '../Dots';
import { Swap } from '../Animated';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon } from '../Icons';

export function Brief({ at, onOpen }: { at: number; onOpen: (bucket: Bucket) => void }) {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { ws, decisions } = useStore();
  const [failOpen, setFailOpen] = useState(false);

  const working = ws.tasks.filter((t) => t.status === 'Working').length;
  const failed = ws.tasks.filter((t) => t.status === 'Failed');
  const count = (b: Bucket) => decisions.filter((d) => d.bucket === b && d.state === 'pending').length;
  const now = count('now');
  const nameOf = (id: string) => (id === 'me' ? 'You' : firstName(ws.members.find((x) => x.id === id)?.name));

  const agents = working ? `${working} ${working === 1 ? 'agent is' : 'agents are'} working` : 'No agents are running';
  const lead = now ? `${agents}, and ${now === 1 ? 'one thing needs' : `${now} things need`} a decision from you now.` : `${agents}, and nothing needs you right now.`;

  return (
    <Animated.View layout={layout(m)} style={{ borderRadius: radius.xl + 4, backgroundColor: p.surface, paddingTop: 22, paddingBottom: 10, gap: 18 }}>
      <View style={{ paddingHorizontal: 20, gap: 6 }}>
        <T v="title">{greeting(new Date(at))}</T>
        <T v="callout" tone="secondary">{lead}</T>
      </View>

      <View>
        {BUCKETS.map((b) => (
          <BucketRow key={b} label={BUCKET_LABEL[b]} n={count(b)} strong={b === 'now'} onPress={() => onOpen(b)} />
        ))}
        {failed.length ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ expanded: failOpen }}
              onPress={() => {
                haptic.select();
                setFailOpen((o) => !o);
              }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 20, backgroundColor: pressed ? p.hover : 'transparent' })}
            >
              <StatusDot status="Failed" />
              <T v="callout" tone="secondary" style={{ flex: 1 }}>
                {failed.length} {failed.length === 1 ? 'run' : 'runs'} failed overnight
              </T>
              <Turn open={failOpen} />
            </Pressable>
            {failOpen ? (
              <Animated.View entering={enter(m)} exiting={exit(m)} style={{ paddingBottom: 6 }}>
                {failed.map((t) => (
                  <Pressable
                    key={t.id}
                    accessibilityRole="button"
                    accessibilityHint="Opens the run"
                    onPress={() => router.push({ pathname: '/run/[id]', params: { id: t.id } })}
                    style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingLeft: 48, paddingRight: 20, paddingVertical: 8, backgroundColor: pressed ? p.hover : 'transparent' })}
                  >
                    <View style={{ flex: 1, gap: 2 }}>
                      <T v="callout" numberOfLines={1}>{t.task}</T>
                      <T v="monoSmall" tone="muted" numberOfLines={1}>{nameOf(t.owner)} · {t.source} · {t.detail}</T>
                    </View>
                    <ChevronRightIcon color={p.textMuted} size={14} />
                  </Pressable>
                ))}
              </Animated.View>
            ) : null}
          </>
        ) : null}
      </View>
    </Animated.View>
  );
}

function BucketRow({ label, n, strong, onPress }: { label: string; n: number; strong?: boolean; onPress: () => void }) {
  const p = usePalette();
  const m = useMotion();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${n || 'nothing'}`}
      disabled={!n}
      onPress={() => {
        haptic.select();
        onPress();
      }}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 46, paddingHorizontal: 20, backgroundColor: pressed ? p.hover : 'transparent' })}
    >
      <View style={{ width: 16, alignItems: 'center' }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: n ? (strong ? p.text : p.textMuted) : p.border }} />
      </View>
      <Swap id={n ? 'some' : 'none'} style={{ flex: 1 }}>
        <T v={strong && n ? 'calloutMedium' : 'callout'} tone={n ? (strong ? 'text' : 'secondary') : 'muted'}>{label}</T>
      </Swap>
      <View style={{ minWidth: 24, height: 20, alignItems: 'flex-end', justifyContent: 'center' }}>
        <Animated.View key={n} entering={enter(m)} exiting={exit(m)} style={{ position: 'absolute', right: 0 }}>
          {n ? <T v="mono" tone={strong ? 'text' : 'secondary'}>{n}</T> : <CheckIcon color={p.textMuted} size={14} />}
        </Animated.View>
      </View>
      <ChevronRightIcon color={n ? p.textMuted : 'transparent'} size={16} />
    </Pressable>
  );
}

/** A chevron that turns to open, never jumps. */
function Turn({ open }: { open: boolean }) {
  const p = usePalette();
  const m = useMotion();
  const deg = useSharedValue(0);
  useEffect(() => {
    deg.value = springTo(open ? 180 : 0, 'small');
  }, [open, m.base, deg]);
  const s = useAnimatedStyle(() => ({ transform: [{ rotate: `${deg.value}deg` }] }));
  return (
    <Animated.View style={s}>
      <ChevronDownIcon color={p.textMuted} size={16} />
    </Animated.View>
  );
}
