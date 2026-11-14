// Create a task: POST /v1/tasks { title }. Live mode only. Pure: no React.
// Opsy confirms with the task the server sent back, never one it made up.

import type { Task } from '../../types';
import { TASKS_PATH } from '../source';
import { parseServerTask, toUiTask } from '../serverTasks';
import { problemReply } from './problems';
import { callApi, type ApiResult } from './serverCall';
import type { TaskLine, TaskListWidget, TextWidget } from './types';

/** The server's limit on a task title, in characters. */
export const TASK_TITLE_MAX = 200;

export const CREATED_SOURCE = 'Created on your server';

/** The title to send: trimmed, 1 to TASK_TITLE_MAX characters. undefined if it is not. */
export function taskTitleFrom(text: string): string | undefined {
  const title = text.trim();
  return title === '' || title.length > TASK_TITLE_MAX ? undefined : title;
}

/**
 * Create a task. Never throws. A title the server would refuse (empty, over
 * 200 characters) is a 'bad-request' without a request.
 */
export async function createTask(
  token: string,
  text: string,
  signal: AbortSignal,
  fetchImpl?: typeof fetch,
): Promise<ApiResult<Task>> {
  const title = taskTitleFrom(text);
  if (title === undefined) {
    return { ok: false, problem: 'bad-request', reason: `a task title is 1 to ${TASK_TITLE_MAX} characters.` };
  }
  return callApi({
    token, action: 'createTask', path: TASKS_PATH, method: 'POST', json: { title }, signal, fetchImpl,
    parse: (body) => {
      if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
      const task = parseServerTask((body as { task?: unknown }).task);
      return task === undefined ? undefined : toUiTask(task);
    },
  });
}

/** Opsy's message for a result: the created task, as the server sent it, or the problem. */
export function createTaskReply(result: ApiResult<Task>): TaskListWidget | TextWidget {
  if (!result.ok) return problemReply(result.problem, result.reason);
  const t = result.value;
  const line: TaskLine = {
    id: t.id, title: t.task, status: t.status, agent: '', owner: t.owner === 'me' ? 'You' : '', detail: t.detail,
    ...(t.since === undefined ? {} : { since: t.since }),
  };
  return { kind: 'tasks', title: 'I created this task', tasks: [line], more: 0, source: CREATED_SOURCE };
}
