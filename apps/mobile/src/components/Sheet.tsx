// The parts every sheet and settings page is built from: a scrolling page, a title,
// grouped iOS-style sections and their rows. Surface tone, no outlines.

import { useEffect, type ReactNode } from 'react';
import { Pressable, ScrollView, Switch, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { T, useMotion, usePalette } from '../theme/theme';
import { radius } from '../theme/tokens';
import { layout, springTo } from '../theme/motion';
import { haptic } from '../lib/haptics';
import { ChevronRightIcon } from './Icons';
import { SelectChip, Swap } from './Animated';

export function SheetPage({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <ScrollView
      showsVerticalScrollIndicator={false}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[{ paddingTop: 28, paddingBottom: 48, paddingHorizontal: 16, gap: 24 }, style]}
    >
      {children}
    </ScrollView>
  );
}

export function SheetTitle({ title, sub, lead }: { title: string; sub?: string; lead?: ReactNode }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 8 }}>
      {lead}
      <View style={{ flex: 1, gap: 3 }}>
        <T v="title">{title}</T>
        {sub ? <T v="callout" tone="secondary">{sub}</T> : null}
      </View>
    </View>
  );
}

export function Group({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const p = usePalette();
  const m = useMotion();
  return (
    <View>
      {title ? <T v="label" tone="muted" style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{title}</T> : null}
      <Animated.View layout={layout(m)} style={{ borderRadius: radius.xl, backgroundColor: p.surface, overflow: 'hidden' }}>
        {children}
      </Animated.View>
      {footer ? <T v="caption" tone="muted" style={{ paddingHorizontal: 16, paddingTop: 8 }}>{footer}</T> : null}
    </View>
  );
}

export function Row({
  icon,
  title,
  sub,
  value,
  right,
  chevron,
  open,
  onPress,
  tone,
}: {
  icon?: ReactNode;
  title: string;
  sub?: string;
  value?: string;
  right?: ReactNode;
  chevron?: boolean;
  open?: boolean;
  onPress?: () => void;
  tone?: 'error';
}) {
  const p = usePalette();
  return (
    <Pressable
      disabled={!onPress}
      onPress={onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16, paddingVertical: 10,
        backgroundColor: pressed ? p.hover : 'transparent',
      })}
    >
      {icon}
      <View style={{ flex: 1, gap: 1 }}>
        <T v="callout" tone={tone === 'error' ? 'error' : 'text'} numberOfLines={2}>{title}</T>
        {sub ? <T v="caption" tone="muted" numberOfLines={2}>{sub}</T> : null}
      </View>
      {value ? <T v="callout" tone="secondary" numberOfLines={1}>{value}</T> : null}
      {right}
      {chevron ? <Chevron open={!!open} /> : null}
    </Pressable>
  );
}

/** Turns down when its row opens, never jumps. */
export function Chevron({ open }: { open: boolean }) {
  const p = usePalette();
  const m = useMotion();
  const deg = useSharedValue(0);
  useEffect(() => {
    deg.value = springTo(open ? 90 : 0, 'small');
  }, [open, m.base, deg]);
  const s = useAnimatedStyle(() => ({ transform: [{ rotate: `${deg.value}deg` }] }));
  return (
    <Animated.View style={s}>
      <ChevronRightIcon color={p.textMuted} size={16} />
    </Animated.View>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  const p = usePalette();
  return (
    <Switch
      value={on}
      onValueChange={(v) => {
        haptic.select();
        onChange(v);
      }}
      trackColor={{ false: p.track, true: p.accent }}
      ios_backgroundColor={p.track}
    />
  );
}

/** A small segmented control with a sliding thumb. */
export function Segmented<V extends string>({ value, options, onChange }: { value: V; options: [V, string][]; onChange: (v: V) => void }) {
  const p = usePalette();
  const m = useMotion();
  const w = useSharedValue(0);
  const i = Math.max(options.findIndex(([v]) => v === value), 0);
  const x = useSharedValue(i);
  useEffect(() => {
    x.value = springTo(i, 'small');
  }, [i, m.base, x]);
  const n = options.length;
  const thumb = useAnimatedStyle(() => ({ width: w.value / n - 6, transform: [{ translateX: (x.value * w.value) / n }] }));
  return (
    <View onLayout={(e) => w.set(e.nativeEvent.layout.width)} style={{ flexDirection: 'row', height: 38, borderRadius: 12, backgroundColor: p.hover }}>
      <Animated.View style={[{ position: 'absolute', top: 3, bottom: 3, left: 3, borderRadius: 10, backgroundColor: p.raised }, thumb]} />
      {options.map(([v, label]) => (
        <Pressable
          key={v}
          accessibilityRole="button"
          accessibilityState={{ selected: v === value }}
          onPress={() => {
            if (v === value) return;
            haptic.select();
            onChange(v);
          }}
          style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}
        >
          <Swap id={`${v}-${v === value}`}>
            <T v="calloutMedium" tone={v === value ? 'text' : 'secondary'} numberOfLines={1}>{label}</T>
          </Swap>
        </Pressable>
      ))}
    </View>
  );
}

/** "2m ago", "3h ago", "2d ago" from minutes. */
export function minutesAgo(min: number): string {
  if (min < 1) return 'just now';
  if (min < 60) return `${Math.round(min)}m ago`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

/** Chips for one choice that you can change again: the picked one is tinted. */
export function Choices({ value, options, onChange }: { value: string; options: string[]; onChange: (v: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => (
        <SelectChip
          key={o}
          label={o}
          on={o === value}
          height={34}
          onPress={() => {
            if (o === value) return;
            haptic.select();
            onChange(o);
          }}
        />
      ))}
    </View>
  );
}
