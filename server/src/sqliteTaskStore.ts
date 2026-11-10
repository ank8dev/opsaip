import type { DatabaseSync } from 'node:sqlite';
import { createTaskStore, type AgentTask, type TaskStore } from '@opsaip/core';

/**
 * A TaskStore kept in SQLite. The database is the only copy of the tasks:
 * nothing is cached in memory, so memory and disk can never disagree.
 *
 * The rules are not repeated here. Each apply() loads the one task it needs
 * into a short-lived core store (createTaskStore), lets core decide, and
 * saves the result, all in one transaction. Rows read back go through
 * createTaskStore too, which rejects malformed stored data.
 *
 * Unlike the in-memory store, apply() can throw: when the database itself
 * fails (disk full, I/O error, file locked by another process). Nothing is
 * saved then; the HTTP layer turns the error into a 500.
 */
export function createSqliteTaskStore(db: DatabaseSync): TaskStore {
  const COLUMNS = 'id, status, updated_at AS updatedAt';
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM tasks WHERE id = ?`);
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM tasks ORDER BY seq`);
  const upsert = db.prepare(`
    INSERT INTO tasks (id, status, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at
  `);

  // Rows come back as plain records; createTaskStore validates them.
  const loadOne = (id: string): AgentTask[] => {
    const row = selectOne.get(id);
    return row === undefined ? [] : [row as unknown as AgentTask];
  };

  return {
    get(id) {
      return createTaskStore(loadOne(id)).get(id);
    },

    all() {
      return createTaskStore(selectAll.all() as unknown as AgentTask[]).all();
    },

    apply(report) {
      // Malformed input (not a report, taskId not a string) cannot be used as
      // a query parameter. An empty core store rejects it with core's reason.
      if (typeof report?.taskId !== 'string') return createTaskStore().apply(report);

      // IMMEDIATE takes the write lock now, so read-check-write is atomic even
      // if another process opens the same file.
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = createTaskStore(loadOne(report.taskId)).apply(report);
        if (result.ok) upsert.run(result.task.id, result.task.status, result.task.updatedAt);
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
    },
  };
}
