import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createTaskStore, type StatusReport } from '@opsaip/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase } from './db';
import { createSqliteTaskStore } from './sqliteTaskStore';

let dir: string;
let path: string;
let db: DatabaseSync;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opsaip-store-'));
  path = join(dir, 'opsaip.db');
  db = openDatabase(path);
});
afterEach(() => {
  if (db.isOpen) db.close();
  rmSync(dir, { recursive: true, force: true });
});

const T0 = '2026-11-01T10:00:00Z';
const T1 = '2026-11-01T10:05:00Z';
const T2 = '2026-11-01T10:10:00Z';
const r = (taskId: string, status: StatusReport['status'], at: string): StatusReport => ({
  taskId,
  status,
  at,
});

describe('createSqliteTaskStore', () => {
  it('gives the same result as the in-memory core store for every rule', () => {
    const reports: StatusReport[] = [
      r('a', 'queued', T0), // create
      r('a', 'queued', T0), // exact duplicate
      r('a', 'queued', '2026-11-01T13:00:00+03:00'), // same instant, other offset
      r('b', 'running', T0), // unknown task, not queued
      r('a', 'done', T1), // transition not allowed
      r('a', 'running', T1), // allowed
      r('a', 'waiting_on_human', T0), // stale
      r('c', 'queued', 'not a time'), // invalid timestamp on create
      r('c', 'queued', T0),
      r('a', 'done', T2),
      r('a', 'running', T2), // done is final
      null as unknown as StatusReport, // malformed
      { taskId: 7 } as unknown as StatusReport, // malformed
    ];
    const memory = createTaskStore();
    const sqlite = createSqliteTaskStore(db);

    for (const report of reports) {
      expect(sqlite.apply(report), JSON.stringify(report)).toEqual(memory.apply(report));
    }
    expect(sqlite.all()).toEqual(memory.all());
    expect(sqlite.get('a')).toEqual(memory.get('a'));
    expect(sqlite.get('missing')).toBeUndefined();
  });

  it('gives the same result as the in-memory core store for title, agent and note', () => {
    const reports: StatusReport[] = [
      { ...r('a', 'queued', T0), title: 'Fix login', agent: 'claude-code', note: 'n0' },
      { ...r('a', 'queued', T0), note: 'ignored: exact duplicate' },
      { ...r('a', 'running', T1), agent: 'codex' }, // note cleared, agent replaced
      { ...r('a', 'waiting_on_human', T1), note: 'Which branch?' },
      r('a', 'failed', T2), // note cleared
      { ...r('a', 'queued', T2), title: 'Fix login, take 2' }, // retry renames
      { ...r('b', 'queued', T0), note: 'only a note' },
    ];
    const memory = createTaskStore();
    const sqlite = createSqliteTaskStore(db);

    for (const report of reports) {
      expect(sqlite.apply(report), JSON.stringify(report)).toEqual(memory.apply(report));
      expect(sqlite.all()).toEqual(memory.all());
    }
    expect(sqlite.get('a')).toEqual({
      id: 'a',
      status: 'queued',
      updatedAt: T2,
      title: 'Fix login, take 2',
      agent: 'codex',
    });
  });

  it('stores a field that is not set as NULL and reads it back as absent', () => {
    const store = createSqliteTaskStore(db);
    store.apply({ ...r('a', 'queued', T0), note: 'n' });
    store.apply(r('a', 'running', T1));
    expect(db.prepare('SELECT title, agent, note FROM tasks').get()).toEqual({
      title: null,
      agent: null,
      note: null,
    });
    expect(Object.keys(store.get('a')!).sort()).toEqual(['id', 'status', 'updatedAt']);
  });

  it('keeps creation order when a task is updated later', () => {
    // Not alphabetical on purpose: ORDER BY id would give another order.
    const store = createSqliteTaskStore(db);
    store.apply(r('zeta', 'queued', T0));
    store.apply(r('alpha', 'queued', T0));
    store.apply(r('zeta', 'running', T1));
    expect(store.all().map((task) => task.id)).toEqual(['zeta', 'alpha']);
  });

  it('returns plain objects (not SQLite rows) that callers cannot use to change the data', () => {
    const store = createSqliteTaskStore(db);
    store.apply(r('a', 'queued', T0));
    const [task] = store.all();
    expect(Object.getPrototypeOf(task)).toBe(Object.prototype);
    task.status = 'done';
    expect(store.get('a')?.status).toBe('queued');
  });

  it('keeps tasks after the database is closed and opened again', () => {
    const first = createSqliteTaskStore(db);
    first.apply(r('a', 'queued', T0));
    first.apply(r('a', 'running', T1));
    db.close();

    db = openDatabase(path);
    const second = createSqliteTaskStore(db);
    expect(second.all()).toEqual([{ id: 'a', status: 'running', updatedAt: T1 }]);
    // The restored task follows the rules from where it was.
    expect(second.apply(r('a', 'queued', T2))).toEqual({
      ok: false,
      reason: 'transition not allowed: running -> queued',
    });
  });

  describe('create', () => {
    const mine = (id: string, extra: Record<string, string> = {}) => ({
      id,
      title: 'Fix login',
      createdAt: T0,
      source: 'you' as const,
      ...extra,
    });

    it('gives the same result as the in-memory core store', () => {
      const memory = createTaskStore();
      const sqlite = createSqliteTaskStore(db);
      const steps = [
        mine('a'),
        mine('a', { title: 'again' }), // taken
        mine('b', { agent: 'codex' }),
        mine(''), // malformed
        mine('c', { createdAt: 'later' }),
        null as never,
        { id: 7 } as never,
      ];
      for (const input of steps) {
        expect(sqlite.create(input), JSON.stringify(input)).toEqual(memory.create(input));
        expect(sqlite.all()).toEqual(memory.all());
      }
    });

    it('stores source, and later reports keep it', () => {
      const store = createSqliteTaskStore(db);
      expect(store.create(mine('a', { agent: 'codex' }))).toEqual({
        ok: true,
        task: { id: 'a', status: 'queued', updatedAt: T0, title: 'Fix login', agent: 'codex', source: 'you' },
      });
      expect(db.prepare('SELECT source FROM tasks').get()).toEqual({ source: 'you' });
      store.apply(r('a', 'running', T1));
      store.apply({ ...r('a', 'waiting_on_human', T2), note: 'which?' });
      expect(db.prepare('SELECT source FROM tasks').get()).toEqual({ source: 'you' });
      expect(store.get('a')).toMatchObject({ status: 'waiting_on_human', source: 'you' });
    });

    it('stores NULL for a task made by an agent', () => {
      const store = createSqliteTaskStore(db);
      store.apply(r('a', 'queued', T0));
      expect(db.prepare('SELECT source FROM tasks').get()).toEqual({ source: null });
      expect(Object.hasOwn(store.get('a')!, 'source')).toBe(false);
    });

    it('rejects a taken id and never overwrites the stored task', () => {
      const store = createSqliteTaskStore(db);
      store.apply({ ...r('a', 'queued', T0), title: 'From an agent' });
      expect(store.create(mine('a'))).toEqual({ ok: false, reason: 'task already exists' });
      expect(store.get('a')).toEqual({ id: 'a', status: 'queued', updatedAt: T0, title: 'From an agent' });
      expect(db.isTransaction).toBe(false);
    });

    it('keeps creation order together with report-created tasks', () => {
      const store = createSqliteTaskStore(db);
      store.apply(r('zeta', 'queued', T0));
      store.create(mine('alpha'));
      store.apply(r('zeta', 'running', T1));
      expect(store.all().map((t) => t.id)).toEqual(['zeta', 'alpha']);
    });

    it('keeps source after the database is closed and opened again', () => {
      const first = createSqliteTaskStore(db);
      first.create(mine('a'));
      first.apply(r('a', 'running', T1));
      db.close();

      db = openDatabase(path);
      expect(createSqliteTaskStore(db).get('a')).toEqual({
        id: 'a',
        status: 'running',
        updatedAt: T1,
        title: 'Fix login',
        source: 'you',
      });
    });

    it('throws, saves nothing and leaves no transaction open when the database fails', () => {
      const store = createSqliteTaskStore(db);
      db.exec("CREATE TRIGGER fail BEFORE INSERT ON tasks BEGIN SELECT RAISE(ABORT, 'boom'); END");
      expect(() => store.create(mine('a'))).toThrow('boom');
      expect(db.isTransaction).toBe(false);
      db.exec('DROP TRIGGER fail');
      expect(store.all()).toEqual([]);
      expect(store.create(mine('a')).ok).toBe(true);
    });

    it('refuses a stored row with an unknown source instead of serving it', () => {
      db.prepare('INSERT INTO tasks (id, status, updated_at, source) VALUES (?, ?, ?, ?)').run('a', 'queued', T0, 'robot');
      expect(() => createSqliteTaskStore(db).all()).toThrow(TypeError);
    });
  });

  describe('when the database fails during apply', () => {
    // A trigger makes the write itself fail, like a full disk would.
    const failOn = (event: 'INSERT' | 'UPDATE') =>
      db.exec(`CREATE TRIGGER fail BEFORE ${event} ON tasks BEGIN SELECT RAISE(ABORT, 'boom'); END`);

    it('throws, saves nothing, and leaves no transaction open (insert)', () => {
      const store = createSqliteTaskStore(db);
      failOn('INSERT');
      expect(() => store.apply(r('a', 'queued', T0))).toThrow('boom');
      expect(db.isTransaction).toBe(false);
      expect(store.all()).toEqual([]);

      db.exec('DROP TRIGGER fail');
      expect(store.apply(r('a', 'queued', T0)).ok).toBe(true);
    });

    it('throws and keeps the old task (update)', () => {
      const store = createSqliteTaskStore(db);
      store.apply(r('a', 'queued', T0));
      failOn('UPDATE');
      expect(() => store.apply(r('a', 'running', T1))).toThrow('boom');
      expect(db.isTransaction).toBe(false);
      expect(store.get('a')).toEqual({ id: 'a', status: 'queued', updatedAt: T0 });
    });
  });

  it('refuses malformed stored rows instead of serving them', () => {
    db.prepare('INSERT INTO tasks (id, status, updated_at) VALUES (?, ?, ?)').run('a', 'paused', T0);
    const store = createSqliteTaskStore(db);
    expect(() => store.all()).toThrow(new TypeError('initial task 0 is malformed'));
    expect(() => store.apply(r('a', 'running', T1))).toThrow(TypeError);
    expect(db.isTransaction).toBe(false);
  });
});
