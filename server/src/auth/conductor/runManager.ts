// Conductor runs: one agent at a time, each in its own git worktree, with its
// progress written to a task through the TaskStore like any agent report.
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmod, mkdir, rmdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { MAX_NOTE_LENGTH, type AgentTaskStatus, type TaskStore } from '@opsaip/core';
import { createClaudeCliDriver, withoutOpsaipVars } from './claudeCliDriver';
import type { AgentDriver, PermissionRequest, RunEvent } from './driver';
import { truncate } from './toolSummary';

/** How long a permission request waits for the person before Opsaip denies it and stops the run. */
export const PERMISSION_TIMEOUT_MS = 30 * 60_000;
/**
 * Claude Code's MCP tool-call limit for the permission tool. Longer than
 * PERMISSION_TIMEOUT_MS, so Opsaip always answers first, with a clear note,
 * instead of the call failing inside Claude Code.
 */
export const TOOL_TIMEOUT_MS = PERMISSION_TIMEOUT_MS + 2 * 60_000;
/** Longest lastMessage kept for GET /v1/runs/:id, in UTF-16 code units. */
export const MAX_LAST_MESSAGE_CHARS = 2000;
/** Finished runs kept in memory for GET /v1/runs/:id (the server forgets them on restart). */
export const KEPT_RUNS = 20;
/** Where run worktrees go: ~/.opsaip/worktrees/<run id>. */
export const DEFAULT_WORKTREES_DIR = join(homedir(), '.opsaip', 'worktrees');
/** The agent name written on run tasks. */
export const RUN_AGENT = 'claude-code';

/** A run as GET /v1/runs/:id returns it. */
export interface RunView {
  id: string;
  /** The task that tracks this run (GET /v1/tasks). */
  taskId: string;
  /** The task's status as this run last reported it. */
  status: AgentTaskStatus;
  /** The run's own branch, kept after the run. */
  branch: string;
  /** The run's worktree folder, kept after the run. */
  worktree: string;
  /** The oldest permission request waiting for an answer, while there is one. */
  permission?: PermissionRequest;
  /** The agent's latest text (its final answer once the run is done), truncated. */
  lastMessage?: string;
}

export type RunResult =
  | { ok: true; run: RunView }
  | { ok: false; status: 404 | 409 | 500; error: string };

export interface RunManager {
  /** Start a run (title and prompt already checked by parseNewRun). */
  start(input: { title: string; prompt: string }): Promise<RunResult>;
  get(id: string): RunView | undefined;
  answerPermission(id: string, permissionId: string, allow: boolean): RunResult;
  sendMessage(id: string, text: string): RunResult;
  cancel(id: string): RunResult;
  /** Stop the active run, if any (server shutdown). Resolves once its process has exited. */
  stopActive(): Promise<void>;
}

export interface RunManagerOptions {
  store: TaskStore;
  /** The repository (OPSAIP_CONDUCTOR_DIR, already checked by conductorFromEnv). */
  repoDir: string;
  worktreesDir?: string;
  /**
   * The agent program and the arguments before the Claude flags. Defaults to
   * ["claude"]. Tests put the fake agent here; production never changes it.
   */
  agentCommand?: readonly string[];
  /** Makes the driver for each run. Defaults to a ClaudeCliDriver for agentCommand. */
  createDriver?: () => AgentDriver;
  permissionTimeoutMs?: number;
  /** One line at the start and one at the end of each run: run id and exit code only. */
  log?: (line: string) => void;
  now?: () => number;
}

interface Run {
  id: string;
  taskId: string;
  branch: string;
  worktree: string;
  status: AgentTaskStatus;
  /** Waiting for the person, oldest first. */
  permissions: PermissionRequest[];
  permissionTimers: Map<string, NodeJS.Timeout>;
  lastMessage?: string;
  driver: AgentDriver;
  /** The task is done or failed: the run accepts nothing more. */
  finished: boolean;
  /** Resolves once the agent process has exited. */
  exited: Promise<void>;
}

const execFileAsync = promisify(execFile);

/**
 * Create the run manager. Rules:
 *   - one run at a time: a run is active from POST /v1/runs until its agent
 *     process has exited (a finished run can take a few seconds to exit);
 *   - each run gets a new branch opsaip/run-<id> and a worktree at
 *     <worktreesDir>/<id>, made from the repository's HEAD. Both are KEPT
 *     after the run, for the person to review. Opsaip never deletes them;
 *   - the run's task is created queued (source "you", agent "claude-code"),
 *     then: running when the agent starts; waiting_on_human (note: the
 *     request) while a permission request waits; running after the answer;
 *     done on a successful result; failed on an error result, a crash
 *     (note: exit code), a cancel ("Stopped by you") or an unanswered
 *     permission request (after permissionTimeoutMs);
 *   - every report's time is strictly later than the previous one, so core
 *     never rejects a report as stale or as a duplicate.
 * Logs name only the run id and the exit code: never the prompt, the agent's
 * output, permission requests or paths.
 */
