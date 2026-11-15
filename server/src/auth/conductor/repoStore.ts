// The repositories a person added for Conductor mode: a small table in the
// server's SQLite database (migration 4 -> 5 in db.ts). Rows hold only a path
// and a name; deleting a row never touches the files.
import type { DatabaseSync } from 'node:sqlite';

export interface StoredRepo {
  id: string;
  /** The real, absolute path, as checked when it was added. */
  path: string;
  /** The folder name. */
  name: string;
  createdAt: string;
}

export interface RepoStore {
  /** Oldest first. */
  list(): StoredRepo[];
  get(id: string): StoredRepo | undefined;
  /** false if the id or the path is already stored. */
  add(repo: StoredRepo): boolean;
  /** false if there is no such id. */
  remove(id: string): boolean;
}

interface Row {
  id: string;
  path: string;
  name: string;
  created_at: string;
}

const toRepo = (row: Row): StoredRepo => ({ id: row.id, path: row.path, name: row.name, createdAt: row.created_at });

export function createRepoStore(db: DatabaseSync): RepoStore {
  const list = db.prepare('SELECT id, path, name, created_at FROM repositories ORDER BY created_at, rowid');
  const get = db.prepare('SELECT id, path, name, created_at FROM repositories WHERE id = ?');
  const insert = db.prepare('INSERT INTO repositories (id, path, name, created_at) VALUES (?, ?, ?, ?)');
  const remove = db.prepare('DELETE FROM repositories WHERE id = ?');
  return {
    list: () => (list.all() as unknown as Row[]).map(toRepo),
    get(id) {
      const row = get.get(id) as Row | undefined;
      return row === undefined ? undefined : toRepo(row);
    },
    add(repo) {
      try {
        insert.run(repo.id, repo.path, repo.name, repo.createdAt);
        return true;
      } catch (error) {
        if (/UNIQUE|constraint/i.test((error as Error).message)) return false;
        throw error;
      }
    },
    remove: (id) => Number(remove.run(id).changes) > 0,
  };
}

/** A store that lives in memory only (tests, and a server given no database). */
export function createMemoryRepoStore(): RepoStore {
  const repos: StoredRepo[] = [];
  return {
    list: () => repos.map((repo) => ({ ...repo })),
    get: (id) => {
      const repo = repos.find((entry) => entry.id === id);
      return repo === undefined ? undefined : { ...repo };
    },
    add(repo) {
      if (repos.some((entry) => entry.id === repo.id || entry.path === repo.path)) return false;
      repos.push({ ...repo });
      return true;
    },
    remove(id) {
      const index = repos.findIndex((entry) => entry.id === id);
      if (index === -1) return false;
      repos.splice(index, 1);
      return true;
    },
  };
}
