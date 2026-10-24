// The composer: one bubble, the desktop's four modes, phone-sized.
//
//   [mode chip] [text field] [+] [mic ⇄ send]
//
//   bubble     its own surface (Liquid Glass where available), a hairline border
//              and a soft shadow. Focus lifts it (shadow, scale 1 → 1.01) and turns
//              the border lime.
//   mode chip  opens one menu (Task, Message, Agent, Announce) that grows out of
//              the chip and collapses back into it; the chip's label cross-fades and
//              its width follows.
//   recipient  a small chip above the field once one is chosen; tap to change it.
//   field      grows line by line on a spring, up to 5 lines, then scrolls inside.
//              The placeholder is our own text, so it cross-fades when the mode
//              changes.
//   "@"        people and agents; "/" connectors.

import { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, TextInput, View, type LayoutChangeEvent, type TextInputInstance } from 'react-native';
import Animated, { interpolateColor, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useRouter } from 'expo-router';
import type { Mode, Recipient } from '../data/types';
import { clockFor, firstName } from '../data/shared';
import { useStore } from '../state/store';
import { T, useMotion, usePalette } from '../theme/theme';
import { font, radius } from '../theme/tokens';
import { AMBIENT, enter, exit, fadeTo, grow, layout, listIn, pulse, shrink, springTo } from '../theme/motion';
import { haptic } from '../lib/haptics';
import { MODES, MODE_LABEL, agentsFor, ownerName, placeholderFor } from '../lib/compose';
import { AGENT_DOT } from '../mocks/agents';
import { Glass } from './Glass';
import { Face } from './Face';
import { StatusDot } from './Dots';
import { ArrowUpIcon, AtIcon, CheckIcon, ChevronDownIcon, CloseIcon, HashIcon, MegaphoneIcon, MicIcon, PlusIcon, StatusIcon, TerminalIcon } from './Icons';

export const LINE = 52;          // the bubble at rest: one line
const LINE_H = 22;               // one line of text
const MAX_LINES = 5;
const PAD = 6;                   // bubble padding; the menu's origin is measured from it
const RADIUS = 26;

const AnimatedInput = Animated.createAnimatedComponent(TextInput);

export function ModeIcon({ mode, color, size = 15 }: { mode: Mode; color: string; size?: number }) {
  if (mode === 'task') return <StatusIcon color={color} size={size} />;
  if (mode === 'message') return <HashIcon color={color} size={size} />;
  if (mode === 'announce') return <MegaphoneIcon color={color} size={size} />;
  return <TerminalIcon color={color} size={size} />;
}

/** The recipient chip's words, or null when the mode itself says who: Opsaip, everyone. */
function recipientChip(r: Recipient | null, mode: Mode, ws: ReturnType<typeof useStore>['ws']): string | null {
  if (!r) return mode === 'task' || mode === 'message' ? 'Choose who' : null;
  switch (r.kind) {
    case 'opsaip':
    case 'workspace':
      return null;
    case 'agent': {
      const a = agentsFor(ws).find((x) => x.id === r.id);
      if (!a) return 'Agent';
      return a.owner === 'me' ? `Your ${a.name}` : `${a.name} · ${ownerName(a.owner, ws)}`;
    }
    case 'person':
      return firstName(ws.members.find((x) => x.id === r.id)?.name) || 'Someone';
    case 'channel':
      return r.name;
  }
}

