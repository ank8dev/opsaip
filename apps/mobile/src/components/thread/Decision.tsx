// One decision, in its three looks:
//   open     the one card you act on: one meta line, the ask, at most two facts,
//            one primary button and one quiet "Not now"
//   waiting  a one-line row; tap to open it instead
//   decided  a quiet line: what happened, or when you will be reminded
// "Not now" turns the open card into the agent's question: remind you when, or drop it?

import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import type { Decision } from '../../data/types';
import { openTitle } from '../../data/types';
import { ago, firstName, tessera } from '../../data/shared';
import { useStore } from '../../state/store';
import { useSettings } from '../../state/settings';
import { T, useMotion, usePalette } from '../../theme/theme';
import { radius } from '../../theme/tokens';
import { Appear, enter, exit } from '../../theme/motion';
import { haptic } from '../../lib/haptics';
import { clock, dayOf } from '../../lib/time';
import { Button } from '../Button';
import { Spinner } from '../Dots';
import { CheckIcon, ClockIcon, DesktopIcon, UndoIcon } from '../Icons';
import { Card, DesktopHint, Facts, Meta, Replies, TextAction, useWorkspaceLabel } from './parts';

const WORKING: Record<string, string> = { merge: 'Merging…', slack: 'Sending…', status: 'Moving…', dependency: 'Approving…', deploy: 'Deploying…' };
const firstSentence = (s: string) => {
  const i = s.indexOf('. ');
  return i < 0 ? s : s.slice(0, i + 1);
};

// ---- open ----

export function DecisionCard({ item }: { item: Decision }) {
  const m = useMotion();
  const { queue } = useStore();
  const asking = queue.asking === item.id;
  return (
    <Appear radius={radius.xl + 2} dist={12}>
      <Card>
        <Header item={item} />
        <Animated.View key={asking ? 'ask' : 'body'} entering={enter(m, 'small', { delay: 80 })} exiting={exit(m)} style={{ gap: 14 }}>
          {asking ? <RemindAsk item={item} /> : <Body item={item} />}
        </Animated.View>
      </Card>
    </Appear>
  );
}

function Header({ item }: { item: Decision }) {
  const { ws } = useStore();
  const owner = (id?: string) => (id ? ws.members.find((x) => x.id === id) : undefined);
  switch (item.kind) {
    case 'approval': {
      const o = owner(item.approval.owner);
      return <Meta initials={o?.initials} who={`${o ? firstName(o.name) : 'Your'} · ${item.approval.agent}`} at={item.at} ws={item.ws} />;
    }
    case 'question': {
      const o = owner(item.question.owner);
      return <Meta initials={o?.initials} who={`${o ? firstName(o.name) : 'Your'} · ${item.question.agent}`} at={item.at} ws={item.ws} />;
    }
    case 'drift':
      return <Meta who="Opsaip noticed" at={item.at} ws={item.ws} />;
    case 'memories':
      return <Meta who="Team memory" at={item.at} ws={item.ws} />;
    case 'desktop': {
      const o = owner(item.owner);
      return <Meta initials={o?.initials} who={o ? `${firstName(o.name)} · Codex` : 'Opsaip'} at={item.at} ws={item.ws} />;
    }
  }
}

function Body({ item }: { item: Decision }) {
  switch (item.kind) {
    case 'approval': return <ApprovalBody item={item} />;
    case 'question': return <QuestionBody item={item} />;
    case 'drift': return <DriftBody item={item} />;
    case 'memories': return <MemoriesBody item={item} />;
    case 'desktop': return <DesktopBody item={item} />;
  }
}

function Ask({ title, summary }: { title: string; summary?: string }) {
  return (
    <View style={{ gap: 4 }}>
      <T v="headline">{title}</T>
      {summary ? <T v="callout" tone="secondary">{summary}</T> : null}
    </View>
  );
}

/** One quiet "Not now" on the left; the primary action, and a desktop hint if any, on the right. */
function Actions({ item, children, hint, busy }: { item: Decision; children: ReactNode; hint?: string; busy?: boolean }) {
  const { notNow } = useStore();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
      <View style={{ flex: 1, alignItems: 'flex-start' }}>
        <TextAction label="Not now" disabled={busy} onPress={() => notNow(item.id)} />
      </View>
      {hint ? <DesktopHint text={hint} /> : null}
      {children}
    </View>
  );
}

