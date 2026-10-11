import type { McpStatus, SyncState, TaskStatus } from '../../types';

const TASK_DOT: Record<TaskStatus, string> = {
  Working: 'op-dot',
  'Needs you': 'op-dot-needs',
  Failed: 'op-dot-fail',
  Queued: 'op-dot-queued',
  Done: 'op-dot-done',
};

const MCP_DOT: Record<McpStatus, string> = {
  Connected: 'op-dot-live',
  'Needs auth': 'op-dot-needs',
  Error: 'op-dot-fail',
  Offline: 'op-dot-queued',
};

const SYNC_DOT: Record<SyncState, string> = {
  'In sync': 'op-dot-live',
  Conflict: 'op-dot-fail',
  Suggested: 'op-dot-queued',
  Kept: 'op-dot-done',
};

interface DotProps {
  className?: string;
  /** Lets the conductor's baton find this dot: a task id, or "tray". */
  batonKey?: string;
}

/** A task's state, shown by shape: spinning ring, hollow, filled, red. */
export function StatusDot({ status, className, batonKey }: DotProps & { status: TaskStatus }) {
  return (
    <span className={`op-dotbox ${className ?? ''}`} data-baton={batonKey} aria-hidden="true">
      <span className={TASK_DOT[status] ?? 'op-dot-done'} />
    </span>
  );
}

export function McpDot({ status, className }: DotProps & { status: McpStatus }) {
  return (
    <span className={`op-dotbox ${className ?? ''}`} aria-hidden="true">
      <span className={MCP_DOT[status] ?? 'op-dot-queued'} />
    </span>
  );
}

export function SyncDot({ sync }: { sync: SyncState }) {
  return (
    <span className="op-dotbox" style={{ width: 12, height: 16 }} aria-hidden="true">
      <span className={SYNC_DOT[sync] ?? 'op-dot-done'} />
    </span>
  );
}
