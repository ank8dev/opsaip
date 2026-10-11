import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { AnyTask, LocalTask } from '../../types';
import { isLocal } from '../../types';
import { clockFor, firstName } from '../../data/selectors';
import { LOCAL_PREFIX, useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { Face } from '../common/Face';
import { Picker, type PickerOption } from '../common/Picker';
import { ModeMenu, type ComposeMode } from './ModeMenu';
import { QuickActions } from './QuickActions';
import { useTypingPlaceholder } from './useTypingPlaceholder';

const VERB: Record<ComposeMode, string> = { task: 'Create', message: 'Send', agent: 'Run', announce: 'Announce' };
const LABEL: Record<ComposeMode, string> = { task: 'Task', message: 'Message', agent: 'Agent task', announce: 'Announcement' };
const TO: Record<ComposeMode, string> = { task: 'For', message: 'To', agent: 'Agent', announce: 'To' };

let localSeq = 0;

/** Where you talk to Opsaip: create a task, message a teammate, start an agent, or announce. */
export function Composer({ task }: { task: AnyTask | null }) {
  const { ws, people, addLocalTask, changeTask, addMessage } = useWorkspace();
  const ui = useUi();
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const [mode, setMode] = useState<ComposeMode>('task');
  const [personId, setPersonId] = useState(ws.team[0]?.id ?? '');
  const agents = ws.mcp.filter((c) => c.direction === 'in');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [text, setText] = useState('');

  const slack = ws.channels.find((c) => c.channel === 'Slack');
  const slackOk = slack?.status === 'Connected';
  const viaSlack = mode === 'message' || mode === 'announce';
  const canSend = !viaSlack || slackOk;

  // Opening a task points the composer at it: a message to its owner.
  // Closing it brings back the mode you had before.
  const modeBefore = useRef<ComposeMode | null>(null);
  useEffect(() => {
    if (task && !isLocal(task) && people[task.owner]) {
      if (modeBefore.current === null) modeBefore.current = mode;
      setMode('message');
      setPersonId(task.owner);
    } else if (!task && modeBefore.current) {
      setMode(modeBefore.current);
      modeBefore.current = null;
    }
  }, [task?.id]); // only when the open task changes

  const typed = useTypingPlaceholder(mode === 'agent', !!text, ui.motion.reduced);
  const person = people[personId];
  const placeholder =
    mode === 'agent' ? typed
    : mode === 'message' && person
      ? task ? `Write to ${firstName(person.name)} about this task…` : `Message ${firstName(person.name)}…`
    : mode === 'task' ? 'What needs doing?'
    : mode === 'announce' ? 'What should the team know?'
    : 'Write a message';

  // The input grows with its text, up to 220px.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text, mode]);

  function prefill(value: string) {
    setText(value);
    requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(value.length, value.length);
    });
  }

  function startAgentTask(value: string) {
    const conn = agents.find((c) => c.id === agentId);
    const owner = conn ? people[conn.owner] : undefined;
    const agentName = conn ? conn.name + (owner ? ` (${firstName(owner.name)})` : '') : 'an agent';
    const id = `${LOCAL_PREFIX}${++localSeq}`;
    const local: LocalTask = {
      id, local: true, owner: 'me', priority: 'High', impact: 'Started by you',
      task: value, tool: conn?.name ?? '', status: 'Queued', detail: `Waiting for ${agentName} to pick it up`, source: 'Opsaip',
      since: new Date().toISOString(), msgs: [{ role: 'user', text: value }],
    };
    addLocalTask(local);
    ui.flashHint('Started — follow it in the sidebar under Started by you.');
    // A preview of the task's life: Queued → Working → steps → Needs you
    window.setTimeout(() => changeTask(id, { status: 'Working', detail: 'Planning the steps' }), 1400);
    window.setTimeout(() => changeTask(id, { detail: 'Reading the codebase' }, { role: 'tool', text: 'read 14 files in app/ and lib/' }), 4000);
    window.setTimeout(() => changeTask(id, { detail: 'Writing the plan' }), 6200);
    window.setTimeout(() => changeTask(id, { status: 'Needs you', detail: 'Plan ready · review it to start' }, {
      role: 'assistant', text: 'The plan is ready: 4 steps, 2 files to change, tests at the end. Approve it and I will start.',
    }), 8400);
  }

  function submit() {
    const value = text.trim();
    if (!value || !canSend) return;
    if (mode === 'message') {
      const to = person?.name ?? 'teammate';
      if (task) {
        addMessage(task.id, { role: 'user', text: value, via: `to ${to} on Slack` });
        ui.flashHint(`Preview: sent to ${firstName(to)} on Slack and added to this task. Nothing left this page.`);
      } else {
        ui.flashHint(`Preview: message to ${to} on Slack — not sent, this is a preview.`);
      }
    } else if (mode === 'announce') {
      ui.flashHint(`Preview: announcement to ${ws.team.length} teammates on Slack — not sent, this is a preview.`);
    } else if (mode === 'task') {
      const id = `${LOCAL_PREFIX}${++localSeq}`;
      addLocalTask({
        id, local: true, owner: 'me', task: value, tool: '', status: 'Queued',
        detail: `Assigned to ${person?.name ?? 'a teammate'}`, source: 'Opsaip',
        since: new Date().toISOString(), msgs: [{ role: 'user', text: value }],
      });
      ui.flashHint('Started — follow it in the sidebar under Started by you.');
    } else {
      startAgentTask(value);
    }
    setText('');
    inputRef.current?.focus();
  }

  const now = new Date();
  const personOptions: PickerOption[] = ws.team.map((p) => {
    const c = clockFor(p, now);
    return {
      value: p.id,
      label: p.name,
      detail: [p.role, (c.working ? 'At work' : 'Off hours') + (c.text ? ` · ${c.text}` : '')].join(' · '),
      lead: <Face person={p} on={c.working} />,
    };
  });
  const agentOptions: PickerOption[] = agents.map((c) => ({
    value: c.id,
    label: c.name,
    detail: [people[c.owner]?.name, c.status === 'Connected' ? '' : 'offline'].filter(Boolean).join(' · '),
  }));

  return (
    <div className="op-glowbox">
      <div className="op-ring">
        <div className="op-composer">
          <div className="op-to">
            <span>{TO[mode]}</span>
            {(mode === 'task' || mode === 'message') && (
              <Picker ariaLabel="Teammate" value={personId} options={personOptions} onChange={setPersonId} display={(o) => o.label} />
            )}
            {task && mode === 'message' && <span className="op-to-about">about “{task.task}”</span>}
            {mode === 'agent' && (
              <Picker
                ariaLabel="Agent"
                value={agentId}
                options={agentOptions}
                onChange={setAgentId}
                display={(o) => [o.label, o.detail].filter(Boolean).join(' · ')}
              />
            )}
            {mode === 'announce' && <span className="op-to-v">the whole team</span>}
            {viaSlack && (
              <>
                <span>via</span>
                <span className="op-to-v">{slack ? (slackOk ? slack.channel : `${slack.channel} · not connected`) : '—'}</span>
              </>
            )}
          </div>
          <label htmlFor="op-input" className="op-sr-only">{LABEL[mode]}</label>
          <textarea
            ref={inputRef}
            id="op-input"
            className="op-input"
            rows={1}
            placeholder={placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="op-bar">
            <ModeMenu
              mode={mode}
              onChange={(m) => { setMode(m); inputRef.current?.focus(); }}
            />
            {task && <QuickActions task={task} prefill={prefill} />}
            <span className="op-note" data-flash={ui.hint.flash} title={ui.hint.text} aria-live="polite">{ui.hint.text}</span>
            <button type="button" className="op-btn" disabled={!text.trim() || !canSend} onClick={submit}>
              {VERB[mode]}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