function ApprovalBody({ item }: { item: Extract<Decision, { kind: 'approval' }> }) {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { decide } = useStore();
  const [busy, setBusy] = useState(false);
  const a = item.approval;

  const approve = () => {
    if (busy) return;
    setBusy(true);
    setTimeout(() => {
      haptic.success();
      decide(item.id, 'approved');
    }, m.reduced ? 0 : 700);
  };

  return (
    <>
      <Ask title={a.title} summary={a.summary} />
      {a.slack ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: p.border, paddingLeft: 12, gap: 4 }}>
          <T v="callout" numberOfLines={4}>{a.slack.text}</T>
        </View>
      ) : null}
      {a.status ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <T v="callout" tone="muted">{a.status.from}</T>
          <T v="callout" tone="muted">→</T>
          <T v="calloutMedium">{a.status.to}</T>
        </View>
      ) : null}
      <Facts facts={a.facts} onDetails={() => router.push({ pathname: '/details/[id]', params: { id: item.id } })} />
      <Actions item={item} busy={busy} hint={a.kind === 'merge' ? 'You can merge from here. The full diff and line comments are on desktop.' : a.kind === 'deploy' ? 'You can deploy from here. Rollbacks and environment settings are on desktop.' : undefined}>
        <Button
          label={busy ? WORKING[a.kind] : a.primary}
          kind="primary"
          onPress={approve}
          icon={busy ? <Spinner size={12} /> : undefined}
          style={{ minWidth: 112 }}
        />
      </Actions>
    </>
  );
}

function QuestionBody({ item }: { item: Extract<Decision, { kind: 'question' }> }) {
  const { answer, notNow } = useStore();
  return (
    <>
      <T v="body">{item.question.text}</T>
      <Replies options={item.question.options} picked={item.answer} onPick={(o) => answer(item.id, o)} />
      <View style={{ alignItems: 'flex-start' }}>
        <TextAction label="Not now" onPress={() => notNow(item.id)} />
      </View>
    </>
  );
}

function DriftBody({ item }: { item: Extract<Decision, { kind: 'drift' }> }) {
  const m = useMotion();
  const { ws, decide } = useStore();
  const [more, setMore] = useState(false);
  const who = ws.members.find((x) => x.id === item.person);
  const joined = tessera.newcomers.find((n) => n.person === item.person)?.joined;
  const n = item.missing.length;
  return (
    <>
      <Ask
        title={`${who?.name ?? 'A new teammate'} is missing ${n} ${n === 1 ? 'connector' : 'connectors'}. Send setup?`}
        summary={`${who ? firstName(who.name) : 'They'} joined ${joined ? ago(joined) : 'recently'}. Their agents can’t reach these yet.`}
      />
      <Facts facts={item.missing} all={more} onDetails={more ? undefined : () => setMore(true)} />
      {more ? (
        <Animated.View entering={enter(m)}>
          <T v="monoSmall" tone="muted">From {item.source}</T>
        </Animated.View>
      ) : null}
      <Actions item={item} hint="Changing the team kit itself is done on desktop.">
        <Button label="Send setup links" kind="primary" onPress={() => { haptic.success(); decide(item.id, 'approved'); }} />
      </Actions>
    </>
  );
}

function MemoriesBody({ item }: { item: Extract<Decision, { kind: 'memories' }> }) {
  const p = usePalette();
  const m = useMotion();
  const { ws, decide } = useStore();
  const [more, setMore] = useState(false);
  const facts = item.memoryIds.map((id) => tessera.memories.find((x) => x.id === id)).filter((x) => !!x);
  return (
    <>
      <Ask title={`${facts.length} new team memories to review`} summary="Agents already get these as context. Worth a look before they spread." />
      {more ? (
        <Animated.View entering={enter(m)} style={{ gap: 12 }}>
          {facts.map((f) => {
            const by = ws.members.find((x) => x.id === f.author);
            return (
              <View key={f.id} style={{ flexDirection: 'row', gap: 10 }}>
                <View style={{ width: 2, borderRadius: 1, backgroundColor: p.border }} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T v="callout">{f.fact}</T>
                  <T v="monoSmall" tone="muted">{by ? firstName(by.name) : 'You'} · {f.source.agent} · {ago(f.created)}</T>
                </View>
              </View>
            );
          })}
        </Animated.View>
      ) : (
        <Animated.View exiting={exit(m)}>
          <Facts facts={[]} onDetails={() => setMore(true)} />
        </Animated.View>
      )}
      <Actions item={item} hint="Editing or removing a memory is done on desktop.">
        <Button label="Looks right" kind="primary" onPress={() => { haptic.success(); decide(item.id, 'approved'); }} />
      </Actions>
    </>
  );
}

function DesktopBody({ item }: { item: Extract<Decision, { kind: 'desktop' }> }) {
  const p = usePalette();
  const { decide } = useStore();
  return (
    <>
      <Ask title={item.title} summary={item.text} />
      <Actions item={item}>
        <Button
          label="Send to my desk"
          kind="primary"
          icon={<DesktopIcon color={p.onAccent} size={15} />}
          onPress={() => { haptic.success(); decide(item.id, 'approved'); }}
        />
      </Actions>
    </>
  );
}

