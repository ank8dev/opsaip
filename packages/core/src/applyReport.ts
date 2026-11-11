import { canTransition, type AgentTaskStatus } from './agentTaskStatus';

/** The part of a task that applyReport reads. Any extra fields are kept as they are. */
export interface AgentTask {
  id: string;
  status: AgentTaskStatus;
  /** ISO 8601 timestamp of the last accepted report. */
  updatedAt: string;
  /** Short human-readable name, set by an accepted "queued" report that has one. */
  title?: string;
  /** Who works on the task (e.g. "claude-code"): the last accepted report that named one. */
  agent?: string;
  /** About the current status (e.g. the question while waiting_on_human). Cleared on every status change. */
  note?: string;
}

/** What an agent sends: "task X is now in status Y, as of time Z". */
export interface StatusReport {
  taskId: string;
  status: AgentTaskStatus;
  /** ISO 8601 timestamp of when the agent observed this status. */
  at: string;
  /** Only with status "queued" (parseReport enforces it). */
  title?: string;
  agent?: string;
  note?: string;
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
 *
 * The optional fields of an accepted report:
 *   - title, agent: replace the task's value if the report has one, else kept;
 *   - note: describes the new status, so it replaces the old note, and a
 *     report without a note clears it. A question asked while
 *     waiting_on_human must not stay on the task once it is done.
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
    const next: T = { ...task, status: report.status, updatedAt: report.at };
    if (report.title !== undefined) next.title = report.title;
    if (report.agent !== undefined) next.agent = report.agent;
    if (report.note !== undefined) next.note = report.note;
    else delete next.note;
    return { ok: true, task: next };
  } catch {
    // Malformed input (null, unknown status, ...). Reject instead of throwing.
    return { ok: false, reason: 'invalid report or task' };
  }
}
