import { describe, expect, it } from 'vitest';
import type { StatusReport } from './applyReport';
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
});
