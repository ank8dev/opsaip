// Which run belongs to which task, for the Chat tab. A run's task is known when
// the run is started here (and changes when a finished run is resumed), so the
// page remembers it for this tab: sessionStorage, bounded, ids only. Pure.

import type { KeyValueStore } from '../source';

export const RUN_TASKS_KEY = 'opsaip.runTasks';
/** The most task ids remembered; the oldest are forgotten first. */
export const MAX_REMEMBERED = 50;

export type RunTasks = Record<string, string>; // task id -> run id

function sessionStore(): KeyValueStore | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined;
  }
}

export function loadRunTasks(storage: KeyValueStore | undefined = sessionStore()): RunTasks {
  try {
    const raw = storage?.getItem(RUN_TASKS_KEY) ?? null;
    if (raw === null) return {};
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return {};
    const out: RunTasks = {};
    for (const [task, run] of Object.entries(value)) if (typeof run === 'string' && run !== '') out[task] = run;
    return out;
  } catch {
    return {};
  }
}

/** `map` plus task -> run, keeping at most MAX_REMEMBERED (the newest). Does not change `map`. */
export function rememberRunTask(map: RunTasks, taskId: string, runId: string): RunTasks {
  if (map[taskId] === runId) return map;
  const next: RunTasks = { ...map };
  delete next[taskId]; // re-added last, so it counts as the newest
  next[taskId] = runId;
  const keys = Object.keys(next);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete next[k];
  return next;
}

export function saveRunTasks(map: RunTasks, storage: KeyValueStore | undefined = sessionStore()): void {
  try {
    storage?.setItem(RUN_TASKS_KEY, JSON.stringify(map));
  } catch {
    // Storage blocked: the chat tab just will not find older runs after a reload.
  }
}
