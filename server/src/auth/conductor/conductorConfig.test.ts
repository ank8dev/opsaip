import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { conductorFromEnv, LOOPBACK_HOSTS } from './conductorConfig';
import { cleanUp, git, makeRepo, tempDir } from './testing/conductorTestKit';

afterAll(cleanUp);

const on = (dir: string, host = '127.0.0.1') => conductorFromEnv({ OPSAIP_CONDUCTOR_DIR: dir }, host);
const problemOf = (dir: string, host?: string): string => {
  const result = on(dir, host);
  if (result.ok) throw new Error('expected a problem');
  return result.problem;
};

describe('conductorFromEnv', () => {
  it('is off when OPSAIP_CONDUCTOR_DIR is unset, empty or blank, on any host', () => {
    expect(conductorFromEnv({}, '0.0.0.0')).toEqual({ ok: true, dir: undefined });
    expect(conductorFromEnv({ OPSAIP_CONDUCTOR_DIR: '' }, '127.0.0.1')).toEqual({ ok: true, dir: undefined });
    expect(conductorFromEnv({ OPSAIP_CONDUCTOR_DIR: '   ' }, '127.0.0.1')).toEqual({ ok: true, dir: undefined });
  });

  it('accepts the top folder of a git repository with a commit, on every loopback host', () => {
    const repo = makeRepo();
    for (const host of LOOPBACK_HOSTS) expect(on(repo, host)).toEqual({ ok: true, dir: repo });
    expect(on(` ${repo} `)).toEqual({ ok: true, dir: repo });
  });

  it('returns the real path when the value goes through a symlink', () => {
    const repo = makeRepo();
    const link = join(tempDir(), 'link');
    symlinkSync(repo, link);
    expect(on(link)).toEqual({ ok: true, dir: repo });
  });

  it('refuses a host that is not loopback, before looking at the path', () => {
    const repo = makeRepo();
    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'example.com', '127.0.0.2']) {
      expect(problemOf(repo, host)).toContain('OPSAIP_HOST must be one of 127.0.0.1, ::1, localhost');
    }
  });

  it('refuses a relative path', () => {
    expect(problemOf('repo')).toContain('not an absolute path');
    expect(problemOf('./some/where')).toContain('not an absolute path');
  });

  it('refuses a path that does not exist', () => {
    expect(problemOf(join(tempDir(), 'missing'))).toContain('does not exist');
  });

  it('refuses a file', () => {
    const file = join(tempDir(), 'file.txt');
    writeFileSync(file, 'x');
    expect(problemOf(file)).toContain('not a directory');
  });

  it('refuses a folder that is not in a git repository', () => {
    expect(problemOf(tempDir())).toContain('not a git repository');
  });

  it('refuses a folder inside a repository: it must be the top folder', () => {
    const repo = makeRepo();
    const sub = join(repo, 'src');
    mkdirSync(sub);
    expect(problemOf(sub)).toContain('not its top folder');
  });

  it('refuses a repository without a commit', () => {
    const dir = tempDir();
    git(dir, 'init', '-q');
    expect(problemOf(dir)).toContain('no commit yet');
  });

  it('never puts the path in the problem, and says how to turn it off', () => {
    const secretish = join(tempDir(), 'client-acme-secret-project');
    const problem = problemOf(secretish);
    expect(problem).not.toContain('client-acme');
    expect(problem).toContain('Unset it to turn Conductor mode off');
    expect(problemOf('relative-client-acme')).not.toContain('client-acme');
  });
});
