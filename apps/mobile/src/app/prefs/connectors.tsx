// Settings › Connectors: read-only, with where each comes from and when it last
// reported in. Managing them is on desktop.

import { View } from 'react-native';
import { useRouter } from 'expo-router';
import { useStore } from '../../state/store';
import { usePalette } from '../../theme/theme';
import { Group, Row, SheetPage, minutesAgo } from '../../components/Sheet';
import { ArrowUpRightIcon, DesktopIcon } from '../../components/Icons';

export default function ConnectorsPage() {
  const p = usePalette();
  const router = useRouter();
  const { ws } = useStore();
  return (
    <SheetPage style={{ paddingTop: 16 }}>
      <Group title={ws.name} footer="In the team kit: every teammate’s agents should reach it.">
        {ws.connectors.map((c) => (
          <Row
            key={c.name}
            icon={<View style={{ width: 10, height: 10, borderRadius: 5, marginHorizontal: 9, backgroundColor: c.lastSeen < 60 ? p.signal : p.border }} />}
            title={c.name}
            sub={`${c.source}${c.inKit ? ' · in the team kit' : ''}`}
            value={minutesAgo(c.lastSeen)}
          />
        ))}
      </Group>
      <Group>
        <Row
          icon={<DesktopIcon color={p.textSecondary} size={18} />}
          title="Manage on desktop"
          right={<ArrowUpRightIcon color={p.textMuted} size={16} />}
          onPress={() => router.push({ pathname: '/desktop', params: { title: 'Connectors are set up on desktop', text: 'Adding, removing and granting access to connectors happens in Opsaip on your computer.' } })}
        />
      </Group>
    </SheetPage>
  );
}
