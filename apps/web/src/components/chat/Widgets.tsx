import { useEffect, useRef } from 'react';
import type { TaskStatus } from '../../types';
import { ago } from '../../data/selectors';
import type {
  AgentWidget, BriefWidget, NeedsWidget, PermissionWidget, ProposalWidget, RunWidget, TaskLine, TaskListWidget, TextWidget, Widget,
} from '../../data/chat/types';
import { isRunActive } from '../../data/chat/conductor';
import { PERMISSION_OUTCOME_TEXT, RUN_STATUS_TEXT } from '../../data/chat/runWidget';
import { STATUS_LABEL } from '../../data/serverTasks';
import { useUi } from '../../state/ui';
import { useWorkspace } from '../../state/workspace';
import { useNow } from '../../lib/useNow';
import { StatusDot } from '../common/StatusDot';

// What Opsy puts in a message. Everything here is drawn as React text nodes:
// an answer from the server is never parsed as HTML or Markdown.

interface Props<W extends Widget> {
  widget: W;
}

interface ViewProps {
  widget: Widget;
  /** Approve or Cancel a proposal. */
  onDecide: (d: 'approve' | 'cancel') => void;
  /** Allow or Deny a permission request. */
  onAnswer: (allow: boolean) => void;
  /** Stop the run. */
  onStop: () => void;
}

/** One widget, with its source line underneath. */
export function WidgetView({ widget, onDecide, onAnswer, onStop }: ViewProps) {
  return (
    <div className="op-w">
      {widget.kind === 'brief' && <Brief widget={widget} />}
      {widget.kind === 'tasks' && <TaskList widget={widget} />}
      {widget.kind === 'needs' && <Needs widget={widget} />}
      {widget.kind === 'agent' && <AgentCard widget={widget} />}
      {widget.kind === 'proposal' && <Proposal widget={widget} onDecide={onDecide} />}
      {widget.kind === 'text' && <Text widget={widget} />}
      {widget.kind === 'run' && <RunCard widget={widget} onStop={onStop} />}
      {widget.kind === 'permission' && <PermissionCard widget={widget} onAnswer={onAnswer} />}
      {widget.source && <p className="op-w-source">{widget.source}</p>}
    </div>
  );
}

// ---- Pieces ----

