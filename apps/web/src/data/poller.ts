// Polls the server for tasks every few seconds. Pure: no React, no DOM.
// The caller passes the fetch function and says when the page is hidden.
//
// Rules:
//   - one request at a time: the next one is scheduled only after the last
//     answer (a setTimeout chain, not setInterval), so slow answers never pile up;
//   - each request has a timeout;
//   - while the page is hidden, no new request is scheduled; wake() resumes at once;
//   - 401 stops polling: a wrong token stays wrong, so retrying only adds load;
//   - after any other failure the last good tasks are kept, and polling goes on.

import type { Task } from '../types';
import type { FetchProblem, FetchTasksResult } from './source';

export const POLL_INTERVAL_MS = 5000;
export const REQUEST_TIMEOUT_MS = 4000;

export type LiveState =
  /** Connected, no answer yet. */
  | { status: 'connecting' }
  /** The last request succeeded. `at` is when (ms since epoch). */
  | { status: 'live'; tasks: Task[]; skipped: number; at: number }
  /** The last request failed. `tasks` and `at` are from the last success, if any. */
  | { status: 'offline'; problem: FetchProblem; tasks: Task[]; skipped: number; at: number | null };

/**
 * Where the data on screen comes from: Demo (dev and tests only), no server yet
 * (the Connect screen), or the server (connecting, live, offline).
 */
export type DataSource = { status: 'demo' } | { status: 'disconnected' } | LiveState;

export interface PollerOptions {
  fetchTasks: (signal: AbortSignal) => Promise<FetchTasksResult>;
  onState: (state: LiveState) => void;
  isHidden?: () => boolean;
  now?: () => number;
  intervalMs?: number;
  timeoutMs?: number;
}

export interface Poller {
  /** Poll now if the poller is idle (e.g. the page became visible again). */
  wake: () => void;
  /** Stop for good: cancel the timer and the request in flight; no more onState calls. */
  stop: () => void;
}

/**
 * The state to show after `next` arrives, given what is on screen (`prev`).
 * The caller (the React provider) keeps `prev`; a poller only knows its own
 * answers, and a new poller starts with none.
 */
export function keepLastGood(prev: LiveState | null, next: LiveState): LiveState {
  if (next.status === 'live') return next; // only a new success replaces the tasks
  const loaded = prev !== null && prev.status !== 'connecting' && prev.at !== null ? prev : null;
  if (loaded === null) return next;
  if (next.status === 'connecting') return loaded; // a new poller has no answer yet: keep the screen
  if (next.at !== null) return next; // the failing poller has its own, newer tasks
  return { ...next, tasks: loaded.tasks, skipped: loaded.skipped, at: loaded.at };
}

/** Start polling at once. */
export function startPoller({
  fetchTasks,
  onState,
  isHidden = () => false,
  now = Date.now,
  intervalMs = POLL_INTERVAL_MS,
  timeoutMs = REQUEST_TIMEOUT_MS,
}: PollerOptions): Poller {
  let stopped = false;
  let inFlight: AbortController | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastGood: { tasks: Task[]; skipped: number; at: number } | null = null;

  async function poll(): Promise<void> {
    timer = null;
    const controller = new AbortController();
    inFlight = controller;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let result: FetchTasksResult;
    try {
      result = await fetchTasks(controller.signal);
    } catch {
      result = { ok: false, problem: 'unreachable' }; // fetchTasks should not throw; be safe anyway
    } finally {
      clearTimeout(timeout);
      inFlight = null;
    }
    if (stopped) return;

    if (result.ok) {
      lastGood = { tasks: result.tasks, skipped: result.skipped, at: now() };
      onState({ status: 'live', ...lastGood });
    } else {
      onState({
        status: 'offline',
        problem: result.problem,
        tasks: lastGood?.tasks ?? [],
        skipped: lastGood?.skipped ?? 0,
        at: lastGood?.at ?? null,
      });
      if (result.problem === 'unauthorized') {
        stopped = true;
        return;
      }
    }
    if (!isHidden()) timer = setTimeout(poll, intervalMs);
  }

  onState({ status: 'connecting' });
  void poll();

  return {
    wake() {
      if (stopped || inFlight !== null) return;
      if (timer !== null) clearTimeout(timer);
      void poll();
    },
    stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      inFlight?.abort();
    },
  };
}
