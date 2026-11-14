// "Needs you" and "failed" for the UI. The rule itself is in @opsaip/core
// (attention); this only maps the UI's task statuses onto it. The sidebar,
// the bar above the composer, the Brief and Opsy all use this one function.

import { attention, type AgentTaskStatus } from '@opsaip/core';
import type { Task, TaskStatus } from '../types';

const AGENT_STATUS: Record<TaskStatus, AgentTaskStatus> = {
  'Needs you': 'waiting_on_human',
  Working: 'running',
  Failed: 'failed',
  Queued: 'queued',
  Done: 'done',
};

export interface AttentionView<T extends Task> {
  /** Tasks that need you (waiting, or with a pending permission request), in the order given. */
  needsYou: T[];
  failed: T[];
}

/**
 * `pendingPermissionTaskIds`: tasks with a permission request nobody has
 * answered. Ids that are not in `tasks` are ignored: there is nothing to show.
 */
export function attentionOf<T extends Task>(
  tasks: readonly T[],
  pendingPermissionTaskIds: readonly string[] = [],
): AttentionView<T> {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const known = pendingPermissionTaskIds.filter((id) => byId.has(id));
  const result = attention(tasks.map((t) => ({ id: t.id, status: AGENT_STATUS[t.status] })), known);
  const pick = (ids: string[]) => ids.map((id) => byId.get(id)).filter((t): t is T => t !== undefined);
  return { needsYou: pick(result.needsYou), failed: pick(result.failed) };
}

/** "2 need you", "1 needs you", or '' for none. */
export function needsYouText(n: number): string {
  return n === 0 ? '' : `${n} ${n === 1 ? 'needs' : 'need'} you`;
}