const STATUS_WORD: Record<TaskStatus, (n: number) => string> = {
  'Needs you': (n) => (n === 1 ? 'needs you' : 'need you'),
  Working: () => 'working',
  Failed: () => 'failed',
  Queued: () => 'queued',
  Done: () => 'done',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Urgent · Tom Becker · Claude Code": the parts that are known. */
function meta(line: TaskLine, withStatus: boolean): string {
  return [withStatus ? line.status : '', line.priority ?? '', line.owner, line.agent].filter(Boolean).join(' · ');
}

/** A task you can open: the dot, the title, and who and what. */
function TaskRow({ line, withStatus = true }: { line: TaskLine; withStatus?: boolean }) {
  const ui = useUi();
  return (
    <li>
      <button type="button" className={`op-w-row${line.status === 'Failed' ? ' op-fail' : ''}`} onClick={() => ui.openTask(line.id)}>
        <StatusDot status={line.status} />
        <span className="op-w-title">{line.title}</span>
        <span className="op-w-meta">{meta(line, withStatus)}</span>
      </button>
    </li>
  );
}

function More({ count }: { count: number }) {
  if (count <= 0) return null;
  return <p className="op-w-more">and {count} more. Open Agents in the sidebar to see them all.</p>;
}

// ---- Widgets ----

function Brief({ widget }: Props<BriefWidget>) {
  return (
    <>
      <p className="op-w-lead">Here is where things stand across {plural(widget.total, 'task', 'tasks')}.</p>
      <ul className="op-w-counts" aria-label="Tasks by status">
        {widget.counts.map((c) => (
          <li key={c.status}>
            <StatusDot status={c.status} />
            <b className="op-n">{c.count}</b> {STATUS_WORD[c.status](c.count)}
          </li>
        ))}
      </ul>
      {widget.next && (
        <>
          <p className="op-w-label">{widget.next.status === 'Needs you' ? 'Start with' : 'Look at'}</p>
          <ul className="op-w-list"><TaskRow line={widget.next} /></ul>
        </>
      )}
    </>
  );
}

function TaskList({ widget }: Props<TaskListWidget>) {
  return (
    <>
      <p className="op-w-lead">{widget.title}.</p>
      <ul className="op-w-list">
        {widget.tasks.map((t) => <TaskRow key={t.id} line={t} />)}
      </ul>
      <More count={widget.more} />
    </>
  );
}

function Needs({ widget }: Props<NeedsWidget>) {
  const ui = useUi();
  const n = widget.tasks.length + widget.more;
  return (
    <>
      <p className="op-w-lead">{n === 1 ? '1 task needs you.' : `${n} tasks need you.`}</p>
      <ul className="op-w-list op-w-needs">
        {widget.tasks.map((t) => (
          <li key={t.id} className="op-w-need">
            <span className="op-w-title">{t.title}</span>
            <span className="op-w-meta">{meta(t, false)}</span>
            {t.detail && <span className="op-w-ask">{t.detail}</span>}
            <button type="button" className="op-sbtn op-w-act" aria-label={`Open task: ${t.title}`} onClick={() => ui.openTask(t.id)}>
              Open task
            </button>
          </li>
        ))}
      </ul>
      <More count={widget.more} />
    </>
  );
}

function AgentCard({ widget }: Props<AgentWidget>) {
  const now = useNow().getTime();
  const { current, last } = widget;
  return (
    <>
      <p className="op-w-lead">{widget.agent}</p>
      <p className="op-w-counts-line">
        {widget.counts.map((c, i) => (
          <span key={c.status}>{i > 0 && ' · '}<b className="op-n">{c.count}</b> {STATUS_WORD[c.status](c.count)}</span>
        ))}
      </p>
      <p className="op-w-label">Working on</p>
      {current ? (
        <>
          <ul className="op-w-list"><TaskRow line={current} withStatus={false} /></ul>
          {widget.alsoWorking > 0 && <p className="op-w-more">and {plural(widget.alsoWorking, 'other task', 'other tasks')} at the same time.</p>}
        </>
      ) : (
        <p className="op-w-more">Nothing right now.</p>
      )}
      {last && (
        <>
          <p className="op-w-label">Last report{last.since ? ` · ${ago(last.since, now)}` : ''}</p>
          <p className="op-w-quote"><span className="op-w-meta">{last.title}</span>{last.detail || 'No note.'}</p>
        </>
      )}
    </>
  );
}

function Proposal({ widget, onDecide }: Props<ProposalWidget> & { onDecide: (d: 'approve' | 'cancel') => void }) {
  const outcome = useRef<HTMLParagraphElement>(null);
  const was = useRef(widget.status);
  // The buttons go away once you decide: keep focus in the card, on the outcome.
  useEffect(() => {
    if (was.current === 'pending' && widget.status !== 'pending') outcome.current?.focus({ preventScroll: true });
    was.current = widget.status;
  }, [widget.status]);

  return (
    <div className="op-w-prop" data-status={widget.status}>
      <p className="op-w-label">Proposed change</p>
      <p className="op-w-lead">I suggest a new title for this task.</p>
      <dl className="op-w-diff">
        <div><dt>{widget.status === 'approved' ? 'Was' : 'Now'}</dt><dd>{widget.before}</dd></div>
        <div><dt>New</dt><dd className="op-w-after">{widget.after}</dd></div>
      </dl>
      {widget.status === 'pending' ? (
        <>
          <p className="op-w-more">Nothing changes until you approve.</p>
          <div className="op-w-acts">
            <button type="button" className="op-sbtn op-sbtn-primary" onClick={() => onDecide('approve')}>Approve</button>
            <button type="button" className="op-sbtn" onClick={() => onDecide('cancel')}>Cancel</button>
          </div>
        </>
      ) : (
        <p ref={outcome} tabIndex={-1} role="status" className="op-w-outcome">
          {widget.status === 'approved' && <>Approved. The task is now called {`“${widget.after}”`}.</>}
          {widget.status === 'cancelled' && <>Cancelled. Nothing was changed.</>}
          {widget.status === 'stale' && <>The task’s title changed since I suggested this, so I did not apply it. Nothing was changed.</>}
        </p>
      )}
    </div>
  );
}

function Text({ widget }: Props<TextWidget>) {
  return (
    <>
      <p className="op-w-text">{widget.text}</p>
      {widget.link && (
        <p className="op-w-text">
          <a href={widget.link.href} target="_blank" rel="noopener noreferrer">{widget.link.label}</a>
        </p>
      )}
    </>
  );
}

/** A Conductor run: title, status in words, the agent's latest text, the branch, and Stop while it is active. */
function RunCard({ widget, onStop }: Props<RunWidget> & { onStop: () => void }) {
  const { findTask } = useWorkspace();
  const active = isRunActive(widget.status);
  // Why it failed: the note on the run's task, if the server has sent it yet.
  const note = widget.status === 'failed' ? (findTask(widget.taskId)?.detail ?? '') : '';
  return (
    <div className="op-w-run" data-status={widget.status}>
      <p className="op-w-label">Claude Code run</p>
      <p className="op-w-lead">{widget.title}</p>
      <p className="op-w-status">
        <StatusDot status={STATUS_LABEL[widget.status]} />
        <span>{RUN_STATUS_TEXT[widget.status]}</span>
      </p>
      {widget.lastMessage !== '' && (
        <>
          <p className="op-w-label">{active ? 'Latest from the agent' : 'Its last message'}</p>
          <p className="op-w-quote op-w-pre">{widget.lastMessage}</p>
        </>
      )}
      {widget.status === 'failed' && <p className="op-w-more">{note !== '' ? `It failed: ${note}` : 'It failed.'}</p>}
      {widget.status === 'done' && <p className="op-w-more">It finished. Its changes are on the branch below, for you to review.</p>}
      <p className="op-w-meta">Branch: <code>{widget.branch}</code></p>
      {active && (
        <div className="op-w-acts">
          <button type="button" className="op-sbtn" disabled={widget.stopping} onClick={onStop}>
            {widget.stopping ? 'Stopping…' : 'Stop'}
          </button>
        </div>
      )}
    </div>
  );
}

/** The agent asks to use a tool. Allow or Deny; the tool and what it would do are the agent's words, drawn as text. */
function PermissionCard({ widget, onAnswer }: Props<PermissionWidget> & { onAnswer: (allow: boolean) => void }) {
  const outcome = useRef<HTMLParagraphElement>(null);
  const was = useRef(widget.state);
  // The buttons go away once answered: keep focus in the card, on the outcome.
  useEffect(() => {
    if (was.current === 'pending' && widget.state !== 'pending') outcome.current?.focus({ preventScroll: true });
    was.current = widget.state;
  }, [widget.state]);

  return (
    <div className="op-w-prop op-w-perm" data-status={widget.state}>
      <p className="op-w-label">Needs you</p>
      <p className="op-w-lead">Claude Code asks to use {widget.tool}.</p>
      <p className="op-w-quote op-w-pre">{widget.summary}</p>
      {widget.state === 'pending' ? (
        <>
          <div className="op-w-acts">
            <button type="button" className="op-sbtn op-sbtn-primary" disabled={widget.busy} onClick={() => onAnswer(true)}>Allow</button>
            <button type="button" className="op-sbtn" disabled={widget.busy} onClick={() => onAnswer(false)}>Deny</button>
          </div>
          {widget.error !== '' && <p role="alert" className="op-w-outcome">{widget.error}</p>}
        </>
      ) : (
        <p ref={outcome} tabIndex={-1} role="status" className="op-w-outcome">{PERMISSION_OUTCOME_TEXT[widget.state]}</p>
      )}
    </div>
  );
}
