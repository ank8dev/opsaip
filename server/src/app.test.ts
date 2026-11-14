import { once } from 'node:events';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { request, type IncomingMessage, type OutgoingHttpHeaders, type Server } from 'node:http';
import { createTaskStore, type TaskStore } from '@opsaip/core';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, MAX_BODY_BYTES, type AppOptions } from './app';
import { WEB_CSP } from './webFiles';

// Each test starts its own server on a random free port (listen(0)).
let server: Server | undefined;
let base = '';

async function start(options: Partial<AppOptions> = {}): Promise<void> {
  server = createApp({ store: createTaskStore(), token: TOKEN, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  if (server === undefined) return;
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  server = undefined;
});

function post(
  body: RequestInit['body'],
  headers: Record<string, string> = JSON_HEADERS,
): Promise<Response> {
  return fetch(`${base}/v1/reports`, { method: 'POST', headers: { ...AUTH, ...headers }, body });
}

function report(taskId: string, status: string, at: string): Promise<Response> {
  return post(JSON.stringify({ taskId, status, at }));
}

/**
 * Low-level request with node:http, for what fetch cannot do: send headers
 * without a body, or a raw path like "//evil/x". Resolves on the response.
 */
function rawRequest(
  method: string,
  path: string,
  headers: OutgoingHttpHeaders = {},
): Promise<IncomingMessage> {
  const { port } = server!.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      res.resume();
      req.destroy(); // a body may still be "pending"; stop it
      resolve(res);
    });
    req.on('error', reject);
    req.flushHeaders(); // send headers now, and no body
  });
}

async function tasks(): Promise<unknown> {
  const res = await fetch(`${base}/v1/tasks`, { headers: AUTH });
  expect(res.status).toBe(200);
  return ((await res.json()) as { tasks: unknown }).tasks;
}

// Access token rules are tested in accessToken.test.ts; here every request
// to a protected path sends the right token (only /healthz is open).
const TOKEN = 'app-test-token-0123456789abcdef0123';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const JSON_HEADERS = { 'content-type': 'application/json' };
const T0 = '2026-11-01T10:00:00Z';
const T1 = '2026-11-01T10:05:00Z';

describe('GET /healthz', () => {
  it('returns 200 "ok" as plain text', async () => {
    await start();
    const res = await fetch(`${base}/healthz`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8');
    expect(await res.text()).toBe('ok');
  });

  it('ignores the query string', async () => {
    await start();
    expect((await fetch(`${base}/healthz?probe=1`)).status).toBe(200);
  });
});

describe('GET /v1/tasks', () => {
  it('returns an empty list at first', async () => {
    await start();
    const res = await fetch(`${base}/v1/tasks`, { headers: AUTH });
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ tasks: [] });
  });

  it('returns all tasks in the order they were created', async () => {
    await start();
    await report('b', 'queued', T0);
    await report('a', 'queued', T0);
    await report('b', 'running', T1);
    expect(await tasks()).toEqual([
      { id: 'b', status: 'running', updatedAt: T1 },
      { id: 'a', status: 'queued', updatedAt: T0 },
    ]);
  });
});

function postTask(
  body: RequestInit['body'],
  headers: Record<string, string> = JSON_HEADERS,
): Promise<Response> {
  return fetch(`${base}/v1/tasks`, { method: 'POST', headers: { ...AUTH, ...headers }, body });
}

