// POST /v1/ask over HTTP, with a fake provider (no network, no real model).
import { once } from 'node:events';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createTaskStore } from '@opsaip/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_RESPONSE_SCHEMA } from './askIntent';
import { ASK_RATE_LIMIT, MAX_QUESTION_CHARS, NOT_CONFIGURED } from './ask';
import { createApp, type AppOptions } from './app';
import type { AskPrompt, AskProvider } from './auth/askProvider';
import { ProviderError } from './auth/askProvider';
import { askProviderFromEnv } from './auth/llm';
import { createChatStore } from './chatStore';
import { openDatabase } from './db';
import { createRepoRegistry } from './auth/conductor/repoRegistry';
import { createRunManager } from './auth/conductor/runManager';
import { makeRepo, tempDir } from './auth/conductor/testing/conductorTestKit';

const TOKEN = 'ask-test-token-0123456789abcdef0123456789';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const JSON_HEADERS = { 'content-type': 'application/json' };

let server: Server | undefined;
let base = '';

async function start(options: Partial<AppOptions> = {}): Promise<void> {
  const store = createTaskStore();
  store.apply({ taskId: 't1', status: 'queued', at: '2026-11-13T09:00:00Z', title: 'Fix login', agent: 'claude-code' });
  server = createApp({ store, token: TOKEN, log: () => {}, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (server === undefined) return;
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  server = undefined;
});

function ask(body: unknown, headers: Record<string, string> = { ...AUTH, ...JSON_HEADERS }): Promise<Response> {
  return fetch(`${base}/v1/ask`, {
    method: 'POST',
    headers,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** A provider that answers with `reply(prompt, signal)` and records the prompts. */
function fakeProvider(reply: (prompt: AskPrompt, signal: AbortSignal) => Promise<string>) {
  const prompts: AskPrompt[] = [];
  const provider: AskProvider = {
    name: 'fake',
    displayName: 'Fake',
    capabilities: { maxTotalBytes: 1000, types: [{ id: 'image', label: 'Images', mimes: ['image/png'], extensions: ['png'], maxBytes: 600 }, { id: 'text', label: 'Text', mimes: ['text/plain'], extensions: ['txt'], maxBytes: 600 }] },
    model: 'fake-model',
    answer: (prompt, signal) => {
      prompts.push(prompt);
      return reply(prompt, signal);
    },
  };
  return { provider, prompts };
}

/** Never answers; rejects when the signal aborts, like fetch does. */
function hang(_prompt: AskPrompt, signal: AbortSignal): Promise<string> {
  return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason)));
}

describe('POST /v1/ask', () => {
  it('200 with the answer; the model gets the tasks and the question', async () => {
    const { provider, prompts } = fakeProvider(async () => 'One task: Fix login, running on claude-code.');
    await start({ ask: provider });

    const res = await ask({ question: 'What is running?' });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    expect(await res.json()).toEqual({ answer: 'One task: Fix login, running on claude-code.', action: null });

    expect(prompts).toHaveLength(1);
    expect(prompts[0].user).toContain('"title":"Fix login"');
    expect(prompts[0].user).toContain('What is running?');
  });

  it('puts the history from the body in the prompt, and nothing else: no stored chat', async () => {
    const { provider, prompts } = fakeProvider(async () => 'ok');
    const chats = createChatStore(openDatabase(':memory:'));
    const other = chats.create('Secret other chat');
    chats.replaceMessages(other.id, [{ role: 'you', text: 'TOP-SECRET-OTHER-CHAT', widget: '{"k":"WIDGET-SECRET"}' }]);
    await start({ ask: provider, chats });

    const history = [
      { role: 'you', text: 'What is running?' },
      { role: 'opsy', text: 'Fix login.' },
    ];
    expect((await ask({ question: 'and then?', history })).status).toBe(200);
    expect((await ask({ question: 'plain question' })).status).toBe(200);

    expect(prompts[0].user).toContain('<conversation>');
    expect(prompts[0].user).toContain('"text":"Fix login."');
    expect(prompts[1].user).not.toContain('conversation');
    for (const prompt of prompts) {
      for (const text of [prompt.system, prompt.user]) {
        expect(text).not.toContain('TOP-SECRET-OTHER-CHAT');
        expect(text).not.toContain('WIDGET-SECRET');
        expect(text).not.toContain('Secret other chat');
      }
    }
  });

  it('400 for a bad history; the model is not called', async () => {
    const { provider, prompts } = fakeProvider(async () => 'never');
    await start({ ask: provider });
    const seven = Array.from({ length: 7 }, () => ({ role: 'you', text: 'x' }));
    for (const history of [seven, [{ role: 'you', text: 'a'.repeat(1001) }], [{ role: 'bot', text: 'x' }], 'x', {}]) {
      const res = await ask({ question: 'q', history });
      expect(res.status, JSON.stringify(history).slice(0, 40)).toBe(400);
      expect(await res.json()).toEqual({ error: expect.stringContaining('history') });
    }
    expect(prompts).toHaveLength(0);
  });

  it('logs only the number of history messages, never their text', async () => {
    const lines: string[] = [];
    const { provider } = fakeProvider(async () => 'The SECRET-ANSWER');
    await start({ ask: provider, log: (line) => lines.push(line) });
    await ask({ question: 'q', history: [{ role: 'you', text: 'SECRET-HISTORY' }] });
    expect(lines.join('\n')).toContain('1 history messages');
    expect(lines.join('\n')).not.toContain('SECRET');
  });

  it('503 with how to set it up when Ask is not configured', async () => {
    await start();
    const res = await ask({ question: 'Anything?' });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: NOT_CONFIGURED });
    expect(NOT_CONFIGURED).toContain('OPSAIP_LLM_PROVIDER');
    expect(NOT_CONFIGURED).toContain('OPSAIP_LLM_KEY');
  });

  it('401 without the token, even when Ask is not configured', async () => {
    await start();
    expect((await ask({ question: 'x' }, JSON_HEADERS)).status).toBe(401);
  });

  it('400 for a question over 1000 characters; the model is not called', async () => {
    const { provider, prompts } = fakeProvider(async () => 'never');
    await start({ ask: provider });
    const res = await ask({ question: 'a'.repeat(MAX_QUESTION_CHARS + 1) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'question must be at most 1000 characters' });
    expect(prompts).toHaveLength(0);
  });

  it('400 for an empty question or bad JSON, 415 for another content type, 405 for GET', async () => {
    const { provider, prompts } = fakeProvider(async () => 'never');
    await start({ ask: provider });
    expect((await ask({ question: ' ' })).status).toBe(400);
    expect((await ask({})).status).toBe(400);
    expect((await ask('{bad')).status).toBe(400);
    expect((await ask({ question: 'x' }, { ...AUTH, 'content-type': 'text/plain' })).status).toBe(415);
    const get = await fetch(`${base}/v1/ask`, { headers: AUTH });
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST');
    expect(prompts).toHaveLength(0);
  });

  it('504 when the model does not answer in time', async () => {
    const { provider } = fakeProvider(hang);
    await start({ ask: provider, askTimeoutMs: 50 });
    const res = await ask({ question: 'Slow?' });
    expect(res.status).toBe(504);
    expect(await res.json()).toEqual({ error: 'the AI provider did not answer in time, try again' });
  });

  it('502 when the provider fails, with no details for the client', async () => {
    for (const error of [new ProviderError('provider answered HTTP 500'), new Error('internal detail')]) {
      const { provider } = fakeProvider(async () => {
        throw error;
      });
      await start({ ask: provider });
      const res = await ask({ question: 'Broken?' });
      expect(res.status).toBe(502);
      expect(await res.json()).toEqual({ error: 'the AI provider failed to answer, try again later' });
      server!.closeAllConnections();
      server!.close();
      await once(server!, 'close');
      server = undefined;
    }
  });

  it('asks the model for JSON with the response schema', async () => {
    const { provider, prompts } = fakeProvider(async () => '{"answer":"x","action":null}');
    await start({ ask: provider });
    await ask({ question: 'q' });
    expect(prompts[0].responseSchema).toBe(ASK_RESPONSE_SCHEMA);
  });

  it('returns a run proposal from the model JSON, dropping unknown fields, and runs nothing', async () => {
    const reply = JSON.stringify({
      answer: 'I will fix the login bug with Claude Code.',
      extra: 1,
      action: { type: 'run', title: ' Fix login ', prompt: 'Fix the login bug', agent: 'Claude Code', cmd: 'rm -rf /' },
    });
    const { provider } = fakeProvider(async () => reply);
    await start({ ask: provider });
    const res = await ask({ question: 'fix login with claude' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      answer: 'I will fix the login bug with Claude Code.',
      action: { type: 'run', agent: 'claude-code', title: 'Fix login', prompt: 'Fix the login bug' },
    });
    const tasks = (await (await fetch(`${base}/v1/tasks`, { headers: AUTH })).json()) as { tasks: unknown[] };
    expect(tasks.tasks).toHaveLength(1); // nothing was created
  });

  it('returns a task proposal', async () => {
    const { provider } = fakeProvider(async () =>
      JSON.stringify({ answer: 'I propose a task.', action: { type: 'task', title: 'Write docs', prompt: 'ignored' } }),
    );
    await start({ ask: provider });
    expect(await (await ask({ question: 'add a task' })).json()).toEqual({
      answer: 'I propose a task.',
      action: { type: 'task', title: 'Write docs' },
    });
  });

  it('another agent gets the v0.1 message and no action', async () => {
    const { provider } = fakeProvider(async () =>
      JSON.stringify({ answer: 'ok', action: { type: 'run', title: 't', prompt: 'p', agent: 'codex' } }),
    );
    await start({ ask: provider });
    expect(await (await ask({ question: 'run codex' })).json()).toEqual({
      answer: 'Only Claude Code is available in v0.1.',
      action: null,
    });
  });

  it('an invalid action keeps the answer; non-JSON becomes the plain answer', async () => {
    const replies = [
      JSON.stringify({ answer: 'Fine.', action: { type: 'run', title: 'x'.repeat(201), prompt: 'p' } }),
      '  just text, not JSON  ',
    ];
    const { provider } = fakeProvider(async () => replies.shift()!);
    await start({ ask: provider });
    expect(await (await ask({ question: 'a' })).json()).toEqual({ answer: 'Fine.', action: null });
    expect(await (await ask({ question: 'b' })).json()).toEqual({ answer: 'just text, not JSON', action: null });
  });

  it('cuts a very long answer', async () => {
    const { provider } = fakeProvider(async () => 'x'.repeat(10_000));
    await start({ ask: provider });
    const { answer } = (await (await ask({ question: 'Long?' })).json()) as { answer: string };
    expect(Array.from(answer)).toHaveLength(4001);
    expect(answer.endsWith('…')).toBe(true);
  });

  it(`429 after ${ASK_RATE_LIMIT.max} questions in a minute, with Retry-After; bad questions do not count`, async () => {
    const { provider, prompts } = fakeProvider(async () => 'ok');
    await start({ ask: provider });

    expect((await ask({ question: '' })).status).toBe(400);
    for (let i = 0; i < ASK_RATE_LIMIT.max; i++) {
      expect((await ask({ question: `q${i}` })).status).toBe(200);
    }
    const res = await ask({ question: 'one more' });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(Number(res.headers.get('retry-after'))).toBeLessThanOrEqual(60);
    expect(((await res.json()) as { error: string }).error).toContain('too many questions');
    expect(prompts).toHaveLength(ASK_RATE_LIMIT.max);
  });
});

