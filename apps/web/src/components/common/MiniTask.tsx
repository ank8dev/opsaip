import type { AnyTask } from '../../types';
import { useUi } from '../../state/ui';
import { StatusDot } from './StatusDot';

/** A one-line task inside expanded details (a teammate, an MCP link). Opens the task. */
export function MiniTask({ task }: { task: AnyTask }) {
  const { openTask } = useUi();
  return (
    <button
      type="button"
      className={`op-mini${task.status === 'Failed' ? ' op-fail' : ''}`}
      onClick={() => openTask(task.id)}
    >
      <StatusDot status={task.status} batonKey={task.id} />
      <span className="op-mini-title">{task.task}</span>
      <span className="op-mini-status">{task.status}</span>
    </button>
  );
}

/** A label and a value on one line. Hidden when there is no value. */
export function Fact({ k, v, mono = false }: { k: string; v?: string; mono?: boolean }) {
  if (!v) return null;
  return (
    <div className="op-fact">
      <span className="op-fact-k">{k}</span>
      <span className={`op-fact-v${mono ? ' op-mono' : ''}`}>{v}</span>
    </div>
  );
}
