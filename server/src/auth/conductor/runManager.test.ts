import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createClaudeCliDriver } from './claudeCliDriver';
import type { AgentDriver, RunEvent } from './driver';
import { KEPT_RUNS, MAX_ENTRY_CHARS, MAX_TRANSCRIPT_CHARS, MAX_TRANSCRIPT_ENTRIES, createRunManager, type RunManager, type RunManagerOptions, type RunView } from './runManager';
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
    // The run is over and its agent has exited: a follow-up now resumes it (see 'resuming').
    expect(t.manager.sendMessage(run.id, 'again')).toMatchObject({ ok: true });
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

describe('the transcript', () => {
  it('records the prompt, the agent messages and the result in order, with increasing ids', async () => {
    const t = setUp('success');
    const run = await t.start('Please fix it');
    await t.ended(run);
    const transcript = t.manager.transcript(run.id)!;
    expect(transcript.entries.map(({ id, role, kind, text }) => ({ id, role, kind, text }))).toEqual([
      { id: 1, role: 'you', kind: 'prompt', text: 'Please fix it' },
      { id: 2, role: 'agent', kind: 'message', text: 'Looking at the code' },
      { id: 3, role: 'agent', kind: 'message', text: 'All done' },
    ]);
    for (const entry of transcript.entries) expect(new Date(entry.at).toISOString()).toBe(entry.at);
    expect(transcript).toMatchObject({ finished: true, truncated: false });
  });

  it('records an accepted follow-up, and not a refused one', async () => {
    const t = setUp('followup');
    const run = await t.start();
    await t.until(run, (view) => view.lastMessage === 'Send me a follow-up');
    expect(t.manager.transcript(run.id)!.finished).toBe(false);
    t.manager.sendMessage(run.id, 'Also update the docs');
    await t.ended(run);
    expect(t.manager.sendMessage('no-such-run', 'x')).toMatchObject({ ok: false, status: 404 });
    expect(t.manager.transcript(run.id)!.entries.map(({ role, kind, text }) => [role, kind, text])).toEqual([
      ['you', 'prompt', 'Do the thing'],
      ['agent', 'message', 'Send me a follow-up'],
      ['you', 'followup', 'Also update the docs'],
      ['agent', 'message', 'follow-up: Also update the docs'],
    ]);
  });

  it('an unknown run has no transcript', () => {
    const t = setUp('success');
    expect(t.manager.transcript('no-such-run')).toBeUndefined();
  });

  it('is never logged', async () => {
    const t = setUp('success');
    const run = await t.start('PROMPT-SECRET-TEXT');
    await t.ended(run);
    const all = t.logs.join('\n');
    for (const secret of ['PROMPT-SECRET-TEXT', 'Looking at the code', 'All done']) expect(all).not.toContain(secret);
  });
});

/** A driver the test controls: it keeps the run's onEvent and accepts follow-ups. */
function scriptedDriver(): { driver: AgentDriver; emit(event: RunEvent): void } {
  let onEvent: (event: RunEvent) => void = () => {};
  return {
    emit: (event) => onEvent(event),
    driver: {
      agent: 'claude-code',
      start: (options) => {
        onEvent = options.onEvent;
        options.onEvent({ type: 'started' });
        return Promise.resolve();
      },
      sendMessage: () => true,
      answerPermission: () => false,
      cancel: () => {
        onEvent({ type: 'exited', code: 143, signal: null, startFailed: false });
        return Promise.resolve();
      },
    },
  };
}

