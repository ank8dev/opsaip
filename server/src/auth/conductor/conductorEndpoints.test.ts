import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createTaskStore } from '@opsaip/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { CONDUCTOR_OFF } from './conductorConfig';
import { MAX_PROMPT_CHARS } from './parseRun';
import { createRunManager, type RunManager } from './runManager';
import { cleanUp, fakeCommand, makeRepo, tempDir } from './testing/conductorTestKit';

const TOKEN = 'conductor-test-token-0123456789abcdef';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const JSON_HEADERS = { ...AUTH, 'content-type': 'application/json' };

let server: Server | undefined;
let manager: RunManager | undefined;
let base = '';

afterAll(cleanUp);
afterEach(async () => {
  await manager?.stopActive();
  manager = undefined;
  if (server === undefined) return;
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  server = undefined;
});

async function start(scenario?: string): Promise<void> {
  const store = createTaskStore();
  manager =
    scenario === undefined
      ? undefined
      : createRunManager({
          store,
          repoDir: makeRepo(),
          worktreesDir: join(tempDir(), 'worktrees'),
          agentCommand: fakeCommand(scenario, join(tempDir(), 'record.jsonl')),
          log: () => {},
        });
  server = createApp({ store, token: TOKEN, conductor: manager });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const post = (path: string, body?: unknown, headers: Record<string, string> = JSON_HEADERS) =>
  fetch(`${base}${path}`, { method: 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body) });
const get = (path: string) => fetch(`${base}${path}`, { headers: AUTH });
const json = async (res: Response) => (await res.json()) as Record<string, any>;

async function newRun(): Promise<Record<string, any>> {
  const res = await post('/v1/runs', { title: 'Fix the login bug', prompt: 'Please fix it' });
  expect(res.status).toBe(201);
  return (await json(res)).run;
}

async function pollRun(id: string, check: (run: Record<string, any>) => boolean): Promise<Record<string, any>> {
  const deadline = Date.now() + 8000;
  for (;;) {
    const run = (await json(await get(`/v1/runs/${id}`))).run;
    if (check(run)) return run;
    if (Date.now() > deadline) throw new Error('run did not get there');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('Conductor mode off', () => {
  it('GET /v1/conductor says it is off and how to turn it on', async () => {
    await start();
    const res = await get('/v1/conductor');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ enabled: false, agent: 'claude-code', reason: CONDUCTOR_OFF });
  });

  it('every run endpoint answers 503, before reading a body', async () => {
    await start();
    for (const res of [
      await post('/v1/runs', { title: 't', prompt: 'p' }),
      await post('/v1/runs', 'not json', AUTH),
      await get('/v1/runs/abc'),
      await post('/v1/runs/abc/permission', { allow: true, permissionId: 'x' }),
      await post('/v1/runs/abc/message', { text: 'x' }),
      await post('/v1/runs/abc/cancel'),
    ]) {
      expect(res.status).toBe(503);
      expect(await json(res)).toEqual({ error: CONDUCTOR_OFF });
    }
  });
});

