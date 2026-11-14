import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

/**
 * Schema changes, in order. Step i takes a database from version i to i + 1
 * (PRAGMA user_version). Never edit a step that has shipped: databases that
 * already ran it would not run it again. Add a new step at the end instead.
 */
const MIGRATIONS: readonly string[] = [
  // 0 -> 1: the tasks table. seq is the creation order (TaskStore.all()
  // returns tasks in that order); an upsert on id keeps the row, so seq
  // never changes after creation.
  `CREATE TABLE tasks (
     seq        INTEGER PRIMARY KEY,
     id         TEXT    NOT NULL UNIQUE,
     status     TEXT    NOT NULL,
     updated_at TEXT    NOT NULL
   ) STRICT;`,
  // 1 -> 2: optional report fields. NULL means "not set".
  `ALTER TABLE tasks ADD COLUMN title TEXT;
   ALTER TABLE tasks ADD COLUMN agent TEXT;
   ALTER TABLE tasks ADD COLUMN note  TEXT;`,
  // 2 -> 3: who created the task ("you" for a task a person made). NULL
  // means "not set", which is every task an agent created and every old row.
  `ALTER TABLE tasks ADD COLUMN source TEXT;`,
];

/** The schema this code reads and writes, stored in SQLite's PRAGMA user_version. */
export const SCHEMA_VERSION = MIGRATIONS.length;

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

function readVersion(db: DatabaseSync): number {
  const { user_version: version } = db.prepare('PRAGMA user_version').get() as {
    user_version: number;
  };
  return version;
}

function migrate(db: DatabaseSync): void {
  if (readVersion(db) === SCHEMA_VERSION) return;

  // All missing steps in one transaction: a crash leaves the old version,
  // never a half-migrated file. IMMEDIATE takes the write lock first, and the
  // version is read again under it, so two servers starting on the same file
  // cannot both run a step.
  db.exec('BEGIN IMMEDIATE');
  try {
    const version = readVersion(db);
    if (version < 0 || version > SCHEMA_VERSION) {
      throw new Error(
        `database schema version ${version} is not supported (this server reads version ${SCHEMA_VERSION})`,
      );
    }
    for (const step of MIGRATIONS.slice(version)) db.exec(step);
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec('COMMIT');
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // SQLite may have rolled back already. Keep the first error.
    }
    throw error;
  }
}
