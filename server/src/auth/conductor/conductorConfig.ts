// Conductor mode settings: OPSAIP_CONDUCTOR_DIR, read once at startup by
// loadConfig. Off by default. When it is set, every check below must pass or
// the server does not start, the same way a half-done Ask setup stops it.
import { spawnSync } from 'node:child_process';
import { realpathSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/** The listen hosts Conductor mode accepts: this machine only. */
export const LOOPBACK_HOSTS: readonly string[] = ['127.0.0.1', '::1', 'localhost'];

/** What GET /v1/conductor and POST /v1/runs say while Conductor mode is off. */
export const CONDUCTOR_OFF =
  'Conductor mode is off. Set OPSAIP_CONDUCTOR_DIR to the absolute path of a git repository on ' +
  'this machine and restart the server. See "Conductor mode (experimental)" in README.md.';

export type ConductorFromEnv = { ok: true; dir: string | undefined } | { ok: false; problem: string };

/**
 * Read OPSAIP_CONDUCTOR_DIR (pass process.env) for a server that listens on
 * `host`. Never throws.
 *
 *   unset or blank -> ok, dir undefined: Conductor mode is off
 *   set            -> ok with the directory's real path, only if ALL hold:
 *     - the server listens on a loopback host (LOOPBACK_HOSTS): a run starts
 *       an agent that edits files and, once you allow it, runs commands on
 *       this machine, so it is never offered to another machine;
 *     - the value is an absolute path to an existing directory;
 *     - that directory is the top folder of a git repository
 *       (`git rev-parse --show-toplevel` is the directory itself), not a
 *       subfolder: each run is a `git worktree` of this repository;
 *     - the repository has at least one commit: a worktree starts from HEAD.
 *
 * Problems never contain the path: it is the user's own data, and the
 * message ends up in a log.
 */
export function conductorFromEnv(
  env: Readonly<Record<string, string | undefined>>,
  host: string,
): ConductorFromEnv {
  const raw = env.OPSAIP_CONDUCTOR_DIR?.trim();
  if (raw === undefined || raw === '') return { ok: true, dir: undefined };

  const fail = (problem: string): ConductorFromEnv => ({
    ok: false,
    problem: `OPSAIP_CONDUCTOR_DIR is set, but ${problem}. Unset it to turn Conductor mode off. See "Conductor mode (experimental)" in README.md`,
  });

  if (!LOOPBACK_HOSTS.includes(host)) {
    return fail(`Conductor mode only runs on a server that listens on this machine: OPSAIP_HOST must be one of ${LOOPBACK_HOSTS.join(', ')}`);
  }
  if (!isAbsolute(raw)) return fail('it is not an absolute path');

  let dir: string;
  try {
    if (!statSync(raw).isDirectory()) return fail('it is not a directory');
    dir = realpathSync(raw);
  } catch {
    return fail('the path does not exist or cannot be read');
  }

  const topLevel = git(dir, ['rev-parse', '--show-toplevel']);
  if (topLevel === undefined) return fail('it is not a git repository (or git is not installed)');
  let top: string;
  try {
    top = realpathSync(topLevel);
  } catch {
    return fail('it is not a git repository');
  }
  if (top !== dir) return fail('it is a folder inside a git repository, not its top folder');

  if (git(dir, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) === undefined) {
    return fail('the repository has no commit yet (a run starts from HEAD)');
  }
  return { ok: true, dir };
}

/** Run git with an argument array (no shell). The trimmed stdout, or undefined if it failed. */
function git(dir: string, args: readonly string[]): string | undefined {
  const result = spawnSync('git', ['-C', dir, ...args], {
    encoding: 'utf8',
    shell: false,
    timeout: 10_000,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if (result.error !== undefined || result.status !== 0) return undefined;
  const out = result.stdout.trim();
  return out === '' ? undefined : out;
}
