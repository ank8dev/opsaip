import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { agentEnv, claudeArgs, createClaudeCliDriver, type ClaudeCliDriverOptions } from './claudeCliDriver';
import type { RunEvent } from './driver';
import { cleanUp, fakeCommand, readRecord, tempDir, waitFor } from './testing/conductorTestKit';

afterAll(cleanUp);

describe('claudeArgs', () => {
  it('is exactly the verified flags, as an array', () => {
    expect(claudeArgs('/tmp/opsaip-abc/mcp.json')).toEqual([
      '-p',
      '--input-format',
      'stream-json',
      '--output-format',
      'stream-json',
      '--verbose',
      '--permission-mode',
      'acceptEdits',
      '--mcp-config',
      '/tmp/opsaip-abc/mcp.json',
      '--strict-mcp-config',
      '--permission-prompt-tool',
      'mcp__opsaip__approve',
    ]);
  });

  it('never skips permissions', () => {
    const args = claudeArgs('/x').join(' ');
    expect(args).not.toContain('dangerously');
    expect(args).not.toContain('bypassPermissions');
  });
});

describe('agentEnv', () => {
  it('drops every OPSAIP_* variable, keeps the rest, and raises the MCP tool time limits', () => {
    const env = agentEnv(
      { PATH: '/bin', HOME: '/home/me', OPSAIP_TOKEN: 't', OPSAIP_LLM_KEY: 'k', opsaip_lower: 'x', MCP_TOOL_TIMEOUT: '5', UNSET: undefined },
      1_920_000,
    );
    expect(env).toEqual({
      PATH: '/bin',
      HOME: '/home/me',
      MCP_TOOL_TIMEOUT: '1920000',
      CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT: '1920000',
    });
  });
});

/** Run the fake agent through the driver; collect its events. */
function drive(scenario: string, overrides: Partial<ClaudeCliDriverOptions> = {}) {
  const dir = tempDir();
  const recordFile = join(dir, 'record.jsonl');
  const events: RunEvent[] = [];
  const driver = createClaudeCliDriver({
    command: fakeCommand(scenario, recordFile),
    toolTimeoutMs: 60_000,
    env: { ...process.env, OPSAIP_TOKEN: 'server-token-must-not-leak', OPSAIP_LLM_KEY: 'k' },
    ...overrides,
  });
  const exited = () => events.find((event) => event.type === 'exited');
  return { dir, recordFile, events, driver, exited, record: () => readRecord(recordFile) };
}

describe('createClaudeCliDriver with the fake agent', () => {
  it('starts the agent with an argv array, the prompt on stdin only, no OPSAIP_* env, in cwd', async () => {
    const run = drive('success');
    const prompt = 'Fix the login bug; do not touch the "payments" module';
    await run.driver.start({ cwd: run.dir, prompt, onEvent: (event) => run.events.push(event) });
    await waitFor(run.exited);

    expect(run.events).toEqual([
      { type: 'started' },
      { type: 'message', text: 'Looking at the code' },
      { type: 'result', ok: true, text: 'All done' },
      { type: 'exited', code: 0, signal: null, startFailed: false },
    ]);
    const record = run.record();
    const argv = record.find((entry) => entry.event === 'argv')!.argv as string[];
    const configPath = argv[argv.indexOf('--mcp-config') + 1];
    expect(argv).toEqual(claudeArgs(configPath));
    expect(argv.join(' ')).not.toContain('login bug');
    expect(record.find((entry) => entry.event === 'prompt')).toEqual({ event: 'prompt', text: prompt });
    expect(record.find((entry) => entry.event === 'env')).toEqual({
      event: 'env',
      opsaipVars: [],
      mcpToolTimeout: '60000',
      idleTimeout: '60000',
      cwd: run.dir,
    });
    // The real MCP server answered the fake's handshake with the approve tool.
    expect(record.find((entry) => entry.event === 'mcp')).toMatchObject({ toolNames: ['mcp__opsaip__approve'] });
    // stdin was closed after the result, and the run directory is gone.
    expect(record.some((entry) => entry.event === 'stdin-closed')).toBe(true);
    expect(existsSync(configPath)).toBe(false);
  });

  it('reports a binary that cannot start as exited with startFailed', async () => {
    const run = drive('success', { command: [join(tempDir(), 'no-such-claude')] });
    await run.driver.start({ cwd: run.dir, prompt: 'x', onEvent: (event) => run.events.push(event) });
    await waitFor(run.exited);
    expect(run.events).toEqual([{ type: 'exited', code: null, signal: null, startFailed: true }]);
    expect(run.driver.sendMessage('more')).toBe(false);
  });

  it('after the result, SIGTERMs an agent that does not exit within the grace period', async () => {
    const run = drive('linger', { exitGraceMs: 100 });
    await run.driver.start({ cwd: run.dir, prompt: 'x', onEvent: (event) => run.events.push(event) });
    await waitFor(run.exited);
    expect(run.events.at(-2)).toEqual({ type: 'result', ok: true, text: 'done, but not exiting' });
    expect(run.exited()).toEqual({ type: 'exited', code: 143, signal: null, startFailed: false });
    expect(run.record().some((entry) => entry.event === 'sigterm')).toBe(true);
  });

  it('cancel: denies the pending request first, then SIGTERM; follow-ups and answers are refused after', async () => {
    const run = drive('permission-hang');
    await run.driver.start({ cwd: run.dir, prompt: 'x', onEvent: (event) => run.events.push(event) });
    const asked = await waitFor(() => run.events.find((event) => event.type === 'permissionRequested'));
    expect(asked).toMatchObject({ permission: { tool: 'Bash', summary: 'rm -rf build' } });

    await run.driver.cancel('Stopped by the person.');
    expect(run.exited()).toEqual({ type: 'exited', code: 143, signal: null, startFailed: false });
    const record = run.record();
    const decision = record.findIndex((entry) => entry.event === 'decision');
    const sigterm = record.findIndex((entry) => entry.event === 'sigterm');
    expect(record[decision]).toMatchObject({ decision: { behavior: 'deny', message: 'Stopped by the person.' } });
    expect(sigterm).toBeGreaterThan(decision);
    expect(record[sigterm]).toMatchObject({ waitingForDecision: false });
    expect(run.driver.sendMessage('more')).toBe(false);
    if (asked.type === 'permissionRequested') expect(run.driver.answerPermission(asked.permission.id, true)).toBe(false);
  });

  it('SIGKILLs an agent that ignores SIGTERM', async () => {
    const run = drive('ignore-sigterm', { killGraceMs: 150 });
    await run.driver.start({ cwd: run.dir, prompt: 'x', onEvent: (event) => run.events.push(event) });
    await waitFor(() => run.events.find((event) => event.type === 'message'));
    await run.driver.cancel();
    expect(run.exited()).toEqual({ type: 'exited', code: null, signal: 'SIGKILL', startFailed: false });
    expect(run.record().some((entry) => entry.event === 'sigterm')).toBe(true);
  });

  it('cancel before start never starts the agent', async () => {
    const run = drive('success');
    await run.driver.cancel();
    await expect(run.driver.start({ cwd: run.dir, prompt: 'x', onEvent: (event) => run.events.push(event) })).rejects.toThrow();
    expect(run.record()).toEqual([]);
  });
});
