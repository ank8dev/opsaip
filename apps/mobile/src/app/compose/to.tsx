// Who it goes to, for the composer's current mode: a teammate (Task), a channel or
// a person (Message), an agent with its owner and status (Agent), or everyone
// (Announce).

import { View } from 'react-native';
import { useRouter } from 'expo-router';
import type { Recipient } from '../../data/types';
import { clockFor, firstName } from '../../data/shared';
import { useStore } from '../../state/store';
import { T, usePalette } from '../../theme/theme';
import { MODE_LABEL, agentsFor, ownerName, sameRecipient } from '../../lib/compose';
import { fromMinutes } from '../../lib/time';
import { AGENT_DOT, AGENT_STATE_LABEL } from '../../mocks/agents';
import { Group, Row, SheetPage, SheetTitle } from '../../components/Sheet';
import { Face, WorkspaceTile } from '../../components/Face';
import { StatusDot } from '../../components/Dots';
import { Baton } from '../../components/Baton';
import { HashIcon } from '../../components/Icons';
import { ModeIcon } from '../../components/Composer';
import { Check } from '../../components/Animated';

export default function RecipientSheet() {
  const p = usePalette();
  const router = useRouter();
  const { ws, state, setRecipient } = useStore();
  const { mode, to } = state.composer;

  const pick = (r: Recipient) => {
    setRecipient(r);
    router.back();
  };
  const check = (r: Recipient) => <Check on={sameRecipient(r, to)} />;

  const people = (
    <Group title="People">
      {ws.members.map((x) => {
        const c = clockFor(x);
        const r: Recipient = { kind: 'person', id: x.id };
        return (
          <Row
            key={x.id}
            icon={<Face initials={x.initials} size={32} on={c.working} />}
            title={x.name}
            sub={`${x.role} · ${fromMinutes(c.min)} local${c.working ? '' : ' · off hours'}`}
            right={check(r)}
            onPress={() => pick(r)}
          />
        );
      })}
    </Group>
  );

  return (
    <SheetPage>
      <SheetTitle
        title={mode === 'announce' ? 'Announce to' : mode === 'agent' ? 'Which agent?' : mode === 'task' ? 'Whose task?' : 'Send to'}
        sub={`${MODE_LABEL[mode]} · ${ws.name}`}
        lead={
          <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: p.surface }}>
            <ModeIcon mode={mode} color={p.text} size={20} />
          </View>
        }
      />

      {mode === 'agent' ? (
        <>
          <Group footer="Opsaip answers itself, or hands the work to one of your agents.">
            <Row icon={<View style={{ width: 32, alignItems: 'center' }}><Baton height={24} live={false} /></View>} title="Opsaip" sub="Your manager across workspaces" right={check({ kind: 'opsaip' })} onPress={() => pick({ kind: 'opsaip' })} />
          </Group>
          {(['mine', 'theirs'] as const).map((group) => {
            const list = agentsFor(ws).filter((a) => (group === 'mine' ? a.owner === 'me' : a.owner !== 'me'));
            if (!list.length) return null;
            return (
              <Group key={group} title={group === 'mine' ? 'Your agents' : 'Teammates’ agents'}>
                {list.map((a) => {
                  const r: Recipient = { kind: 'agent', id: a.id };
                  return (
                    <Row
                      key={a.id}
                      icon={<View style={{ width: 32, alignItems: 'center' }}><StatusDot status={AGENT_DOT[a.state]} /></View>}
                      title={a.name}
                      sub={`${ownerName(a.owner, ws)} · ${AGENT_STATE_LABEL[a.state]}${a.runs[0] && a.state !== 'idle' ? ` · ${a.runs[0].title}` : ''}`}
                      right={check(r)}
                      onPress={() => pick(r)}
                    />
                  );
                })}
              </Group>
            );
          })}
        </>
      ) : null}

      {mode === 'task' ? (ws.members.length ? people : <Empty text={`${ws.name} is just you. Tasks for teammates live in a team workspace.`} />) : null}

      {mode === 'message' ? (
        ws.channels.length || ws.members.length ? (
          <>
            {ws.channels.length ? (
              <Group title="Channels">
                {ws.channels.map((c) => {
                  const r: Recipient = { kind: 'channel', name: c };
                  return <Row key={c} icon={<View style={{ width: 32, alignItems: 'center' }}><HashIcon color={p.textSecondary} size={18} /></View>} title={c.slice(1)} right={check(r)} onPress={() => pick(r)} />;
                })}
              </Group>
            ) : null}
            {ws.members.length ? people : null}
          </>
        ) : (
          <Empty text="Slack isn’t connected to your personal space. Switch to a team workspace to message people." />
        )
      ) : null}

      {mode === 'announce' ? (
        <Group footer={`Posted as you to everyone in ${ws.name}, and pinned. People in quiet hours see it in their next brief.`}>
          <Row
            icon={<WorkspaceTile monogram={ws.monogram} size={32} />}
            title={`Everyone in ${ws.name}`}
            sub={ws.members.length ? `${ws.members.length} people · ${ws.members.filter((x) => clockFor(x).working).length} working now` : 'Just you'}
            right={check({ kind: 'workspace' })}
            onPress={() => pick({ kind: 'workspace' })}
          />
        </Group>
      ) : null}

      {mode !== 'announce' && ws.members.length ? (
        <T v="caption" tone="muted" style={{ paddingHorizontal: 16 }}>
          Tip: type @ in the message to mention {firstName(ws.members[0].name)} or an agent.
        </T>
      ) : null}
    </SheetPage>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <Group>
      <View style={{ padding: 16 }}>
        <T v="callout" tone="secondary">{text}</T>
      </View>
    </Group>
  );
}
