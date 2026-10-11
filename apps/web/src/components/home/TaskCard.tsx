import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import type { AnyTask, ChatMessage } from '../../types';
import { isLocal } from '../../types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { listItem } from '../../styles/motion';
import { StatusDot } from '../common/StatusDot';
import { LinkedItems } from './LinkedItems';

/** One task, opened above the composer: what the agent was asked and what it did. */
export function TaskCard({ task }: { task: AnyTask }) {
  const { people, messagesFor } = useWorkspace();
  const ui = useUi();
  const t = ui.motion;
  const backRef = useRef<HTMLButtonElement>(null);
  const owner = isLocal(task) ? undefined : people[task.owner];

  useEffect(() => { backRef.current?.focus({ preventScroll: true }); }, [task.id]);

  // Escape closes the task, unless you are typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (e.key === 'Escape' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)) {
        e.stopPropagation();
        ui.closeTask();
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ui]);

  return (
    <motion.section
      className="op-card"
      aria-label="Task"
      initial={{ opacity: 0, y: t.dist, filter: `blur(${t.blur}px)` }}
      animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
      transition={{ duration: t.slow, ease: t.easeOut }}
    >
      <div className="op-card-chat">
        <div className="op-card-head op-grid">
          <button ref={backRef} type="button" className="op-back" aria-label="Close task" onClick={ui.closeTask}>
            <span />
          </button>
          <span className="op-title">{task.task}</span>
          <span className="op-c3">{task.source && <span className="op-tag">{task.source}</span>}</span>
          <span className="op-c4" style={task.status === 'Failed' ? { color: 'var(--op-error)' } : undefined}>
            <StatusDot status={task.status} batonKey={task.id} className="op-card-dot" />
            {task.status}
          </span>
        </div>
        <div className="op-card-meta">{[owner?.name ?? 'You', task.tool, task.detail].filter(Boolean).join(' · ')}</div>
        <div className="op-scroll op-card-scroll">
          {!isLocal(task) && <LinkedItems task={task} />}
          <Chat messages={messagesFor(task)} you={owner?.name ?? 'You'} agent={task.source || 'Agent'} />
          <div className="op-chat-foot">
            {isLocal(task) ? 'Started here · not saved yet' : `Exported from ${task.source} · read only`}
          </div>
        </div>
      </div>
    </motion.section>
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
