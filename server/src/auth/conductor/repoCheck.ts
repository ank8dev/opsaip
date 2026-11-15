// The rules a repository must pass before Conductor mode may run an agent in
// it. The same function runs when a path is added and again right before
// every run starts, because a folder can change in between (deleted, replaced
// by a symlink, emptied of commits).
//
// Messages never contain the path: it is the user's own data and an error can
// end up in a log.
import { realpathSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, parse, sep } from 'node:path';
import { git } from './conductorConfig';

/** Why a path was refused. Stable: the web app and the tests may rely on them. */
export type RepoRefusal =
  | 'invalid_path'
  | 'not_absolute'
  | 'not_found'
  | 'not_directory'
  | 'is_root'
  | 'system_folder'
  | 'is_home'
  | 'opsaip_folder'
  | 'outside_home'
  | 'not_git'
  | 'not_top_folder'
  | 'no_commit'
  | 'changed';

export type RepoCheck = { ok: true; path: string; name: string } | { ok: false; code: RepoRefusal; message: string };

/** The longest path accepted, in UTF-16 code units. */
export const MAX_PATH_CHARS = 4096;

/**
 * Folders no repository may be, or be inside of. Checked on the real path.
 * (macOS /private/etc and /private/var are the real paths of /etc and /var.)
 */
export const SYSTEM_FOLDERS: readonly string[] = [
  '/bin',
  '/boot',
  '/dev',
  '/etc',
  '/lib',
  '/lib32',
  '/lib64',
  '/proc',
  '/sbin',
  '/sys',
  '/usr',
  '/var',
  '/System',
  '/Library',
  '/Applications',
  '/private/etc',
  '/private/var',
];

const REFUSALS: Record<RepoRefusal, string> = {
  invalid_path: 'the path must be text of at most 4096 characters, without empty or special characters',
  not_absolute: 'the path must be absolute (it starts with / on macOS and Linux)',
  not_found: 'the path does not exist or cannot be read',
  not_directory: 'the path is not a folder',
  is_root: 'the root folder "/" cannot be used',
  system_folder: 'system folders cannot be used',
  is_home: 'your home folder itself cannot be used: choose a repository inside it',
  opsaip_folder: 'the ~/.opsaip folder (where Opsaip keeps its worktrees) cannot be used',
  outside_home: 'the repository must be inside your home folder',
  not_git: 'it is not a git repository (or git is not installed)',
  not_top_folder: 'it is a folder inside a git repository, not its top folder: choose the top folder',
  no_commit: 'the repository has no commit yet: a run starts from HEAD, so make a first commit',
  changed: 'the folder is not the same as when it was added (a symlink or a moved folder): add it again',
};

export const refusal = (code: RepoRefusal): { ok: false; code: RepoRefusal; message: string } => ({
  ok: false,
  code,
  message: REFUSALS[code],
});

export interface RepoCheckOptions {
  /** The user's home folder. Defaults to os.homedir(); tests pass a temporary one. */
  home?: string;
  /**
   * "added" (default): everything below. "default": only that it still exists
   * and is a git repository with a commit. OPSAIP_CONDUCTOR_DIR was checked at
   * startup and stays valid wherever it is.
   */
  policy?: 'added' | 'default';
}

/**
 * Check `raw` and return its real path and folder name. Never throws.
 *
 * Policy "added", in this order:
 *   text, absolute, <= 4096 characters  ->  the real path (symlinks resolved,
 *   so a link cannot point out of the home folder)  ->  a folder  ->  not "/"
 *   -> not a system folder  ->  not the home folder  ->  not ~/.opsaip  ->
 *   inside the home folder  ->  the top folder of a git repository  ->  at
 *   least one commit.
 */
export function checkRepoPath(raw: unknown, options: RepoCheckOptions = {}): RepoCheck {
  try {
    if (typeof raw !== 'string') return refusal('invalid_path');
    const given = raw.trim();
    if (given === '' || given.length > MAX_PATH_CHARS || given.includes('\0')) return refusal('invalid_path');
    if (!isAbsolute(given)) return refusal('not_absolute');

    let path: string;
    try {
      path = realpathSync(given);
      if (!statSync(path).isDirectory()) return refusal('not_directory');
    } catch {
      return refusal('not_found');
    }

    if (options.policy !== 'default') {
      const home = realHome(options.home ?? homedir());
      if (path === parse(path).root) return refusal('is_root');
      if (SYSTEM_FOLDERS.some((folder) => isSameOrInside(path, folder))) return refusal('system_folder');
      if (path === home) return refusal('is_home');
      if (isSameOrInside(path, join(home, '.opsaip')) || isSameOrInside(path, realOrSelf(join(home, '.opsaip')))) {
        return refusal('opsaip_folder');
      }
      if (!isSameOrInside(path, home)) return refusal('outside_home');
    }

    const topLevel = git(path, ['rev-parse', '--show-toplevel']);
    if (topLevel === undefined) return refusal('not_git');
    let top: string;
    try {
      top = realpathSync(topLevel);
    } catch {
      return refusal('not_git');
    }
    if (top !== path) return refusal('not_top_folder');
    if (git(path, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}']) === undefined) return refusal('no_commit');

    return { ok: true, path, name: parse(path).base };
  } catch {
    return refusal('not_found');
  }
}

/** True if `path` is `folder` or inside it. Both are absolute, normalized, real paths. */
function isSameOrInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : folder + sep);
}

function realOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function realHome(home: string): string {
  return realOrSelf(home);
}
