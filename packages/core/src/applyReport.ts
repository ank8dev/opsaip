import { canTransition, type AgentTaskStatus } from './agentTaskStatus';

/** The part of a task that applyReport reads. Any extra fields are kept as they are. */
export interface AgentTask {
  id: string;
  status: AgentTaskStatus;
  /** ISO 8601 timestamp of the last accepted report. */
  updatedAt: string;
}

/** What an agent sends: "task X is now in status Y, as of time Z". */
export interface StatusReport {
  taskId: string;
  status: AgentTaskStatus;
  /** ISO 8601 timestamp of when the agent observed this status. */
  at: string;
}

export type ApplyReportResult<T extends AgentTask> =
  | { ok: true; task: T }
  | { ok: false; reason: string };

/**
 * Apply one agent report to a task. Pure: the input is never mutated, and the
 * function never throws, because reports arrive from outside the process.
 *
 * Checks run in this order, and the first failure decides the reason:
 *   0. the report is well formed and belongs to this task;
 *   1. the transition is allowed by canTransition;
 *   2. the report is not older than task.updatedAt (equal is accepted).
 */
export function applyReport<T extends AgentTask>(
  task: T,
  report: StatusReport,
): ApplyReportResult<T> {
  try {
    if (report.taskId !== task.id) {
      return { ok: false, reason: `report is for task ${report.taskId}, not ${task.id}` };
    }

    const reportTime = Date.parse(report.at);
    const taskTime = Date.parse(task.updatedAt);
    if (Number.isNaN(reportTime) || Number.isNaN(taskTime)) {
      return { ok: false, reason: 'invalid timestamp' };
    }

    // Rule 1. canTransition throws on a status it does not know; the catch
    // below turns that into a rejection.
    if (!canTransition(task.status, report.status)) {
      return {
        ok: false,
        reason: `transition not allowed: ${task.status} -> ${report.status}`,
      };
    }

    // Rule 2. Compare instants, not strings: "+03:00" offsets and
    // millisecond precision make text comparison wrong.
    if (reportTime < taskTime) {
      return {
        ok: false,
        reason: `stale report: ${report.at} is older than ${task.updatedAt}`,
      };
    }

    // Rule 3.
    return { ok: true, task: { ...task, status: report.status, updatedAt: report.at } };
  } catch {
    // Malformed input (null, unknown status, ...). Reject instead of throwing.
    return { ok: false, reason: 'invalid report or task' };
  }
}
