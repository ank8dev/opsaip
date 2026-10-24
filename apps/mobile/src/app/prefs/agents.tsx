// Settings › My agents: your connected agents (read-only) and which agent each
// composer mode starts with.

import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Mode } from '../../data/types';
import { useSettings } from '../../state/settings';
import { T, usePalette } from '../../theme/theme';
import { MODES, myAgents } from '../../lib/compose';
import { AGENT_DOT, AGENT_STATE_LABEL } from '../../mocks/agents';
import { Choices, Group, Row, SheetPage, minutesAgo } from '../../components/Sheet';
import { StatusDot } from '../../components/Dots';
import { ModeIcon } from '../../components/Composer';

const FOR: Record<Mode, string> = {
  task: 'Teammates’ tasks run on',
  message: 'Drafts messages',
  agent: 'Agent mode starts with',
  announce: 'Drafts announcements',
};

export default function MyAgentsPage() {
  const p = usePalette();
  const router = useRouter();
  const { settings, set } = useSettings();
  const mine = myAgents();
  const names = mine.map((a) => a.name);

  return (
    <SheetPage style={{ paddingTop: 16 }}>
      <Group title="Connected" footer="Connect or remove agents on desktop.">
        {mine.map((a) => (
          <Row
            key={a.id}
            icon={<View style={{ width: 28, alignItems: 'center' }}><StatusDot status={AGENT_DOT[a.state]} /></View>}
            title={a.name}
            sub={`${AGENT_STATE_LABEL[a.state]} · seen ${minutesAgo(a.lastSeen)}`}
            chevron
            onPress={() => router.push({ pathname: '/agent/[id]', params: { id: a.id } })}
          />
        ))}
      </Group>

      <Group title="Default agent per mode">
        {MODES.map(({ mode }) => {
          const options = mode === 'task' ? ['Their default', ...names] : names;
          return (
            <View key={mode} style={{ padding: 16, gap: 10 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <ModeIcon mode={mode} color={p.textSecondary} size={14} />
                <T v="caption" tone="muted">{FOR[mode]}</T>
              </View>
              <Choices value={settings.defaultAgent[mode]} options={options} onChange={(o) => set('defaultAgent', { ...settings.defaultAgent, [mode]: o })} />
            </View>
          );
        })}
      </Group>
    </SheetPage>
  );
}
