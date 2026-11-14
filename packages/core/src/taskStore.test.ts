import { describe, expect, it } from 'vitest';
import type { AgentTask, StatusReport } from './applyReport';
import { createTaskStore, type CreateTaskInput } from './taskStore';

const T0 = '2026-11-01T10:00:00.000Z';
const T1 = '2026-11-01T10:05:00.000Z';

const report = (overrides: Partial<StatusReport> = {}): StatusReport => ({
  taskId: 'task-1',
  status: 'queued',
  at: T0,
  ...overrides,
});

/** A store that already holds task-1 in status queued, updatedAt T0. */
const storeWithTask = () => {
  const store = createTaskStore();
  store.apply(report());
  return store;
};

describe('createTaskStore', () => {
  it('starts empty', () => {
    const store = createTaskStore();
    expect(store.all()).toEqual([]);
    expect(store.get('task-1')).toBeUndefined();
  });

  describe('rule 1: unknown task + queued creates the task', () => {
    it('creates the task and returns it', () => {
      const store = createTaskStore();
      const result = store.apply(report());
      const created = { id: 'task-1', status: 'queued', updatedAt: T0 };
      expect(result).toEqual({ ok: true, task: created });
      expect(store.get('task-1')).toEqual(created);
      expect(store.all()).toEqual([created]);
    });

    it('rejects an invalid timestamp and creates nothing', () => {
      const store = createTaskStore();
      const result = store.apply(report({ at: 'not a date' }));
      expect(result).toEqual({ ok: false, reason: 'invalid timestamp' });
      expect(store.all()).toEqual([]);
    });

    it('creates the task with the report\'s title, agent and note', () => {
      const store = createTaskStore();
      const result = store.apply(report({ title: 'Fix login', agent: 'claude-code', note: 'n' }));
      const created = {
        id: 'task-1',
        status: 'queued',
        updatedAt: T0,
        title: 'Fix login',
        agent: 'claude-code',
        note: 'n',
      };
      expect(result).toEqual({ ok: true, task: created });
      expect(store.get('task-1')).toEqual(created);
    });

    it('leaves out optional fields the report does not have', () => {
      const store = createTaskStore();
      store.apply(report({ title: 'Fix login' }));
      expect(Object.keys(store.get('task-1')!).sort()).toEqual(['id', 'status', 'title', 'updatedAt']);
    });

    it('keeps tasks in creation order', () => {
      const store = createTaskStore();
      store.apply(report({ taskId: 'b' }));
      store.apply(report({ taskId: 'a' }));
      expect(store.all().map((task) => task.id)).toEqual(['b', 'a']);
    });
  });

  describe('rule 2: unknown task + any other status is rejected', () => {
    it.each(['running', 'waiting_on_human', 'done', 'failed'] as const)(
      'rejects %s with "unknown task" and stores nothing',
      (status) => {
        const store = createTaskStore();
        const result = store.apply(report({ status }));
        expect(result).toEqual({ ok: false, reason: 'unknown task' });
        expect(store.all()).toEqual([]);
      },
    );
  });

  describe('rule 3: an exact duplicate is ok and changes nothing', () => {
    it('accepts the same queued report twice', () => {
      const store = storeWithTask();
      const result = store.apply(report());
      expect(result).toEqual({ ok: true, task: { id: 'task-1', status: 'queued', updatedAt: T0 } });
      expect(store.all()).toHaveLength(1);
    });

    it('accepts the same running report twice', () => {
      const store = storeWithTask();
      store.apply(report({ status: 'running', at: T1 }));
      const result = store.apply(report({ status: 'running', at: T1 }));
      expect(result.ok).toBe(true);
      expect(store.get('task-1')).toEqual({ id: 'task-1', status: 'running', updatedAt: T1 });
    });

    it('treats the same instant with another UTC offset as a duplicate', () => {
      const store = storeWithTask();
      // 13:00+03:00 is 10:00Z, the same instant as T0.
      const result = store.apply(report({ at: '2026-11-01T13:00:00+03:00' }));
      expect(result.ok).toBe(true);
      // The stored text is kept as it was: nothing changes on a duplicate.
      expect(store.get('task-1')?.updatedAt).toBe(T0);
    });

    it('does not treat the same status with another `at` as a duplicate', () => {
      const store = storeWithTask();
      const result = store.apply(report({ at: T1 }));
      // Falls through to applyReport, which forbids queued -> queued.
      expect(result).toEqual({ ok: false, reason: 'transition not allowed: queued -> queued' });
      expect(store.get('task-1')?.updatedAt).toBe(T0);
    });
  });

  describe('rule 3 and optional fields', () => {
    it('ignores a different note on an exact duplicate', () => {
      const store = createTaskStore();
      store.apply(report({ note: 'first' }));
      const result = store.apply(report({ note: 'second', agent: 'codex' }));
      expect(result).toEqual({
        ok: true,
        task: { id: 'task-1', status: 'queued', updatedAt: T0, note: 'first' },
      });
    });
  });

  describe('rule 4 and optional fields', () => {
    it('saves the merged fields: title kept, agent replaced, note replaced then cleared', () => {
      const store = createTaskStore();
      store.apply(report({ title: 'Fix login', agent: 'claude-code' }));
      store.apply(report({ status: 'running', at: T1, agent: 'codex' }));
      store.apply(report({ status: 'waiting_on_human', at: T1, note: 'Which branch?' }));
      expect(store.get('task-1')).toEqual({
        id: 'task-1',
        status: 'waiting_on_human',
        updatedAt: T1,
        title: 'Fix login',
        agent: 'codex',
        note: 'Which branch?',
      });
      store.apply(report({ status: 'running', at: T1 }));
      expect(store.get('task-1')).toEqual({
        id: 'task-1',
        status: 'running',
        updatedAt: T1,
        title: 'Fix login',
        agent: 'codex',
      });
    });
  });

  describe('rule 4: otherwise applyReport decides, and only ok results are saved', () => {
    it('saves an allowed transition', () => {
      const store = storeWithTask();
      const result = store.apply(report({ status: 'running', at: T1 }));
      const running = { id: 'task-1', status: 'running', updatedAt: T1 };
      expect(result).toEqual({ ok: true, task: running });
      expect(store.get('task-1')).toEqual(running);
    });

    it('rejects a forbidden transition and keeps the task', () => {
      const store = storeWithTask();
      const result = store.apply(report({ status: 'done', at: T1 }));
      expect(result).toEqual({ ok: false, reason: 'transition not allowed: queued -> done' });
      expect(store.get('task-1')).toEqual({ id: 'task-1', status: 'queued', updatedAt: T0 });
    });

    it('rejects a stale report and keeps the task', () => {
      const store = storeWithTask();
      const result = store.apply(report({ status: 'running', at: '2026-11-01T09:00:00.000Z' }));
      expect(result.ok).toBe(false);
      expect(store.get('task-1')).toEqual({ id: 'task-1', status: 'queued', updatedAt: T0 });
    });
  });

  describe('apply never throws', () => {
    it.each([null, undefined, {}, { taskId: 'task-1' }])('rejects malformed input %j', (input) => {
      const store = createTaskStore();
      const result = store.apply(input as unknown as StatusReport);
      expect(result.ok).toBe(false);
      expect(store.all()).toEqual([]);
    });
  });

  describe('isolation', () => {
    it('changing a returned task does not change the store', () => {
      const store = storeWithTask();
      const fromGet = store.get('task-1')!;
      fromGet.status = 'done';
      const fromAll = store.all()[0]!;
      fromAll.status = 'failed';
      const fromApply = store.apply(report());
      if (fromApply.ok) fromApply.task.status = 'running';
      expect(store.get('task-1')?.status).toBe('queued');
    });

    it('two stores do not share tasks', () => {
      const a = storeWithTask();
      const b = createTaskStore();
      expect(a.all()).toHaveLength(1);
      expect(b.all()).toEqual([]);
    });
  });

  describe('initial tasks', () => {
    const running: AgentTask = { id: 'task-1', status: 'running', updatedAt: T1 };

    it('starts with the given tasks, in the given order', () => {
      const other: AgentTask = { id: 'task-0', status: 'done', updatedAt: T0 };
      const store = createTaskStore([running, other]);
      expect(store.all()).toEqual([running, other]);
      expect(store.get('task-1')).toEqual(running);
    });

    it('applies the normal rules to initial tasks', () => {
      // A running task cannot be created through apply (only queued can),
      // which is why the store needs initial tasks at all.
      const store = createTaskStore([running]);
      expect(store.apply(report({ status: 'queued', at: T1 }))).toEqual({
        ok: false,
        reason: 'transition not allowed: running -> queued',
      });
      expect(store.apply(report({ status: 'done', at: T1 }))).toEqual({
        ok: true,
        task: { ...running, status: 'done' },
      });
    });

    it('treats a resent last report as a duplicate', () => {
      const store = createTaskStore([running]);
      expect(store.apply(report({ status: 'running', at: T1 }))).toEqual({
        ok: true,
        task: running,
      });
    });

    it('copies only the known fields, and is not affected by later changes', () => {
      const input = { ...running, extra: 'x' };
      const store = createTaskStore([input]);
      input.updatedAt = T0;
      expect(store.get('task-1')).toEqual(running);
    });

    it('copies title, agent and note of initial tasks', () => {
      const full: AgentTask = { ...running, title: 't', agent: 'a', note: 'n' };
      expect(createTaskStore([full]).get('task-1')).toEqual(full);
    });

    it('treats an undefined optional field as absent', () => {
      const store = createTaskStore([{ ...running, note: undefined }]);
      expect(Object.hasOwn(store.get('task-1')!, 'note')).toBe(false);
    });

    it('copies source of initial tasks', () => {
      const mine: AgentTask = { ...running, source: 'you' };
      expect(createTaskStore([mine]).get('task-1')).toEqual(mine);
    });

    it.each([
      ['null', null],
      ['a string', 'task-1'],
      ['no id', { status: 'queued', updatedAt: T0 }],
      ['an empty id', { id: '', status: 'queued', updatedAt: T0 }],
      ['a numeric id', { id: 1, status: 'queued', updatedAt: T0 }],
      ['an unknown status', { id: 'task-1', status: 'paused', updatedAt: T0 }],
      ['a "toString" status', { id: 'task-1', status: 'toString', updatedAt: T0 }],
      ['no updatedAt', { id: 'task-1', status: 'queued' }],
      ['an unparsable updatedAt', { id: 'task-1', status: 'queued', updatedAt: 'yesterday' }],
      ['a null title', { id: 'task-1', status: 'queued', updatedAt: T0, title: null }],
      ['a numeric agent', { id: 'task-1', status: 'queued', updatedAt: T0, agent: 1 }],
      ['an object note', { id: 'task-1', status: 'queued', updatedAt: T0, note: {} }],
      ['an unknown source', { id: 'task-1', status: 'queued', updatedAt: T0, source: 'agent' }],
      ['a null source', { id: 'task-1', status: 'queued', updatedAt: T0, source: null }],
    ])('throws a TypeError for a task with %s', (_name, task) => {
      const tasks = [running, task] as unknown as AgentTask[];
      expect(() => createTaskStore(tasks)).toThrow(new TypeError('initial task 1 is malformed'));
    });

    it('throws a TypeError for a repeated id', () => {
      const again: AgentTask = { ...running, status: 'queued' };
      expect(() => createTaskStore([running, again])).toThrow(
        new TypeError('initial task 1 repeats an earlier id'),
      );
    });
  });
});

