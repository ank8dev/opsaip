import { describe, expect, it } from 'vitest';
import type { AgentTask, StatusReport } from './applyReport';
import { createTaskStore } from './taskStore';

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
