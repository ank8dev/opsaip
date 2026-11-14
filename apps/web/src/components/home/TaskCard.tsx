import { motion } from 'motion/react';
import type { AnyTask, ChatMessage } from '../../types';
import { isLocal } from '../../types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { listItem } from '../../styles/motion';
import { StatusDot } from '../common/StatusDot';
import { LinkedItems } from './LinkedItems';
import { TaskOverlay } from './TaskOverlay';

/**
 * One task in the task window: what the agent was asked and what it did.
 * The window itself (backdrop, Esc, focus) is TaskOverlay.
 */
export function TaskCard({ task }: { task: AnyTask }) {
  const { people, messagesFor } = useWorkspace();
  const owner = isLocal(task) ? undefined : people[task.owner];
  const meta = [isLocal(task) ? 'You' : owner?.name, task.tool].filter(Boolean).join(' · ');

  return (
    <TaskOverlay
      label="Task"
      title={
        <>
          <span className="op-overlay-name">{task.task}</span>
          {task.source && <span className="op-tag">{task.source}</span>}
          <span className="op-overlay-status" style={task.status === 'Failed' ? { color: 'var(--op-error)' } : undefined}>
            <StatusDot status={task.status} className="op-card-dot" />
            {task.status}
          </span>
        </>
      }
    >
      <div className="op-card-meta">
        {meta}
        {meta && task.detail && ' · '}
        {task.detail && <span className="op-note">{task.detail}</span>}
      </div>
      {!isLocal(task) && <LinkedItems task={task} />}
      <Chat messages={messagesFor(task)} you={owner?.name ?? 'You'} agent={task.source || 'Agent'} />
      <div className="op-chat-foot">
        {isLocal(task) ? 'Started here · not saved yet' : task.source ? `Exported from ${task.source} · read only` : 'Read only'}
      </div>
    </TaskOverlay>
  );
}

/** The chat. Consecutive tool calls are grouped into one block. */
function Chat({ messages, you, agent }: { messages: ChatMessage[]; you: string; agent: string }) {
  const t = useUi().motion;
  const blocks: ({ kind: 'tools'; lines: string[] } | { kind: 'msg'; m: ChatMessage })[] = [];
  for (const m of messages) {
    const last = blocks[blocks.length - 1];
    if (m.role === 'tool') {
      if (last?.kind === 'tools') last.lines.push(m.text);
      else blocks.push({ kind: 'tools', lines: [m.text] });
    } else {
      blocks.push({ kind: 'msg', m });
    }
  }

  return (
    <div className="op-chat">
      {blocks.map((b, i) =>
        b.kind === 'tools' ? (
          <motion.div key={i} className="op-msg op-msg-tools" {...listItem(t, i)}>
            {b.lines.map((line, j) => <div key={j}>{line}</div>)}
          </motion.div>
        ) : (
          <motion.div key={i} className={`op-msg ${b.m.role === 'user' ? 'op-msg-user' : 'op-msg-ai'}`} {...listItem(t, i)}>
            <span className="op-msg-who">
              {b.m.via ? <>You<span className="op-msg-via"> · {b.m.via}</span></> : b.m.role === 'user' ? you : agent}
            </span>
            <span className="op-msg-body">{b.m.text}</span>
          </motion.div>
        ),
      )}
    </div>
  );
}
