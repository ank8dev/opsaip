import { describe, expect, it } from 'vitest';
import { CREATED_SOURCE, TASK_TITLE_MAX, createTask, createTaskReply, taskTitleFrom } from './tasks';

const signal = new AbortController().signal;

function fakeFetch(res: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const created = { id: 't-1', status: 'queued', updatedAt: '2026-11-10T16:00:00Z', title: 'Fix login', source: 'you' };

describe('taskTitleFrom', () => {
  it('trims, and accepts 1 to 200 characters', () => {
    expect(taskTitleFrom('  Fix login \n')).toBe('Fix login');
    expect(taskTitleFrom('x'.repeat(TASK_TITLE_MAX))).toHaveLength(200);
  });
  it('refuses empty, whitespace and too long', () => {
    expect(taskTitleFrom('')).toBeUndefined();
    expect(taskTitleFrom(' \n\t ')).toBeUndefined();
    expect(taskTitleFrom('x'.repeat(201))).toBeUndefined();
  });
});

describe('createTask: the request', () => {
  it('POSTs { title } trimmed to /v1/tasks with the token, JSON, no redirects, no cache', async () => {
    const { impl, calls } = fakeFetch(json(201, { task: created }));
    const r = await createTask('tok-1', '  Fix login  ', signal, impl);
    expect(r).toEqual({
      ok: true,
      value: { id: 't-1', task: 'Fix login', tool: '', status: 'Queued', owner: 'me', source: '', detail: '', since: created.updatedAt },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/v1/tasks');
    const init = calls[0].init;
    expect(init.method).toBe('POST');
    expect(init.redirect).toBe('error');
    expect(init.cache).toBe('no-store');
    expect(init.signal).toBe(signal);
    expect(init.headers).toMatchObject({ authorization: 'Bearer tok-1', 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Fix login' });
    expect(calls[0].url).not.toContain('tok-1');
  });

  it('does not call the server for a title it would refuse', async () => {
    for (const text of ['', '   ', 'x'.repeat(201)]) {
      const { impl, calls } = fakeFetch(json(201, { task: created }));
      const r = await createTask('t', text, signal, impl);
      expect(r).toMatchObject({ ok: false, problem: 'bad-request' });
      expect(calls).toHaveLength(0);
    }
  });
});

describe('createTask: answers', () => {
  it.each([
    [400, 'bad-request'], [401, 'unauthorized'], [413, 'too-large'], [415, 'unsupported'], [409, 'server-error'],
    [500, 'server-error'], [503, 'server-error'],
  ] as const)('status %i -> %s', async (status, problem) => {
    const { impl } = fakeFetch(json(status, { error: 'nope' }));
    const r = await createTask('t', 'Fix', signal, impl);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toBe(problem);
  });

  it('a 400 carries the server reason; a 500 does not', async () => {
    const bad = await createTask('t', 'Fix', signal, fakeFetch(json(400, { error: 'title must not be empty' })).impl);
    expect(bad).toEqual({ ok: false, problem: 'bad-request', reason: 'title must not be empty' });
    const err = await createTask('t', 'Fix', signal, fakeFetch(json(500, { error: 'db path /secret' })).impl);
    expect(err).toEqual({ ok: false, problem: 'server-error' });
  });

  it('network error and abort are unreachable', async () => {
    expect(await createTask('t', 'Fix', signal, fakeFetch(new TypeError('x')).impl)).toEqual({ ok: false, problem: 'unreachable' });
  });

  it('malformed 2xx bodies are bad-response, never a crash', async () => {
    const bodies: unknown[] = [
      {}, [], null, 'x', 5, { task: null }, { task: [] }, { task: {} }, { task: { id: '', status: 'queued', updatedAt: created.updatedAt } },
      { task: { ...created, status: 'weird' } }, { task: { ...created, updatedAt: 'not a date' } }, { task: { ...created, title: 5 } },
    ];
    for (const b of bodies) {
      const r = await createTask('t', 'Fix', signal, fakeFetch(json(201, b)).impl);
      expect(r).toEqual({ ok: false, problem: 'bad-response' });
    }
    const html = await createTask('t', 'Fix', signal, fakeFetch(new Response('<html>', { status: 201 })).impl);
    expect(html).toEqual({ ok: false, problem: 'bad-response' });
  });

  it('ignores unknown fields', async () => {
    const r = await createTask('t', 'Fix', signal, fakeFetch(json(201, { task: { ...created, extra: 1 }, other: 2 })).impl);
    expect(r.ok).toBe(true);
  });
});

describe('createTaskReply', () => {
  it('confirms with the task the server sent, as yours', async () => {
    const r = await createTask('t', 'Fix login', signal, fakeFetch(json(201, { task: created })).impl);
    expect(createTaskReply(r)).toEqual({
      kind: 'tasks', title: 'I created this task', more: 0, source: CREATED_SOURCE,
      tasks: [{ id: 't-1', title: 'Fix login', status: 'Queued', agent: '', owner: 'You', detail: '', since: created.updatedAt }],
    });
  });

  it('shows the server title, not what was typed', async () => {
    const r = await createTask('t', 'typed', signal, fakeFetch(json(201, { task: { ...created, title: 'Server title' } })).impl);
    const reply = createTaskReply(r);
    expect(reply.kind === 'tasks' && reply.tasks[0].title).toBe('Server title');
  });

  it('an error is text with the server reason for a 400', () => {
    expect(createTaskReply({ ok: false, problem: 'bad-request', reason: 'title is missing' })).toEqual({
      kind: 'text', text: 'The server could not use that: title is missing',
    });
    expect(createTaskReply({ ok: false, problem: 'unreachable' }).kind).toBe('text');
  });
});
