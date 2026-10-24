// A teammate: working hours, their agents, the connectors those agents reach, and
// what they are missing from the team kit. You can hand them a task; roles and repo
// rights stay on desktop.

import { View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { clockFor, firstName, missingFromKit, tessera } from '../../data/shared';
import { useStore } from '../../state/store';
import { T, usePalette } from '../../theme/theme';
import { clock, fromMinutes } from '../../lib/time';
import { AGENT_DOT, AGENT_STATE_LABEL } from '../../mocks/agents';
import { Group, Row, SheetPage, minutesAgo } from '../../components/Sheet';
import { Face } from '../../components/Face';
import { StatusDot } from '../../components/Dots';
import { Button } from '../../components/Button';
import { ComposeIcon, DesktopIcon } from '../../components/Icons';
import { Facts } from '../../components/thread/parts';

export default function PersonSheet() {
  const p = usePalette();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const store = useStore();
  const { ws } = store;
  const person = ws.members.find((x) => x.id === id);
  if (!person) return null;

  const c = clockFor(person);
  const first = firstName(person.name);
  const agents = ws.agents.filter((a) => a.owner === person.id);
  const reach = [...new Set(agents.flatMap((a) => a.connectors))];
  const missing = ws.id === 'tessera' ? missingFromKit(tessera, person.id).map((k) => k.name) : ws.connectors.filter((k) => k.inKit && !reach.includes(k.name)).map((k) => k.name);

  return (
    <SheetPage>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 8 }}>
        <Face initials={person.initials} size={56} on={c.working} ring={p.surface} />
        <View style={{ flex: 1, gap: 2 }}>
          <T v="title">{person.name}</T>
          <T v="callout" tone="secondary">{person.role}</T>
        </View>
      </View>

      <Group title="Working hours">
        <Row title={`${clock(person.start)} – ${clock(person.end)}`} sub={person.tz.replace('_', ' ')} value={`${fromMinutes(c.min)} now`} />
        <Row title={c.working ? 'Working now' : 'Off hours'} sub={c.working ? `Until ${clock(person.end)} their time` : `Back at ${clock(person.start)} their time`} right={<View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: c.working ? p.signal : p.border }} />} />
      </Group>

      <Group title="Focus">
        <Row title={person.focus} sub={person.changing} />
      </Group>

      <Group title={`Agents · ${agents.length}`}>
        {agents.length ? (
          agents.map((a) => (
            <Row
              key={a.id}
              icon={<View style={{ width: 28, alignItems: 'center' }}><StatusDot status={AGENT_DOT[a.state]} /></View>}
              title={a.name}
              sub={a.state === 'idle' ? `Idle · seen ${minutesAgo(a.lastSeen)}` : `${AGENT_STATE_LABEL[a.state]} · ${a.runs[0]?.title ?? ''}`}
              chevron
              onPress={() => router.push({ pathname: '/agent/[id]', params: { id: a.id } })}
            />
          ))
        ) : (
          <View style={{ padding: 16 }}>
            <T v="callout" tone="secondary">No agent connected yet.</T>
          </View>
        )}
      </Group>

      <View style={{ gap: 10, paddingHorizontal: 8 }}>
        <T v="label" tone="muted">Connectors their agents reach</T>
        {reach.length ? <Facts facts={reach} all /> : <T v="callout" tone="muted">None yet.</T>}
      </View>

      <View style={{ gap: 10, paddingHorizontal: 8 }}>
        <T v="label" tone="muted">Missing from the team kit</T>
        {missing.length ? <Facts facts={missing} all /> : <T v="callout" tone="secondary">Has everything in the kit.</T>}
      </View>

      <View style={{ gap: 12 }}>
        <Button
          label={`Give ${first} a task`}
          kind="primary"
          icon={<ComposeIcon color={p.onAccent} size={16} />}
          onPress={() => {
            router.back();
            setTimeout(() => {
              store.setMode('task');
              store.setRecipient({ kind: 'person', id: person.id });
              store.focusComposer();
            }, 320);
          }}
        />
        <Button
          label="Role and repo rights"
          icon={<DesktopIcon color={p.text} size={15} />}
          onPress={() => router.push({ pathname: '/desktop', params: { title: 'Roles are set on desktop', text: `Changing ${first}’s role or repo rights is an admin action. Do it in Opsaip on your computer.` } })}
        />
      </View>
    </SheetPage>
  );
}
