// Settings: one scrolling screen of grouped sections, iOS style, with sub-pages
// where a list would crowd it. Only what belongs on a phone; the rest is on desktop.

import { useState } from 'react';
import { Alert, Pressable, ScrollView, View } from 'react-native';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import Constants from 'expo-constants';
import { useRouter } from 'expo-router';
import { useStore } from '../../state/store';
import { BRIEF_TIMES, PRESENCE, SNOOZES, useSettings, type Interrupt } from '../../state/settings';
import { T, useMotion, usePalette } from '../../theme/theme';
import { Appear, enter, exit, layout } from '../../theme/motion';
import { haptic } from '../../lib/haptics';
import { clock, fromMinutes } from '../../lib/time';
import { myAgents } from '../../lib/compose';
import { workspaces } from '../../mocks/workspaces';
import { Header, WorkspaceButton, useHeaderSpace } from '../../components/Header';
import { useDockSpace } from '../../components/Dock';
import { Face, WorkspaceTile } from '../../components/Face';
import { Choices, Group, Row, Segmented, Toggle } from '../../components/Sheet';
import { ArrowUpRightIcon, BellIcon, DesktopIcon, MemoryIcon, PlugIcon, TerminalIcon } from '../../components/Icons';
import { Check } from '../../components/Animated';

const INTERRUPTS: [Interrupt, string][] = [
  ['approvals', 'Approvals'],
  ['failures', 'Failed runs'],
  ['questions', 'Agent questions'],
  ['memory', 'Memory reviews'],
  ['drift', 'Kit drift'],
];

