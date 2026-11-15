import { describe, expect, it } from 'vitest';
import {
  HISTORY_MESSAGES, HISTORY_TEXT_MAX, MAX_MESSAGES, TITLE_MAX, createChat, deleteChat, historyFor, listChats, loadMessages, nextSession,
  parseChatList, renameChat, restoreMessages, restoreWidget, saveMessages, titleFrom, titleProblem, toStored, widgetText,
} from './chats';
import type { ThreadMessage, Widget } from '../chat/types';

const you = (id: number, text: string): ThreadMessage => ({ id, from: 'you', text });
const opsy = (id: number, widget: Widget, pending?: boolean): ThreadMessage => ({ id, from: 'opsy', widget, ...(pending ? { pending } : {}) });
const text = (t: string): Widget => ({ kind: 'text', text: t });
const signal = new AbortController().signal;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const chat = { id: 'c1', title: 'Hello', createdAt: '2026-11-14T10:00:00Z', updatedAt: '2026-11-14T10:00:00Z', messageCount: 2 };

describe('what goes to the AI provider with a question', () => {
  it('is only the last few messages of this chat', () => {
    const thread = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? you(i, `q${i}`) : opsy(i, text(`a${i}`))));
    const h = historyFor(thread);
    expect(h).toHaveLength(HISTORY_MESSAGES);
    expect(h[h.length - 1]).toEqual({ role: 'opsy', text: 'a19' });
    expect(h[0]).toEqual({ role: 'you', text: 'q14' });
  });

  it('skips waiting placeholders and cuts long text', () => {
    const h = historyFor([you(1, 'x'.repeat(HISTORY_TEXT_MAX + 50)), opsy(2, text('Asking…'), true)]);
    expect(h).toHaveLength(1);
    expect(h[0].text).toHaveLength(HISTORY_TEXT_MAX);
  });

  it('is empty for a new chat', () => {
    expect(historyFor([])).toEqual([]);
  });

  it('only sees the array it is given: another chat cannot leak in', () => {
    const a = [you(0, 'secret of chat A')];
    const b = [you(0, 'hello from chat B')];
    expect(JSON.stringify(historyFor(b))).not.toContain('secret');
    expect(JSON.stringify(historyFor(a))).toContain('secret');
  });

  it('describes a card as one line of text, never its data', () => {
    const brief: Widget = { kind: 'brief', total: 3, counts: [{ status: 'Needs you', count: 2 }, { status: 'Done', count: 1 }], next: null };
    expect(widgetText(brief)).toBe('Brief: 3 tasks (2 Needs you, 1 Done).');
  });
});

describe('storing and restoring a thread', () => {
  it('does not store waiting placeholders and keeps the newest MAX_MESSAGES', () => {
    const many = Array.from({ length: MAX_MESSAGES + 5 }, (_, i) => you(i, `m${i}`));
    const stored = toStored([...many, opsy(999, text('Asking…'), true)]);
    expect(stored).toHaveLength(MAX_MESSAGES);
    expect(stored[stored.length - 1].text).toBe(`m${MAX_MESSAGES + 4}`);
  });

  it('round-trips your messages and Opsy’s cards', () => {
    const stored = toStored([you(0, 'Brief me'), opsy(1, { kind: 'brief', total: 1, counts: [{ status: 'Done', count: 1 }], next: null })]);
    const back = restoreMessages({ messages: stored.map((m) => ({ ...m, at: 'x' })) })!;
    expect(back.map((m) => m.from)).toEqual(['you', 'opsy']);
    expect(back[1]).toMatchObject({ widget: { kind: 'brief', total: 1 } });
    expect(back.map((m) => m.id)).toEqual([0, 1]);
  });

  it('a permission that was waiting is stale after a reload, and a Stop in progress is not', () => {
    const perm = { kind: 'permission', runId: 'r', permissionId: 'p', tool: 'Bash', summary: 's', state: 'pending', busy: true, error: '' };
    expect(restoreWidget(perm)).toMatchObject({ state: 'stale', busy: false });
    expect(restoreWidget({ kind: 'run', runId: 'r', taskId: 't', title: 'T', status: 'running', branch: 'b', lastMessage: '', stopping: true })).toMatchObject({ stopping: false });
    expect(restoreWidget({ kind: 'action', action: 'run', state: 'approving', answer: 'a' })).toMatchObject({ state: 'failed' });
    // A card saved before repositories existed has no repoId: it is '' (the server chooses), not undefined.
    expect(restoreWidget({ kind: 'action', action: 'run', state: 'pending', answer: 'a', repo: 'app' })).toMatchObject({ repoId: '', repo: 'app', state: 'pending' });
    expect(restoreWidget({ kind: 'action', action: 'run', state: 'pending', answer: 'a', repo: 'app', repoId: 'r1' })).toMatchObject({ repoId: 'r1' });
    expect(restoreWidget({ kind: 'action', action: 'run', state: 'pending', answer: 'a', repoId: 7 })).toMatchObject({ repoId: '' });
  });

  it('skips what this version cannot draw instead of crashing', () => {
    expect(restoreWidget({ kind: 'hologram' })).toBeNull();
    expect(restoreWidget({ kind: 'tasks', tasks: 'nope' })).toBeNull();
    expect(restoreWidget(null)).toBeNull();
    const back = restoreMessages({ messages: [{ role: 'opsy', text: 'x', widget: { kind: 'hologram' } }, { role: 'you', text: 'hi' }, { role: 'robot', text: 'x' }, 7] })!;
    expect(back).toEqual([{ id: 0, from: 'you', text: 'hi' }]);
    expect(restoreMessages({})).toBeUndefined();
  });
});