describe('POST /v1/tasks', () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('creates a queued task from you: 201 with the task', async () => {
    await start();
    const before = Date.now();
    const res = await postTask(JSON.stringify({ title: '  Fix login ', agent: 'claude-code' }));
    const after = Date.now();
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const { task } = (await res.json()) as { task: Record<string, string> };
    expect(task).toEqual({
      id: expect.stringMatching(UUID),
      status: 'queued',
      updatedAt: expect.any(String),
      title: 'Fix login',
      agent: 'claude-code',
      source: 'you',
    });
    expect(task.updatedAt).toBe(new Date(task.updatedAt).toISOString());
    expect(Date.parse(task.updatedAt)).toBeGreaterThanOrEqual(before);
    expect(Date.parse(task.updatedAt)).toBeLessThanOrEqual(after);
    expect(await tasks()).toEqual([task]);
  });

  it('works without an agent, and gives every task its own id', async () => {
    await start();
    const a = (await (await postTask('{"title":"a"}')).json()) as { task: { id: string } };
    const b = (await (await postTask('{"title":"a"}')).json()) as { task: { id: string } };
    expect(a.task.id).not.toBe(b.task.id);
    expect(Object.hasOwn(a.task, 'agent')).toBe(false);
  });

  it('ignores id, status, updatedAt and source in the body', async () => {
    await start();
    const res = await postTask(
      JSON.stringify({ title: 't', id: 'mine', status: 'done', updatedAt: T0, source: 'x' }),
    );
    expect(res.status).toBe(201);
    const { task } = (await res.json()) as { task: Record<string, string> };
    expect(task.id).toMatch(UUID);
    expect(task).toMatchObject({ status: 'queued', source: 'you' });
    expect(task.updatedAt).not.toBe(T0);
  });

  it('a task from you then follows agent reports and keeps its source', async () => {
    await start();
    const { task } = (await (await postTask('{"title":"t"}')).json()) as {
      task: { id: string };
    };
    const later = new Date(Date.now() + 60_000).toISOString();
    expect((await report(task.id, 'running', later)).status).toBe(200);
    expect(await tasks()).toEqual([
      expect.objectContaining({ id: task.id, status: 'running', source: 'you' }),
    ]);
  });

  it('GET /v1/tasks leaves source out for tasks from agents', async () => {
    await start();
    await report('agent-made', 'queued', T0);
    await postTask('{"title":"t"}');
    const list = (await tasks()) as Record<string, unknown>[];
    expect(Object.hasOwn(list[0], 'source')).toBe(false);
    expect(list[1].source).toBe('you');
  });

  it('409 if the store rejects the task (id collision)', async () => {
    const collide: TaskStore = {
      ...createTaskStore(),
      create: () => ({ ok: false, reason: 'task already exists' }),
    };
    await start({ store: collide });
    const res = await postTask('{"title":"t"}');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'task already exists' });
  });

  it('401 without a token, and nothing is created', async () => {
    await start();
    const res = await fetch(`${base}/v1/tasks`, {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{"title":"t"}',
    });
    expect(res.status).toBe(401);
    expect(await tasks()).toEqual([]);
  });

  it('401 with a wrong token', async () => {
    await start();
    const res = await postTask('{"title":"t"}', { ...JSON_HEADERS, authorization: 'Bearer nope' });
    expect(res.status).toBe(401);
  });

  describe('400 on invalid input', () => {
    it.each([
      ['not JSON', 'nope', 'body must be valid JSON (UTF-8)'],
      ['an array', '[]', 'task must be an object'],
      ['null', 'null', 'task must be an object'],
      ['no title', '{}', 'title is missing'],
      ['an empty title', '{"title":""}', 'title must not be empty'],
      ['a blank title', '{"title":"   "}', 'title must not be only whitespace'],
      ['a numeric title', '{"title":5}', 'title must be a string'],
      ['a title over 200 characters', JSON.stringify({ title: 'a'.repeat(201) }), 'title must be at most 200 characters'],
      ['a null agent', '{"title":"t","agent":null}', 'agent must be a string'],
      ['an empty agent', '{"title":"t","agent":""}', 'agent must not be empty'],
      ['an agent over 100 characters', JSON.stringify({ title: 't', agent: 'a'.repeat(101) }), 'agent must be at most 100 characters'],
    ])('%s', async (_name, body, error) => {
      await start();
      const res = await postTask(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error });
      expect(await tasks()).toEqual([]);
    });
  });

  it('415 unless the body is declared as JSON', async () => {
    await start();
    const res = await postTask('{"title":"t"}', { 'content-type': 'text/plain' });
    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: 'content-type must be application/json' });
    expect(await tasks()).toEqual([]);
  });

  it('413 over the body size limit', async () => {
    await start();
    const res = await postTask(JSON.stringify({ title: 't', pad: 'x'.repeat(MAX_BODY_BYTES) }));
    expect(res.status).toBe(413);
    expect(await tasks()).toEqual([]);
  });

  it('500 with no details when the store throws', async () => {
    const failing: TaskStore = {
      ...createTaskStore(),
      create() {
        throw new Error('disk on fire');
      },
    };
    const logError = vi.fn();
    await start({ store: failing, logError });
    const res = await postTask('{"title":"t"}');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'internal error' });
    expect(logError).toHaveBeenCalledOnce();
  });
});