export function createRunManager(options: RunManagerOptions): RunManager {
  const { store, repoDir } = options;
  const worktreesDir = options.worktreesDir ?? DEFAULT_WORKTREES_DIR;
  const permissionTimeoutMs = options.permissionTimeoutMs ?? PERMISSION_TIMEOUT_MS;
  const log = options.log ?? ((line: string) => console.log(line));
  const now = options.now ?? Date.now;
  const createDriver =
    options.createDriver ??
    (() => createClaudeCliDriver({ command: options.agentCommand ?? ['claude'], toolTimeoutMs: TOOL_TIMEOUT_MS }));

  const runs = new Map<string, Run>();
  let active: Run | undefined;
  let starting: Promise<RunResult> | undefined;
  let lastAt = 0;

  /** A timestamp strictly later than the previous one. */
  const nextAt = (): string => {
    lastAt = Math.max(now(), lastAt + 1);
    return new Date(lastAt).toISOString();
  };

  const report = (run: Run, status: AgentTaskStatus, note?: string): void => {
    run.status = status;
    try {
      // A rejection (e.g. someone else reported on this task) changes
      // nothing on the task; the run keeps its own view.
      store.apply({
        taskId: run.taskId,
        status,
        at: nextAt(),
        agent: RUN_AGENT,
        ...(note === undefined ? {} : { note: truncate(note, MAX_NOTE_LENGTH) }),
      });
    } catch {
      // The database failed. The run goes on; GET /v1/runs/:id still shows it.
    }
  };

  const permissionNote = (permission: PermissionRequest): string =>
    `Claude Code asks to use ${permission.tool}: ${permission.summary}`;

  const finish = (run: Run, status: 'done' | 'failed', note?: string): void => {
    if (run.finished) return;
    run.finished = true;
    for (const timer of run.permissionTimers.values()) clearTimeout(timer);
    run.permissionTimers.clear();
    run.permissions = [];
    // queued -> failed is not a transition core allows.
    if (run.status === 'queued') report(run, 'running');
    report(run, status, note);
  };

  /** Remove a request from the queue; keep the task's status in step. */
  const settle = (run: Run, permissionId: string): void => {
    const index = run.permissions.findIndex((permission) => permission.id === permissionId);
    if (index === -1) return;
    clearTimeout(run.permissionTimers.get(permissionId));
    run.permissionTimers.delete(permissionId);
    run.permissions.splice(index, 1);
    if (run.finished || index !== 0) return;
    report(run, 'running');
    const next = run.permissions[0];
    if (next !== undefined) report(run, 'waiting_on_human', permissionNote(next));
  };

  const onPermissionTimeout = (run: Run, permissionId: string): void => {
    if (run.finished) return;
    const waited = formatDuration(permissionTimeoutMs);
    run.driver.answerPermission(permissionId, false, `No answer in Opsaip within ${waited}, so this was denied and the run was stopped.`);
    finish(run, 'failed', `No answer to the permission request within ${waited}. Opsaip denied it and stopped the run`);
    void run.driver.cancel();
  };

  const onEvent = (run: Run, event: RunEvent, exited: () => void): void => {
    switch (event.type) {
      case 'started':
        if (!run.finished && run.status === 'queued') report(run, 'running');
        return;
      case 'message':
        run.lastMessage = truncate(event.text, MAX_LAST_MESSAGE_CHARS);
        return;
      case 'permissionRequested': {
        const { permission } = event;
        if (run.finished) {
          run.driver.answerPermission(permission.id, false, 'The run has ended in Opsaip, so this was denied.');
          return;
        }
        run.permissions.push(permission);
        const timer = setTimeout(() => onPermissionTimeout(run, permission.id), permissionTimeoutMs);
        run.permissionTimers.set(permission.id, timer);
        if (run.permissions.length === 1) {
          if (run.status === 'queued') report(run, 'running');
          report(run, 'waiting_on_human', permissionNote(permission));
        }
        return;
      }
      case 'permissionWithdrawn':
        settle(run, event.permissionId);
        return;
      case 'result':
        if (event.text !== undefined) run.lastMessage = truncate(event.text, MAX_LAST_MESSAGE_CHARS);
        if (event.ok) finish(run, 'done');
        else finish(run, 'failed', 'Claude Code ended the run with an error');
        return;
      case 'exited': {
        if (event.startFailed) {
          finish(run, 'failed', 'Could not start Claude Code. Is the claude CLI installed, on PATH and logged in?');
        } else {
          const how = event.code !== null ? `exit code ${event.code}` : `signal ${event.signal ?? 'unknown'}`;
          finish(run, 'failed', `Claude Code stopped before finishing (${how})`);
        }
        log(`opsaip: conductor run ${run.id} ended (${exitText(event)})`);
        if (active === run) active = undefined;
        exited();
        return;
      }
    }
  };

  const start = async ({ title, prompt }: { title: string; prompt: string }): Promise<RunResult> => {
    const id = randomUUID();
    const taskId = randomUUID();
    const branch = `opsaip/run-${id}`;
    const worktree = join(worktreesDir, id);

    try {
      await createWorktree(repoDir, worktreesDir, branch, worktree);
    } catch {
      return { ok: false, status: 500, error: 'could not create the git worktree for the run' };
    }

    let created: { ok: boolean };
    try {
      created = store.create({ id: taskId, title, agent: RUN_AGENT, createdAt: nextAt(), source: 'you' });
    } catch {
      created = { ok: false };
    }
    // The worktree stays: Opsaip never deletes one.
    if (!created.ok) return { ok: false, status: 500, error: 'could not create the task for the run' };

    let markExited: () => void = () => {};
    const run: Run = {
      id,
      taskId,
      branch,
      worktree,
      status: 'queued',
      permissions: [],
      permissionTimers: new Map(),
      driver: createDriver(),
      finished: false,
      exited: new Promise<void>((resolve) => (markExited = resolve)),
    };
    runs.set(id, run);
    forgetOldRuns(runs);
    active = run;
    log(`opsaip: conductor run ${id} started`);
    try {
      await run.driver.start({ cwd: worktree, prompt, onEvent: (event) => onEvent(run, event, markExited) });
    } catch {
      // Only a misused driver throws (see AgentDriver.start). Free the slot.
      onEvent(run, { type: 'exited', code: null, signal: null, startFailed: true }, markExited);
    }
    return { ok: true, run: view(run) };
  };

  const find = (id: string): Run | { ok: false; status: 404; error: string } =>
    runs.get(id) ?? { ok: false, status: 404, error: 'run not found' };

  return {
    async start(input) {
      if (active !== undefined || starting !== undefined) {
        return { ok: false, status: 409, error: 'a run is already active: one run at a time. Stop it or wait until it has ended' };
      }
      starting = start(input);
      try {
        return await starting;
      } finally {
        starting = undefined;
      }
    },

    get(id) {
      const run = runs.get(id);
      return run === undefined ? undefined : view(run);
    },

    answerPermission(id, permissionId, allow) {
      const run = find(id);
      if ('ok' in run) return run;
      if (run.finished) return { ok: false, status: 409, error: 'the run has ended' };
      if (!run.permissions.some((permission) => permission.id === permissionId)) {
        return { ok: false, status: 409, error: 'no pending permission request with this permissionId' };
      }
      run.driver.answerPermission(permissionId, allow);
      settle(run, permissionId);
      return { ok: true, run: view(run) };
    },

    sendMessage(id, text) {
      const run = find(id);
      if ('ok' in run) return run;
      if (run.finished || run.status === 'queued' || !run.driver.sendMessage(text)) {
        return { ok: false, status: 409, error: 'the run is not active: follow-ups are accepted only while it runs' };
      }
      return { ok: true, run: view(run) };
    },

    cancel(id) {
      const run = find(id);
      if ('ok' in run) return run;
      if (run.finished) return { ok: false, status: 409, error: 'the run has already ended' };
      finish(run, 'failed', 'Stopped by you');
      void run.driver.cancel();
      return { ok: true, run: view(run) };
    },

    async stopActive() {
      await starting;
      const run = active;
      if (run === undefined) return;
      finish(run, 'failed', 'Stopped because the Opsaip server shut down');
      await run.driver.cancel('The Opsaip server is shutting down, so this was denied.');
      await run.exited;
    },
  };
}