describe('POST /v1/ask never leaks the key, the question or the answer', () => {
  const KEY = 'AIza-LEAK-test-SECRET-key-0123456789';
  const QUESTION = 'QUESTION-MARKER which task is private?';
  const ANSWER = 'ANSWER-MARKER the private task is Fix login';

  it('in any response, nor in any log line, for every outcome', async () => {
    // The real Gemini adapter, made from env like main.ts does, over a fake
    // fetch. Each call plays the next scenario.
    const scenarios: (() => Promise<Response>)[] = [
      // 200
      async () => Response.json({ candidates: [{ content: { parts: [{ text: ANSWER }] }, finishReason: 'STOP' }] }),
      // 502: an error body that echoes the key and the question
      async () => Response.json({ error: { message: `bad key ${KEY} for ${QUESTION}` } }, { status: 400 }),
      // 502: a network error whose message holds the key
      async () => {
        throw new TypeError(`connect failed ${KEY}`);
      },
      // 502: blocked
      async () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } }),
    ];
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      const scenario = scenarios[call++];
      if (scenario !== undefined) return scenario();
      // Then: hang until the timeout aborts.
      return new Promise((_resolve, reject) =>
        init!.signal!.addEventListener('abort', () => reject(new Error(`aborted ${KEY}`))),
      );
    });
    const env = askProviderFromEnv({ OPSAIP_LLM_PROVIDER: 'gemini', OPSAIP_LLM_KEY: KEY }, fetchImpl);
    if (!env.ok || env.provider === undefined) throw new Error('expected a provider');

    // Every way the server could print: the default log functions (console)
    // and console itself.
    const printed: string[] = [];
    for (const method of ['log', 'error', 'warn', 'info', 'debug'] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map((a) => (a instanceof Error ? `${a.message} ${a.stack}` : String(a))).join(' '));
      });
    }
    const store = createTaskStore();
    store.apply({ taskId: 't1', status: 'queued', at: '2026-11-13T09:00:00Z', title: 'Fix login' });
    server = createApp({ store, token: TOKEN, ask: env.provider, askTimeoutMs: 50 });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const responses: string[] = [];
    const statuses: number[] = [];
    for (let i = 0; i < ASK_RATE_LIMIT.max + 1; i++) {
      const res = await ask({ question: QUESTION });
      statuses.push(res.status);
      responses.push(`${JSON.stringify([...res.headers])} ${await res.text()}`);
    }
    // Also a 400 that quotes nothing back.
    const tooLong = await ask({ question: `${QUESTION}${'x'.repeat(MAX_QUESTION_CHARS)}` });
    responses.push(await tooLong.text());

    expect(statuses).toEqual([200, 502, 502, 502, ...Array(ASK_RATE_LIMIT.max - 4).fill(504), 429]);
    expect(responses[0]).toContain(ANSWER); // the answer goes to the client, and only there

    const everything = [...responses, ...printed].join('\n');
    expect(everything).not.toContain(KEY);
    expect(everything).not.toContain('SECRET');
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes(KEY))).toBe(true);

    const logs = printed.join('\n');
    expect(printed.length).toBeGreaterThanOrEqual(ASK_RATE_LIMIT.max + 1); // one line per question
    expect(logs).not.toContain('QUESTION-MARKER');
    expect(logs).not.toContain('ANSWER-MARKER');
    expect(logs).not.toContain('Fix login'); // nor the task data
    expect(logs).toContain('ask 200');
    expect(logs).toContain('ask 502 (gemini: provider answered HTTP 400');
    expect(logs).toContain('ask 502 (gemini: request to the provider failed');
    expect(logs).toContain('ask 502 (gemini: provider returned no answer (SAFETY)');
    expect(logs).toContain('ask 504');
    expect(logs).toContain('ask 429');
  });
});

