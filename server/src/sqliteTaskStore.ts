import type { DatabaseSync } from 'node:sqlite';
import { createTaskStore, type AgentTask, type TaskStore } from '@opsaip/core';

/**
 * A TaskStore kept in SQLite. The database is the only copy of the tasks:
 * nothing is cached in memory, so memory and disk can never disagree.
 *
 * The rules are not repeated here. Each apply() or create() loads the one task it needs
 * into a short-lived core store (createTaskStore), lets core decide, and
 * saves the result, all in one transaction. create() inserts only if core
 * accepted the task, so an id that exists is never overwritten. Rows read back go through
 * createTaskStore too, which rejects malformed stored data.
 *
 * Unlike the in-memory store, apply() and create() can throw: when the database itself
 * fails (disk full, I/O error, file locked by another process). Nothing is
 * saved then; the HTTP layer turns the error into a 500.
 */
export function createSqliteTaskStore(db: DatabaseSync): TaskStore {
  const COLUMNS = 'id, status, updated_at AS updatedAt, title, agent, note, source';
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`);
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM tasks ORDER BY seq`);
  const upsert = db.prepare(`
    INSERT INTO tasks (id, status, updated_at, title, agent, note, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET
      status = excluded.status, updated_at = excluded.updated_at,
      title = excluded.title, agent = excluded.agent, note = excluded.note,
      source = excluded.source
  `);
  // Plain INSERT for create(): if core ever let a duplicate id through, the
  // UNIQUE constraint throws and nothing is overwritten.
  const insert = db.prepare(`
    INSERT INTO tasks (id, status, updated_at, title, agent, note, source)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const save = (statement: typeof upsert, task: AgentTask): void => {
    // A field that is not set is stored as NULL (node:sqlite rejects undefined).
    statement.run(
      task.id,
      task.status,
      task.updatedAt,
      task.title ?? null,
      task.agent ?? null,
      task.note ?? null,
      task.source ?? null,
    );
  };

  // BEGIN IMMEDIATE takes the write lock now, so read-check-write is atomic
  // even if another process opens the same file.
  const inTransaction = <R>(work: () => R): R => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite may have rolled back already (e.g. disk full). Keep the first error.
      }
      throw error;
    }
  };

  // Rows come back as plain records; createTaskStore validates them.
  const loadOne = (id: string): AgentTask[] => {
    const row = selectOne.get(id);
    return row === undefined ? [] : [fromRow(row)];
  };

  return {
    get(id) {
      return createTaskStore(loadOne(id)).get(id);
    },

    all() {
      return createTaskStore(selectAll.all().map(fromRow)).all();
    },

    apply(report) {
      // Malformed input (not a report, taskId not a string) cannot be used as
      // a query parameter. An empty core store rejects it with core's reason.
      if (typeof report?.taskId !== 'string') return createTaskStore().apply(report);

      return inTransaction(() => {
        const result = createTaskStore(loadOne(report.taskId)).apply(report);
        if (result.ok) save(upsert, result.task);
        return result;
      });
    },

    create(input) {
      // Malformed input (not an object, id not a string) cannot be used as a
      // query parameter. An empty core store rejects it with core's reason.
      if (typeof input?.id !== 'string') return createTaskStore().create(input);

      return inTransaction(() => {
        const result = createTaskStore(loadOne(input.id)).create(input);
        if (result.ok) save(insert, result.task);
        return result;
      });
    },
  };
}

/**
 * A row as a task: NULL in an optional column means "not set", so the key is
 * left out, the same as in the in-memory store. Anything else is passed on
 * unchanged for createTaskStore to validate.
 */
function fromRow(row: Record<string, unknown>): AgentTask {
  const task: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (value !== null) task[key] = value;
  }
  return task as unknown as AgentTask;
}
