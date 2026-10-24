import { View } from 'react-native';
import { T, usePalette } from '../theme/theme';
import { font } from '../theme/tokens';

/** A person: initials, and a presence dot — lime inside their work hours, hollow outside. */
export function Face({ initials, size = 36, on, ring }: { initials: string; size?: number; on?: boolean; ring?: string }) {
  const p = usePalette();
  const badge = Math.round(size * 0.3);
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size / 2,
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: p.raised, borderWidth: 1, borderColor: p.border,
      }}
    >
      <T v="label" tone="secondary" style={{ fontFamily: font.sansMedium, fontSize: Math.round(size * 0.32), lineHeight: Math.round(size * 0.4), letterSpacing: 0.3 }}>
        {initials}
      </T>
      {on !== undefined ? (
        <View
          style={{
            position: 'absolute', right: -1, bottom: -1,
            width: badge, height: badge, borderRadius: badge / 2,
            backgroundColor: on ? p.signal : ring ?? p.bg,
            borderWidth: on ? 2 : 1.5,
            borderColor: on ? ring ?? p.bg : p.textMuted,
          }}
        />
      ) : null}
    </View>
  );
}

/** A workspace tile, Slack-style: rounded square with its monogram. */
export function WorkspaceTile({ monogram, size = 30, active }: { monogram: string; size?: number; active?: boolean }) {
  const p = usePalette();
  return (
    <View
      style={{
        width: size, height: size, borderRadius: Math.round(size * 0.3),
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: active ? p.text : p.raised,
        borderWidth: active ? 0 : 1, borderColor: p.border,
      }}
    >
      <T
        v="headline"
        style={{
          color: active ? p.bg : p.text,
          fontSize: monogram.length > 1 ? Math.round(size * 0.36) : Math.round(size * 0.48),
          lineHeight: Math.round(size * 0.6),
          letterSpacing: -0.2,
        }}
      >
        {monogram}
      </T>
    </View>
  );
}
