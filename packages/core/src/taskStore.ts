import { isAgentTaskStatus } from './agentTaskStatus';
import {
  applyReport,
  type AgentTask,
  type ApplyReportResult,
  type StatusReport,
} from './applyReport';

/** In-memory store of agent tasks, updated only through agent reports. */
export interface TaskStore {
  /** A copy of the task, or undefined if the store has never seen it. */
  get(id: string): AgentTask | undefined;
  /** Copies of all tasks, in the order they were created. */
  all(): AgentTask[];
  /** Apply one report. Never throws; see createTaskStore for the rules. */
  apply(report: StatusReport): ApplyReportResult<AgentTask>;
}

/**
 * Create a task store. It starts with `initial`: tasks that already exist,
 * for example loaded from a database, in the order they were created.
 * Only id, status and updatedAt are copied. Throws a TypeError if an initial
 * task is malformed or two share an id: that is broken stored data, not a
 * bad report, so it must stop the caller instead of being skipped.
 *
 * apply(report) checks, in this order:
 *   1. unknown task + status "queued" -> create the task;
 *   2. unknown task + any other status -> reject: "unknown task";
 *   3. exact duplicate (same status and same instant `at` as the stored
 *      task) -> ok, nothing changes. Resending a report is never an error;
 *   4. otherwise applyReport, and keep the result only if it is ok.
 *
 * get and all return copies, so callers cannot change stored tasks
 * without going through apply.
 */
export function createTaskStore(initial: readonly AgentTask[] = []): TaskStore {
  const tasks = new Map<string, AgentTask>();
  initial.forEach((task, index) => {
    // Messages name the index only, never stored values.
    if (!isValidTask(task)) throw new TypeError(`initial task ${index} is malformed`);
    if (tasks.has(task.id)) throw new TypeError(`initial task ${index} repeats an earlier id`);
    tasks.set(task.id, { id: task.id, status: task.status, updatedAt: task.updatedAt });
  });

  return {
    get(id) {
      const task = tasks.get(id);
      return task === undefined ? undefined : { ...task };
    },

    all() {
      return [...tasks.values()].map((task) => ({ ...task }));
    },

    apply(report) {
      try {
        const stored = tasks.get(report.taskId);

        if (stored === undefined) {
          // Rule 2.
          if (report.status !== 'queued') {
            return { ok: false, reason: 'unknown task' };
          }
          // Rule 1. applyReport is not called here, so validate `at` ourselves.
          if (Number.isNaN(Date.parse(report.at))) {
            return { ok: false, reason: 'invalid timestamp' };
          }
          const task: AgentTask = { id: report.taskId, status: 'queued', updatedAt: report.at };
          tasks.set(task.id, task);
          return { ok: true, task: { ...task } };
        }

        // Rule 3. Compare instants, like applyReport does: the same moment
        // written with another UTC offset is still the same report.
        if (
          report.status === stored.status &&
          Date.parse(report.at) === Date.parse(stored.updatedAt)
        ) {
          return { ok: true, task: { ...stored } };
        }

        // Rule 4.
        const result = applyReport(stored, report);
        if (result.ok) {
          tasks.set(stored.id, result.task);
          return { ok: true, task: { ...result.task } };
        }
        return result;
      } catch {
        // Malformed input (null, missing fields, ...). Reject instead of throwing.
        return { ok: false, reason: 'invalid report' };
      }
    },
  };
}

function isValidTask(task: unknown): task is AgentTask {
  if (typeof task !== 'object' || task === null) return false;
  const { id, status, updatedAt } = task as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    isAgentTaskStatus(status) &&
    typeof updatedAt === 'string' &&
    !Number.isNaN(Date.parse(updatedAt))
  );
}