describe('the transcript limits', () => {
  function scripted() {
    const script = scriptedDriver();
    const t = setUp('success', { createDriver: () => script.driver });
    return { ...script, t };
  }
  const say = (text: string): RunEvent => ({ type: 'message', text });
  const exit: RunEvent = { type: 'exited', code: 0, signal: null, startFailed: false };

  it('cuts one entry to 8000 characters and says so', async () => {
    const { emit, t } = scripted();
    const run = await t.start('p'.repeat(MAX_ENTRY_CHARS + 500));
    emit(say('m'.repeat(MAX_ENTRY_CHARS + 1)));
    const transcript = t.manager.transcript(run.id)!;
    expect(transcript.entries.map((entry) => entry.text.length)).toEqual([MAX_ENTRY_CHARS, MAX_ENTRY_CHARS]);
    expect(transcript.truncated).toBe(true);
  });

  it('keeps at most 200 entries, dropping the oldest', async () => {
    const { emit, t } = scripted();
    const run = await t.start('first');
    for (let i = 1; i <= MAX_TRANSCRIPT_ENTRIES + 5; i++) emit(say(`m${i}`));
    const { entries, truncated } = t.manager.transcript(run.id)!;
    expect(entries).toHaveLength(MAX_TRANSCRIPT_ENTRIES);
    // 1 prompt + 205 messages = 206 entries: ids 1..6 are gone.
    expect(entries[0]).toMatchObject({ id: 7, text: 'm6' });
    expect(entries.at(-1)).toMatchObject({ id: 206, text: 'm205' });
    expect(truncated).toBe(true);
  });

  it('keeps at most 200 000 characters, dropping the oldest entries first', async () => {
    const { emit, t } = scripted();
    const run = await t.start('first');
    const size = 5000;
    const count = MAX_TRANSCRIPT_CHARS / size + 10;
    for (let i = 1; i <= count; i++) emit(say('a'.repeat(size)));
    const { entries, truncated } = t.manager.transcript(run.id)!;
    const total = entries.reduce((sum, entry) => sum + entry.text.length, 0);
    expect(total).toBeLessThanOrEqual(MAX_TRANSCRIPT_CHARS);
    expect(total).toBeGreaterThan(MAX_TRANSCRIPT_CHARS - size);
    // The newest entry is kept; the entries are consecutive; the prompt (the oldest) is gone.
    expect(entries.at(-1)!.id).toBe(count + 1);
    expect(entries.map((entry) => entry.id)).toEqual(Array.from({ length: entries.length }, (_, i) => count + 2 - entries.length + i));
    expect(entries.some((entry) => entry.kind === 'prompt')).toBe(false);
    expect(truncated).toBe(true);
  });

  it('adds the result text only when it differs from the last message', async () => {
    const same = scripted();
    const run = await same.t.start();
    same.emit(say('same'));
    same.emit({ type: 'result', ok: true, text: 'same' });
    expect(same.t.manager.transcript(run.id)!.entries).toHaveLength(2);

    const other = scripted();
    const run2 = await other.t.start();
    other.emit(say('one'));
    other.emit({ type: 'result', ok: true, text: 'two' });
    expect(other.t.manager.transcript(run2.id)!.entries.map((entry) => entry.text)).toEqual(['Do the thing', 'one', 'two']);
  });

  it('is forgotten with its run: finished runs follow KEPT_RUNS', async () => {
    const scripts: Array<ReturnType<typeof scriptedDriver>> = [];
    const t = setUp('success', {
      createDriver: () => {
        const script = scriptedDriver();
        scripts.push(script);
        return script.driver;
      },
    });
    const ids: string[] = [];
    for (let i = 0; i < KEPT_RUNS + 2; i++) {
      ids.push((await t.start(`prompt ${i}`)).id);
      scripts[i].emit({ type: 'result', ok: true, text: 'done' });
      scripts[i].emit(exit); // frees the slot for the next run
    }
    expect(t.manager.transcript(ids[0])).toBeUndefined();
    expect(t.manager.transcript(ids[1])).toBeUndefined();
    expect(t.manager.transcript(ids[2])!.entries[0].text).toBe('prompt 2');
    expect(t.manager.transcript(ids.at(-1)!)!.finished).toBe(true);
  });

  it('active() is true while a run is active and false once its agent has exited', async () => {
    const { emit, t } = scripted();
    expect(t.manager.active()).toBe(false);
    await t.start();
    expect(t.manager.active()).toBe(true);
    emit({ type: 'result', ok: true, text: 'done' }); // finished, but the process has not exited
    expect(t.manager.active()).toBe(true);
    emit(exit);
    expect(t.manager.active()).toBe(false);
  });

  it('repoName is the last segment of repoDir, or the option', () => {
    const t = setUp('success', { repoDir: '/some/where/my-repo' });
    expect(t.manager.repoName).toBe('my-repo');
    expect(setUp('success', { repoName: 'x' }).manager.repoName).toBe('x');
  });
});