describe('POST /v1/reports', () => {
  it('creates a task from a queued report: 200 with the task', async () => {
    await start();
    const res = await report('t1', 'queued', T0);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ task: { id: 't1', status: 'queued', updatedAt: T0 } });
  });

  it('applies a later report to an existing task', async () => {
    await start();
    await report('t1', 'queued', T0);
    const res = await report('t1', 'running', T1);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ task: { id: 't1', status: 'running', updatedAt: T1 } });
  });

  it('accepts an exact duplicate (resending is not an error)', async () => {
    await start();
    await report('t1', 'queued', T0);
    expect((await report('t1', 'queued', T0)).status).toBe(200);
    expect(await tasks()).toEqual([{ id: 't1', status: 'queued', updatedAt: T0 }]);
  });

  describe('optional title, agent and note', () => {
    it('stores them and GET /v1/tasks returns them', async () => {
      await start();
      const created = await post(
        JSON.stringify({ taskId: 't1', status: 'queued', at: T0, title: 'Fix login', agent: 'claude-code' }),
      );
      expect(created.status).toBe(200);
      const waiting = await post(
        JSON.stringify({ taskId: 't1', status: 'running', at: T1, note: 'Which branch?' }),
      );
      expect(await waiting.json()).toEqual({
        task: { id: 't1', status: 'running', updatedAt: T1, title: 'Fix login', agent: 'claude-code', note: 'Which branch?' },
      });
      expect(await tasks()).toEqual([
        { id: 't1', status: 'running', updatedAt: T1, title: 'Fix login', agent: 'claude-code', note: 'Which branch?' },
      ]);
    });

    it('leaves out fields that are not set (no null in the JSON)', async () => {
      await start();
      await report('t1', 'queued', T0);
      const res = await fetch(`${base}/v1/tasks`, { headers: AUTH });
      expect(await res.text()).toBe(`{"tasks":[{"id":"t1","status":"queued","updatedAt":"${T0}"}]}`);
    });
  });

  describe('409 when the store rejects the report', () => {
    it('unknown task with a status other than queued', async () => {
      await start();
      const res = await report('ghost', 'running', T0);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'unknown task' });
    });

    it('transition not allowed', async () => {
      await start();
      await report('t1', 'queued', T0);
      const res = await report('t1', 'done', T1);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: 'transition not allowed: queued -> done' });
    });

    it('stale report', async () => {
      await start();
      await report('t1', 'queued', T1);
      const res = await report('t1', 'running', T0);
      expect(res.status).toBe(409);
      expect(((await res.json()) as { error: string }).error).toMatch(/^stale report/);
    });

    it('does not change the stored task', async () => {
      await start();
      await report('t1', 'queued', T0);
      await report('t1', 'done', T1);
      expect(await tasks()).toEqual([{ id: 't1', status: 'queued', updatedAt: T0 }]);
    });
  });

  describe('400 on invalid input', () => {
    it.each([
      ['not JSON', '{"taskId":'],
      ['empty body', ''],
    ])('%s', async (_name, body) => {
      await start();
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'body must be valid JSON (UTF-8)' });
    });

    it('invalid UTF-8', async () => {
      await start();
      // 0xff never appears in UTF-8.
      const bytes = new Uint8Array([...Buffer.from('{"taskId":"'), 0xff, ...Buffer.from('"}')]);
      const res = await post(bytes);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: 'body must be valid JSON (UTF-8)' });
    });

    it.each([
      ['an array', [], 'report must be an object'],
      ['a missing taskId', { status: 'queued', at: T0 }, 'taskId is missing'],
      ['an unknown status', { taskId: 't1', status: 'paused', at: T0 }, 'status must be one of'],
      ['a timestamp without offset', { taskId: 't1', status: 'queued', at: '2026-11-01T10:00:00' }, 'at must be'],
      ['a title with status running', { taskId: 't1', status: 'running', at: T0, title: 'x' }, 'title is only allowed with status "queued"'],
      ['a title over 200 characters', { taskId: 't1', status: 'queued', at: T0, title: 'x'.repeat(201) }, 'title must be at most 200 characters'],
      ['an agent over 100 characters', { taskId: 't1', status: 'queued', at: T0, agent: 'x'.repeat(101) }, 'agent must be at most 100 characters'],
      ['a note over 500 characters', { taskId: 't1', status: 'queued', at: T0, note: 'x'.repeat(501) }, 'note must be at most 500 characters'],
      ['a null note', { taskId: 't1', status: 'queued', at: T0, note: null }, 'note must be a string'],
    ])('JSON that parseReport rejects: %s', async (_name, body, reason) => {
      await start();
      const res = await post(JSON.stringify(body));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain(reason);
      expect(await tasks()).toEqual([]);
    });
  });

  describe('415 unless the body is declared as JSON', () => {
    it.each([
      ['no content-type', {}],
      ['text/plain', { 'content-type': 'text/plain' }],
      ['form', { 'content-type': 'application/x-www-form-urlencoded' }],
      ['a JSON look-alike', { 'content-type': 'application/jsonp' }],
    ])('%s', async (_name, headers) => {
      await start();
      const res = await post(JSON.stringify({ taskId: 't1', status: 'queued', at: T0 }), headers);
      expect(res.status).toBe(415);
      expect(await res.json()).toEqual({ error: 'content-type must be application/json' });
      expect(await tasks()).toEqual([]);
    });

    it.each(['application/json; charset=utf-8', 'Application/JSON'])(
      'accepts %j',
      async (contentType) => {
        await start();
        const res = await post(JSON.stringify({ taskId: 't1', status: 'queued', at: T0 }), {
          'content-type': contentType,
        });
        expect(res.status).toBe(200);
      },
    );
  });

  describe('body size limit (16 KB)', () => {
    // A valid report padded with spaces (valid JSON whitespace) to `size` bytes.
    function paddedReport(size: number): string {
      const json = JSON.stringify({ taskId: 't1', status: 'queued', at: T0 });
      return json + ' '.repeat(size - json.length);
    }

    it('is 16384 bytes', () => {
      expect(MAX_BODY_BYTES).toBe(16384);
    });

    it('accepts a body of exactly 16384 bytes', async () => {
      await start();
      expect((await post(paddedReport(MAX_BODY_BYTES))).status).toBe(200);
    });

    it('rejects 16385 bytes with 413 (Content-Length)', async () => {
      await start();
      const res = await post(paddedReport(MAX_BODY_BYTES + 1));
      expect(res.status).toBe(413);
      expect(res.headers.get('connection')).toBe('close');
      expect(await res.json()).toEqual({ error: 'body must be at most 16384 bytes' });
      expect(await tasks()).toEqual([]);
    });

    it('rejects by Content-Length alone, without waiting for the body', async () => {
      await start();
      // Headers promise 1 MB, but no body byte is ever sent. A server that
      // waited for the body would never answer and the test would time out.
      const res = await rawRequest('POST', '/v1/reports', {
        ...AUTH,
        ...JSON_HEADERS,
        'content-length': 1_000_000,
      });
      expect(res.statusCode).toBe(413);
    });

    it('rejects an oversized chunked body (no Content-Length) with 413', async () => {
      await start();
      const chunk = new TextEncoder().encode(' '.repeat(4096));
      let sent = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          // 5 x 4096 = 20480 bytes, over the limit.
          if (sent++ < 5) controller.enqueue(chunk);
          else controller.close();
        },
      });
      const res = await fetch(`${base}/v1/reports`, {
        method: 'POST',
        headers: { ...AUTH, ...JSON_HEADERS },
        body,
        duplex: 'half',
      });
      expect(res.status).toBe(413);
      expect(await tasks()).toEqual([]);
    });
  });
});

