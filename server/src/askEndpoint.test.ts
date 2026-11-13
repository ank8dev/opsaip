// POST /v1/ask over HTTP, with a fake provider (no network, no real model).
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { createTaskStore } from '@opsaip/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASK_RATE_LIMIT, MAX_QUESTION_CHARS, NOT_CONFIGURED } from './ask';
import { createApp, type AppOptions } from './app';
import type { AskPrompt, AskProvider } from './auth/askProvider';
import { ProviderError } from './auth/askProvider';
import { askProviderFromEnv } from './auth/llm';

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
    expect(await res.json()).toEqual({ answer: 'One task: Fix login, running on claude-code.' });

    expect(prompts).toHaveLength(1);
    expect(prompts[0].user).toContain('"title":"Fix login"');
    expect(prompts[0].user).toContain('What is running?');
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
