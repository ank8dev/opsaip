import type { AnyTask, ChatMessage, Task } from '../../types';
import { isLocal } from '../../types';
import { firstName } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';

type Action = { label: string; main?: boolean; run: () => void };

/** The next steps for the open task, next to the mode button. Preview only. */
export function QuickActions({ task, prefill }: { task: AnyTask; prefill: (text: string) => void }) {
  const { people, changeTask } = useWorkspace();
  const { flashHint } = useUi();
  const owner = isLocal(task) ? undefined : people[task.owner];
  const fn = owner ? firstName(owner.name) : 'them';
  const agent = task.source ? (owner ? `${fn}’s ${task.source}` : task.source) : 'the agent';

  const change = (patch: Partial<Task>, note: string, msg?: ChatMessage) => {
    changeTask(task.id, patch, msg);
    flashHint(note);
  };

  const actions: Record<Task['status'], Action[]> = {
    'Needs you': [
      {
        label: 'Approve',
        main: true,
        run: () =>
          change(
            { status: 'Working', detail: 'Approved by you · continuing' },
            `Approved — ${agent} continues. ${fn} gets a note on Slack.`,
            { role: 'user', text: 'Approved. Go ahead.', via: `to ${agent}` },
          ),
      },
      { label: 'Ask', run: () => prefill('Quick question before I approve: ') },
      { label: 'Hold off', run: () => prefill('Please hold off for now — ') },
    ],
    Working: [
      { label: 'Get an update', run: () => prefill(`Hi ${fn}, how is it going with this?`) },
      { label: 'Make urgent', run: () => change({ priority: 'Urgent' }, `Marked urgent — ${fn} and the agent see it first.`) },
      { label: 'Pause', run: () => change({ status: 'Queued', detail: 'Paused by you' }, `Paused — ${agent} stops after its current step.`) },
    ],
    Failed: [
      { label: 'Retry', main: true, run: () => change({ status: 'Working', detail: 'Retrying after the failure' }, `Retrying — ${agent} starts again.`) },
      { label: `Ask ${fn} to check`, run: () => prefill(`Can you take a look? The agent failed: ${task.detail}`) },
    ],
    Queued: [
      { label: 'Start now', main: true, run: () => change({ status: 'Working', detail: 'Started by you' }, `Started — ${agent} picks it up now.`) },
      { label: 'Cancel', run: () => change({ status: 'Done', detail: 'Canceled by you' }, 'Canceled.') },
    ],
    Done: [
      { label: 'Say thanks', run: () => prefill(`Thanks, ${fn}! `) },
      { label: 'Reopen', run: () => change({ status: 'Working', detail: 'Reopened by you' }, `Reopened — ${agent} picks it up again.`) },
    ],
  };

  return (
    <span className="op-quick" role="group" aria-label="Actions for this task">
      {actions[task.status].map((a) => (
        <button key={a.label} type="button" className={`op-qbtn${a.main ? ' op-qbtn-main' : ''}`} onClick={a.run}>
          {a.label}
        </button>
      ))}
    </span>
  );
}
