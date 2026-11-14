// Test helpers (not tests) for Conductor mode: temporary git repositories,
// the fake agent, a task store that remembers every status it accepted.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTaskStore, type AgentTaskStatus, type TaskStore } from '@opsaip/core';

/** The fake `claude` (testing/fakeClaude.mjs). */
export const FAKE_CLAUDE = fileURLToPath(new URL('./fakeClaude.mjs', import.meta.url));

/** The agent command for a fake scenario, recording into `recordFile`. */
export function fakeCommand(scenario: string, recordFile: string): string[] {
  return [process.execPath, FAKE_CLAUDE, '--scenario', scenario, '--record', recordFile];
}

const made: string[] = [];

/** A new empty temporary directory (real path), removed by cleanUp(). */
export function tempDir(prefix = 'opsaip-test-'): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  made.push(dir);
  return dir;
}

export function cleanUp(): void {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function git(dir: string, ...args: string[]): string {
  return execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

/** A git repository with one commit (and a README), at its real path. */
export function makeRepo(): string {
  const dir = tempDir('opsaip-repo-');
  git(dir, 'init', '-q');
  execFileSync('sh', ['-c', 'echo hello > README.md'], { cwd: dir });
  git(dir, 'add', 'README.md');
  git(dir, '-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'init');
  return dir;
}

/** Each JSON line the fake agent recorded, in order. */
export function readRecord(file: string): Array<Record<string, unknown>> {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

/** A core task store that also keeps the list of statuses (and notes) it accepted, per task. */
export function recordingStore(): TaskStore & { history(taskId: string): Array<{ status: AgentTaskStatus; note?: string; at: string }> } {
  const store = createTaskStore();
  const accepted = new Map<string, Array<{ status: AgentTaskStatus; note?: string; at: string }>>();
  const push = (taskId: string, entry: { status: AgentTaskStatus; note?: string; at: string }) => {
    accepted.set(taskId, [...(accepted.get(taskId) ?? []), entry]);
  };
  return {
    get: (id) => store.get(id),
    all: () => store.all(),
    create(input) {
      const result = store.create(input);
      if (result.ok) push(input.id, { status: 'queued', at: input.createdAt });
      return result;
    },
    apply(report) {
      const result = store.apply(report);
      if (result.ok) {
        const entry: { status: AgentTaskStatus; note?: string; at: string } = { status: report.status, at: report.at };
        if (report.note !== undefined) entry.note = report.note;
        push(report.taskId, entry);
      }
      return result;
    },
    history: (taskId) => accepted.get(taskId) ?? [],
  };
}

/** Poll until `check` returns a value that is not undefined/false, or fail after `timeoutMs`. */
export async function waitFor<T>(check: () => T | undefined | false, timeoutMs = 8_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = check();
    if (value !== undefined && value !== false) return value;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
