// Your decisions, handled one at a time. Exactly one is open; the others wait as
// one-line rows, and decided ones settle into a quiet line. When a stage is clear the
// agent asks whether to go on: Now → Today → Can wait.

import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import type { Bucket, Decision } from '../../data/types';
import { BUCKET_LABEL } from '../../data/types';
import { inStage, useStore } from '../../state/store';
import { T, useMotion, usePalette } from '../../theme/theme';
import { enter, exit, layout } from '../../theme/motion';
import { CheckIcon } from '../Icons';
import { DecidedRow, DecisionCard, DecisionRow } from './Decision';
import { Replies } from './parts';

const ONWARD: Record<Bucket, string> = { now: 'now', today: 'for today', wait: 'that can wait' };

export function Queue() {
  const m = useMotion();
  const { decisions, queue, started } = useStore();
  if (!started) return null;

  const shown = decisions.filter((d) => inStage(d, queue.stage));
  const waiting = (d: Decision) => d.state === 'pending';
  const ahead = decisions.filter((d) => !inStage(d, queue.stage) && waiting(d));
  const several = new Set(shown.map((d) => d.bucket)).size > 1;

  return (
    <View style={{ gap: 10 }}>
      {shown.map((d, i) => (
        <Animated.View key={d.id} layout={layout(m)}>
          {several && d.bucket !== shown[i - 1]?.bucket ? (
            <Animated.View entering={enter(m)} exiting={exit(m)}>
              <T v="label" tone="muted" style={{ paddingHorizontal: 4, paddingTop: i ? 14 : 0, paddingBottom: 8 }}>{BUCKET_LABEL[d.bucket]}</T>
            </Animated.View>
          ) : null}
          {!waiting(d) ? (
            <DecidedRow key="done" item={d} />
          ) : queue.open === d.id ? (
            <DecisionCard key="open" item={d} />
          ) : (
            <DecisionRow key="row" item={d} />
          )}
        </Animated.View>
      ))}
      <Animated.View layout={layout(m)}>
        {!shown.some(waiting) ? <Onward key={ahead.length ? ahead[0].bucket : 'clear'} next={ahead} /> : null}
      </Animated.View>
    </View>
  );
}

/** The stage is clear: go on to the next, or the end of the day's decisions. */
function Onward({ next }: { next: Decision[] }) {
  const p = usePalette();
  const m = useMotion();
  const { queue, goTo, pause, decisions } = useStore();
  if (!next.length) {
    return (
      <Animated.View entering={enter(m, 'small', { delay: 240 })} exiting={exit(m)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingTop: 10, paddingHorizontal: 4 }}>
        <CheckIcon color={p.signal} size={16} strokeWidth={1.8} />
        <T v="callout" tone="secondary" style={{ flex: 1 }}>
          {decisions.length ? 'That’s everything. I’ll stay quiet until something needs you.' : 'Nothing needs you. I’ll stay quiet until something does.'}
        </T>
      </Animated.View>
    );
  }
  const bucket = next[0].bucket;
  const n = next.filter((d) => d.bucket === bucket).length;
  const cleared = BUCKET_LABEL[queue.stage];
  return (
    <Animated.View entering={enter(m, 'small', { delay: 240 })} exiting={exit(m)} style={{ gap: 12, paddingTop: 14 }}>
      {queue.paused ? (
        <T v="callout" tone="muted">Okay. {BUCKET_LABEL[bucket]} is in the brief whenever you’re ready.</T>
      ) : (
        <>
          <T v="body">
            {cleared} is clear. {n} {n === 1 ? 'thing' : 'things'} {ONWARD[bucket]} — keep going?
          </T>
          <Replies options={['Keep going', 'Later']} onPick={(o) => (o === 'Later' ? pause() : goTo(bucket))} />
        </>
      )}
    </Animated.View>
  );
}
