import { mkdirSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { openDatabase } from '../../db';
import { createRepoRegistry, DEFAULT_REPO_ID, MAX_REPOS } from './repoRegistry';
import { createMemoryRepoStore, createRepoStore, type RepoStore } from './repoStore';
import { cleanUp, makeRepo, tempDir } from './testing/conductorTestKit';

afterAll(cleanUp);

const stores: Array<[string, () => RepoStore]> = [
  ['memory', createMemoryRepoStore],
  ['SQLite', () => createRepoStore(openDatabase(':memory:'))],
];

describe.each(stores)('the %s repository store', (_name, make) => {
  const row = (id: string, path = `/home/me/${id}`) => ({ id, path, name: id, createdAt: `2026-11-0${id.length}T10:00:00Z` });

  it('adds, lists oldest first, gets and removes', () => {
    const store = make();
    expect(store.list()).toEqual([]);
    expect(store.add(row('a'))).toBe(true);
    expect(store.add(row('bb'))).toBe(true);
    expect(store.list().map((repo) => repo.id)).toEqual(['a', 'bb']);
    expect(store.get('bb')).toEqual(row('bb'));
    expect(store.get('zz')).toBeUndefined();
    expect(store.remove('a')).toBe(true);
    expect(store.remove('a')).toBe(false);
    expect(store.list().map((repo) => repo.id)).toEqual(['bb']);
  });

  it('refuses a repeated id or path', () => {
    const store = make();
    expect(store.add(row('a'))).toBe(true);
    expect(store.add(row('a', '/home/me/other'))).toBe(false);
    expect(store.add(row('c', '/home/me/a'))).toBe(false);
  });
});

function setUp(defaultDir?: string) {
  const home = tempDir('opsaip-home-');
  const db = openDatabase(':memory:');
  const registry = createRepoRegistry({ store: createRepoStore(db), defaultDir, home });
  return { home, db, registry };
}

describe('the repository registry', () => {
  it('lists the default repository first, then the added ones', () => {
    const defaultDir = makeRepo();
    const t = setUp(defaultDir);
    const app = makeRepo(t.home, 'app');
    const added = t.registry.add(app);
    expect(added).toMatchObject({ ok: true, repo: { name: 'app', path: app, isDefault: false } });
    const list = t.registry.list();
    expect(list.map((repo) => repo.isDefault)).toEqual([true, false]);
    expect(list[0]).toMatchObject({ id: DEFAULT_REPO_ID, path: defaultDir });
  });

  it('an added repository survives reopening the database (it is in SQLite)', () => {
    const t = setUp();
    const app = makeRepo(t.home, 'app');
    const added = t.registry.add(app);
    expect(added.ok).toBe(true);
    const again = createRepoRegistry({ store: createRepoStore(t.db), home: t.home });
    expect(again.list().map((repo) => repo.path)).toEqual([app]);
  });

  it('refuses a path twice (also through a symlink) and the default repository again', () => {
    const defaultDir = makeRepo();
    const t = setUp(defaultDir);
    const app = makeRepo(t.home, 'app');
    expect(t.registry.add(app).ok).toBe(true);
    symlinkSync(app, join(t.home, 'link'));
    expect(t.registry.add(app)).toMatchObject({ ok: false, status: 409, code: 'duplicate' });
    expect(t.registry.add(join(t.home, 'link'))).toMatchObject({ ok: false, status: 409, code: 'duplicate' });
    // The default repository is outside "home" here, so it is refused for that reason first.
    expect(t.registry.add(defaultDir)).toMatchObject({ ok: false, status: 400, code: 'outside_home' });
  });

  it('a refused path is a 400 with a code and is not stored', () => {
    const t = setUp();
    expect(t.registry.add(t.home)).toMatchObject({ ok: false, status: 400, code: 'is_home' });
    expect(t.registry.list()).toEqual([]);
  });

  it(`allows at most ${MAX_REPOS} added repositories`, () => {
    const t = setUp();
    const store = createRepoStore(t.db);
    for (let i = 0; i < MAX_REPOS; i++) store.add({ id: `r${i}`, path: `/x/${i}`, name: `${i}`, createdAt: '2026-11-01T00:00:00Z' });
    expect(t.registry.add(makeRepo(t.home, 'one-too-many'))).toMatchObject({ ok: false, status: 409, code: 'too_many' });
  });

  it('removes a repository from the list and never deletes its files', () => {
    const t = setUp();
    const app = makeRepo(t.home, 'app');
    const added = t.registry.add(app);
    if (!added.ok) throw new Error('add failed');
    expect(t.registry.remove(added.repo.id)).toEqual({ ok: true });
    expect(t.registry.list()).toEqual([]);
    expect(t.registry.remove(added.repo.id)).toMatchObject({ ok: false, status: 404 });
    // Still a repository on disk: it can be added again.
    expect(t.registry.add(app).ok).toBe(true);
  });

  it('the default repository cannot be removed', () => {
    const t = setUp(makeRepo());
    expect(t.registry.remove(DEFAULT_REPO_ID)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('OPSAIP_CONDUCTOR_DIR') });
    expect(t.registry.list()).toHaveLength(1);
  });

  describe('prepare (the checks right before a run)', () => {
    it('without an id: the default repository, or the only one, otherwise a 400', () => {
      const defaultDir = makeRepo();
      expect(setUp(defaultDir).registry.prepare(undefined)).toMatchObject({ ok: true, repo: { id: DEFAULT_REPO_ID } });

      const t = setUp();
      expect(t.registry.prepare(undefined)).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('add one') });
      const first = t.registry.add(makeRepo(t.home, 'a'));
      expect(t.registry.prepare(undefined)).toMatchObject({ ok: true, repo: { name: 'a' } });
      t.registry.add(makeRepo(t.home, 'b'));
      expect(t.registry.prepare(undefined)).toMatchObject({ ok: false, status: 400, error: expect.stringContaining('repoId is required') });
      expect(first.ok).toBe(true);
    });

    it('an unknown id is a 404', () => {
      expect(setUp().registry.prepare('nope')).toMatchObject({ ok: false, status: 404 });
    });

    it('refuses an added repository that was deleted, emptied of git, or turned into a symlink', () => {
      const t = setUp();
      const added = t.registry.add(makeRepo(t.home, 'app'));
      if (!added.ok) throw new Error('add failed');
      const { id, path } = added.repo;
      expect(t.registry.prepare(id).ok).toBe(true);

      // git metadata removed
      renameSync(join(path, '.git'), join(path, '.git-gone'));
      expect(t.registry.prepare(id)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('not a git repository') });
      renameSync(join(path, '.git-gone'), join(path, '.git'));
      expect(t.registry.prepare(id).ok).toBe(true);

      // replaced by a symlink to a repository outside home
      const elsewhere = makeRepo();
      renameSync(path, `${path}-moved`);
      symlinkSync(elsewhere, path);
      expect(t.registry.prepare(id)).toMatchObject({ ok: false, status: 409 });
      rmSync(path);

      // deleted
      expect(t.registry.prepare(id)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('does not exist') });
    });

    it('refuses a repository that moved outside home through a symlink swap, with the "changed" or "outside" reason', () => {
      const t = setUp();
      const added = t.registry.add(makeRepo(t.home, 'app'));
      if (!added.ok) throw new Error('add failed');
      const inner = makeRepo(t.home, 'other');
      renameSync(added.repo.path, `${added.repo.path}-moved`);
      symlinkSync(inner, added.repo.path); // inside home, but not the folder that was added
      expect(t.registry.prepare(added.repo.id)).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('not the same') });
    });

    it('the default repository stays valid outside home, and is refused once it is no longer a repository', () => {
      const defaultDir = makeRepo();
      const t = setUp(defaultDir);
      expect(t.registry.prepare(DEFAULT_REPO_ID).ok).toBe(true);
      rmSync(join(defaultDir, '.git'), { recursive: true });
      expect(t.registry.prepare(DEFAULT_REPO_ID)).toMatchObject({ ok: false, status: 409 });
    });
  });

  it('finds a repository by display name, ignoring case; two with one name are "many"', () => {
    const t = setUp();
    const a = t.registry.add(makeRepo(t.home, 'App'));
    t.registry.add(makeRepo(join(t.home, 'x'), 'dup'));
    mkdirSync(join(t.home, 'y'));
    t.registry.add(makeRepo(join(t.home, 'y'), 'dup'));
    expect(a.ok).toBe(true);
    expect(t.registry.findByName(' app ')).toMatchObject({ kind: 'one', repo: { name: 'App' } });
    expect(t.registry.findByName('nothing')).toEqual({ kind: 'none' });
    expect(t.registry.findByName('DUP')).toEqual({ kind: 'many' });
  });
});
