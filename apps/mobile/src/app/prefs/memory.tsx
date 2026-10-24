// Settings › My memory: what Opsaip gives your agents about you. Read-only here.

import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { ago, tessera } from '../../data/shared';
import { T, usePalette } from '../../theme/theme';
import { Group, Row, SheetPage } from '../../components/Sheet';
import { DesktopIcon } from '../../components/Icons';

export default function MemoryPage() {
  const p = usePalette();
  const router = useRouter();
  const mine = tessera.memories.filter((m) => m.scope === 'personal');
  return (
    <SheetPage style={{ paddingTop: 16 }}>
      <T v="callout" tone="secondary" style={{ paddingHorizontal: 8 }}>
        Your agents get these as context in every session. Only you see them.
      </T>
      <Group title={`${mine.length} memories`}>
        {mine.map((m) => (
          <View key={m.id} style={{ padding: 16, gap: 4 }}>
            <T v="callout">{m.fact}</T>
            <T v="monoSmall" tone="muted">{m.source.agent} · {ago(m.created)}</T>
          </View>
        ))}
      </Group>
      <Group>
        <Row
          icon={<DesktopIcon color={p.textSecondary} size={18} />}
          title="Edit or remove on desktop"
          onPress={() => router.push({ pathname: '/desktop', params: { title: 'Memories are edited on desktop', text: 'Changing what your agents remember is done in Opsaip on your computer, where you can see each session it came from.' } })}
        />
      </Group>
    </SheetPage>
  );
}