describe('titles', () => {
  it('uses the first line of the first question, cut on a word', () => {
    expect(titleFrom('  What is\n  going on?  ')).toBe('What is');
    expect(titleFrom('')).toBe('New chat');
    const long = titleFrom(`${'word '.repeat(30)}`);
    expect(long.length).toBeLessThanOrEqual(61);
    expect(long.endsWith('…')).toBe(true);
  });
  it('checks a new name', () => {
    expect(titleProblem('  ')).toBeTruthy();
    expect(titleProblem('a'.repeat(TITLE_MAX))).toBeUndefined();
    expect(titleProblem('a'.repeat(TITLE_MAX + 1))).toBeTruthy();
  });
});

describe('which chat is open', () => {
  const s = { key: 3, chatId: 'a' };
  it('New chat starts over with no chat id', () => {
    expect(nextSession(s, { type: 'new' })).toEqual({ key: 4, chatId: null });
  });
  it('opening another chat starts over, opening the same does nothing', () => {
    expect(nextSession(s, { type: 'open', chatId: 'b' })).toEqual({ key: 4, chatId: 'b' });
    expect(nextSession(s, { type: 'open', chatId: 'a' })).toBe(s);
  });
  it('saving a new chat gives it an id without resetting the thread', () => {
    expect(nextSession({ key: 3, chatId: null }, { type: 'created', chatId: 'z' })).toEqual({ key: 3, chatId: 'z' });
    expect(nextSession(s, { type: 'created', chatId: 'z' })).toBe(s);
  });
  it('deleting the open chat leaves a new chat; deleting another changes nothing', () => {
    expect(nextSession(s, { type: 'deleted', chatId: 'a' })).toEqual({ key: 4, chatId: null });
    expect(nextSession(s, { type: 'deleted', chatId: 'q' })).toBe(s);
  });
});

describe('calls', () => {
  const rec = (res: Response) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return res; }) as unknown as typeof fetch;
    return { calls, impl };
  };

  it('list, create, rename, delete use the right method, path and token', async () => {
    let r = rec(json(200, { chats: [chat, { id: 5 }] }));
    expect(await listChats('tok', signal, r.impl)).toEqual({ ok: true, value: [chat] });
    expect(r.calls[0]).toMatchObject({ url: '/v1/chats', init: { method: 'GET' } });
    expect((r.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');

    r = rec(json(201, { chat }));
    await createChat('tok', 'Hello', signal, r.impl);
    expect(r.calls[0]).toMatchObject({ url: '/v1/chats', init: { method: 'POST' } });
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({ title: 'Hello' });

    r = rec(json(200, { chat }));
    await renameChat('tok', 'c/1', '  New  ', signal, r.impl);
    expect(r.calls[0]).toMatchObject({ url: '/v1/chats/c%2F1', init: { method: 'PATCH' } });
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({ title: 'New' });

    r = rec(new Response(null, { status: 204 }));
    expect(await deleteChat('tok', 'c1', signal, r.impl)).toEqual({ ok: true, value: true });
    expect(r.calls[0].init.method).toBe('DELETE');
  });

  it('load and save messages', async () => {
    let r = rec(json(200, { messages: [{ role: 'you', text: 'hi' }] }));
    expect(await loadMessages('t', 'c1', signal, r.impl)).toEqual({ ok: true, value: [{ id: 0, from: 'you', text: 'hi' }] });
    expect(r.calls[0].url).toBe('/v1/chats/c1/messages');
    r = rec(json(200, { chat }));
    await saveMessages('t', 'c1', [you(0, 'hi'), opsy(1, text('Asking…'), true)], signal, r.impl);
    expect(r.calls[0].init.method).toBe('PUT');
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({ messages: [{ role: 'you', text: 'hi' }] });
  });

  it('maps problems', async () => {
    expect(await listChats('t', signal, rec(json(401, {})).impl)).toEqual({ ok: false, problem: 'unauthorized' });
    expect(await deleteChat('t', 'x', signal, rec(json(404, {})).impl)).toEqual({ ok: false, problem: 'not-found' });
    expect(await listChats('t', signal, rec(json(200, { nope: 1 })).impl)).toEqual({ ok: false, problem: 'bad-response' });
    expect(parseChatList({ chats: 'x' })).toBeUndefined();
  });
});