describe('POST /v1/ask with repositories', () => {
  async function withRepos() {
    const home = tempDir('opsaip-home-');
    const repos = createRepoRegistry({ home });
    const api = repos.add(makeRepo(home, 'api'));
    if (!api.ok) throw new Error('add failed');
    const store = createTaskStore();
    const conductor = createRunManager({ store, repos, worktreesDir: join(tempDir(), 'w'), log: () => {} });
    return { conductor, apiId: api.repo.id };
  }

  it('sends only display names to the model and validates the named repository on the server', async () => {
    const { conductor, apiId } = await withRepos();
    const fake = fakeProvider(async () =>
      JSON.stringify({ answer: 'Run it.', action: { type: 'run', title: 'Fix', prompt: 'p', repo: 'API' } }),
    );
    await start({ ask: fake.provider, conductor });
    const res = await ask({ question: 'fix login in api' });
    expect(await res.json()).toEqual({
      answer: 'Run it.',
      action: { type: 'run', agent: 'claude-code', title: 'Fix', prompt: 'p', repoId: apiId, repoName: 'api' },
    });
    expect(fake.prompts[0].user).toContain('<repositories>\n["api"]\n</repositories>');
    expect(fake.prompts[0].user).not.toContain(apiId);
  });

  it('a repository that does not exist: no action, a plain answer', async () => {
    const { conductor } = await withRepos();
    const fake = fakeProvider(async () =>
      JSON.stringify({ answer: 'Run it.', action: { type: 'run', title: 'Fix', prompt: 'p', repo: 'ghost' } }),
    );
    await start({ ask: fake.provider, conductor });
    const body = (await (await ask({ question: 'fix login in ghost' })).json()) as { answer: string; action: unknown };
    expect(body.action).toBeNull();
    expect(body.answer).toContain('There is no repository named "ghost"');
  });
});
