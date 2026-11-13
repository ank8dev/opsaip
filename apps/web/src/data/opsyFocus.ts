// Where Opsy is and what it shows. Pure: no React, no clock, no AI model.
// Everything comes from task statuses, so Demo mocks and live server tasks
// (both are the UI's Task) give the same answer for the same input.

import type { Task, TaskStatus } from '../types';
import type { ConnectionLabel } from './connectionView';

export type OpsyState = 'question' | 'error' | 'working' | 'done' | 'idle' | 'offline';

export interface OpsyFocus {
  /** The task Opsy points at; null for idle and offline. */
  taskId: string | null;
  state: OpsyState;
}

/** A Done task counts as "just finished" for this long after its last status change. */
export const DONE_WINDOW_MS = 60_000;

/** Highest priority first. Queued tasks never get Opsy's attention. */
const PRIORITY: readonly { status: TaskStatus; state: OpsyState }[] = [
  { status: 'Needs you', state: 'question' },
  { status: 'Failed', state: 'error' },
  { status: 'Working', state: 'working' },
  { status: 'Done', state: 'done' },
];

/**
 * Decide Opsy's focus.
 *
 * 1. `connection` is Offline -> offline, no task.
 * 2. Otherwise the first status in PRIORITY that has a task wins. A Done task
 *    counts only if it changed status at most DONE_WINDOW_MS before `now`
 *    (a time in the future counts too, as in `ago`). No task -> idle.
 * 3. Among tasks of the same status: the latest `since` wins; equal times
 *    are broken by the smaller id. A task without a valid `since` is older
 *    than any task with one.
 *
 * `now` is ms since epoch.
 */
export function opsyFocus(tasks: readonly Task[], connection: ConnectionLabel, now: number): OpsyFocus {
  if (connection === 'Offline') return { taskId: null, state: 'offline' };

  for (const { status, state } of PRIORITY) {
    let best: Task | null = null;
    for (const t of tasks) {
      if (t.status !== status) continue;
      if (status === 'Done' && !finishedRecently(t, now)) continue;
      if (best === null || isNewer(t, best)) best = t;
    }
    if (best !== null) return { taskId: best.id, state };
  }
  return { taskId: null, state: 'idle' };
}

function finishedRecently(t: Task, now: number): boolean {
  const at = sinceMs(t);
  return at !== null && now - at <= DONE_WINDOW_MS;
}

/** True if `a` should be picked over `b`: later `since`, then smaller id. */
function isNewer(a: Task, b: Task): boolean {
  const ta = sinceMs(a) ?? -Infinity;
  const tb = sinceMs(b) ?? -Infinity;
  if (ta !== tb) return ta > tb;
  // Plain code-unit comparison, not localeCompare: the same on every machine.
  return a.id < b.id;
}

/** `since` as ms since epoch, or null if missing or not a date. Parsed, not compared as text: offsets differ. */
function sinceMs(t: Task): number | null {
  const ms = Date.parse(t.since ?? '');
  return Number.isNaN(ms) ? null : ms;
}
