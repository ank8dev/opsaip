// Agent mode: put the attached files into the run's worktree, where the agent
// can read them, and tell the agent where they are. This does not depend on
// any agent driver: the run manager calls it before the prompt reaches the
// driver, so every driver gets attachments the same way.
//
// Files go to <worktree>/.opsaip/attachments/<run id>/<generated name>. Names
// are generated here (a random UUID and the extension of the DETECTED type),
// never taken from the upload. Nothing is written outside the worktree:
// every folder on the way is made by us or checked to be a real folder (not a
// symbolic link), the final real path is verified, and files are created
// exclusively (an existing file, or a link, is never followed or overwritten).
// The files stay in the worktree and go away with it.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFile, lstat, mkdir, open, readFile, realpath } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { UploadedFile } from './uploadStore';

const execFileAsync = promisify(execFile);

/** Folder inside the worktree, relative. */
export const ATTACHMENTS_DIR = '.opsaip/attachments';
const RUN_ID = /^[A-Za-z0-9-]{1,64}$/;
// Only characters that cannot make a path: the extension comes from a fixed list.
const SAFE_EXT = /^[a-z0-9]{1,10}$/;

export interface SavedAttachments {
  /** Paths relative to the worktree, with "/" separators, in the order of the files. */
  paths: string[];
}

/** Save the files. Throws (with a message that holds no file data) if anything is unsafe. */
export async function saveAttachments(
  worktree: string,
  runId: string,
  files: readonly UploadedFile[],
  env?: NodeJS.ProcessEnv,
): Promise<SavedAttachments> {
  if (!RUN_ID.test(runId)) throw new Error('unsafe run id');
  if (!isAbsolute(worktree)) throw new Error('worktree must be an absolute path');
  const root = await realpath(worktree);

  // Each folder: made with mode 0700 if missing, otherwise it must be a real directory.
  let dir = root;
  for (const part of ['.opsaip', 'attachments', runId]) {
    dir = join(dir, part);
    try {
      await mkdir(dir, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
    const info = await lstat(dir);
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error('attachment folder is not a plain folder');
  }
  const real = await realpath(dir);
  if (real !== dir || !real.startsWith(root + sep)) throw new Error('attachment folder is outside the worktree');

  await excludeFromGit(root, env);

  const paths: string[] = [];
  for (const file of files) {
    if (!SAFE_EXT.test(file.ext)) throw new Error('unsafe extension');
    const name = `${randomUUID()}.${file.ext}`;
    const target = join(dir, name);
    if (resolve(target) !== target || !target.startsWith(dir + sep)) throw new Error('unsafe file name');
    // "wx": create only, fail if anything (even a link) is already there. 0600: private to this user.
    const handle = await open(target, 'wx', 0o600);
    try {
      await handle.writeFile(file.bytes);
    } finally {
      await handle.close();
    }
    paths.push(`${ATTACHMENTS_DIR}/${runId}/${name}`);
  }
  return { paths };
}

/** The prompt the agent gets: what the person wrote, a blank line, then the list of files. */
export function promptWithAttachments(prompt: string, paths: readonly string[]): string {
  if (paths.length === 0) return prompt;
  return `${prompt}\n\nAttached files:\n${paths.map((path) => `- ${path}`).join('\n')}`;
}

/**
 * Keep .opsaip/ out of `git status` through the repository's info/exclude
 * (not .gitignore, which would be a change to the project). Best effort: a
 * failure here never fails the run.
 */
async function excludeFromGit(worktree: string, env?: NodeJS.ProcessEnv): Promise<void> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', worktree, 'rev-parse', '--git-path', 'info/exclude'], {
      shell: false,
      timeout: 10_000,
      ...(env === undefined ? {} : { env }),
    });
    const line = stdout.trim();
    if (line === '') return;
    const file = isAbsolute(line) ? line : resolve(worktree, line);
    const current = await readFile(file, 'utf8').catch(() => ''); // no file yet: created below
    if (current.split('\n').includes('/.opsaip/')) return;
    await appendFile(file, `${current === '' || current.endsWith('\n') ? '' : '\n'}/.opsaip/\n`);
  } catch {
    // Not fatal: the files are only a little more visible in git status.
  }
}