describe('create', () => {
  const input = (overrides: Partial<CreateTaskInput> = {}): CreateTaskInput => ({
    id: 'mine-1',
    title: 'Fix login',
    createdAt: T0,
    source: 'you',
    ...overrides,
  });

  it('creates a queued task with source "you" and returns a copy', () => {
    const store = createTaskStore();
    const result = store.create(input({ agent: 'claude-code' }));
    const created = {
      id: 'mine-1',
      status: 'queued',
      updatedAt: T0,
      title: 'Fix login',
      agent: 'claude-code',
      source: 'you',
    };
    expect(result).toEqual({ ok: true, task: created });
    expect(store.get('mine-1')).toEqual(created);
    expect(store.all()).toEqual([created]);
    if (result.ok) result.task.title = 'changed';
    expect(store.get('mine-1')?.title).toBe('Fix login');
  });

  it('leaves out agent when there is none, and keeps creation order', () => {
    const store = createTaskStore();
    store.apply(report({ taskId: 'first' }));
    store.create(input());
    expect(store.all().map((t) => t.id)).toEqual(['first', 'mine-1']);
    expect(Object.hasOwn(store.get('mine-1')!, 'agent')).toBe(false);
  });

  it('rejects a taken id and never overwrites the existing task', () => {
    const store = createTaskStore();
    store.apply(report({ taskId: 'mine-1', title: 'Original', agent: 'a' }));
    const before = store.all();
    expect(store.create(input())).toEqual({ ok: false, reason: 'task already exists' });
    expect(store.all()).toEqual(before);
    // Also against a task that was itself created by create().
    store.create(input({ id: 'mine-2' }));
    expect(store.create(input({ id: 'mine-2', title: 'Other' }))).toEqual({
      ok: false,
      reason: 'task already exists',
    });
    expect(store.get('mine-2')?.title).toBe('Fix login');
  });

  it('a later agent report cannot reuse a created id to take it over, but updates it normally', () => {
    const store = createTaskStore();
    store.create(input());
    // "queued" on an existing task is a transition queued -> queued: not allowed.
    expect(store.apply(report({ taskId: 'mine-1', status: 'queued', at: T1 })).ok).toBe(false);
    expect(store.get('mine-1')?.source).toBe('you');
  });

  it('keeps source across every later report', () => {
    const store = createTaskStore();
    store.create(input());
    const T2 = '2026-11-01T10:10:00.000Z';
    const T3 = '2026-11-01T10:15:00.000Z';
    for (const [status, at, extra] of [
      ['running', T1, { agent: 'codex' }],
      ['waiting_on_human', T2, { note: 'which branch?' }],
      ['running', T3, {}],
    ] as const) {
      const result = store.apply(report({ taskId: 'mine-1', status, at, ...extra }));
      expect(result.ok).toBe(true);
      expect(store.get('mine-1')?.source).toBe('you');
    }
    const done = store.apply(report({ taskId: 'mine-1', status: 'done', at: '2026-11-01T10:20:00.000Z' }));
    expect(done.ok && done.task.source).toBe('you');
    expect(store.get('mine-1')?.source).toBe('you');
  });

  it('a report with a source field cannot set it on a new or an existing task', () => {
    const store = createTaskStore();
    store.apply({ ...report({ taskId: 'agent-made' }), source: 'you' } as StatusReport);
    expect(Object.hasOwn(store.get('agent-made')!, 'source')).toBe(false);
    store.apply({ ...report({ taskId: 'agent-made', status: 'running', at: T1 }), source: 'you' } as StatusReport);
    expect(Object.hasOwn(store.get('agent-made')!, 'source')).toBe(false);
  });

  it('keeps source on a retry cycle (failed -> queued)', () => {
    const store = createTaskStore();
    store.create(input());
    store.apply(report({ taskId: 'mine-1', status: 'running', at: T1 }));
    store.apply(report({ taskId: 'mine-1', status: 'failed', at: '2026-11-01T10:10:00.000Z' }));
    store.apply(report({ taskId: 'mine-1', status: 'queued', at: '2026-11-01T10:15:00.000Z' }));
    expect(store.get('mine-1')).toMatchObject({ status: 'queued', source: 'you' });
  });

  it.each([
    ['null', null, 'task must be an object'],
    ['a string', 'x', 'task must be an object'],
    ['a missing id', { ...{ title: 't', createdAt: T0, source: 'you' } }, 'id must be a string'],
    ['an empty id', { id: '', title: 't', createdAt: T0, source: 'you' }, 'id must not be empty'],
    ['a blank title', { id: 'a', title: '  ', createdAt: T0, source: 'you' }, 'title must not be only whitespace'],
    ['a numeric title', { id: 'a', title: 1, createdAt: T0, source: 'you' }, 'title must be a string'],
    ['a null agent', { id: 'a', title: 't', agent: null, createdAt: T0, source: 'you' }, 'agent must be a string'],
    ['a bad time', { id: 'a', title: 't', createdAt: 'later', source: 'you' }, 'invalid timestamp'],
    ['a missing time', { id: 'a', title: 't', source: 'you' }, 'invalid timestamp'],
    ['an unknown source', { id: 'a', title: 't', createdAt: T0, source: 'agent' }, 'source is not valid'],
    ['a missing source', { id: 'a', title: 't', createdAt: T0 }, 'source is not valid'],
  ])('rejects %s and creates nothing', (_name, bad, reason) => {
    const store = createTaskStore();
    expect(store.create(bad as unknown as CreateTaskInput)).toEqual({ ok: false, reason });
    expect(store.all()).toEqual([]);
  });

  it('does not treat "toString" or "__proto__" as a taken id', () => {
    const store = createTaskStore();
    expect(store.create(input({ id: 'toString' })).ok).toBe(true);
    expect(store.create(input({ id: '__proto__' })).ok).toBe(true);
  });
});
