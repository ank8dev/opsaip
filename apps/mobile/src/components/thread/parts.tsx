// Small pieces every thread card shares: the surface, the one meta line, at most two
// facts, the desktop hint, quick replies and the diff summary the details sheet uses.

import type { ReactNode } from 'react';
import { useRouter } from 'expo-router';
import { Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated from 'react-native-reanimated';
import { T, useMotion, usePalette } from '../../theme/theme';
import { radius } from '../../theme/tokens';
import { exit, layout, listIn } from '../../theme/motion';
import { timeOf } from '../../lib/time';
import { useStore } from '../../state/store';
import { ChevronRightIcon, DesktopIcon } from '../Icons';
import { Face } from '../Face';
import { SelectChip } from '../Animated';

export { timeOf };

/** A card is a quiet surface: tone, not outline. */
export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const p = usePalette();
  return <View style={[{ borderRadius: radius.xl + 2, backgroundColor: p.surface, padding: 18, gap: 14 }, style]}>{children}</View>;
}

/** The workspace an item belongs to — only shown from your personal space, or when it is not this one's. */
export function useWorkspaceLabel(ws?: string): string | null {
  const store = useStore();
  const own = ws ?? store.ws.id;
  if (store.ws.kind !== 'personal' && own === store.ws.id) return null;
  return store.spaces.find((w) => w.id === own)?.name ?? null;
}

/** One line: avatar, "Aiko · Codex · 8:32 AM", and the workspace when it matters. */
export function Meta({ initials, who, at, ws }: { initials?: string; who: string; at: number; ws?: string }) {
  const p = usePalette();
  const label = useWorkspaceLabel(ws);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      {initials ? <Face initials={initials} size={22} /> : null}
      <T v="caption" tone="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
        {who} · {timeOf(at)}
      </T>
      {label ? (
        <View style={{ paddingHorizontal: 6, height: 18, borderRadius: 5, justifyContent: 'center', backgroundColor: p.hover }}>
          <T v="monoSmall" tone="secondary" style={{ fontSize: 10, lineHeight: 13 }}>{label}</T>
        </View>
      ) : null}
    </View>
  );
}

/** At most two facts; the rest are behind "Details". */
export function Facts({ facts, onDetails, all }: { facts: string[]; onDetails?: () => void; all?: boolean }) {
  const p = usePalette();
  const m = useMotion();
  const shown = all ? facts : facts.slice(0, 2);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {shown.map((f, i) => (
        <Animated.View key={f} entering={listIn(m, i, 'small')} layout={layout(m, 'small')} style={{ paddingHorizontal: 8, height: 24, borderRadius: 7, justifyContent: 'center', backgroundColor: p.hover }}>
          <T v="monoSmall" tone="secondary">{f}</T>
        </Animated.View>
      ))}
      {onDetails ? (
        <Animated.View exiting={exit(m)}>
          <Pressable accessibilityRole="button" onPress={onDetails} hitSlop={10} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', paddingLeft: 4, opacity: pressed ? 0.6 : 1 })}>
            <T v="label" tone="secondary">Details</T>
            <ChevronRightIcon color={p.textSecondary} size={14} />
          </Pressable>
        </Animated.View>
      ) : null}
    </View>
  );
}

/** A small desktop icon next to an action. What stays on desktop is said only on tap, in a sheet. */
export function DesktopHint({ text, title = 'This part is on desktop' }: { text: string; title?: string }) {
  const p = usePalette();
  const router = useRouter();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="What stays on desktop"
      accessibilityHint={text}
      onPress={() => router.push({ pathname: '/desktop', params: { title, text } })}
      hitSlop={10}
      style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? p.hover : 'transparent' })}
    >
      <DesktopIcon color={p.textMuted} size={16} />
    </Pressable>
  );
}

/** Quick replies. Once one is picked it stays, tinted, and the others fade away. */
export function Replies({ options, picked, onPick }: { options: string[]; picked?: string; onPick: (o: string) => void }) {
  const m = useMotion();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) =>
        !picked || picked === o ? (
          <Animated.View key={o} layout={layout(m)} exiting={exit(m)}>
            <SelectChip label={o} on={picked === o} disabled={!!picked} onPress={() => onPick(o)} />
          </Animated.View>
        ) : null,
      )}
    </View>
  );
}

/** A quiet text action: the one secondary choice on a card. */
export function TextAction({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} disabled={disabled} hitSlop={12} style={({ pressed }) => ({ paddingVertical: 8, opacity: disabled ? 0.4 : pressed ? 0.55 : 1 })}>
      <T v="calloutMedium" tone="secondary">{label}</T>
    </Pressable>
  );
}

/** Files, their +/− and a proportional bar — enough to judge on a phone. */
export function DiffSummary({ files }: { files: { path: string; add: number; del: number }[] }) {
  const p = usePalette();
  const max = Math.max(...files.map((f) => f.add + f.del), 1);
  return (
    <View style={{ gap: 8 }}>
      {files.map((f) => {
        const name = f.path.split('/').pop() ?? f.path;
        const dir = f.path.slice(0, f.path.length - name.length);
        return (
          <View key={f.path} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <T v="mono" numberOfLines={1} style={{ flex: 1 }}>
              <T v="mono" tone="muted">{dir}</T>
              {name}
            </T>
            <T v="monoSmall" tone="signal" style={{ width: 34, textAlign: 'right' }}>+{f.add}</T>
            <T v="monoSmall" tone="muted" style={{ width: 30, textAlign: 'right' }}>−{f.del}</T>
            <View style={{ width: 44, height: 4, borderRadius: 2, backgroundColor: p.track, flexDirection: 'row', overflow: 'hidden' }}>
              <View style={{ width: (44 * f.add) / max, backgroundColor: p.signal }} />
              <View style={{ width: (44 * f.del) / max, backgroundColor: p.borderControl }} />
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** What the phone does not do, on screens that explain it (sheets, Team). */
export function DesktopNote({ text }: { text: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 2 }}>
      <DesktopIcon color={p.textMuted} size={15} />
      <T v="caption" tone="muted" style={{ flex: 1 }}>{text}</T>
    </View>
  );
}
