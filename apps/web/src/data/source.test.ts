import { describe, expect, it, vi } from 'vitest';
import {
  TASKS_PATH, TOKEN_KEY, clearConnection, fetchTasks, loadConnection, saveConnection, serverWorkspace, tokenProblem,
  type KeyValueStore,
} from './source';
import type { Task } from '../types';

const TOKEN = 'a'.repeat(64);

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

const broken: KeyValueStore = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

describe('tokenProblem', () => {
  it('accepts visible ASCII', () => {
    expect(tokenProblem(TOKEN)).toBeUndefined();
    expect(tokenProblem('x!~')).toBeUndefined();
  });

  it.each(['', 'two words', 'tab\there', 'line\nbreak', 'tökén', 'emoji🙂'])('rejects %j', (token) => {
    expect(tokenProblem(token)).toEqual(expect.any(String));
  });

  it('never repeats the token in the message', () => {
    expect(tokenProblem('secret value')).not.toContain('secret');
  });
});

describe('loadConnection', () => {
  it('is null when nothing is saved (Demo)', () => {
    expect(loadConnection(memoryStore())).toBeNull();
  });

  it('returns the saved token', () => {
    expect(loadConnection(memoryStore({ [TOKEN_KEY]: TOKEN }))).toEqual({ token: TOKEN });
  });

  it('ignores a saved value that cannot be sent', () => {
    expect(loadConnection(memoryStore({ [TOKEN_KEY]: 'has space' }))).toBeNull();
    expect(loadConnection(memoryStore({ [TOKEN_KEY]: '' }))).toBeNull();
  });

  it('is null when storage is missing or blocked', () => {
    expect(loadConnection(undefined)).toBeNull();
    expect(loadConnection(broken)).toBeNull();
  });
});

describe('saveConnection', () => {
  it('saves the token without the spaces around it', () => {
    const store = memoryStore();
    expect(saveConnection(`  ${TOKEN}\n`, store)).toEqual({ ok: true, connection: { token: TOKEN } });
    expect(store.data.get(TOKEN_KEY)).toBe(TOKEN);
  });

  it('refuses a token that cannot be sent, and saves nothing', () => {
    const store = memoryStore();
    expect(saveConnection('   ', store)).toEqual({ ok: false, problem: expect.any(String) });
    expect(saveConnection('two words', store)).toEqual({ ok: false, problem: expect.any(String) });
    expect(store.data.size).toBe(0);
  });

  it('still connects when storage is blocked (memory only)', () => {
    expect(saveConnection(TOKEN, broken)).toEqual({ ok: true, connection: { token: TOKEN } });
    expect(saveConnection(TOKEN, undefined)).toEqual({ ok: true, connection: { token: TOKEN } });
  });
});

describe('clearConnection', () => {
  it('removes the token', () => {
    const store = memoryStore({ [TOKEN_KEY]: TOKEN, other: 'kept' });
    clearConnection(store);
    expect(store.data.has(TOKEN_KEY)).toBe(false);
    expect(store.data.get('other')).toBe('kept');
  });

  it('does not throw when storage is blocked', () => {
    expect(() => clearConnection(broken)).not.toThrow();
  });
});

describe('serverWorkspace', () => {
  it('holds the server tasks and no sample data', () => {
    const tasks = [{ id: 't1' }] as Task[];
    const ws = serverWorkspace(tasks);
    expect(ws.activity).toBe(tasks);
    expect(ws.repo).toBeNull();
    for (const [key, value] of Object.entries(ws)) {
      if (key === 'activity' || key === 'repo') continue;
      expect(value, key).toEqual([]);
    }
  });
});

describe('fetchTasks', () => {
  const okBody = { tasks: [{ id: 't1', status: 'running', updatedAt: '2026-11-10T16:00:00Z', title: 'Fix login' }] };
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const signal = () => new AbortController().signal;

  it('calls the relative path with the token in the Authorization header only', async () => {
    const fetchImpl = vi.fn(async () => json(200, okBody));
    await fetchTasks(TOKEN, signal(), fetchImpl);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(TASKS_PATH);
    expect(url).toBe('/v1/tasks');
    expect(url).not.toContain(TOKEN);
    expect(init.headers).toEqual({ authorization: `Bearer ${TOKEN}`, accept: 'application/json' });
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
  });

  it('passes the abort signal on', async () => {
    const fetchImpl = vi.fn(async () => json(200, okBody));
    const s = signal();
    await fetchTasks(TOKEN, s, fetchImpl);
    expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].signal).toBe(s);
  });

  it('returns the tasks mapped to the UI model', async () => {
    const result = await fetchTasks(TOKEN, signal(), async () => json(200, okBody));
    expect(result).toEqual({
      ok: true,
      skipped: 0,
      tasks: [{ id: 't1', task: 'Fix login', tool: '', status: 'Working', owner: '', source: '', detail: '', since: '2026-11-10T16:00:00Z' }],
    });
  });

  it('counts skipped tasks', async () => {
    const result = await fetchTasks(TOKEN, signal(), async () => json(200, { tasks: [...okBody.tasks, { id: 'x' }] }));
    expect(result.ok && result.skipped).toBe(1);
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'server-error'],
    [404, 'server-error'],
    [500, 'server-error'],
    [502, 'server-error'],
  ] as const)('maps HTTP %i to %s', async (status, problem) => {
    expect(await fetchTasks(TOKEN, signal(), async () => json(status, { error: 'x' }))).toEqual({ ok: false, problem });
  });

  it('is unreachable when fetch rejects (network down, timeout, redirect)', async () => {
    const result = await fetchTasks(TOKEN, signal(), async () => { throw new TypeError('Failed to fetch'); });
    expect(result).toEqual({ ok: false, problem: 'unreachable' });
  });

  it('is a bad response when the body is not JSON', async () => {
    const html = new Response('<!doctype html><title>dev server</title>', { status: 200 });
    expect(await fetchTasks(TOKEN, signal(), async () => html)).toEqual({ ok: false, problem: 'bad-response' });
  });

  it('is a bad response when the JSON is not { tasks: [...] }', async () => {
    expect(await fetchTasks(TOKEN, signal(), async () => json(200, { items: [] }))).toEqual({ ok: false, problem: 'bad-response' });
  });

  it('is unreachable when aborted while reading the body', async () => {
    const controller = new AbortController();
    const res = json(200, okBody);
    vi.spyOn(res, 'json').mockImplementation(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    expect(await fetchTasks(TOKEN, controller.signal, async () => res)).toEqual({ ok: false, problem: 'unreachable' });
  });
});