export default function SettingsScreen() {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const store = useStore();
  const { ws, spaces, switchTo, leave, reminders } = store;
  const { settings, set } = useSettings();
  const top = useHeaderSpace();
  const space = useDockSpace();
  const spacer = useAnimatedStyle(() => ({ height: space.value + 8 }));
  const [open, setOpen] = useState<'brief' | 'default' | null>(null);
  const toggle = (k: 'brief' | 'default') => {
    haptic.select();
    setOpen((o) => (o === k ? null : k));
  };
  const mine = myAgents();
  const icon = (node: React.ReactNode) => <View style={{ width: 30, height: 30, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: p.hover }}>{node}</View>;
  const step = (i: number) => i * m.enterStep;

  const confirmLeave = (id: string, name: string) =>
    Alert.alert(`Leave ${name}?`, 'Its agents stop reporting to you. You can rejoin from an invite.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Leave', style: 'destructive', onPress: () => leave(id) },
    ]);

  const toggleSnooze = (id: string) => {
    haptic.select();
    const on = settings.snoozes.includes(id);
    set('snoozes', on ? settings.snoozes.filter((x) => x !== id) : SNOOZES.map((s) => s.id).filter((x) => x === id || settings.snoozes.includes(x)));
  };

  const pr = settings.profile;

  return (
    <View style={{ flex: 1, backgroundColor: p.bg }}>
      <ScrollView showsVerticalScrollIndicator={false} contentInsetAdjustmentBehavior="never" contentContainerStyle={{ paddingTop: top + 4, paddingHorizontal: 16, gap: 28 }}>
        <Appear style={{ paddingHorizontal: 4 }}>
          <T v="display">Settings</T>
        </Appear>

        <Appear delay={step(1)}>
          <Group title="Profile">
            <Row
              icon={<Face initials={pr.initials} size={44} on={pr.presence === 'working'} />}
              title={pr.name}
              sub={`${PRESENCE[pr.presence]} · ${clock(pr.hours.start)} – ${clock(pr.hours.end)}`}
              chevron
              onPress={() => router.push('/prefs/profile')}
            />
          </Group>
        </Appear>

        <Appear delay={step(2)}>
          <Group title="Workspaces" footer="The agent works across all of them. Your personal space is only yours.">
            {spaces.map((w) => (
              <Animated.View key={w.id} layout={layout(m)} exiting={exit(m)}>
                <Row
                  icon={<WorkspaceTile monogram={w.monogram} size={30} active={w.id === ws.id} />}
                  title={w.name}
                  sub={w.kind === 'personal' ? 'Personal' : `Team · ${w.members.length} people · ${w.agents.length} agents`}
                  onPress={() => switchTo(w.id)}
                  right={
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
                      {w.kind === 'team' ? (
                        <Pressable accessibilityRole="button" accessibilityLabel={`Leave ${w.name}`} hitSlop={10} onPress={() => confirmLeave(w.id, w.name)}>
                          <T v="label" tone="muted">Leave</T>
                        </Pressable>
                      ) : null}
                      <Check on={w.id === ws.id} />
                    </View>
                  }
                />
              </Animated.View>
            ))}
            <Row title="Open at launch" value={workspaces.find((w) => w.id === settings.defaultWorkspace)?.name} chevron open={open === 'default'} onPress={() => toggle('default')} />
            {open === 'default' ? (
              <Animated.View entering={enter(m)} exiting={exit(m)} style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
                <Choices value={workspaces.find((w) => w.id === settings.defaultWorkspace)?.name ?? ''} options={spaces.map((w) => w.name)} onChange={(o) => set('defaultWorkspace', spaces.find((w) => w.name === o)?.id ?? settings.defaultWorkspace)} />
              </Animated.View>
            ) : null}
          </Group>
        </Appear>

        <Appear delay={step(3)}>
          <Group title="Notifications">
            <Row title="Morning brief" value={fromMinutes(settings.briefAt)} chevron open={open === 'brief'} onPress={() => toggle('brief')} />
            {open === 'brief' ? (
              <Animated.View entering={enter(m)} exiting={exit(m)} style={{ paddingHorizontal: 16, paddingBottom: 14 }}>
                <Choices value={fromMinutes(settings.briefAt)} options={BRIEF_TIMES.map(fromMinutes)} onChange={(o) => set('briefAt', BRIEF_TIMES.find((t) => fromMinutes(t) === o) ?? settings.briefAt)} />
              </Animated.View>
            ) : null}
            <Row title="Quiet hours" sub={`${fromMinutes(settings.quiet.from)} – ${fromMinutes(settings.quiet.to)}`} right={<Toggle on={settings.quiet.on} onChange={(on) => set('quiet', { ...settings.quiet, on })} />} />
            <Row title="Per workspace" sub="All, approvals only, or muted" chevron onPress={() => router.push('/prefs/notifications')} />
          </Group>
        </Appear>

        <Appear delay={step(4)}>
          <Group title="What can interrupt me" footer="Everything else waits for the next brief.">
            {INTERRUPTS.map(([key, label]) => (
              <Row key={key} title={label} right={<Toggle on={settings.interrupts[key]} onChange={(on) => set('interrupts', { ...settings.interrupts, [key]: on })} />} />
            ))}
          </Group>
        </Appear>

        <Appear delay={step(5)}>
          <Group title="Reminders" footer="What “Not now” offers. “Drop it” is always there.">
            <Row
              icon={icon(<BellIcon color={p.text} size={16} />)}
              title="Upcoming"
              value={reminders.length ? String(reminders.length) : 'None'}
              chevron
              onPress={() => router.push('/reminders')}
            />
            {SNOOZES.map((s) => (
              <Row
                key={s.id}
                title={s.label}
                value={s.chip() === s.label ? undefined : s.chip()}
                onPress={() => toggleSnooze(s.id)}
                right={<Check on={settings.snoozes.includes(s.id)} />}
              />
            ))}
          </Group>
        </Appear>

        <Appear delay={step(6)}>
          <Group title="Agents and data">
            <Row icon={icon(<TerminalIcon color={p.text} size={16} />)} title="My agents" value={`${mine.filter((a) => a.state === 'running').length} running`} chevron onPress={() => router.push('/prefs/agents')} />
            <Row icon={icon(<PlugIcon color={p.text} size={16} />)} title="Connectors" value={String(ws.connectors.length)} chevron onPress={() => router.push('/prefs/connectors')} />
            <Row icon={icon(<MemoryIcon color={p.text} size={16} />)} title="My memory" sub="What your agents know about you" chevron onPress={() => router.push('/prefs/memory')} />
          </Group>
        </Appear>

        <Appear delay={step(7)}>
          <Group title="Personal workspace" footer="In your personal space, Opsaip mentions what waits for you in team workspaces.">
            <Row title="Remind me about other workspaces" right={<Toggle on={settings.elsewhere.on} onChange={(on) => set('elsewhere', { ...settings.elsewhere, on })} />} />
            {settings.elsewhere.on ? (
              <Animated.View entering={enter(m)} exiting={exit(m)} style={{ padding: 6 }}>
                <Segmented value={settings.elsewhere.every} options={[['brief', 'With the brief'], ['twice', 'Twice a day'], ['hourly', 'Hourly']]} onChange={(every) => set('elsewhere', { ...settings.elsewhere, every })} />
              </Animated.View>
            ) : null}
          </Group>
        </Appear>

        <Appear delay={step(8)}>
          <Group title="Appearance">
            <View style={{ padding: 6 }}>
              <Segmented value={settings.appearance} options={[['system', 'System'], ['light', 'Light'], ['dark', 'Dark']]} onChange={(v) => set('appearance', v)} />
            </View>
            <Row title="Reduce motion" sub="Fades instead of movement" right={<Toggle on={settings.reduceMotion} onChange={(v) => set('reduceMotion', v)} />} />
            <Row title="Haptics" right={<Toggle on={settings.haptics} onChange={(v) => set('haptics', v)} />} />
          </Group>
        </Appear>

        <Appear delay={step(9)}>
          <Group title="About">
            <Row title="Version" value={`${Constants.expoConfig?.version ?? '0.1.0'} preview`} />
            <Row
              title="Open source"
              sub="GNU AGPL v3"
              right={<ArrowUpRightIcon color={p.textMuted} size={16} />}
              onPress={() => router.push({ pathname: '/desktop', params: { title: 'Opsaip is open source', text: 'Licensed under GNU AGPL v3, self-hosted by your team. Send the source link to your desktop to read it there.' } })}
            />
            <Row title="Send feedback" chevron onPress={() => router.push('/feedback')} />
            <Row
              icon={icon(<DesktopIcon color={p.text} size={16} />)}
              title="More settings on desktop"
              right={<ArrowUpRightIcon color={p.textMuted} size={16} />}
              onPress={() => router.push({ pathname: '/desktop', params: { title: 'More settings on desktop', text: 'Roles, repo access, connectors, the team kit and workflows live in Opsaip on your computer.' } })}
            />
          </Group>
        </Appear>

        <Appear delay={step(10)}>
          <Group>
            <Row
              title="Sign out"
              tone="error"
              onPress={() =>
                Alert.alert('Sign out of Opsaip?', 'Your agents keep running. You’ll get the brief again when you sign back in.', [
                  { text: 'Cancel', style: 'cancel' },
                  { text: 'Sign out', style: 'destructive', onPress: store.signOut },
                ])
              }
            />
          </Group>
        </Appear>

        <Animated.View style={spacer} />
      </ScrollView>

      <Header left={<WorkspaceButton withName />} />
    </View>
  );
}
