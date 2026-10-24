// Every agent in the open workspace, optionally only one state (from Team's stats).

import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import type { AgentState } from '../data/types';
import { useStore } from '../state/store';
import { ownerName } from '../lib/compose';
import { AGENT_DOT, AGENT_STATE_LABEL } from '../mocks/agents';
import { Group, Row, SheetPage, SheetTitle, minutesAgo } from '../components/Sheet';
import { StatusDot } from '../components/Dots';

const ORDER: AgentState[] = ['waiting', 'failed', 'running', 'idle', 'done'];

export default function AgentsSheet() {
  const router = useRouter();
  const { state } = useLocalSearchParams<{ state?: AgentState }>();
  const { ws } = useStore();
  const shown = state ? [state] : ORDER;
  const total = ws.agents.filter((a) => shown.includes(a.state)).length;
  return (
    <SheetPage>
      <SheetTitle title={state ? AGENT_STATE_LABEL[state] : 'Agents'} sub={`${ws.name} · ${total} ${total === 1 ? 'agent' : 'agents'}`} />
      {shown.map((s) => {
        const list = ws.agents.filter((a) => a.state === s);
        if (!list.length) return null;
        return (
          <Group key={s} title={state ? undefined : AGENT_STATE_LABEL[s]}>
            {list.map((a) => (
              <Row
                key={a.id}
                icon={<View style={{ width: 28, alignItems: 'center' }}><StatusDot status={AGENT_DOT[a.state]} /></View>}
                title={`${a.name} · ${ownerName(a.owner, ws)}`}
                sub={a.runs[0] && a.state !== 'idle' ? a.runs[0].title : `Seen ${minutesAgo(a.lastSeen)}`}
                chevron
                onPress={() => router.push({ pathname: '/agent/[id]', params: { id: a.id } })}
              />
            ))}
          </Group>
        );
      })}
    </SheetPage>
  );
}
