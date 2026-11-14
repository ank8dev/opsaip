import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClaudeCliDriver } from './claudeCliDriver';
import { createRunManager, type RunManager, type RunManagerOptions, type RunView } from './runManager';
import { cleanUp, fakeCommand, git, makeRepo, readRecord, recordingStore, tempDir, waitFor } from './testing/conductorTestKit';

afterAll(cleanUp);

const managers: RunManager[] = [];
afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.stopActive()));
});

function setUp(scenario: string, overrides: Partial<RunManagerOptions> = {}) {
  const repo = makeRepo();
  const worktreesDir = join(tempDir(), 'worktrees');
  const recordFile = join(tempDir(), 'record.jsonl');
  const store = recordingStore();
  const logs: string[] = [];
  const manager = createRunManager({
    store,
    repoDir: repo,
    worktreesDir,
    agentCommand: fakeCommand(scenario, recordFile),
    log: (line) => logs.push(line),
    ...overrides,
  });
  managers.push(manager);
  const start = async (prompt = 'Do the thing') => {
    const result = await manager.start({ title: 'Fix the login bug', prompt });
    if (!result.ok) throw new Error(`start failed: ${result.error}`);
    return result.run;
  };
  const statuses = (run: RunView) => store.history(run.taskId).map((entry) => entry.status);
  const until = (run: RunView, check: (view: RunView) => boolean) => waitFor(() => {
    const view = manager.get(run.id)!;
    return check(view) ? view : undefined;
  });
  const ended = (run: RunView) => waitFor(() => logs.some((line) => line.includes(`run ${run.id} ended`)));
  return { repo, worktreesDir, recordFile, store, logs, manager, start, statuses, until, ended, record: () => readRecord(recordFile) };
}