describe('resuming a finished run', () => {
  const SESSION = 'fake-session-0001'; // what the fake agent reports
  const endedTimes = (t: ReturnType<typeof setUp>, run: RunView, count: number) =>
    waitFor(() => t.logs.filter((line) => line.includes(`run ${run.id} ended`)).length >= count);

  it('a follow-up to a done run resumes the same session in the same worktree, on a new task', async () => {
    const t = setUp('success');
    const run = await t.start('Please fix it');
    await t.ended(run);
    expect(t.manager.transcript(run.id)).toMatchObject({ finished: true, canResume: true });

    const resumed = t.manager.sendMessage(run.id, 'Now add a test');
    expect(resumed).toMatchObject({ ok: true, run: { id: run.id, branch: run.branch, worktree: run.worktree } });
    expect(resumed.ok && resumed.run.taskId).not.toBe(run.taskId);
    expect(t.manager.active()).toBe(true);
    expect(t.manager.transcript(run.id)).toMatchObject({ finished: false, canResume: false });
    await endedTimes(t, run, 2);

    const argvs = t.record().filter((entry) => entry.event === 'argv').map((entry) => entry.argv as string[]);
    expect(argvs[0]).not.toContain('--resume');
    expect(argvs[1].slice(argvs[1].indexOf('--resume'), argvs[1].indexOf('--resume') + 2)).toEqual(['--resume', SESSION]);
    expect(argvs[1]).not.toContain('Now add a test'); // the text goes to stdin, never argv
    expect(t.record().filter((entry) => entry.event === 'prompt').map((entry) => entry.text)).toEqual(['Please fix it', 'Now add a test']);
    expect(t.record().filter((entry) => entry.event === 'env').map((entry) => entry.cwd)).toEqual([run.worktree, run.worktree]);

    const now = t.manager.get(run.id)!;
    expect(now.status).toBe('done');
    expect(t.store.get(run.taskId)).toMatchObject({ status: 'done' }); // the old task stays final
    expect(t.store.get(now.taskId)).toMatchObject({ status: 'done', title: 'Fix the login bug', source: 'you', agent: 'claude-code' });
    expect(t.statuses(now)).toEqual(['queued', 'running', 'done']);
    expect(t.manager.transcript(run.id)!.entries.map(({ kind, text }) => [kind, text])).toEqual([
      ['prompt', 'Please fix it'],
      ['message', 'Looking at the code'],
      ['message', 'All done'],
      ['followup', 'Now add a test'],
      ['message', 'Looking at the code'],
      ['message', 'All done'],
    ]);
    expect(t.manager.transcript(run.id)).toMatchObject({ finished: true, canResume: true });
  });

  it('a failed run goes back in line on its own task (failed -> queued -> running)', async () => {
    const t = setUp('error-result');
    const run = await t.start();
    await t.ended(run);
    expect(t.manager.sendMessage(run.id, 'Try again')).toMatchObject({ ok: true, run: { taskId: run.taskId } });
    await endedTimes(t, run, 2);
    expect(t.statuses(run)).toEqual(['queued', 'running', 'failed', 'queued', 'running', 'failed']);
  });

  it('is refused while another run is active', async () => {
    const t = setUp('hang');
    const first = await t.start();
    await t.until(first, (view) => view.lastMessage === 'Working');
    t.manager.cancel(first.id);
    await t.ended(first);
    const second = await t.start();
    expect(t.manager.sendMessage(first.id, 'continue')).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('another run is active') });
    expect(t.manager.get(first.id)!.status).toBe('failed');
    expect(t.manager.transcript(first.id)!.entries.some((entry) => entry.kind === 'followup')).toBe(false);
    t.manager.cancel(second.id);
  });

  it('is refused without a session id: a 409, canResume false', async () => {
    const script = scriptedDriver();
    const t = setUp('success', { createDriver: () => script.driver });
    const run = await t.start();
    script.emit({ type: 'result', ok: false });
    script.emit({ type: 'exited', code: 1, signal: null, startFailed: false });
    expect(t.manager.transcript(run.id)).toMatchObject({ finished: true, canResume: false });
    expect(t.manager.sendMessage(run.id, 'continue')).toMatchObject({ ok: false, status: 409, error: expect.stringContaining('no session') });
  });

  it('is refused until the agent process has exited', async () => {
    const script = scriptedDriver();
    const t = setUp('success', { createDriver: () => script.driver });
    const run = await t.start();
    script.emit({ type: 'session', sessionId: 'abc' });
    script.emit({ type: 'result', ok: true });
    expect(t.manager.transcript(run.id)).toMatchObject({ finished: true, canResume: false });
    expect(t.manager.sendMessage(run.id, 'continue')).toMatchObject({ ok: false, status: 409 });
  });

  it('never shows or logs the session id', async () => {
    const t = setUp('success');
    const run = await t.start();
    await t.ended(run);
    t.manager.sendMessage(run.id, 'continue');
    await endedTimes(t, run, 2);
    const everything = JSON.stringify([t.logs, t.manager.get(run.id), t.manager.transcript(run.id)]);
    expect(everything).not.toContain(SESSION);
  });

  it('permissions work in the resumed run', async () => {
    const t = setUp('permission');
    const run = await t.start();
    const first = await t.until(run, (view) => view.permission !== undefined);
    t.manager.answerPermission(run.id, first.permission!.id, true);
    await t.ended(run);

    t.manager.sendMessage(run.id, 'Run them again');
    const second = await t.until(run, (view) => view.permission !== undefined && view.permission.id !== first.permission!.id);
    expect(second.status).toBe('waiting_on_human');
    expect(t.manager.answerPermission(run.id, second.permission!.id, false)).toMatchObject({ ok: true });
    await endedTimes(t, run, 2);
    expect(t.manager.get(run.id)).toMatchObject({ status: 'done', lastMessage: 'decision: deny (The person denied this in Opsaip.)' });
  });
});