export function Composer({
  inputRef,
  visible,
  onHeight,
  onMenu,
  onChip,
}: {
  inputRef: React.RefObject<TextInputInstance | null>;
  visible: boolean;
  onHeight: (h: number) => void;
  onMenu: () => void;
  /** Where the mode chip's centre is, from the bubble's left edge: the menu grows from there. */
  onChip: (x: number) => void;
}) {
  const p = usePalette();
  const m = useMotion();
  const router = useRouter();
  const store = useStore();
  const { ws } = store;
  const { mode, to, attachments } = store.state.composer;
  const [focused, setFocused] = useState(false);
  const [listening, setListening] = useState<'off' | 'on' | 'note'>('off');
  const draft = store.state.draft;
  const hasText = draft.trim().length > 0;
  const chip = recipientChip(to, mode, ws);

  // focus: the bubble lifts and its border turns lime
  const lift = useSharedValue(0);
  useEffect(() => {
    lift.value = springTo(focused ? 1 : 0, 'small');
  }, [focused, lift]);
  const dark = p.scheme === 'dark';
  const reduced = m.reduced;
  const bubble = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + (reduced ? 0 : lift.value * 0.01) }],
    shadowOpacity: (dark ? 0.35 : 0.1) + lift.value * (dark ? 0.2 : 0.08),
    shadowRadius: 14 + lift.value * 10,
  }));
  const from = p.border;
  const to_ = p.accent;
  const edge = useAnimatedStyle(() => ({ borderColor: interpolateColor(lift.value, [0, 1], [from, to_]) }));

  // the field grows one line at a time, up to five, then scrolls
  const [contentH, setContentH] = useState(LINE_H);
  const fieldH = useSharedValue(LINE_H);
  const target = hasText ? Math.min(Math.max(contentH, LINE_H), LINE_H * MAX_LINES) : LINE_H;
  useEffect(() => {
    fieldH.value = springTo(target, 'small');
  }, [target, fieldH]);
  const field = useAnimatedStyle(() => ({ height: fieldH.value }));

  // mic ⇄ send: a cross-fade with a little scale
  const morph = useSharedValue(0);
  useEffect(() => {
    morph.value = springTo(hasText ? 1 : 0, 'small');
  }, [hasText, morph]);
  const micStyle = useAnimatedStyle(() => ({ opacity: 1 - morph.value, transform: [{ scale: 1 - morph.value * 0.4 }] }));
  const sendStyle = useAnimatedStyle(() => ({ opacity: morph.value, transform: [{ scale: 0.6 + morph.value * 0.4 }] }));

  const send = () => {
    if (!hasText || !to) return;
    store.send(draft);
  };

  const voice = () => {
    haptic.light();
    setListening('on');
    setTimeout(() => setListening('note'), 1600);
    setTimeout(() => setListening('off'), 4200);
  };

  const placeholder = listening === 'on' ? 'Listening…' : listening === 'note' ? 'Voice comes with the Opsaip server.' : placeholderFor(mode, to, ws);
  const pickTo = () => {
    haptic.select();
    router.push('/compose/to');
  };

  return (
    <View onLayout={(e: LayoutChangeEvent) => onHeight(e.nativeEvent.layout.height)}>
      <Suggest />
      {focused && !hasText && !attachments.length ? <Starters /> : null}

      <Animated.View
        layout={layout(m)}
        style={[
          { marginHorizontal: 16, borderRadius: RADIUS, shadowColor: '#000', shadowOffset: { width: 0, height: 6 } },
          Platform.OS === 'android' ? { elevation: focused ? 10 : 6, backgroundColor: p.raised } : null,
          bubble,
        ]}
      >
        <Glass radius={RADIUS} visible={visible}>
          <View style={{ padding: PAD, gap: 6 }}>
            {chip || attachments.length ? (
              <Animated.View entering={enter(m)} exiting={exit(m)} layout={layout(m)}>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 6, paddingHorizontal: 4, paddingTop: 2 }}>
                  {chip ? (
                    <Animated.View key={chip} entering={enter(m)} exiting={exit(m)} layout={layout(m, 'small')}>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`To ${chip}. Change who it goes to`}
                        onPress={pickTo}
                        style={({ pressed }) => [styles.smallChip, { backgroundColor: to ? p.tintBg : pressed ? p.raised : p.hover }]}
                      >
                        <T v="label" style={{ color: to ? p.tintFg : p.textSecondary }} numberOfLines={1}>{to ? `To ${chip}` : chip}</T>
                        <ChevronDownIcon color={to ? p.tintFg : p.textMuted} size={12} />
                      </Pressable>
                    </Animated.View>
                  ) : null}
                  {attachments.map((a) => (
                    <Animated.View key={a.id} entering={listIn(m, 0, 'small')} exiting={exit(m)} layout={layout(m, 'small')}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${a.label}`} onPress={() => store.detach(a.id)} style={[styles.smallChip, { backgroundColor: p.hover, paddingRight: 6 }]}>
                        <T v="monoSmall" tone="secondary">{a.label}</T>
                        <CloseIcon color={p.textMuted} size={12} />
                      </Pressable>
                    </Animated.View>
                  ))}
                </ScrollView>
              </Animated.View>
            ) : null}

            <View style={styles.row}>
              {/* mode chip: its width follows its label */}
              <Animated.View layout={layout(m, 'small')} onLayout={(e) => onChip(PAD + e.nativeEvent.layout.x + e.nativeEvent.layout.width / 2)}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Mode: ${MODE_LABEL[mode]}. Change mode`}
                  onPress={onMenu}
                  hitSlop={4}
                  style={({ pressed }) => [styles.modeChip, { backgroundColor: pressed ? p.raised : p.hover }]}
                >
                  <ModeIcon mode={mode} color={p.text} size={14} />
                  <Animated.View key={mode} entering={enter(m)} exiting={exit(m)}>
                    <T v="label">{MODE_LABEL[mode]}</T>
                  </Animated.View>
                  <ChevronDownIcon color={p.textMuted} size={12} />
                </Pressable>
              </Animated.View>

              <View style={{ flex: 1, justifyContent: 'center', minHeight: 40 }}>
                {!draft ? (
                  <Animated.View key={placeholder} entering={enter(m)} exiting={exit(m)} pointerEvents="none" style={{ position: 'absolute', left: 4, right: 0 }}>
                    <T v="body" numberOfLines={1} style={{ color: listening === 'on' ? p.signal : p.textMuted }}>{placeholder}</T>
                  </Animated.View>
                ) : null}
                <AnimatedInput
                  ref={inputRef}
                  value={draft}
                  onChangeText={store.setDraft}
                  onFocus={() => {
                    haptic.light();
                    setFocused(true);
                  }}
                  onBlur={() => setFocused(false)}
                  onContentSizeChange={(e) => setContentH(e.nativeEvent.contentSize.height)}
                  multiline
                  // web renders a multiline field two rows tall; native grows from one line on its own
                  numberOfLines={Platform.OS === 'web' ? 1 : undefined}
                  scrollEnabled={contentH > LINE_H * MAX_LINES}
                  submitBehavior="submit"
                  returnKeyType="send"
                  onSubmitEditing={send}
                  keyboardAppearance={p.scheme}
                  selectionColor={p.signal}
                  cursorColor={p.signal}
                  style={[styles.input, { color: p.text, fontFamily: font.sans }, field]}
                  accessibilityLabel={placeholder}
                />
              </View>

              <Pressable accessibilityRole="button" accessibilityLabel="Attach" onPress={() => { haptic.select(); router.push('/compose/attach'); }} hitSlop={6} style={styles.round}>
                <PlusIcon color={p.textSecondary} size={19} />
              </Pressable>

              <Pressable
                accessibilityRole="button"
                accessibilityLabel={hasText ? 'Send' : 'Voice input (preview)'}
                onPress={hasText ? send : voice}
                disabled={hasText && !to}
                hitSlop={8}
                style={styles.round}
              >
                <Animated.View style={[StyleSheet.absoluteFill, styles.center, micStyle]}>
                  <Listening on={listening === 'on'} />
                  <MicIcon color={listening === 'on' ? p.signal : p.textSecondary} size={19} />
                </Animated.View>
                <Animated.View style={[StyleSheet.absoluteFill, styles.center, styles.roundFill, { backgroundColor: to ? p.accent : p.raised }, sendStyle]}>
                  <ArrowUpIcon color={to ? p.onAccent : p.textMuted} size={17} strokeWidth={1.8} />
                </Animated.View>
              </Pressable>
            </View>
          </View>
        </Glass>
        {/* the hairline edge, lime while focused */}
        <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth * 2 }, edge]} />
      </Animated.View>
    </View>
  );
}

