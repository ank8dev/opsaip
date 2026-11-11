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
 * Only id, status, updatedAt and the optional title, agent and note are
 * copied. Throws a TypeError if an initial task is malformed or two share an
 * id: that is broken stored data, not a bad report, so it must stop the
 * caller instead of being skipped.
 *
 * apply(report) checks, in this order:
 *   1. unknown task + status "queued" -> create the task, with the report's
 *      title, agent and note if it has them;
 *   2. unknown task + any other status -> reject: "unknown task";
 *   3. exact duplicate (same status and same instant `at` as the stored
 *      task) -> ok, nothing changes, even if title, agent or note differ.
 *      Resending a report is never an error;
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
    tasks.set(task.id, copyTask(task));
  });

  return {
    get(id) {
      const task = tasks.get(id);
      return task === undefined ? undefined : copyTask(task);
    },

    all() {
      return [...tasks.values()].map(copyTask);
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
          const task = copyTask({
            id: report.taskId,
            status: 'queued',
            updatedAt: report.at,
            title: report.title,
            agent: report.agent,
            note: report.note,
          });
          tasks.set(task.id, task);
          return { ok: true, task: copyTask(task) };
        }

        // Rule 3. Compare instants, like applyReport does: the same moment
        // written with another UTC offset is still the same report.
        if (
          report.status === stored.status &&
          Date.parse(report.at) === Date.parse(stored.updatedAt)
        ) {
          return { ok: true, task: copyTask(stored) };
        }

        // Rule 4.
        const result = applyReport(stored, report);
        if (result.ok) {
          tasks.set(stored.id, copyTask(result.task));
          return { ok: true, task: copyTask(result.task) };
        }
        return result;
      } catch {
        // Malformed input (null, missing fields, ...). Reject instead of throwing.
        return { ok: false, reason: 'invalid report' };
      }
    },
  };
}

/**
 * A new object with only the known fields. An optional field that is
 * undefined is left out, so tasks compare and serialize the same way
 * whether a field was never set or was cleared.
 */
function copyTask(task: AgentTask): AgentTask {
  const copy: AgentTask = { id: task.id, status: task.status, updatedAt: task.updatedAt };
  if (task.title !== undefined) copy.title = task.title;
  if (task.agent !== undefined) copy.agent = task.agent;
  if (task.note !== undefined) copy.note = task.note;
  return copy;
}

function isValidTask(task: unknown): task is AgentTask {
  if (typeof task !== 'object' || task === null) return false;
  const { id, status, updatedAt, title, agent, note } = task as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    isAgentTaskStatus(status) &&
    typeof updatedAt === 'string' &&
    !Number.isNaN(Date.parse(updatedAt)) &&
    isOptionalString(title) &&
    isOptionalString(agent) &&
    isOptionalString(note)
  );
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}
