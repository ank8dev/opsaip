import { isAgentTaskStatus } from './agentTaskStatus';
import {
  applyReport,
  isTaskSource,
  type AgentTask,
  type ApplyReportResult,
  type StatusReport,
  type TaskSource,
} from './applyReport';
import {
  MAX_AGENT_LENGTH,
  MAX_TASK_ID_LENGTH,
  MAX_TITLE_LENGTH,
  textProblem,
} from './parseReport';

/**
 * What create() needs to make a task. The caller (the server) supplies the
 * id and the time; the status is always "queued". title and agent normally
 * come from parseNewTask, and are checked again here.
 */
export interface CreateTaskInput {
  id: string;
  title: string;
  agent?: string;
  /** ISO 8601 timestamp of creation: becomes the task's updatedAt. */
  createdAt: string;
  source: TaskSource;
}

export type CreateTaskResult = { ok: true; task: AgentTask } | { ok: false; reason: string };

/** In-memory store of agent tasks, updated only through agent reports. */
export interface TaskStore {
  /** A copy of the task, or undefined if the store has never seen it. */
  get(id: string): AgentTask | undefined;
  /** Copies of all tasks, in the order they were created. */
  all(): AgentTask[];
  /** Apply one report. Never throws; see createTaskStore for the rules. */
  apply(report: StatusReport): ApplyReportResult<AgentTask>;
  /**
   * Create a queued task that a person made. Never throws. Rejects, and
   * changes nothing, if the input is malformed or the id is already taken:
   * an existing task is never overwritten.
   */
  create(input: CreateTaskInput): CreateTaskResult;
}

/**
 * Create a task store. It starts with `initial`: tasks that already exist,
 * for example loaded from a database, in the order they were created.
 * Only id, status, updatedAt and the optional title, agent, note and source
 * are copied. Throws a TypeError if an initial task is malformed or two share an
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
 * A report never sets or clears a task's source: only create() sets it,
 * and it stays on the task for good.
 *
 * create(input) checks that the input is well formed (an id of 1 to
 * MAX_TASK_ID_LENGTH characters, title and agent by the parseReport text
 * rules, a valid createdAt, a known source), then that the id is new
 * ("task already exists"), and only then stores the task.
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

    create(input) {
      try {
        const problem = createProblem(input);
        if (problem !== undefined) return { ok: false, reason: problem };
        if (tasks.has(input.id)) return { ok: false, reason: 'task already exists' };
        const task = copyTask({
          id: input.id,
          status: 'queued',
          updatedAt: input.createdAt,
          title: input.title,
          agent: input.agent,
          source: input.source,
        });
        tasks.set(task.id, task);
        return { ok: true, task: copyTask(task) };
      } catch {
        return { ok: false, reason: 'invalid task' };
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
  if (task.source !== undefined) copy.source = task.source;
  return copy;
}

function isValidTask(task: unknown): task is AgentTask {
  if (typeof task !== 'object' || task === null) return false;
  const { id, status, updatedAt, title, agent, note, source } = task as Record<string, unknown>;
  return (
    typeof id === 'string' &&
    id.length > 0 &&
    isAgentTaskStatus(status) &&
    typeof updatedAt === 'string' &&
    !Number.isNaN(Date.parse(updatedAt)) &&
    isOptionalString(title) &&
    isOptionalString(agent) &&
    isOptionalString(note) &&
    (source === undefined || isTaskSource(source))
  );
}

/** Why a create() input is not acceptable, or undefined if it is. Never echoes values. */
function createProblem(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return 'task must be an object';
  const { id, title, agent, createdAt, source } = input as Record<string, unknown>;
  const idProblem = textProblem('id', id, MAX_TASK_ID_LENGTH);
  if (idProblem !== undefined) return idProblem;
  const titleProblem = textProblem('title', title, MAX_TITLE_LENGTH);
  if (titleProblem !== undefined) return titleProblem;
  if (agent !== undefined) {
    const agentProblem = textProblem('agent', agent, MAX_AGENT_LENGTH);
    if (agentProblem !== undefined) return agentProblem;
  }
  if (typeof createdAt !== 'string' || Number.isNaN(Date.parse(createdAt))) {
    return 'invalid timestamp';
  }
  if (!isTaskSource(source)) return 'source is not valid';
  return undefined;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}