// ---- The mode menu: grows out of the chip, one menu, four modes ----

export function ModeMenu({ onPick, originX }: { onPick: (mode: Mode) => void; originX: number }) {
  const p = usePalette();
  const m = useMotion();
  const store = useStore();
  const current = store.state.composer.mode;
  return (
    <Animated.View entering={grow(m)} exiting={shrink(m)} style={{ marginHorizontal: 16, marginBottom: 10, transformOrigin: [originX, '100%', 0] }}>
      <Glass radius={22} interactive>
        <View style={{ paddingVertical: 6 }}>
          {MODES.map((x, i) => (
            <Animated.View key={x.mode} entering={listIn(m, i + 1, 'small')}>
              <Pressable
                accessibilityRole="menuitem"
                accessibilityState={{ selected: x.mode === current }}
                onPress={() => onPick(x.mode)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11, backgroundColor: pressed ? p.hover : 'transparent' })}
              >
                <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: p.hover }}>
                  <ModeIcon mode={x.mode} color={p.text} size={16} />
                </View>
                <View style={{ flex: 1 }}>
                  <T v="calloutMedium">{x.label}</T>
                  <T v="caption" tone="muted">{x.hint}</T>
                </View>
                {x.mode === current ? (
                  <Animated.View entering={enter(m)} exiting={exit(m)}>
                    <CheckIcon color={p.signal} size={18} strokeWidth={1.8} />
                  </Animated.View>
                ) : null}
              </Pressable>
            </Animated.View>
          ))}
        </View>
      </Glass>
    </Animated.View>
  );
}

