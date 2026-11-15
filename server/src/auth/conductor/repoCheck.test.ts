import { execFileSync } from 'node:child_process';
import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { checkRepoPath, MAX_PATH_CHARS } from './repoCheck';
import { cleanUp, git, makeRepo, tempDir } from './testing/conductorTestKit';

afterAll(cleanUp);

/** A fake home folder with a good repository inside it. */
function setUp() {
  const home = tempDir('opsaip-home-');
  const repo = makeRepo(home, 'my-app');
  return { home, repo, check: (raw: unknown) => checkRepoPath(raw, { home }) };
}

describe('checkRepoPath: what is accepted', () => {
  it('a git repository with a commit inside home: its real path and folder name', () => {
    const t = setUp();
    expect(t.check(t.repo)).toEqual({ ok: true, path: t.repo, name: 'my-app' });
  });

  it('trims the text and resolves ".." and symlinks to the real path', () => {
    const t = setUp();
    const link = join(t.home, 'link-to-app');
    symlinkSync(t.repo, link);
    expect(t.check(`  ${join(t.home, 'x', '..', 'my-app')}  `)).toMatchObject({ ok: true, path: t.repo });
    expect(t.check(link)).toMatchObject({ ok: true, path: t.repo, name: 'my-app' });
  });
});

describe('checkRepoPath: every refusal', () => {
  it.each([
    ['not text', 42],
    ['empty', '   '],
    ['too long', `/${'a'.repeat(MAX_PATH_CHARS)}`],
    ['a NUL character', '/tmp/a\0b'],
  ])('invalid_path: %s', (_name, value) => {
    expect(setUp().check(value)).toMatchObject({ ok: false, code: 'invalid_path' });
  });

  it('not_absolute: a relative path or "~"', () => {
    const t = setUp();
    expect(t.check('my-app')).toMatchObject({ ok: false, code: 'not_absolute' });
    expect(t.check('~/my-app')).toMatchObject({ ok: false, code: 'not_absolute' });
  });

  it('not_found: a path that does not exist', () => {
    const t = setUp();
    expect(t.check(join(t.home, 'nothing-here'))).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('not_found: a dangling symlink', () => {
    const t = setUp();
    symlinkSync(join(t.home, 'gone'), join(t.home, 'dangling'));
    expect(t.check(join(t.home, 'dangling'))).toMatchObject({ ok: false, code: 'not_found' });
  });

  it('not_directory: a file', () => {
    const t = setUp();
    const file = join(t.home, 'file.txt');
    writeFileSync(file, 'x');
    expect(t.check(file)).toMatchObject({ ok: false, code: 'not_directory' });
  });

  it('is_root: "/"', () => {
    expect(setUp().check('/')).toMatchObject({ ok: false, code: 'is_root' });
  });

  it.each(['/etc', '/usr', '/usr/bin', '/var'])('system_folder: %s', (folder) => {
    expect(setUp().check(folder)).toMatchObject({ ok: false, code: 'system_folder' });
  });

  it('is_home: the home folder itself, even when it is a git repository', () => {
    const t = setUp();
    git(t.home, 'init', '-q');
    expect(t.check(t.home)).toMatchObject({ ok: false, code: 'is_home' });
  });

  it('is_home: a symlink that points at the home folder', () => {
    const t = setUp();
    symlinkSync(t.home, join(t.home, 'me'));
    expect(t.check(join(t.home, 'me'))).toMatchObject({ ok: false, code: 'is_home' });
  });

  it('opsaip_folder: ~/.opsaip and anything inside it, even a repository', () => {
    const t = setUp();
    const inside = makeRepo(join(t.home, '.opsaip', 'worktrees'), 'run');
    expect(t.check(join(t.home, '.opsaip'))).toMatchObject({ ok: false, code: 'opsaip_folder' });
    expect(t.check(inside)).toMatchObject({ ok: false, code: 'opsaip_folder' });
  });

  it('outside_home: a good repository outside the home folder', () => {
    const t = setUp();
    expect(t.check(makeRepo())).toMatchObject({ ok: false, code: 'outside_home' });
  });

  it('outside_home: a symlink inside home that points outside it (no symlink tricks)', () => {
    const t = setUp();
    const elsewhere = makeRepo();
    symlinkSync(elsewhere, join(t.home, 'sneaky'));
    expect(t.check(join(t.home, 'sneaky'))).toMatchObject({ ok: false, code: 'outside_home' });
  });

  it('outside_home: a folder whose name only starts like the home folder', () => {
    const t = setUp();
    const sibling = makeRepo(`${t.home}-other`, 'app');
    expect(t.check(sibling)).toMatchObject({ ok: false, code: 'outside_home' });
  });

  it('not_git: a plain folder', () => {
    const t = setUp();
    const plain = join(t.home, 'plain');
    mkdirSync(plain);
    expect(t.check(plain)).toMatchObject({ ok: false, code: 'not_git' });
  });

  it('not_top_folder: a subfolder of a repository', () => {
    const t = setUp();
    const sub = join(t.repo, 'src');
    mkdirSync(sub);
    expect(t.check(sub)).toMatchObject({ ok: false, code: 'not_top_folder' });
  });

  it('no_commit: a repository without a commit', () => {
    const t = setUp();
    const empty = join(t.home, 'empty');
    mkdirSync(empty);
    execFileSync('git', ['-C', empty, 'init', '-q']);
    expect(t.check(empty)).toMatchObject({ ok: false, code: 'no_commit' });
  });

  it('messages never contain the path', () => {
    const t = setUp();
    const refused = t.check(join(t.home, 'nothing-here'));
    expect(JSON.stringify(refused)).not.toContain(t.home);
  });
});

describe('checkRepoPath: the default policy', () => {
  it('skips the home rules but still needs a folder, git and a commit', () => {
    const t = setUp();
    const outside = makeRepo();
    expect(checkRepoPath(outside, { home: t.home, policy: 'default' })).toMatchObject({ ok: true, path: outside });
    expect(checkRepoPath(tempDir(), { policy: 'default' })).toMatchObject({ ok: false, code: 'not_git' });
    expect(checkRepoPath(join(outside, 'gone'), { policy: 'default' })).toMatchObject({ ok: false, code: 'not_found' });
  });
});
