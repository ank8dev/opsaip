// Team & agents: who is working now, which agents are running, who is off hours.
// Read-only on the phone except for handing someone a task (swipe a row left).

import { useRef } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import Animated, { interpolate, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import ReanimatedSwipeable, { type SwipeableMethods } from 'react-native-gesture-handler/ReanimatedSwipeable';
import { useRouter } from 'expo-router';
import type { Person, Task } from '../../data/shared';
import type { MobileAgent } from '../../data/types';
import { AGENT_DOT, AGENT_STATE_LABEL } from '../../mocks/agents';
import { clockFor, firstName } from '../../data/shared';
import { isOpen } from '../../data/types';
import { useRunning, useStore } from '../../state/store';
import { T, useMotion, usePalette } from '../../theme/theme';
import { radius } from '../../theme/tokens';
import { Appear, layout, listIn } from '../../theme/motion';
import { haptic } from '../../lib/haptics';
import { fromMinutes, timeOf } from '../../lib/time';
import { Header, WorkspaceButton, useHeaderSpace } from '../../components/Header';
import { useDockSpace } from '../../components/Dock';
import { Baton } from '../../components/Baton';
import { Face } from '../../components/Face';
import { StatusDot } from '../../components/Dots';
import { ComposeIcon } from '../../components/Icons';
import { DesktopNote } from '../../components/thread/parts';

export default function TeamScreen() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { ws, state } = useStore();
  const running = useRunning();
  const top = useHeaderSpace();
  const space = useDockSpace();
  const spacer = useAnimatedStyle(() => ({ height: space.value + 8 }));

  const now = new Date();
  const people = ws.members.map((x) => ({ person: x, clock: clockFor(x, now) }));
  const on = people.filter((x) => x.clock.working);
  const off = people.filter((x) => !x.clock.working);
  // what needs you or is moving first; idle and finished agents live in the full list
  const agents = ws.agents.filter((a) => a.state === 'running' || a.state === 'waiting' || a.state === 'failed')
    .sort((a, b) => ['waiting', 'failed', 'running'].indexOf(a.state) - ['waiting', 'failed', 'running'].indexOf(b.state));
  const failed = ws.agents.filter((a) => a.state === 'failed').length;
  const needs = (state.threads[ws.id] ?? []).filter(isOpen).length;
  const nameOf = (id: string) => (id === 'me' ? 'You' : firstName(ws.members.find((x) => x.id === id)?.name));
  const here = timeOf(now.getTime());

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView
        key={ws.id}
        showsVerticalScrollIndicator={false}
        contentInsetAdjustmentBehavior="never"
        contentContainerStyle={{ paddingTop: top + 4 }}
      >
        <Appear style={{ paddingHorizontal: 20, gap: 4, marginBottom: 20 }}>
          <T v="display">Team</T>
          <T v="mono" tone="muted">
            {ws.name} · {ws.members.length ? `${ws.members.length} people · ` : ''}{here} your time
          </T>
        </Appear>

        <Appear delay={m.enterStep} style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, marginBottom: 28 }}>
          <Stat value={running} label="running" dot={<StatusDot status="Working" />} onPress={() => router.push({ pathname: '/agents', params: { state: 'running' } })} />
          <Stat value={needs} label="need you" dot={<StatusDot status="Needs you" />} onPress={() => router.navigate('/')} />
          <Stat value={failed} label="failed" dot={<StatusDot status={failed ? 'Failed' : 'Done'} />} onPress={() => router.push({ pathname: '/agents', params: failed ? { state: 'failed' } : {} })} />
        </Appear>

        {ws.members.length ? (
          <Section title="Working now" count={on.length} step={2}>
            {on.length ? (
              on.map(({ person, clock }, i) => (
                <Animated.View key={person.id} entering={listIn(m, i + 2)} layout={layout(m)}>
                  <PersonRow person={person} time={fromMinutes(clock.min)} on tasks={ws.tasks.filter((t) => t.owner === person.id && t.status === 'Working')} />
                </Animated.View>
              ))
            ) : (
              <Empty text="Nobody is inside their work hours right now." />
            )}
          </Section>
        ) : null}

        <Section title={ws.kind === 'personal' ? 'Your agents' : 'Agents'} count={agents.length} step={3} action={{ label: `All ${ws.agents.length}`, onPress: () => router.push('/agents') }}>
          {agents.length ? (
            agents.map((t, i) => (
              <Animated.View key={t.id} entering={listIn(m, i + 3)} layout={layout(m)}>
                <AgentRow agent={t} owner={nameOf(t.owner)} />
              </Animated.View>
            ))
          ) : (
            <Empty text="Nothing running and nothing waiting. The baton rests." />
          )}
        </Section>

        {off.length ? (
          <Section title="Off hours" count={off.length} step={4}>
            {off.map(({ person, clock }, i) => (
              <Animated.View key={person.id} entering={listIn(m, i + 4)} layout={layout(m)}>
                <PersonRow person={person} time={fromMinutes(clock.min)} tasks={[]} />
              </Animated.View>
            ))}
          </Section>
        ) : null}

        {ws.kind === 'personal' ? (
          <View style={{ paddingHorizontal: 20, marginBottom: 20 }}>
            <Empty text="A personal workspace is just you and your agents. Invite people from a team workspace on desktop." />
          </View>
        ) : null}

        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          <Pressable
            accessibilityRole="button"
            onPress={() => router.push({ pathname: '/desktop', params: { title: 'Team setup is on desktop', text: 'Roles, repo rights, connectors and the team kit are managed in Opsaip on your computer.' } })}
            style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
          >
            <DesktopNote text="Roles, repo rights and connectors are managed on desktop." />
          </Pressable>
        </View>
        <Animated.View style={spacer} />
      </ScrollView>

      <Header
        left={<WorkspaceButton withName />}
        right={
          <Pressable accessibilityRole="button" accessibilityLabel="Back to the thread" onPress={() => router.navigate('/')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <T v="mono" tone={running ? 'signal' : 'muted'}>{running ? `${running} running` : 'quiet'}</T>
            <Baton height={26} live={running > 0} cue={state.cueTick} />
          </Pressable>
        }
      />
    </View>
  );
}

