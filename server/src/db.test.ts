import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from './db';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opsaip-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const userVersion = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

describe('openDatabase', () => {
  it('creates missing parent directories and the file', () => {
    const path = join(dir, 'a', 'b', 'opsaip.db');
    const db = openDatabase(path);
    db.close();
    expect(existsSync(path)).toBe(true);
  });

  it('creates an empty tasks table and sets the schema version', () => {
    const db = openDatabase(join(dir, 'opsaip.db'));
    expect(SCHEMA_VERSION).toBe(1);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT * FROM tasks').all()).toEqual([]);
    db.close();
  });

  it('opens an existing database without touching its rows', () => {
    const path = join(dir, 'opsaip.db');
    const first = openDatabase(path);
    first.prepare('INSERT INTO tasks (id, status, updated_at) VALUES (?, ?, ?)').run(
      't1',
      'queued',
      '2026-11-01T10:00:00Z',
    );
    first.close();

    const second = openDatabase(path);
    expect(second.prepare('SELECT id, status, updated_at FROM tasks').all()).toEqual([
      { id: 't1', status: 'queued', updated_at: '2026-11-01T10:00:00Z' },
    ]);
    second.close();
  });

  it('refuses a schema version newer than this code', () => {
    const path = join(dir, 'opsaip.db');
    const newer = new DatabaseSync(path);
    newer.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`);
    newer.close();
    expect(() => openDatabase(path)).toThrow(
      `database schema version ${SCHEMA_VERSION + 1} is not supported (this server reads version ${SCHEMA_VERSION})`,
    );
  });

  it('refuses a file that is not a SQLite database', () => {
    const path = join(dir, 'notes.txt');
    writeFileSync(path, 'this is not a database, just some text that is long enough');
    expect(() => openDatabase(path)).toThrow(/not a database/);
  });

  it('works with ":memory:"', () => {
    const db = openDatabase(':memory:');
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    db.close();
  });
});