describe('a run', () => {
  it('creates a queued task from you, then running and done; strictly increasing times', async () => {
    const t = setUp('success');
    const run = await t.start();
    expect(run).toMatchObject({ status: expect.stringMatching(/queued|running/), branch: `opsaip/run-${run.id}` });
    await t.ended(run);

    expect(t.statuses(run)).toEqual(['queued', 'running', 'done']);
    const times = t.store.history(run.taskId).map((entry) => Date.parse(entry.at));
    for (let i = 1; i < times.length; i++) expect(times[i]).toBeGreaterThan(times[i - 1]);
    expect(t.store.get(run.taskId)).toMatchObject({ status: 'done', title: 'Fix the login bug', agent: 'claude-code', source: 'you' });
    expect(t.manager.get(run.id)).toEqual({
      id: run.id,
      taskId: run.taskId,
      status: 'done',
      branch: `opsaip/run-${run.id}`,
      worktree: join(t.worktreesDir, run.id),
      lastMessage: 'All done',
    });
  });

  it('works in its own worktree on its own branch, made 0700, and keeps both afterwards', async () => {
    const t = setUp('success');
    const run = await t.start();
    await t.ended(run);
    const env = t.record().find((entry) => entry.event === 'env')!;
    expect(env.cwd).toBe(run.worktree);
    expect(statSync(t.worktreesDir).mode & 0o777).toBe(0o700);
    expect(statSync(run.worktree).mode & 0o777).toBe(0o700);
    expect(existsSync(join(run.worktree, 'README.md'))).toBe(true);
    expect(git(run.worktree, 'rev-parse', '--abbrev-ref', 'HEAD')).toBe(run.branch);
    expect(git(t.repo, 'branch', '--list', run.branch)).toContain(run.branch);
    expect(git(t.repo, 'worktree', 'list')).toContain(run.worktree);
    // The user's own checkout is untouched.
    expect(git(t.repo, 'rev-parse', '--abbrev-ref', 'HEAD')).not.toBe(run.branch);
  });

  it('logs only the run id at start and the exit code at the end', async () => {
    const t = setUp('permission');
    const run = await t.start('PROMPT-SECRET-TEXT');
    const asked = await t.until(run, (view) => view.permission !== undefined);
    t.manager.answerPermission(run.id, asked.permission!.id, true);
    await t.ended(run);
    expect(t.logs).toEqual([`opsaip: conductor run ${run.id} started`, `opsaip: conductor run ${run.id} ended (exit code 0)`]);
    const all = t.logs.join('\n');
    for (const secret of ['PROMPT-SECRET-TEXT', 'npm test', t.repo, t.worktreesDir, 'decision']) expect(all).not.toContain(secret);
  });

  it('permission allowed: waiting_on_human with the request in the note, then running, then done', async () => {
    const t = setUp('permission');
    const run = await t.start();
    const waiting = await t.until(run, (view) => view.permission !== undefined);
    expect(waiting.status).toBe('waiting_on_human');
    expect(waiting.permission).toEqual({ id: expect.any(String), tool: 'Bash', summary: 'npm test' });
    expect(t.store.get(run.taskId)).toMatchObject({ status: 'waiting_on_human', note: 'Claude Code asks to use Bash: npm test' });

    const answered = t.manager.answerPermission(run.id, waiting.permission!.id, true);
    expect(answered).toMatchObject({ ok: true, run: { status: 'running' } });
    expect(answered.ok && answered.run.permission).toBeUndefined();
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'waiting_on_human', 'running', 'done']);
    expect(t.manager.get(run.id)!.lastMessage).toBe('decision: allow');
    expect(t.record().find((entry) => entry.event === 'decision')).toMatchObject({ decision: { behavior: 'allow', updatedInput: { command: 'npm test' } } });
  });

  it('permission denied: the agent gets a deny with a message and goes on', async () => {
    const t = setUp('permission');
    const run = await t.start();
    const waiting = await t.until(run, (view) => view.permission !== undefined);
    t.manager.answerPermission(run.id, waiting.permission!.id, false);
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'waiting_on_human', 'running', 'done']);
    expect(t.manager.get(run.id)!.lastMessage).toBe('decision: deny (The person denied this in Opsaip.)');
  });

  it('a stale or unknown permissionId is a 409 and changes nothing', async () => {
    const t = setUp('permission');
    const run = await t.start();
    const waiting = await t.until(run, (view) => view.permission !== undefined);
    expect(t.manager.answerPermission(run.id, 'not-the-id', true)).toMatchObject({ ok: false, status: 409 });
    expect(t.manager.answerPermission('no-such-run', waiting.permission!.id, true)).toMatchObject({ ok: false, status: 404 });
    expect(t.manager.answerPermission(run.id, waiting.permission!.id, true)).toMatchObject({ ok: true });
    expect(t.manager.answerPermission(run.id, waiting.permission!.id, true)).toMatchObject({ ok: false, status: 409 });
    await t.ended(run);
  });

  it('two requests at once are answered in turn, the task going back to waiting for the second', async () => {
    const t = setUp('two-permissions');
    const run = await t.start();
    const first = await t.until(run, (view) => view.permission !== undefined);
    t.manager.answerPermission(run.id, first.permission!.id, true);
    const second = await t.until(run, (view) => view.permission !== undefined && view.permission.id !== first.permission!.id);
    expect(second.status).toBe('waiting_on_human');
    t.manager.answerPermission(run.id, second.permission!.id, false);
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'waiting_on_human', 'running', 'waiting_on_human', 'running', 'done']);
  });

  it('a follow-up message reaches the agent while the run is active, and is refused after', async () => {
    const t = setUp('followup');
    const run = await t.start();
    await t.until(run, (view) => view.lastMessage === 'Send me a follow-up');
    expect(t.manager.sendMessage(run.id, 'Also update the docs')).toMatchObject({ ok: true });
    await t.ended(run);
    expect(t.record().find((entry) => entry.event === 'followup')).toEqual({ event: 'followup', text: 'Also update the docs' });
    expect(t.manager.get(run.id)).toMatchObject({ status: 'done', lastMessage: 'follow-up: Also update the docs' });
    expect(t.manager.sendMessage(run.id, 'too late')).toMatchObject({ ok: false, status: 409 });
    expect(t.manager.sendMessage('no-such-run', 'x')).toMatchObject({ ok: false, status: 404 });
  });

  it('cancel: failed with "Stopped by you"; a second cancel is a 409', async () => {
    const t = setUp('hang');
    const run = await t.start();
    await t.until(run, (view) => view.lastMessage === 'Working');
    expect(t.manager.cancel(run.id)).toMatchObject({ ok: true, run: { status: 'failed' } });
    expect(t.manager.cancel(run.id)).toMatchObject({ ok: false, status: 409 });
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'failed']);
    expect(t.store.get(run.taskId)).toMatchObject({ status: 'failed', note: 'Stopped by you' });
    expect(t.logs.at(-1)).toBe(`opsaip: conductor run ${run.id} ended (exit code 143)`);
  });

  it('cancel while a permission is pending: the agent gets a deny before SIGTERM', async () => {
    const t = setUp('permission-hang');
    const run = await t.start();
    await t.until(run, (view) => view.permission !== undefined);
    t.manager.cancel(run.id);
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'waiting_on_human', 'failed']);
    const record = t.record();
    const decision = record.findIndex((entry) => entry.event === 'decision');
    expect(record[decision]).toMatchObject({ decision: { behavior: 'deny' } });
    expect(record.findIndex((entry) => entry.event === 'sigterm')).toBeGreaterThan(decision);
    expect(t.manager.get(run.id)!.permission).toBeUndefined();
  });

  it('an unanswered permission request is denied after the timeout and the run fails', async () => {
    const t = setUp('permission-hang', { permissionTimeoutMs: 200 });
    const run = await t.start();
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'waiting_on_human', 'failed']);
    expect(t.store.get(run.taskId)!.note).toBe('No answer to the permission request within 1 second. Opsaip denied it and stopped the run');
    expect(t.record().find((entry) => entry.event === 'decision')).toMatchObject({
      decision: { behavior: 'deny', message: 'No answer in Opsaip within 1 second, so this was denied and the run was stopped.' },
    });
  });

  it('a crash (exit without a result) fails the task with the exit code', async () => {
    const t = setUp('crash');
    const run = await t.start();
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'failed']);
    expect(t.store.get(run.taskId)!.note).toBe('Claude Code stopped before finishing (exit code 3)');
    expect(t.manager.get(run.id)!.lastMessage).toBe('About to crash');
  });

  it('an error result fails the task', async () => {
    const t = setUp('error-result');
    const run = await t.start();
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'failed']);
    expect(t.store.get(run.taskId)!.note).toBe('Claude Code ended the run with an error');
  });

  it('malformed output lines are ignored and the run still finishes', async () => {
    const t = setUp('malformed');
    const run = await t.start();
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'done']);
    expect(t.manager.get(run.id)!.lastMessage).toBe('survived');
  });

  it('an agent that cannot start fails the task with a hint', async () => {
    const t = setUp('success', { agentCommand: [join(tempDir(), 'no-such-claude')] });
    const run = await t.start();
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'failed']);
    expect(t.store.get(run.taskId)!.note).toContain('Could not start Claude Code');
    expect(t.logs.at(-1)).toBe(`opsaip: conductor run ${run.id} ended (did not start)`);
  });

  it('a driver that throws on start fails the run and frees the slot', async () => {
    const t = setUp('success', {
      createDriver: () => ({
        agent: 'claude-code',
        start: () => Promise.reject(new Error('misused')),
        sendMessage: () => false,
        answerPermission: () => false,
        cancel: () => Promise.resolve(),
      }),
    });
    const run = await t.start();
    expect(t.manager.get(run.id)!.status).toBe('failed');
    expect(t.statuses(run)).toEqual(['queued', 'running', 'failed']);
    expect(await t.manager.start({ title: 'again', prompt: 'x' })).toMatchObject({ ok: true });
  });

  it('one run at a time: 409 until the active run has exited, then a new run starts', async () => {
    const t = setUp('hang');
    const run = await t.start();
    const second = await t.manager.start({ title: 'Another', prompt: 'x' });
    expect(second).toMatchObject({ ok: false, status: 409 });
    t.manager.cancel(run.id);
    await t.ended(run);
    const third = await t.manager.start({ title: 'Another', prompt: 'x' });
    expect(third).toMatchObject({ ok: true });
  });

  it('two starts at the same moment: exactly one wins', async () => {
    const t = setUp('hang');
    const results = await Promise.all([
      t.manager.start({ title: 'A', prompt: 'x' }),
      t.manager.start({ title: 'B', prompt: 'x' }),
    ]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok && result.status === 409)).toHaveLength(1);
  });

  it('a worktree that cannot be created is a 500 and creates no task', async () => {
    const t = setUp('success', { repoDir: tempDir() }); // not a repository
    const result = await t.manager.start({ title: 'x', prompt: 'x' });
    expect(result).toEqual({ ok: false, status: 500, error: 'could not create the git worktree for the run' });
    expect(t.store.all()).toEqual([]);
    expect(readdirSync(t.worktreesDir)).toEqual([]);
    // The slot is free again.
    expect(await t.manager.start({ title: 'x', prompt: 'x' })).toMatchObject({ ok: false, status: 500 });
  });

  it('stopActive (server shutdown) stops the run and waits for the process to exit', async () => {
    const t = setUp('permission-hang');
    const run = await t.start();
    await t.until(run, (view) => view.permission !== undefined);
    await t.manager.stopActive();
    expect(t.logs.at(-1)).toBe(`opsaip: conductor run ${run.id} ended (exit code 143)`);
    expect(t.store.get(run.taskId)).toMatchObject({ status: 'failed', note: 'Stopped because the Opsaip server shut down' });
  });

  it('after the result, an agent that lingers is stopped (the grace period comes from the driver)', async () => {
    const recordFile = join(tempDir(), 'linger.jsonl');
    const t = setUp('linger', {
      createDriver: () => createClaudeCliDriver({ command: fakeCommand('linger', recordFile), toolTimeoutMs: 60_000, exitGraceMs: 100 }),
    });
    const run = await t.start();
    await t.ended(run);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'done']);
    expect(readFileSync(recordFile, 'utf8')).toContain('"sigterm"');
  });
});