function Stat({ value, label, dot, onPress }: { value: number; label: string; dot: React.ReactNode; onPress?: () => void }) {
  const p = usePalette();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1, padding: 14, gap: 10, borderRadius: radius.lg,
        backgroundColor: pressed ? p.raised : p.surface,
      })}
    >
      {dot}
      <View>
        <T v="title">{value}</T>
        <T v="caption" tone="muted">{label}</T>
      </View>
    </Pressable>
  );
}

function Section({ title, count, step, action, children }: { title: string; count?: number; step: number; action?: { label: string; onPress: () => void }; children: React.ReactNode }) {
  const m = useMotion();
  return (
    <View style={{ marginBottom: 24 }}>
      <Appear delay={step * m.enterStep} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, marginBottom: 6 }}>
        <T v="label" tone="muted" style={{ textTransform: 'uppercase', letterSpacing: 0.8, fontSize: 11 }}>{title}</T>
        {count ? <T v="monoSmall" tone="muted">{count}</T> : null}
        <View style={{ flex: 1 }} />
        {action ? (
          <Pressable accessibilityRole="button" onPress={action.onPress} hitSlop={10}>
            <T v="label" tone="secondary">{action.label}</T>
          </Pressable>
        ) : null}
      </Appear>
      {children}
    </View>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <View style={{ paddingHorizontal: 20, paddingVertical: 10 }}>
      <T v="callout" tone="muted">{text}</T>
    </View>
  );
}

/** A teammate. Tap for details; swipe left to hand them a task. */
function PersonRow({ person, time, on, tasks }: { person: Person; time: string; on?: boolean; tasks: Task[] }) {
  const p = usePalette();
  const router = useRouter();
  const { focusComposer } = useStore();
  const ref = useRef<SwipeableMethods>(null);
  const first = firstName(person.name);

  const give = () => {
    haptic.light();
    ref.current?.close();
    focusComposer(`@${first} `);
  };

  return (
    <ReanimatedSwipeable
      ref={ref}
      friction={1.6}
      rightThreshold={56}
      overshootRight={false}
      onSwipeableWillOpen={() => haptic.light()}
      renderRightActions={(progress) => <GiveAction progress={progress} onPress={give} name={first} />}
    >
      <Pressable
        onPress={() => router.push({ pathname: '/person/[id]', params: { id: person.id } })}
        accessibilityHint="Swipe left to give a task"
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 10,
          backgroundColor: pressed ? p.hover : p.bg,
        })}
      >
        <Face initials={person.initials} size={40} on={on} />
        <View style={{ flex: 1, gap: 2, opacity: on ? 1 : 0.72 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
            <T v="calloutMedium" numberOfLines={1} style={{ flexShrink: 1 }}>{person.name}</T>
            <T v="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>{person.role}</T>
          </View>
          <T v="monoSmall" tone="muted" numberOfLines={1}>
            {tasks.length ? `${tasks.length} ${tasks.length === 1 ? 'agent' : 'agents'} · ${tasks[0].task}` : person.focus}
          </T>
        </View>
        <T v="mono" tone={on ? 'secondary' : 'muted'}>{time}</T>
      </Pressable>
    </ReanimatedSwipeable>
  );
}

function GiveAction({ progress, onPress, name }: { progress: SharedValue<number>; onPress: () => void; name: string }) {
  const p = usePalette();
  const reveal = useAnimatedStyle(() => ({
    opacity: interpolate(progress.value, [0, 0.6, 1], [0, 0.6, 1]),
    transform: [{ scale: interpolate(progress.value, [0, 1], [0.86, 1]) }],
  }));
  return (
    <View style={{ width: 108, justifyContent: 'center', paddingRight: 16 }}>
      <Animated.View style={reveal}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Give ${name} a task`}
          onPress={onPress}
          style={{ height: 44, borderRadius: 22, backgroundColor: p.accent, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }}
        >
          <ComposeIcon color={p.onAccent} size={16} />
          <T v="label" tone="onAccent">Give task</T>
        </Pressable>
      </Animated.View>
    </View>
  );
}

function AgentRow({ agent, owner }: { agent: MobileAgent; owner: string }) {
  const p = usePalette();
  const router = useRouter();
  const run = agent.runs[0];
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/agent/[id]', params: { id: agent.id } })}
      style={({ pressed }) => ({ flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: pressed ? p.hover : 'transparent' })}
    >
      <View style={{ width: 40, alignItems: 'center', paddingTop: 2 }}>
        <StatusDot status={AGENT_DOT[agent.state]} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T v="calloutMedium" numberOfLines={1}>{run?.title ?? agent.name}</T>
        <T v="monoSmall" tone={agent.state === 'failed' ? 'error' : 'muted'} numberOfLines={1}>
          {owner} · {agent.name} · {AGENT_STATE_LABEL[agent.state].toLowerCase()}
        </T>
      </View>
    </Pressable>
  );
}