describe('routing', () => {
  it('404 for an unknown path', async () => {
    await start();
    const res = await fetch(`${base}/v1/nope`, { headers: AUTH });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  it('404 for "//host/v1/tasks": the path is not parsed as a URL with a host', async () => {
    await start();
    expect((await rawRequest('GET', '//evil/v1/tasks', AUTH)).statusCode).toBe(404);
  });

  it.each([
    ['GET', '/v1/reports', 'POST'],
    ['DELETE', '/v1/tasks', 'GET, POST'],
    ['PUT', '/v1/tasks', 'GET, POST'],
    ['DELETE', '/healthz', 'GET'],
  ])('405 for %s %s, with Allow: %s', async (method, path, allow) => {
    await start();
    const res = await fetch(`${base}${path}`, { method, headers: AUTH });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe(allow);
    expect(await res.json()).toEqual({ error: 'method not allowed' });
  });
});

describe('the web app', () => {
  let webDir = '';
  const INDEX = '<!doctype html><title>Opsaip</title>';
  const SCRIPT = 'console.log("opsaip")';

  beforeAll(() => {
    webDir = mkdtempSync(join(tmpdir(), 'opsaip-app-web-'));
    mkdirSync(join(webDir, 'assets'));
    writeFileSync(join(webDir, 'index.html'), INDEX);
    writeFileSync(join(webDir, 'favicon.svg'), '<svg/>');
    writeFileSync(join(webDir, 'assets', 'index-abc.js'), SCRIPT);
    // Files next to the build that must never be served.
    writeFileSync(join(webDir, 'assets', 'index-abc.js.map'), '{}');
    writeFileSync(join(webDir, 'secret.txt'), 'secret');
  });

  afterAll(() => {
    rmSync(webDir, { recursive: true, force: true });
  });

  it('GET / serves index.html without a token, with the security headers', async () => {
    await start({ webDir });
    const res = await fetch(`${base}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('content-security-policy')).toBe(WEB_CSP);
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('x-frame-options')).toBe('DENY');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    expect(await res.text()).toBe(INDEX);
  });

  it('serves /index.html, /favicon.svg and /assets/<file>; the query string is ignored', async () => {
    await start({ webDir });
    expect(await (await fetch(`${base}/index.html`)).text()).toBe(INDEX);
    expect((await fetch(`${base}/favicon.svg`)).headers.get('content-type')).toBe('image/svg+xml');
    const js = await fetch(`${base}/assets/index-abc.js?v=1`);
    expect(js.headers.get('content-type')).toBe('text/javascript; charset=utf-8');
    expect(js.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await js.text()).toBe(SCRIPT);
  });

  it('a wrong token does not matter for the web app', async () => {
    await start({ webDir });
    const res = await fetch(`${base}/`, { headers: { authorization: 'Bearer wrong' } });
    expect(res.status).toBe(200);
  });

  it('HEAD sends the headers without the body', async () => {
    await start({ webDir });
    const res = await rawRequest('HEAD', '/');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(INDEX)));
  });

  it('405 for other methods, with Allow: GET, HEAD', async () => {
    await start({ webDir });
    const res = await fetch(`${base}/`, { method: 'POST', body: 'x' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('GET, HEAD');
  });

  it('404 for a public path whose file is missing', async () => {
    await start({ webDir });
    const res = await fetch(`${base}/assets/missing.js`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'not found' });
  });

  it('404 for the web paths when no web folder is given', async () => {
    await start();
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it('404 for the web paths when the web folder does not exist (not built yet)', async () => {
    await start({ webDir: join(webDir, 'missing') });
    expect((await fetch(`${base}/`)).status).toBe(404);
  });

  it.each([
    '/secret.txt',
    '/assets/index-abc.js.map',
    '/assets/../secret.txt',
    '/assets/..%2fsecret.txt',
    '/assets/%2e%2e%2fsecret.txt',
    '/%2e%2e/secret.txt',
    '/assets/sub/index-abc.js',
    '/index.html/',
  ])('%s needs the token, and is never a web file', async (path) => {
    await start({ webDir });
    const res = await rawRequest('GET', path);
    expect(res.statusCode).toBe(401);
    // With the token it is a plain 404: the file next to the build is not reachable.
    expect((await rawRequest('GET', path, AUTH)).statusCode).toBe(404);
  });

  it('the API still needs the token when a web build is served', async () => {
    await start({ webDir });
    expect((await fetch(`${base}/v1/tasks`)).status).toBe(401);
    expect((await fetch(`${base}/v1/tasks`, { headers: AUTH })).status).toBe(200);
  });
});

describe('unexpected errors', () => {
  it('500 with no details for the client; the error goes to logError', async () => {
    const failing: TaskStore = {
      ...createTaskStore(),
      apply() {
        throw new Error('disk on fire at /secret/path');
      },
    };
    const logError = vi.fn();
    await start({ store: failing, logError });

    const res = await report('t1', 'queued', T0);
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'internal error' });
    expect(text).not.toContain('secret');
    expect(logError).toHaveBeenCalledOnce();
    expect(logError.mock.calls[0][1]).toBeInstanceOf(Error);
  });
});
