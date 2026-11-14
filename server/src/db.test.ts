import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openDatabase, SCHEMA_VERSION } from './db';
import { createSqliteTaskStore } from './sqliteTaskStore';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opsaip-db-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const userVersion = (db: DatabaseSync) =>
  (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;

const COLUMNS_V3 = ['seq', 'id', 'status', 'updated_at', 'title', 'agent', 'note', 'source'];

const columnsOf = (db: DatabaseSync) =>
  (db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[]).map((c) => c.name);

/**
 * A database exactly as the version 1 server left it: this is the SQL that
 * server ran, copied here on purpose. Do not change it when the schema moves on.
 */
function createVersion1Database(path: string, rows: [string, string, string][]): void {
  const v1 = new DatabaseSync(path);
  v1.exec(`
    BEGIN;
    CREATE TABLE tasks (
      seq        INTEGER PRIMARY KEY,
      id         TEXT    NOT NULL UNIQUE,
      status     TEXT    NOT NULL,
      updated_at TEXT    NOT NULL
    ) STRICT;
    PRAGMA user_version = 1;
    COMMIT;
  `);
  const insert = v1.prepare('INSERT INTO tasks (id, status, updated_at) VALUES (?, ?, ?)');
  for (const row of rows) insert.run(...row);
  v1.close();
}

describe('openDatabase', () => {
  it('creates missing parent directories and the file', () => {
    const path = join(dir, 'a', 'b', 'opsaip.db');
    const db = openDatabase(path);
    db.close();
    expect(existsSync(path)).toBe(true);
  });

  it('creates an empty tasks table and sets the schema version', () => {
    const db = openDatabase(join(dir, 'opsaip.db'));
    expect(SCHEMA_VERSION).toBe(3);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect(db.prepare('SELECT * FROM tasks').all()).toEqual([]);
    expect(columnsOf(db)).toEqual(COLUMNS_V3);
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

  it('refuses a negative schema version', () => {
    const path = join(dir, 'opsaip.db');
    const odd = new DatabaseSync(path);
    odd.exec('PRAGMA user_version = -1');
    odd.close();
    expect(() => openDatabase(path)).toThrow(
      `database schema version -1 is not supported (this server reads version ${SCHEMA_VERSION})`,
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

describe('migration from version 1 to 2', () => {
  const rows: [string, string, string][] = [
    ['zeta', 'waiting_on_human', '2026-11-01T10:05:00Z'],
    ['alpha', 'queued', '2026-11-01T10:00:00Z'],
  ];

  it('adds the title, agent and note columns (and ends at the current version)', () => {
    const path = join(dir, 'opsaip.db');
    createVersion1Database(path, rows);
    const db = openDatabase(path);
    expect(userVersion(db)).toBe(SCHEMA_VERSION);
    expect(columnsOf(db)).toEqual(COLUMNS_V3);
    db.close();
  });

  it('keeps every row, its creation order, and leaves the new columns NULL', () => {
    const path = join(dir, 'opsaip.db');
    createVersion1Database(path, rows);
    const db = openDatabase(path);
    expect(db.prepare('SELECT * FROM tasks ORDER BY seq').all()).toEqual([
      { seq: 1, id: 'zeta', status: 'waiting_on_human', updated_at: '2026-11-01T10:05:00Z', title: null, agent: null, note: null, source: null },
      { seq: 2, id: 'alpha', status: 'queued', updated_at: '2026-11-01T10:00:00Z', title: null, agent: null, note: null, source: null },
    ]);
    db.close();
  });

  it('runs once: opening the migrated file again changes nothing', () => {
    const path = join(dir, 'opsaip.db');
    createVersion1Database(path, rows);
    openDatabase(path).close();
    const again = openDatabase(path);
    expect(userVersion(again)).toBe(SCHEMA_VERSION);
    expect(columnsOf(again)).toHaveLength(COLUMNS_V3.length);
    again.close();
  });

  it('serves the old tasks through the store, which then accepts the new fields', () => {
    const path = join(dir, 'opsaip.db');
    createVersion1Database(path, rows);
    const db = openDatabase(path);
    const store = createSqliteTaskStore(db);
    expect(store.all()).toEqual([
      { id: 'zeta', status: 'waiting_on_human', updatedAt: '2026-11-01T10:05:00Z' },
      { id: 'alpha', status: 'queued', updatedAt: '2026-11-01T10:00:00Z' },
    ]);
    const result = store.apply({
      taskId: 'alpha',
      status: 'running',
      at: '2026-11-01T10:10:00Z',
      agent: 'codex',
      note: 'started',
    });
    expect(result.ok).toBe(true);
    expect(store.get('alpha')).toEqual({
      id: 'alpha',
      status: 'running',
      updatedAt: '2026-11-01T10:10:00Z',
      agent: 'codex',
      note: 'started',
    });
    db.close();
  });

  it('leaves the file at version 1 if a step fails', () => {
    // A v1 file that already has a "note" column: ADD COLUMN note fails
    // after title and agent were added, so the whole step must roll back.
    const path = join(dir, 'opsaip.db');
    createVersion1Database(path, rows);
    const broken = new DatabaseSync(path);
    broken.exec('ALTER TABLE tasks ADD COLUMN note TEXT');
    broken.close();

    expect(() => openDatabase(path)).toThrow(/duplicate column name: note/);

    const check = new DatabaseSync(path);
    expect(userVersion(check)).toBe(1);
    expect(columnsOf(check)).toEqual(['seq', 'id', 'status', 'updated_at', 'note']);
    expect(check.prepare('SELECT count(*) AS n FROM tasks').get()).toEqual({ n: 2 });
    check.close();
  });
});

/**
 * A database exactly as the version 2 server left it (SQL copied on purpose,
 * like createVersion1Database: do not change it when the schema moves on).
 */
function createVersion2Database(path: string, rows: [string, string, string, string | null][]): void {
  const v2 = new DatabaseSync(path);
  v2.exec(`
    BEGIN;
    CREATE TABLE tasks (
      seq        INTEGER PRIMARY KEY,
      id         TEXT    NOT NULL UNIQUE,
      status     TEXT    NOT NULL,
      updated_at TEXT    NOT NULL,
      title      TEXT,
      agent      TEXT,
      note       TEXT
    ) STRICT;
    PRAGMA user_version = 2;
    COMMIT;
  `);
  const insert = v2.prepare('INSERT INTO tasks (id, status, updated_at, title) VALUES (?, ?, ?, ?)');
  for (const row of rows) insert.run(...row);
  v2.close();
}

describe('migration from version 2 to 3', () => {
  const rows: [string, string, string, string | null][] = [
    ['zeta', 'running', '2026-11-01T10:05:00Z', 'Old task'],
    ['alpha', 'queued', '2026-11-01T10:00:00Z', null],
  ];

  it('adds the source column and sets version 3', () => {
    const path = join(dir, 'opsaip.db');
    createVersion2Database(path, rows);
    const db = openDatabase(path);
    expect(SCHEMA_VERSION).toBe(3);
    expect(userVersion(db)).toBe(3);
    expect(columnsOf(db)).toEqual(COLUMNS_V3);
    db.close();
  });

  it('keeps old rows and their order, with source NULL', () => {
    const path = join(dir, 'opsaip.db');
    createVersion2Database(path, rows);
    const db = openDatabase(path);
    expect(db.prepare('SELECT id, title, source FROM tasks ORDER BY seq').all()).toEqual([
      { id: 'zeta', title: 'Old task', source: null },
      { id: 'alpha', title: null, source: null },
    ]);
    db.close();
  });

  it('serves old tasks with no source, and the store can then create tasks from you', () => {
    const path = join(dir, 'opsaip.db');
    createVersion2Database(path, rows);
    const db = openDatabase(path);
    const store = createSqliteTaskStore(db);
    expect(store.all()).toEqual([
      { id: 'zeta', status: 'running', updatedAt: '2026-11-01T10:05:00Z', title: 'Old task' },
      { id: 'alpha', status: 'queued', updatedAt: '2026-11-01T10:00:00Z' },
    ]);
    expect(
      store.create({ id: 'new', title: 'Mine', createdAt: '2026-11-01T11:00:00Z', source: 'you' }).ok,
    ).toBe(true);
    expect(store.all().map((t) => [t.id, t.source])).toEqual([
      ['zeta', undefined],
      ['alpha', undefined],
      ['new', 'you'],
    ]);
    db.close();
  });

  it('runs once: opening the migrated file again changes nothing', () => {
    const path = join(dir, 'opsaip.db');
    createVersion2Database(path, rows);
    openDatabase(path).close();
    const again = openDatabase(path);
    expect(userVersion(again)).toBe(3);
    expect(columnsOf(again)).toEqual(COLUMNS_V3);
    expect(again.prepare('SELECT count(*) AS n FROM tasks').get()).toEqual({ n: 2 });
    again.close();
  });
});
