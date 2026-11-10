import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/** The schema this code reads and writes, stored in SQLite's PRAGMA user_version. */
export const SCHEMA_VERSION = 1;

/**
 * Open (or create) the SQLite database at `path` and bring it to SCHEMA_VERSION.
 * Creates missing parent directories. ":memory:" gives a throwaway database.
 *
 * Throws if the file is not a SQLite database, or if its schema is newer than
 * this code (written by a newer server): refusing is safer than guessing.
 */
export function openDatabase(path: string): DatabaseSync {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  try {
    migrate(db);
    return db;
  } catch (error) {
    db.close();
    throw error;
  }
}

function migrate(db: DatabaseSync): void {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  if (version === SCHEMA_VERSION) return;
  if (version !== 0) {
    throw new Error(
      `database schema version ${version} is not supported (this server reads version ${SCHEMA_VERSION})`,
    );
  }

  // Version 0: a new, empty file. One transaction, so a crash leaves version 0.
  // seq is the creation order (TaskStore.all() returns tasks in that order);
  // an upsert on id keeps the row, so seq never changes after creation.
  db.exec(`
    BEGIN;
    CREATE TABLE tasks (
      seq        INTEGER PRIMARY KEY,
      id         TEXT    NOT NULL UNIQUE,
      status     TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    ) STRICT;
    PRAGMA user_version = ${SCHEMA_VERSION};
    COMMIT;
  `);
}
