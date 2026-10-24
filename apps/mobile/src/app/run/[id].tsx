// A run, opened: what it is, who runs it, and a short timeline. Works for an agent's
// run (from Team, the brief, an agent) and for one you started from the composer.

import { useEffect, useState } from 'react';
import { View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AgentState } from '../../data/types';
import { useStore } from '../../state/store';
import { T, useMotion, usePalette } from '../../theme/theme';
import { enter, exit } from '../../theme/motion';
import { haptic } from '../../lib/haptics';
import { timeOf } from '../../lib/time';
import { agentLabel, MODE_LABEL } from '../../lib/compose';
import { workspaces } from '../../mocks/workspaces';
import { AGENT_DOT, AGENT_STATE_LABEL } from '../../mocks/agents';
import { Group, Row, SheetPage, SheetTitle } from '../../components/Sheet';
import { Button } from '../../components/Button';
import { StatusDot } from '../../components/Dots';
import { DesktopIcon } from '../../components/Icons';
import { Replies } from '../../components/thread/parts';

interface View_ {
  title: string;
  state: AgentState;
  by: string;
  agentId?: string;
  where?: string;
  steps: { at: number; text: string; tone?: 'done' | 'error' | 'ask' }[];
  result?: string;
  threadRun?: string;
}

const RUN_STATE: Record<string, AgentState> = { queued: 'idle', working: 'running', asking: 'waiting', done: 'done' };

function useRunView(id: string): View_ | null {
  const { state } = useStore();
  const [now] = useState(() => Date.now());
  for (const [wsId, items] of Object.entries(state.threads)) {
    const r = items.find((i) => i.id === id);
    if (r?.kind === 'run') {
      const ws = workspaces.find((w) => w.id === wsId);
      return {
        title: r.title,
        state: RUN_STATE[r.state],
        by: r.by,
        agentId: r.agentId,
        where: ws ? `${MODE_LABEL[r.mode]} · ${ws.name}` : MODE_LABEL[r.mode],
        steps: [{ at: r.at, text: 'You sent it' }, ...r.steps.map((s) => ({ ...s, tone: undefined }))],
        result: r.result,
        threadRun: r.id,
      };
    }
  }
  for (const ws of workspaces) {
    for (const a of ws.agents) {
      const run = a.runs.find((x) => x.id === id);
      if (run) {
        return {
          title: run.title,
          state: run.state,
          by: agentLabel(a, ws),
          agentId: a.id,
          where: [run.repo, run.branch].filter(Boolean).join(' @ ') || ws.name,
          steps: run.steps.map((s) => ({ at: now - s.min * 60_000, text: s.text, tone: s.tone })),
          result: run.result,
        };
      }
    }
  }
  return null;
}

export default function RunSheet() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const run = useRunView(id);
  const [retry, setRetry] = useState<'no' | 'asked' | 'started'>('no');
  // opening a failed run: one warning tap
  const failed = run?.state === 'failed';
  useEffect(() => {
    if (failed) haptic.warning();
  }, [failed]);
  if (!run) return null;
  const threadRun = run.threadRun ? store.thread.find((i) => i.id === run.threadRun) : undefined;
  const question = threadRun?.kind === 'run' ? threadRun.question : undefined;

  return (
    <SheetPage>
      <SheetTitle title={run.title} sub={`${AGENT_STATE_LABEL[run.state]} · ${run.where ?? ''}`} />

      <Group>
        <Row
          icon={<View style={{ width: 32, alignItems: 'center' }}><StatusDot status={AGENT_DOT[run.state]} /></View>}
          title={run.by}
          chevron={!!run.agentId}
          onPress={run.agentId ? () => router.push({ pathname: '/agent/[id]', params: { id: run.agentId! } }) : undefined}
        />
      </Group>

      <View style={{ paddingHorizontal: 8, gap: 0 }}>
        <T v="label" tone="muted" style={{ marginBottom: 12 }}>Timeline</T>
        {run.steps.map((s, i) => {
          const last = i === run.steps.length - 1;
          const color = s.tone === 'error' ? p.error : s.tone === 'ask' ? p.text : last ? p.signal : p.borderControl;
          return (
            <Animated.View key={`${s.at}-${i}`} entering={enter(m, 'small', { delay: i * 40 })} style={{ flexDirection: 'row', gap: 14 }}>
              <View style={{ width: 12, alignItems: 'center' }}>
                <View style={{ width: 9, height: 9, borderRadius: 5, marginTop: 6, backgroundColor: s.tone === 'ask' ? 'transparent' : color, borderWidth: s.tone === 'ask' ? 1.5 : 0, borderColor: color }} />
                {!last ? <View style={{ flex: 1, width: 1.5, backgroundColor: p.border, marginVertical: 3 }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: last ? 0 : 16, gap: 2 }}>
                <T v="callout" tone={s.tone === 'error' ? 'error' : 'text'}>{s.text}</T>
                <T v="monoSmall" tone="muted">{timeOf(s.at)}</T>
              </View>
            </Animated.View>
          );
        })}
      </View>

      {run.result ? (
        <Group>
          <View style={{ padding: 16, gap: 4 }}>
            <T v="label" tone="muted">{run.state === 'failed' ? 'What it needs' : 'Result'}</T>
            <T v="callout">{run.result}</T>
          </View>
        </Group>
      ) : null}

      {question && !question.answer && threadRun ? (
        <Animated.View entering={enter(m, 'medium')} exiting={exit(m, 'medium')} style={{ gap: 12, paddingHorizontal: 8 }}>
          <T v="body">{question.text}</T>
          <Replies options={question.options} onPick={(o) => store.answerRun(threadRun.id, o)} />
        </Animated.View>
      ) : null}

      {run.state === 'failed' ? (
        retry === 'started' ? (
          <Animated.View entering={enter(m)} style={{ paddingHorizontal: 8 }}>
            <T v="callout" tone="signal">Retrying with the error as context. I’ll tell you how it goes.</T>
          </Animated.View>
        ) : (
          <Animated.View key="retry" exiting={exit(m)}>
          <Button
            label="Retry the run"
            kind="primary"
            onPress={() => {
              haptic.success();
              setRetry('started');
            }}
          />
          </Animated.View>
        )
      ) : null}

      <Button
        label="Open the full log on desktop"
        icon={<DesktopIcon color={p.text} size={15} />}
        onPress={() => router.push({ pathname: '/desktop', params: { title: 'Full logs are on desktop', text: `The complete transcript and tool calls for “${run.title}” are in Opsaip on your computer.` } })}
      />
    </SheetPage>
  );
}
