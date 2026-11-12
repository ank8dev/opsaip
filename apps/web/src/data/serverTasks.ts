// Tasks from the Opsaip server (GET /v1/tasks), turned into the UI's Task.
// Pure: no fetch, no React. The response is checked like untrusted input,
// because a bad or unexpected server answer must not crash the page.

import type { AgentTask, AgentTaskStatus } from '@opsaip/core';
import type { Task, TaskStatus } from '../types';

/**
 * The UI label of each machine status. A Record, not a switch or a list, so a
 * status added to core fails the build until it gets a label here.
 */
export const STATUS_LABEL: Record<AgentTaskStatus, TaskStatus> = {
  queued: 'Queued',
  running: 'Working',
  waiting_on_human: 'Needs you',
  done: 'Done',
  failed: 'Failed',
};

export type ParseTasksResult =
  | { ok: true; tasks: AgentTask[]; skipped: number }
  | { ok: false; reason: string };

/**
 * Read the body of GET /v1/tasks: `{ "tasks": [...] }`. Never throws.
 *
 * - Not an object with a `tasks` array -> { ok: false }.
 * - A task that breaks the contract is skipped and counted in `skipped`:
 *   id not a non-blank string, unknown status, updatedAt not a timestamp,
 *   title / agent / note present but not a string, or an id already seen
 *   (the first one wins; ids are React keys and must be unique).
 * - Only the known fields are copied, into fresh objects. Extra fields from a
 *   newer server are ignored.
 */
export function parseTasksResponse(body: unknown): ParseTasksResult {
  if (!isRecord(body) || !Array.isArray(body.tasks)) {
    return { ok: false, reason: 'response is not { tasks: [...] }' };
  }

  const tasks: AgentTask[] = [];
  const seen = new Set<string>();
  for (const item of body.tasks as unknown[]) {
    const task = parseTask(item);
    if (task === undefined || seen.has(task.id)) continue;
    seen.add(task.id);
    tasks.push(task);
  }
  return { ok: true, tasks, skipped: body.tasks.length - tasks.length };
}

/** One server task as a UI Task. The server knows no owner, tool or priority yet. */
export function toUiTask(task: AgentTask): Task {
  return {
    id: task.id,
    task: task.title ?? task.id,
    tool: '',
    status: STATUS_LABEL[task.status],
    owner: '',
    source: task.agent ?? '',
    detail: task.note ?? '',
    since: task.updatedAt,
  };
}

function parseTask(item: unknown): AgentTask | undefined {
  if (!isRecord(item)) return undefined;
  const { id, status, updatedAt, title, agent, note } = item;

  if (typeof id !== 'string' || id.trim() === '') return undefined;
  // hasOwn, not `in`: "toString" or "__proto__" must not count as statuses.
  if (typeof status !== 'string' || !Object.hasOwn(STATUS_LABEL, status)) return undefined;
  if (typeof updatedAt !== 'string' || Number.isNaN(Date.parse(updatedAt))) return undefined;
  if (!isOptionalString(title) || !isOptionalString(agent) || !isOptionalString(note)) return undefined;

  const task: AgentTask = { id, status: status as AgentTaskStatus, updatedAt };
  if (title !== undefined) task.title = title;
  if (agent !== undefined) task.agent = agent;
  if (note !== undefined) task.note = note;
  return task;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}
