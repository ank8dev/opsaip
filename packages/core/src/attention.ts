// What needs a person, in one place. The sidebar, the bar above the composer,
// the Brief and Opsy all call this, so they can never disagree. Pure: no React.
import type { AgentTaskStatus } from './agentTaskStatus';

/** The part of a task this needs. */
export interface AttentionTask {
  id: string;
  status: AgentTaskStatus;
}

export interface Attention {
  /**
   * Ids of what needs you: tasks waiting_on_human, plus the tasks of pending
   * permission requests. A run's task is usually both, and counts once.
   */
  needsYou: string[];
  /** Ids of failed tasks. */
  failed: string[];
}

/**
 * Sort tasks into "needs you" and "failed". A pending permission request needs
 * you even if its task has not been reported as waiting yet; a request for a
 * task that is done or failed no longer does (nothing is left to answer).
 * Queued, running and done tasks are neither: they can wait. Each id counts
 * once, in the order of `tasks`; permission-only ids follow, in their order.
 */
export function attention(
  tasks: readonly AttentionTask[],
  pendingPermissionTaskIds: readonly string[] = [],
): Attention {
  const needsYou: string[] = [];
  const failed: string[] = [];
  const seen = new Set<string>();
  const byId = new Map<string, AgentTaskStatus>();
  for (const t of tasks) {
    byId.set(t.id, t.status);
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (t.status === 'waiting_on_human') needsYou.push(t.id);
    else if (t.status === 'failed') failed.push(t.id);
  }
  const counted = new Set(needsYou);
  for (const id of pendingPermissionTaskIds) {
    if (counted.has(id)) continue;
    const status = byId.get(id);
    if (status === 'done' || status === 'failed') continue;
    counted.add(id);
    needsYou.push(id);
  }
  return { needsYou, failed };
}