// ---- "@" people and agents, "/" connectors ----

function Suggest() {
  const p = usePalette();
  const m = useMotion();
  const store = useStore();
  const { ws } = store;
  const draft = store.state.draft;
  const token = draft.match(/(^|\s)([@/])([\w-]*)$/);

  const rows = useMemo(() => {
    if (!token) return [];
    const q = token[3].toLowerCase();
    if (token[2] === '/') {
      return ws.connectors
        .filter((c) => c.name.toLowerCase().startsWith(q))
        .map((c) => ({ key: c.name, insert: `/${c.name.replace(/\s+/g, '')}`, title: c.name, sub: `${c.source} · connector`, lead: <HashIcon color={p.textSecondary} size={14} /> }));
    }
    const people = ws.members
      .filter((x) => firstName(x.name).toLowerCase().startsWith(q))
      .map((x) => ({ key: x.id, insert: `@${firstName(x.name)}`, title: x.name, sub: clockFor(x).working ? `${x.role} · working now` : x.role, lead: <Face initials={x.initials} size={24} on={clockFor(x).working} /> }));
    const agents = agentsFor(ws)
      .filter((a) => a.name.toLowerCase().replace(/\s+/g, '').startsWith(q))
      .map((a) => ({ key: a.id, insert: `@${a.name.replace(/\s+/g, '')}`, title: `${a.name}`, sub: `${ownerName(a.owner, ws)} · ${a.state}`, lead: <StatusDot status={AGENT_DOT[a.state]} /> }));
    return [...people, ...agents].slice(0, 5);
  }, [token, ws, p.textSecondary]);

  if (!rows.length) return null;
  const pick = (insert: string) => {
    haptic.select();
    store.setDraft(draft.replace(/([@/])([\w-]*)$/, `${insert} `));
  };
  return (
    <Animated.View entering={enter(m, 'medium')} exiting={exit(m, 'medium')} layout={layout(m)} style={{ marginHorizontal: 16, marginBottom: 10 }}>
      <View style={{ borderRadius: radius.xl, backgroundColor: p.raised, paddingVertical: 4, overflow: 'hidden' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 4 }}>
          {token?.[2] === '@' ? <AtIcon color={p.textMuted} size={13} /> : <HashIcon color={p.textMuted} size={13} />}
          <T v="caption" tone="muted">{token?.[2] === '@' ? 'People and agents' : 'Connectors'}</T>
        </View>
        {rows.map((r, i) => (
          <Animated.View key={r.key} entering={listIn(m, i, 'small')} exiting={exit(m)} layout={layout(m, 'small')}>
            <Pressable onPress={() => pick(r.insert)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 9, backgroundColor: pressed ? p.hover : 'transparent' })}>
              <View style={{ width: 24, alignItems: 'center' }}>{r.lead}</View>
              <T v="callout" numberOfLines={1} style={{ flexShrink: 1 }}>{r.title}</T>
              <T v="caption" tone="muted" numberOfLines={1} style={{ flex: 1, textAlign: 'right' }}>{r.sub}</T>
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </Animated.View>
  );
}

/** Ways to start, shown above the composer while it is empty. */
function Starters() {
  const p = usePalette();
  const m = useMotion();
  const { ws, setDraft, send, setMode, setRecipient, state } = useStore();
  const someone = useMemo(() => ws.members.find((x) => clockFor(x).working) ?? ws.members[0], [ws]);
  const items: [string, () => void][] = [
    ...(state.composer.to?.kind === 'opsaip' ? [['What needs me?', () => send('What needs me right now?')] as [string, () => void]] : []),
    ...(someone ? [[`Give ${firstName(someone.name)} a task`, () => { setMode('task'); setRecipient({ kind: 'person', id: someone.id }); }] as [string, () => void]] : []),
    ['Type @ or /', () => setDraft(`${state.draft}@`)],
  ];
  return (
    <Animated.View entering={enter(m)} exiting={exit(m)} style={{ marginBottom: 10 }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}>
        {items.map(([label, run], i) => (
          <Animated.View key={label} entering={listIn(m, i, 'small')}>
            <Pressable
              onPress={() => {
                haptic.select();
                run();
              }}
              style={({ pressed }) => ({ height: 34, paddingHorizontal: 14, borderRadius: 17, justifyContent: 'center', backgroundColor: pressed ? p.raised : p.surface })}
            >
              <T v="callout">{label}</T>
            </Pressable>
          </Animated.View>
        ))}
      </ScrollView>
    </Animated.View>
  );
}

/** A lime ring breathing around the mic while "listening" (voice is a preview). */
function Listening({ on }: { on: boolean }) {
  const p = usePalette();
  const m = useMotion();
  const v = useSharedValue(0);
  useEffect(() => {
    v.value = on ? pulse(0.35, 1, AMBIENT.listen, m.reduced) : fadeTo(0);
  }, [on, m.reduced, v]);
  const ring = useAnimatedStyle(() => ({ opacity: v.value * 0.5, transform: [{ scale: 1 + v.value * 0.28 }] }));
  return <Animated.View pointerEvents="none" style={[styles.roundFill, StyleSheet.absoluteFill, { borderWidth: 1.5, borderColor: p.signal }, ring]} />;
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 4 },
  input: { fontSize: 16, lineHeight: LINE_H, paddingTop: 0, paddingBottom: 0, paddingHorizontal: 4, marginVertical: 9 },
  round: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  roundFill: { borderRadius: 20 },
  center: { alignItems: 'center', justifyContent: 'center' },
  modeChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 40, paddingHorizontal: 12, borderRadius: 20, overflow: 'hidden' },
  smallChip: { flexDirection: 'row', alignItems: 'center', gap: 5, height: 26, paddingHorizontal: 10, borderRadius: 13 },
});
