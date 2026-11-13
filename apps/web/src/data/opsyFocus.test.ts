import { describe, expect, it } from 'vitest';
import { DONE_WINDOW_MS, opsyFocus } from './opsyFocus';
import type { ConnectionLabel } from './connectionView';
import type { LocalTask, Task, TaskStatus } from '../types';

const NOW = Date.parse('2026-11-13T12:00:00Z');
const iso = (msBeforeNow: number) => new Date(NOW - msBeforeNow).toISOString();

function task(id: string, status: TaskStatus, since?: string): Task {
  return { id, task: id, tool: '', status, owner: '', source: '', detail: '', since };
}

const ONLINE: ConnectionLabel[] = ['Demo', 'Connecting', 'Live'];

describe('opsyFocus: offline', () => {
  it('Offline wins over every task, with no task', () => {
    const tasks = [task('a', 'Needs you', iso(0)), task('b', 'Failed', iso(0)), task('c', 'Working', iso(0)), task('d', 'Done', iso(0))];
    expect(opsyFocus(tasks, 'Offline', NOW)).toEqual({ taskId: null, state: 'offline' });
  });

  it('Offline with an empty list', () => {
    expect(opsyFocus([], 'Offline', NOW)).toEqual({ taskId: null, state: 'offline' });
  });

  it.each(ONLINE)('%s is not offline: the normal rules apply', (connection) => {
    expect(opsyFocus([task('a', 'Working', iso(0))], connection, NOW)).toEqual({ taskId: 'a', state: 'working' });
  });
});

describe('opsyFocus: nothing to show', () => {
  it.each(ONLINE)('empty list -> idle (%s)', (connection) => {
    expect(opsyFocus([], connection, NOW)).toEqual({ taskId: null, state: 'idle' });
  });

  it('only Queued tasks -> idle', () => {
    expect(opsyFocus([task('a', 'Queued', iso(0))], 'Live', NOW)).toEqual({ taskId: null, state: 'idle' });
  });
});

describe('opsyFocus: priority', () => {
  const question = task('q', 'Needs you', iso(50_000));
  const error = task('e', 'Failed', iso(40_000));
  const working = task('w', 'Working', iso(30_000));
  const done = task('d', 'Done', iso(1_000));
  const queued = task('z', 'Queued', iso(0));

  it('each status maps to its state', () => {
    expect(opsyFocus([question], 'Live', NOW)).toEqual({ taskId: 'q', state: 'question' });
    expect(opsyFocus([error], 'Live', NOW)).toEqual({ taskId: 'e', state: 'error' });
    expect(opsyFocus([working], 'Live', NOW)).toEqual({ taskId: 'w', state: 'working' });
    expect(opsyFocus([done], 'Live', NOW)).toEqual({ taskId: 'd', state: 'done' });
  });

  it('question > error > working > done, even when lower ones are newer', () => {
    expect(opsyFocus([queued, done, working, error, question], 'Live', NOW).state).toBe('question');
    expect(opsyFocus([queued, done, working, error], 'Live', NOW).state).toBe('error');
    expect(opsyFocus([queued, done, working], 'Live', NOW).state).toBe('working');
    expect(opsyFocus([queued, done], 'Live', NOW).state).toBe('done');
  });

  it('works with a task started from this page (LocalTask)', () => {
    const local: LocalTask = { ...task('l', 'Needs you', iso(0)), local: true, msgs: [] };
    expect(opsyFocus([working, local], 'Demo', NOW)).toEqual({ taskId: 'l', state: 'question' });
  });
});

describe('opsyFocus: within the same priority', () => {
  it('the most recently updated task wins, whatever the order', () => {
    const tasks = [task('old', 'Working', iso(30_000)), task('new', 'Working', iso(10_000)), task('mid', 'Working', iso(20_000))];
    expect(opsyFocus(tasks, 'Live', NOW).taskId).toBe('new');
    expect(opsyFocus([...tasks].reverse(), 'Live', NOW).taskId).toBe('new');
  });

  it('compares instants, not text: offsets are parsed', () => {
    // 12:30+01:00 is 11:30Z, older than 11:45Z, although it sorts later as text.
    const tasks = [task('plus1', 'Failed', '2026-11-13T12:30:00+01:00'), task('utc', 'Failed', '2026-11-13T11:45:00Z')];
    expect(opsyFocus(tasks, 'Live', NOW).taskId).toBe('utc');
  });

  it('a tie on time goes to the smaller id, in any input order', () => {
    const at = iso(5_000);
    const tasks = [task('b', 'Needs you', at), task('a', 'Needs you', at), task('c', 'Needs you', at)];
    expect(opsyFocus(tasks, 'Live', NOW)).toEqual({ taskId: 'a', state: 'question' });
    expect(opsyFocus([...tasks].reverse(), 'Live', NOW)).toEqual({ taskId: 'a', state: 'question' });
  });

  it('the same instant written two ways is a tie', () => {
    const tasks = [task('b', 'Working', '2026-11-13T12:00:00+01:00'), task('a', 'Working', '2026-11-13T11:00:00Z')];
    expect(opsyFocus(tasks, 'Live', NOW).taskId).toBe('a');
  });

  it('ids compare by code unit, not by locale ("B" < "a")', () => {
    const at = iso(0);
    expect(opsyFocus([task('a', 'Working', at), task('B', 'Working', at)], 'Live', NOW).taskId).toBe('B');
  });

  it('a task without a valid since is older than one with it; two such tasks tie on id', () => {
    expect(opsyFocus([task('a', 'Working'), task('b', 'Working', iso(99_000_000))], 'Live', NOW).taskId).toBe('b');
    expect(opsyFocus([task('b', 'Working', 'not a date'), task('a', 'Working')], 'Live', NOW).taskId).toBe('a');
  });
});

describe('opsyFocus: the 60-second window for done', () => {
  it('is 60 seconds', () => {
    expect(DONE_WINDOW_MS).toBe(60_000);
  });

  it.each([
    [0, 'done'],
    [59_999, 'done'],
    [60_000, 'done'],
    [60_001, 'idle'],
    [3_600_000, 'idle'],
  ] as const)('finished %i ms ago -> %s', (age, state) => {
    expect(opsyFocus([task('d', 'Done', iso(age))], 'Live', NOW).state).toBe(state);
  });

  it('a finish time in the future (clock skew) counts as just finished', () => {
    expect(opsyFocus([task('d', 'Done', iso(-5_000))], 'Live', NOW)).toEqual({ taskId: 'd', state: 'done' });
  });

  it('a Done task without a valid since is never shown', () => {
    expect(opsyFocus([task('d', 'Done'), task('e', 'Done', 'x')], 'Live', NOW)).toEqual({ taskId: null, state: 'idle' });
  });

  it('an old Done task does not hide a recent one', () => {
    const tasks = [task('old', 'Done', iso(120_000)), task('recent', 'Done', iso(30_000))];
    expect(opsyFocus(tasks, 'Live', NOW)).toEqual({ taskId: 'recent', state: 'done' });
  });
});
