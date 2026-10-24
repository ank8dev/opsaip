// An agent: who runs it, what it is on now, its recent runs and the connectors it
// can reach. You can hand it work; setup and access stay on desktop.

import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useStore } from '../../state/store';
import { T, usePalette } from '../../theme/theme';
import { findAgent, ownerName } from '../../lib/compose';
import { AGENT_DOT, AGENT_STATE_LABEL } from '../../mocks/agents';
import { Group, Row, SheetPage, SheetTitle, minutesAgo } from '../../components/Sheet';
import { Button } from '../../components/Button';
import { Face } from '../../components/Face';
import { StatusDot } from '../../components/Dots';
import { DesktopIcon, TerminalIcon } from '../../components/Icons';
import { Facts } from '../../components/thread/parts';

export default function AgentSheet() {
  const p = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const found = findAgent(id);
  if (!found) return null;
  const { agent: a, ws } = found;
  const owner = ws.members.find((x) => x.id === a.owner);
  const [now, ...past] = a.runs;
  const here = store.ws.id === ws.id || a.owner === 'me';

  const giveWork = () => {
    router.back();
    setTimeout(() => {
      store.setMode('agent');
      store.setRecipient({ kind: 'agent', id: a.id });
      store.focusComposer();
    }, 320);
  };

  return (
    <SheetPage>
      <SheetTitle
        title={a.name}
        sub={`${a.owner === 'me' ? 'Yours' : `${ownerName(a.owner, ws)}’s`} · ${AGENT_STATE_LABEL[a.state]} · seen ${minutesAgo(a.lastSeen)}`}
        lead={
          <View style={{ width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface }}>
            <TerminalIcon color={p.text} size={24} />
          </View>
        }
      />

      {owner ? (
        <Group>
          <Row icon={<Face initials={owner.initials} size={32} />} title={owner.name} sub={owner.role} chevron onPress={() => router.push({ pathname: '/person/[id]', params: { id: owner.id } })} />
        </Group>
      ) : null}

      <Group title={a.state === 'idle' ? 'Now' : 'Current run'}>
        {now ? (
          <Row
            icon={<View style={{ width: 32, alignItems: 'center' }}><StatusDot status={AGENT_DOT[now.state]} /></View>}
            title={now.title}
            sub={[now.repo, now.branch, now.steps[now.steps.length - 1]?.text].filter(Boolean).join(' · ')}
            chevron
            onPress={() => router.push({ pathname: '/run/[id]', params: { id: now.id } })}
          />
        ) : (
          <View style={{ padding: 16 }}>
            <T v="callout" tone="secondary">Idle. It picks up the next task you or {a.owner === 'me' ? 'Opsaip' : ownerName(a.owner, ws)} give it.</T>
          </View>
        )}
      </Group>

      {past.length ? (
        <Group title="Recent runs">
          {past.map((r) => (
            <Row
              key={r.id}
              icon={<View style={{ width: 32, alignItems: 'center' }}><StatusDot status={AGENT_DOT[r.state]} /></View>}
              title={r.title}
              sub={AGENT_STATE_LABEL[r.state]}
              chevron
              onPress={() => router.push({ pathname: '/run/[id]', params: { id: r.id } })}
            />
          ))}
        </Group>
      ) : null}

      <View style={{ gap: 10, paddingHorizontal: 8 }}>
        <T v="label" tone="muted">Can reach</T>
        <Facts facts={a.connectors} all />
      </View>

      <View style={{ gap: 12 }}>
        {here ? <Button label={`Give ${a.name} a task`} kind="primary" onPress={giveWork} /> : null}
        <Button
          label="Change its access"
          icon={<DesktopIcon color={p.text} size={15} />}
          onPress={() => router.push({ pathname: '/desktop', params: { title: 'Agent access is set on desktop', text: `Which repos and connectors ${a.name} can reach is part of the team kit. Change it in Opsaip on your computer.` } })}
        />
      </View>
    </SheetPage>
  );
}
