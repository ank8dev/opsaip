// All repositories Conductor mode can use: the default one (OPSAIP_CONDUCTOR_DIR,
// when set) and the ones a person added. Owns the add/remove rules and the
// check that runs again right before each run starts.
import { randomUUID } from 'node:crypto';
import { checkRepoPath, refusal, type RepoRefusal } from './repoCheck';
import { createMemoryRepoStore, type RepoStore } from './repoStore';

/** The id of the repository from OPSAIP_CONDUCTOR_DIR. Not stored in the database. */
export const DEFAULT_REPO_ID = 'default';
/** Most repositories a person can add. */
export const MAX_REPOS = 50;

export interface Repo {
  id: string;
  name: string;
  /** Absolute real path. */
  path: string;
  /** From OPSAIP_CONDUCTOR_DIR: cannot be removed here. */
  isDefault: boolean;
}

export type AddResult =
  | { ok: true; repo: Repo }
  | { ok: false; status: 400 | 409; code: RepoRefusal | 'duplicate' | 'too_many'; error: string };

export type RemoveResult = { ok: true } | { ok: false; status: 404 | 409; error: string };

export type PrepareResult =
  | { ok: true; repo: Repo }
  | { ok: false; status: 400 | 404 | 409; error: string };

export type NameMatch = { kind: 'one'; repo: Repo } | { kind: 'none' } | { kind: 'many' };

export interface RepoRegistry {
  /** The default repository first, then the added ones, oldest first. */
  list(): Repo[];
  get(id: string): Repo | undefined;
  add(path: unknown): AddResult;
  /** Forget a repository (never deletes files). The caller makes sure no run is active in it. */
  remove(id: string): RemoveResult;
  /**
   * The repository for a run, checked again now. `id` undefined: the default
   * repository, or the only one there is.
   */
  prepare(id: string | undefined): PrepareResult;
  /** A repository by display name (case does not matter), for Ask. */
  findByName(name: string): NameMatch;
}

export interface RepoRegistryOptions {
  store?: RepoStore;
  /** OPSAIP_CONDUCTOR_DIR, already checked by conductorFromEnv. */
  defaultDir?: string;
  /** Tests only: the home folder the rules use. */
  home?: string;
  now?: () => number;
}

export function createRepoRegistry({
  store = createMemoryRepoStore(),
  defaultDir,
  home,
  now = Date.now,
}: RepoRegistryOptions = {}): RepoRegistry {
  const defaultRepo = (): Repo | undefined =>
    defaultDir === undefined
      ? undefined
      : { id: DEFAULT_REPO_ID, path: defaultDir, name: defaultDir.split(/[\\/]/).filter(Boolean).pop() ?? defaultDir, isDefault: true };
  const list = (): Repo[] => {
    const first = defaultRepo();
    const added = store.list().map((row): Repo => ({ id: row.id, path: row.path, name: row.name, isDefault: false }));
    return first === undefined ? added : [first, ...added];
  };

  return {
    list,
    get: (id) => list().find((repo) => repo.id === id),

    add(raw) {
      const checked = checkRepoPath(raw, { home });
      if (!checked.ok) return { ok: false, status: 400, code: checked.code, error: checked.message };
      if (list().some((repo) => repo.path === checked.path)) {
        return { ok: false, status: 409, code: 'duplicate', error: 'this repository is already in the list' };
      }
      if (store.list().length >= MAX_REPOS) {
        return { ok: false, status: 409, code: 'too_many', error: `at most ${MAX_REPOS} repositories: remove one first` };
      }
      const row = { id: randomUUID(), path: checked.path, name: checked.name, createdAt: new Date(now()).toISOString() };
      if (!store.add(row)) {
        return { ok: false, status: 409, code: 'duplicate', error: 'this repository is already in the list' };
      }
      return { ok: true, repo: { id: row.id, path: row.path, name: row.name, isDefault: false } };
    },

    remove(id) {
      if (id === DEFAULT_REPO_ID && defaultDir !== undefined) {
        return {
          ok: false,
          status: 409,
          error: 'this repository comes from OPSAIP_CONDUCTOR_DIR: unset that variable and restart the server to drop it',
        };
      }
      return store.remove(id) ? { ok: true } : { ok: false, status: 404, error: 'repository not found' };
    },

    prepare(id) {
      const repos = list();
      let repo: Repo | undefined;
      if (id === undefined) {
        repo = repos.find((entry) => entry.isDefault) ?? (repos.length === 1 ? repos[0] : undefined);
        if (repo === undefined) {
          return {
            ok: false,
            status: 400,
            error: repos.length === 0 ? 'there is no repository: add one in Settings > Repositories' : 'repoId is required: choose a repository',
          };
        }
      } else {
        repo = repos.find((entry) => entry.id === id);
        if (repo === undefined) return { ok: false, status: 404, error: 'repository not found' };
      }
      const checked = checkRepoPath(repo.path, { home, policy: repo.isDefault ? 'default' : 'added' });
      if (!checked.ok) return { ok: false, status: 409, error: `this repository cannot be used now: ${checked.message}` };
      if (checked.path !== repo.path) {
        return { ok: false, status: 409, error: `this repository cannot be used now: ${refusal('changed').message}` };
      }
      return { ok: true, repo };
    },

    findByName(name) {
      const wanted = name.trim().toLowerCase();
      const found = list().filter((repo) => repo.name.toLowerCase() === wanted);
      if (found.length === 0) return { kind: 'none' };
      return found.length === 1 ? { kind: 'one', repo: found[0] } : { kind: 'many' };
    },
  };
}