function view(run: Run): RunView {
  const result: RunView = {
    id: run.id,
    taskId: run.taskId,
    status: run.status,
    branch: run.branch,
    worktree: run.worktree,
  };
  const permission = run.permissions[0];
  if (permission !== undefined) result.permission = { ...permission };
  if (run.lastMessage !== undefined) result.lastMessage = run.lastMessage;
  return result;
}

/** Keep at most KEPT_RUNS runs, dropping the oldest finished ones. Maps keep insertion order. */
function forgetOldRuns(runs: Map<string, Run>): void {
  for (const [id, run] of runs) {
    if (runs.size <= KEPT_RUNS) return;
    if (run.finished) runs.delete(id);
  }
}

/**
 * `git worktree add -b <branch> <path> HEAD`, with an argument array (no
 * shell). The worktrees folder and the run's folder are made with mode 0700
 * first, so the code in them is private to this user.
 */
async function createWorktree(repoDir: string, worktreesDir: string, branch: string, path: string): Promise<void> {
  await mkdir(worktreesDir, { recursive: true, mode: 0o700 });
  await chmod(worktreesDir, 0o700);
  await mkdir(path, { mode: 0o700 });
  try {
    await execFileAsync('git', ['-C', repoDir, 'worktree', 'add', '-b', branch, path, 'HEAD'], {
      shell: false,
      timeout: 60_000,
      env: withoutOpsaipVars(process.env),
    });
  } catch (error) {
    await rmdir(path).catch(() => {}); // only if git left it empty
    throw error;
  }
}

function exitText(event: { code: number | null; signal: string | null; startFailed: boolean }): string {
  if (event.startFailed) return 'did not start';
  return event.code !== null ? `exit code ${event.code}` : `signal ${event.signal ?? 'unknown'}`;
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) {
    const minutes = Math.round(ms / 60_000);
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  const seconds = Math.max(1, Math.round(ms / 1000));
  return `${seconds} second${seconds === 1 ? '' : 's'}`;
}