describe('Conductor mode on', () => {
  it('GET /v1/conductor says it is on', async () => {
    await start('success');
    expect(await json(await get('/v1/conductor'))).toEqual({ enabled: true, agent: 'claude-code' });
  });

  it('every path needs the access token', async () => {
    await start('success');
    for (const [method, path] of [
      ['GET', '/v1/conductor'],
      ['POST', '/v1/runs'],
      ['GET', '/v1/runs/abc'],
      ['POST', '/v1/runs/abc/permission'],
      ['POST', '/v1/runs/abc/message'],
      ['POST', '/v1/runs/abc/cancel'],
    ]) {
      const res = await fetch(`${base}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });

  it('POST /v1/runs: 201 with the run; GET shows it until done; the task is in /v1/tasks', async () => {
    await start('success');
    const run = await newRun();
    expect(run).toMatchObject({ id: expect.any(String), taskId: expect.any(String), branch: `opsaip/run-${run.id}` });
    const done = await pollRun(run.id, (view) => view.status === 'done');
    expect(done.lastMessage).toBe('All done');
    const tasks = (await json(await get('/v1/tasks'))).tasks as Array<Record<string, unknown>>;
    expect(tasks).toEqual([expect.objectContaining({ id: run.taskId, status: 'done', source: 'you', agent: 'claude-code' })]);
  });

  it('POST /v1/runs: 400 for a bad body, 413 over 16 KB, 415 without JSON', async () => {
    await start('success');
    const bad = [
      [{ prompt: 'p' }, 'title is missing'],
      [{ title: '  ', prompt: 'p' }, 'title must not be only whitespace'],
      [{ title: 't' }, 'prompt is missing'],
      [{ title: 't', prompt: 3 }, 'prompt must be a string'],
      [{ title: 't', prompt: ' \n ' }, 'prompt must not be only whitespace'],
      [{ title: 't', prompt: 'x'.repeat(MAX_PROMPT_CHARS + 1) }, `prompt must be at most ${MAX_PROMPT_CHARS} characters`],
      [[1], 'run must be an object'],
    ] as const;
    for (const [body, error] of bad) {
      const res = await post('/v1/runs', body);
      expect(res.status).toBe(400);
      expect(await json(res)).toEqual({ error });
    }
    expect((await post('/v1/runs', { title: 't', prompt: 'x'.repeat(17_000) })).status).toBe(413);
    expect((await post('/v1/runs', { title: 't', prompt: 'p' }, { ...AUTH, 'content-type': 'text/plain' })).status).toBe(415);
  });

  it('accepts a prompt of exactly the maximum length', async () => {
    await start('success');
    const res = await post('/v1/runs', { title: 't', prompt: 'x'.repeat(MAX_PROMPT_CHARS) });
    expect(res.status).toBe(201);
  });

  it('POST /v1/runs: 409 while a run is active', async () => {
    await start('hang');
    const run = await newRun();
    const res = await post('/v1/runs', { title: 'Second', prompt: 'p' });
    expect(res.status).toBe(409);
    expect((await json(res)).error).toContain('one run at a time');
    expect((await post(`/v1/runs/${run.id}/cancel`)).status).toBe(200);
  });

  it('permission: 200 for the pending id, 409 for a stale one, 400 for a bad body, 404 for an unknown run', async () => {
    await start('permission');
    const run = await newRun();
    const waiting = await pollRun(run.id, (view) => view.permission !== undefined);
    expect(waiting).toMatchObject({ status: 'waiting_on_human', permission: { tool: 'Bash', summary: 'npm test' } });

    expect((await post(`/v1/runs/${run.id}/permission`, { allow: 'yes', permissionId: waiting.permission.id })).status).toBe(400);
    expect((await post(`/v1/runs/${run.id}/permission`, { allow: true })).status).toBe(400);
    expect((await post(`/v1/runs/${run.id}/permission`, { allow: true, permissionId: 'stale' })).status).toBe(409);
    expect((await post('/v1/runs/unknown-run/permission', { allow: true, permissionId: waiting.permission.id })).status).toBe(404);

    const res = await post(`/v1/runs/${run.id}/permission`, { allow: true, permissionId: waiting.permission.id });
    expect(res.status).toBe(200);
    expect((await json(res)).run.status).toBe('running');
    const done = await pollRun(run.id, (view) => view.status === 'done');
    expect(done.lastMessage).toBe('decision: allow');
    expect((await post(`/v1/runs/${run.id}/permission`, { allow: true, permissionId: waiting.permission.id })).status).toBe(409);
  });

  it('message: 200 while active, 409 after, 400 for a bad body', async () => {
    await start('followup');
    const run = await newRun();
    await pollRun(run.id, (view) => view.lastMessage === 'Send me a follow-up');
    expect((await post(`/v1/runs/${run.id}/message`, { text: '' })).status).toBe(400);
    expect((await post(`/v1/runs/${run.id}/message`, { text: 'Also the docs' })).status).toBe(200);
    const done = await pollRun(run.id, (view) => view.status === 'done');
    expect(done.lastMessage).toBe('follow-up: Also the docs');
    expect((await post(`/v1/runs/${run.id}/message`, { text: 'late' })).status).toBe(409);
  });

  it('cancel: 200 and failed, then 409; 404 for an unknown run', async () => {
    await start('hang');
    const run = await newRun();
    const res = await post(`/v1/runs/${run.id}/cancel`);
    expect(res.status).toBe(200);
    expect((await json(res)).run.status).toBe('failed');
    expect((await post(`/v1/runs/${run.id}/cancel`)).status).toBe(409);
    expect((await post('/v1/runs/unknown/cancel')).status).toBe(404);
  });

  it('routes path parameters by exact segments: 404 for anything else, 405 for another method', async () => {
    await start('success');
    for (const path of [
      '/v1/runs/',
      '/v1/runs//cancel',
      '/v1/runs/abc/cancel/',
      '/v1/runs/abc/cancel/x',
      '/v1/runs/abc/nope',
      '/v1/runs/..',
      '/v1/runs/a.b',
      '/v1/runs/%2e%2e',
      '/v1/runs/:id',
      '/v1/runs/:id/cancel',
      `/v1/runs/${'a'.repeat(101)}`,
      '/v1/RUNS/abc',
    ]) {
      const res = await get(path);
      expect(res.status, path).toBe(404);
      expect(await json(res)).toEqual({ error: path === '/v1/runs/abc' ? 'run not found' : 'not found' });
    }
    expect((await get('/v1/runs/abc')).status).toBe(404); // a well-formed id, but no such run
    const wrongMethod = await post('/v1/runs/abc', {});
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.headers.get('allow')).toBe('GET');
    const getCancel = await get('/v1/runs/abc/cancel');
    expect(getCancel.status).toBe(405);
    expect(getCancel.headers.get('allow')).toBe('POST');
    expect((await get('/v1/runs')).status).toBe(405);
    expect((await post('/v1/conductor', {})).status).toBe(405);
  });
});
