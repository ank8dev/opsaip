// The real server process (src/main.ts): refuses to start without a valid
// token or with a half-done Ask setup, and never prints the token or the
// LLM key.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  freePort,
  spawnServer,
  stopServer,
  waitUntilListening,
  type ServerProcess,
} from './testServerProcess';

const TOKEN = 'startup-test-SECRET-0123456789abcdef0123456789';
const HOW_TO = 'openssl rand -hex 32';

let dir: string;
const running: ServerProcess[] = [];
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opsaip-startup-'));
});
afterEach(() => {
  for (const server of running.splice(0)) server.child.kill('SIGKILL');
  rmSync(dir, { recursive: true, force: true });
});

function spawn(env: Record<string, string>): ServerProcess {
  const server = spawnServer({ OPSAIP_DB: join(dir, 'opsaip.db'), ...env });
  running.push(server);
  return server;
}

describe('startup', { timeout: 30_000 }, () => {
  it('refuses to start without OPSAIP_TOKEN on localhost, and says how to create one', async () => {
    const server = spawn({ OPSAIP_PORT: String(await freePort()) });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('OPSAIP_TOKEN is not set');
    expect(server.output()).toContain(HOW_TO);
    expect(server.output()).not.toContain('listening');
  });

  it('refuses to start on a non-local host (0.0.0.0) without OPSAIP_TOKEN', async () => {
    const server = spawn({ OPSAIP_HOST: '0.0.0.0', OPSAIP_PORT: String(await freePort()) });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('OPSAIP_TOKEN is not set');
    expect(server.output()).not.toContain('listening');
  });

  it('refuses a too short token without printing it', async () => {
    const short = 'SECRET-too-short';
    const server = spawn({ OPSAIP_PORT: String(await freePort()), OPSAIP_TOKEN: short });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('at least 32 characters');
    expect(server.output()).toContain(HOW_TO);
    expect(server.output()).not.toContain(short);
  });

  it('never prints the token, nor tokens that clients send', async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;
    const wrong = 'WRONG-client-token-0123456789abcdef0123456789';
    const server = spawn({ OPSAIP_HOST: '127.0.0.1', OPSAIP_PORT: String(port), OPSAIP_TOKEN: TOKEN });
    await waitUntilListening(server);

    const auth = { authorization: `Bearer ${TOKEN}` };
    const json = { 'content-type': 'application/json' };
    const post = (headers: Record<string, string>, body: string) =>
      fetch(`${base}/v1/reports`, { method: 'POST', headers: { ...json, ...headers }, body });
    const report = (status: string) =>
      JSON.stringify({ taskId: 't1', status, at: '2026-11-01T10:00:00Z' });

    // Every kind of answer: 200, 400, 401, 404, 409.
    expect((await post(auth, report('queued'))).status).toBe(200);
    expect((await post(auth, '{bad')).status).toBe(400);
    expect((await post({ authorization: `Bearer ${wrong}` }, report('queued'))).status).toBe(401);
    expect((await fetch(`${base}/v1/tasks`)).status).toBe(401);
    expect((await fetch(`${base}/nope`, { headers: auth })).status).toBe(404);
    expect((await post(auth, report('done'))).status).toBe(409);

    expect(await stopServer(server)).toBe(0);
    const output = server.output();
    expect(output).toContain('server listening'); // the output was captured
    expect(output).not.toContain(TOKEN);
    expect(output).not.toContain('SECRET');
    expect(output).not.toContain(wrong);
  });

  it('refuses a half-done Ask setup, says how to fix it and does not print the key', async () => {
    const key = 'AIza-startup-SECRET-llm-key-0123456789';
    const server = spawn({ OPSAIP_PORT: String(await freePort()), OPSAIP_TOKEN: TOKEN, OPSAIP_LLM_KEY: key });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('OPSAIP_LLM_KEY is set, but OPSAIP_LLM_PROVIDER is not');
    expect(server.output()).not.toContain(key);
    expect(server.output()).not.toContain('listening');
  });

  it('with Ask set up, says so with the provider and model, and never prints the key', async () => {
    const key = 'AIza-startup-SECRET-llm-key-0123456789';
    const server = spawn({
      OPSAIP_PORT: String(await freePort()),
      OPSAIP_TOKEN: TOKEN,
      OPSAIP_LLM_PROVIDER: 'gemini',
      OPSAIP_LLM_KEY: key,
    });
    await waitUntilListening(server);
    expect(await stopServer(server)).toBe(0);
    expect(server.output()).toContain('Ask is on (gemini, model gemini-3.5-flash-lite)');
    expect(server.output()).not.toContain(key);
    expect(server.output()).not.toContain('SECRET');
  });

  it('without Ask set up, says it is off', async () => {
    const server = spawn({ OPSAIP_PORT: String(await freePort()), OPSAIP_TOKEN: TOKEN });
    await waitUntilListening(server);
    expect(await stopServer(server)).toBe(0);
    expect(server.output()).toContain('Ask is off');
  });
});
