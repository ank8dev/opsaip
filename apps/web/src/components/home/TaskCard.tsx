import { useState } from 'react';
import { motion } from 'motion/react';
import type { AnyTask, ChatMessage } from '../../types';
import { isLocal } from '../../types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { listItem, slideIn } from '../../styles/motion';
import { EXTERNAL_NOTE, NO_CHAT_NOTE, chatTabMode } from '../../data/chat/transcript';
import type { Chat as ChatControls } from '../chat/useChat';
import { StatusDot } from '../common/StatusDot';
import { LinkedItems } from './LinkedItems';
import { TaskOverlay } from './TaskOverlay';
import { RunChat } from './RunChat';

/**
 * One task in the task window: what the agent was asked and what it did.
 * The window itself (backdrop, Esc, focus) is TaskOverlay.
 */
export function TaskCard({ task, chat }: { task: AnyTask; chat: ChatControls }) {
  const { people, messagesFor, readOnly } = useWorkspace();
  const t = useUi().motion;
  const [tab, setTab] = useState<'details' | 'chat'>('details');
  const owner = isLocal(task) ? undefined : people[task.owner];
  // A run Opsaip launched has a chat; a task an agent reported through MCP is read only.
  const runId = readOnly && !isLocal(task) ? chat.runIdForTask(task.id) : undefined;
  const mode = isLocal(task) ? 'external' : chatTabMode(task, readOnly, runId);
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
      <div className="op-tabs" role="tablist" aria-label="Task">
        {(['details', 'chat'] as const).map((id) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`op-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`op-panel-${id}`}
            tabIndex={tab === id ? 0 : -1}
            className="op-tab"
            onClick={() => setTab(id)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                e.preventDefault();
                setTab(tab === 'details' ? 'chat' : 'details');
                document.getElementById(`op-tab-${tab === 'details' ? 'chat' : 'details'}`)?.focus();
              }
            }}
          >
            {id === 'details' ? 'Details' : 'Chat'}
          </button>
        ))}
      </div>
      <motion.div key={tab} role="tabpanel" id={`op-panel-${tab}`} aria-labelledby={`op-tab-${tab}`} className="op-tabpanel" {...slideIn(t, 1)}>
        {tab === 'details' ? (
          <>
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
          </>
        ) : mode === 'run' && runId !== undefined ? (
          <RunChat runId={runId} title={task.task} send={chat.sendToRun} />
        ) : (
          <p className="op-runchat-note op-runchat-solo" role="status">{mode === 'launched-here' ? NO_CHAT_NOTE : EXTERNAL_NOTE}</p>
        )}
      </motion.div>
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
