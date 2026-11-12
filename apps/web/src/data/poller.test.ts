import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startPoller, type LiveState } from './poller';
import type { FetchTasksResult } from './source';
import type { Task } from '../types';

const INTERVAL = 5000;
const TIMEOUT = 4000;
const T1 = [{ id: 't1' }] as Task[];
const T2 = [{ id: 't2' }] as Task[];
const ok = (tasks: Task[], skipped = 0): FetchTasksResult => ({ ok: true, tasks, skipped });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

/** Start a poller whose fetch answers from `answers` in order (the last one repeats). */
function setup(answers: FetchTasksResult[], opts: { hidden?: () => boolean } = {}) {
  const states: LiveState[] = [];
  const signals: AbortSignal[] = [];
  let i = 0;
  const fetchTasks = vi.fn(async (signal: AbortSignal) => {
    signals.push(signal);
    return answers[Math.min(i++, answers.length - 1)];
  });
  const poller = startPoller({
    fetchTasks,
    onState: (s) => states.push(s),
    isHidden: opts.hidden,
    intervalMs: INTERVAL,
    timeoutMs: TIMEOUT,
  });
  return { poller, fetchTasks, states, signals };
}

describe('startPoller', () => {
  it('says "connecting", then polls at once and goes live', async () => {
    const { fetchTasks, states } = setup([ok(T1)]);
    expect(states[0]).toEqual({ status: 'connecting' });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTasks).toHaveBeenCalledTimes(1);
    expect(states[1]).toEqual({ status: 'live', tasks: T1, skipped: 0, at: 1_000_000 });
  });

  it('polls again every interval, with the newest tasks', async () => {
    const { fetchTasks, states } = setup([ok(T1), ok(T2, 1)]);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(fetchTasks).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchTasks).toHaveBeenCalledTimes(2);
    expect(states.at(-1)).toMatchObject({ status: 'live', tasks: T2, skipped: 1 });
    await vi.advanceTimersByTimeAsync(INTERVAL * 3);
    expect(fetchTasks).toHaveBeenCalledTimes(5);
  });

  it('never starts a request while one is in flight', async () => {
    let answer: (r: FetchTasksResult) => void = () => {};
    const fetchTasks = vi.fn(() => new Promise<FetchTasksResult>((resolve) => { answer = resolve; }));
    const poller = startPoller({ fetchTasks, onState: () => {}, intervalMs: INTERVAL, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);
    poller.wake();
    expect(fetchTasks).toHaveBeenCalledTimes(1);
    answer(ok(T1));
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fetchTasks).toHaveBeenCalledTimes(2);
    poller.stop();
  });

  it('aborts a request after the timeout', async () => {
    const states: LiveState[] = [];
    const fetchTasks = vi.fn(
      (signal: AbortSignal) =>
        new Promise<FetchTasksResult>((resolve) => {
          signal.addEventListener('abort', () => resolve({ ok: false, problem: 'unreachable' }));
        }),
    );
    const poller = startPoller({ fetchTasks, onState: (s) => states.push(s), intervalMs: INTERVAL, timeoutMs: TIMEOUT });
    await vi.advanceTimersByTimeAsync(TIMEOUT - 1);
    expect(fetchTasks.mock.calls[0][0].aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchTasks.mock.calls[0][0].aborted).toBe(true);
    expect(states.at(-1)).toMatchObject({ status: 'offline', problem: 'unreachable' });
    poller.stop();
  });

  it('keeps the last good tasks while offline, then recovers', async () => {
    const { states } = setup([ok(T1), { ok: false, problem: 'unreachable' }, { ok: false, problem: 'server-error' }, ok(T2)]);
    await vi.advanceTimersByTimeAsync(0);
    vi.setSystemTime(2_000_000);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(states.at(-1)).toEqual({ status: 'offline', problem: 'unreachable', tasks: T1, skipped: 0, at: 1_000_000 });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(states.at(-1)).toEqual({ status: 'offline', problem: 'server-error', tasks: T1, skipped: 0, at: 1_000_000 });
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(states.at(-1)).toMatchObject({ status: 'live', tasks: T2 });
  });

  it('is offline with no tasks when the first request fails', async () => {
    const { states } = setup([{ ok: false, problem: 'bad-response' }]);
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toEqual({ status: 'offline', problem: 'bad-response', tasks: [], skipped: 0, at: null });
  });

  it('stops for good on 401', async () => {
    const { fetchTasks, states, poller } = setup([ok(T1), { ok: false, problem: 'unauthorized' }, ok(T2)]);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(states.at(-1)).toMatchObject({ status: 'offline', problem: 'unauthorized', tasks: T1 });
    poller.wake();
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(fetchTasks).toHaveBeenCalledTimes(2);
  });

  it('treats a fetch that throws as unreachable', async () => {
    const states: LiveState[] = [];
    const poller = startPoller({ fetchTasks: async () => { throw new Error('bug'); }, onState: (s) => states.push(s) });
    await vi.advanceTimersByTimeAsync(0);
    expect(states.at(-1)).toMatchObject({ status: 'offline', problem: 'unreachable' });
    poller.stop();
  });

  it('pauses while the page is hidden and resumes on wake', async () => {
    let hidden = false;
    const { fetchTasks, poller } = setup([ok(T1)], { hidden: () => hidden });
    await vi.advanceTimersByTimeAsync(0);
    hidden = true;
    await vi.advanceTimersByTimeAsync(INTERVAL); // this poll sees the page hidden and schedules nothing
    expect(fetchTasks).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(fetchTasks).toHaveBeenCalledTimes(2);

    hidden = false;
    poller.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTasks).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(fetchTasks).toHaveBeenCalledTimes(4);
    poller.stop();
  });

  it('wake while idle polls now instead of waiting for the timer', async () => {
    const { fetchTasks, poller } = setup([ok(T1)]);
    await vi.advanceTimersByTimeAsync(0);
    poller.wake();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchTasks).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(fetchTasks).toHaveBeenCalledTimes(2); // the old timer was cancelled
    poller.stop();
  });

  it('stop aborts the request in flight and reports nothing more', async () => {
    const { poller, states, signals, fetchTasks } = setup([ok(T1)]);
    expect(signals[0].aborted).toBe(false);
    poller.stop();
    expect(signals[0].aborted).toBe(true);
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(states).toEqual([{ status: 'connecting' }]);
    expect(fetchTasks).toHaveBeenCalledTimes(1);
  });

  it('stop between polls cancels the timer', async () => {
    const { poller, fetchTasks } = setup([ok(T1)]);
    await vi.advanceTimersByTimeAsync(0);
    poller.stop();
    await vi.advanceTimersByTimeAsync(INTERVAL * 10);
    expect(fetchTasks).toHaveBeenCalledTimes(1);
  });
});