/** "Not now" → "Remind you at 4:00 PM, tomorrow morning, or drop it?" */
function RemindAsk({ item }: { item: Decision }) {
  const { remind, keepAsking } = useStore();
  const { snoozes } = useSettings();
  const [picked, setPicked] = useState<string>();
  const phrases = snoozes.map((s) => s.phrase());
  const question = phrases.length
    ? `Remind you ${phrases.length > 1 ? `${phrases.slice(0, -1).join(', ')} or ${phrases[phrases.length - 1]}` : phrases[0]}, or drop it?`
    : 'Drop it, or keep it open?';
  const options = [...snoozes.map((s) => s.chip()), 'Drop it'];

  const pick = (o: string) => {
    setPicked(o);
    const s = snoozes.find((x) => x.chip() === o);
    // let the picked chip settle before the card folds into its reminder line
    setTimeout(() => remind(item.id, s ?? 'drop'), 260);
  };

  return (
    <>
      <Ask title={openTitle(item)} />
      <T v="body">{question}</T>
      <Replies options={options} picked={picked} onPick={pick} />
      <View style={{ alignItems: 'flex-start' }}>
        <TextAction label="Keep it open" disabled={!!picked} onPress={keepAsking} />
      </View>
    </>
  );
}

// ---- waiting ----

export function DecisionRow({ item }: { item: Decision }) {
  const p = usePalette();
  const m = useMotion();
  const { openItem } = useStore();
  const label = useWorkspaceLabel(item.ws);
  return (
    <Animated.View entering={enter(m)} exiting={exit(m)}>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Opens this one"
        onPress={() => openItem(item.id)}
        style={({ pressed }) => ({
          flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16,
          borderRadius: radius.lg, backgroundColor: pressed ? p.raised : p.surface,
        })}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, borderWidth: 1.5, borderColor: p.textSecondary }} />
        <T v="callout" numberOfLines={1} style={{ flex: 1 }}>{openTitle(item)}</T>
        {label ? <T v="monoSmall" tone="muted">{label}</T> : null}
      </Pressable>
    </Animated.View>
  );
}

// ---- decided ----

function doneText(item: Decision): string {
  switch (item.kind) {
    case 'approval': {
      const s = firstSentence(item.approval.followUp);
      return s.split(' ').length > 2 ? s : `${item.approval.done} · ${item.approval.title}`;
    }
    case 'question':
      return firstSentence(item.question.followUp(item.answer ?? ''));
    case 'drift':
      return 'Setup links sent.';
    case 'memories':
      return item.state === 'flagged' ? 'Memories flagged for desktop.' : 'Memories marked as reviewed.';
    case 'desktop':
      return `On your desk: ${item.title.replace(/^./, (c) => c.toLowerCase())}`;
  }
}

const UNDO_MS = 5000;

export function DecidedRow({ item }: { item: Decision }) {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const { undo } = useStore();
  const reminder = item.state === 'later' && item.remindAt;
  const dropped = item.state === 'dropped';
  // "Undo" shows for a few seconds after you decide, then the line settles
  const [canUndo, setCanUndo] = useState(() => !!item.decidedAt && Date.now() - item.decidedAt < UNDO_MS && (item.state === 'approved' || item.state === 'flagged'));
  useEffect(() => {
    if (!canUndo || !item.decidedAt) return;
    const t = setTimeout(() => setCanUndo(false), Math.max(0, UNDO_MS - (Date.now() - item.decidedAt)));
    return () => clearTimeout(t);
  }, [canUndo, item.decidedAt]);
  const when = reminder ? `${dayOf(item.remindAt!) === 'Today' ? '' : `${dayOf(item.remindAt!)} `}${clock(new Date(item.remindAt!).getHours(), new Date(item.remindAt!).getMinutes())}` : '';
  return (
    <Animated.View entering={enter(m, 'small', { delay: 120 })} exiting={exit(m)}>
      <Pressable
        disabled={!reminder}
        accessibilityRole={reminder ? 'button' : undefined}
        accessibilityHint={reminder ? 'Opens your reminders' : undefined}
        onPress={() => router.push('/reminders')}
        style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 40, paddingHorizontal: 4, borderRadius: 12, opacity: pressed ? 0.6 : 1 })}
      >
        <View style={{ width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: reminder || dropped ? p.hover : p.tintBg }}>
          {reminder ? <ClockIcon color={p.textSecondary} size={13} /> : dropped ? <View style={{ width: 8, height: 1.5, borderRadius: 1, backgroundColor: p.textMuted }} /> : <CheckIcon color={p.tintFg} size={13} strokeWidth={1.9} />}
        </View>
        <T v="callout" tone={dropped ? 'muted' : 'secondary'} numberOfLines={1} style={{ flex: 1 }}>
          {reminder ? (
            <>
              <T v="calloutMedium">Reminder · {when}</T>
              <T v="callout" tone="muted">{`  ${openTitle(item)}`}</T>
            </>
          ) : dropped ? (
            `Dropped · ${openTitle(item)}`
          ) : (
            doneText(item)
          )}
        </T>
        {canUndo ? (
          <Animated.View entering={enter(m)} exiting={exit(m)}>
            <Pressable accessibilityRole="button" onPress={() => undo(item.id)} hitSlop={10} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 8 }}>
              <UndoIcon color={p.textSecondary} size={14} />
              <T v="label" tone="secondary">Undo</T>
            </Pressable>
          </Animated.View>
        ) : null}
      </Pressable>
    </Animated.View>
  );
}
