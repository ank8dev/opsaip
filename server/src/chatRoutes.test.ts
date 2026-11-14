// The /v1/chats routes over HTTP.
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { request, type Server } from 'node:http';
import { createTaskStore } from '@opsaip/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { MAX_MESSAGES_BODY_BYTES } from './chatRoutes';
import { createChatStore, MAX_CHATS, MAX_TITLE_CHARS, type ChatStore } from './chatStore';
import { openDatabase } from './db';

const TOKEN = 'chat-test-token-0123456789abcdef0123456789';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const JSON_HEADERS = { 'content-type': 'application/json' };

let server: Server | undefined;
let base = '';
let chats: ChatStore;

async function start(): Promise<void> {
  chats = createChatStore(openDatabase(':memory:'));
  server = createApp({ store: createTaskStore(), token: TOKEN, chats });
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

function call(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = { ...AUTH, ...JSON_HEADERS },
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function newChat(title?: string): Promise<{ id: string; title: string }> {
  const res = await call('POST', '/v1/chats', title === undefined ? {} : { title });
  return ((await res.json()) as { chat: { id: string; title: string } }).chat;
}

/**
 * A request that announces `length` bytes and sends none: the server answers
 * 413 from the header alone. (fetch would fail with ECONNRESET while still
 * uploading a body the server has already refused.)
 */
function announce(path: string, length: number): Promise<{ status: number; body: string }> {
  const { port } = server!.address() as AddressInfo;
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: 'PUT', path, headers: { ...AUTH, ...JSON_HEADERS, 'content-length': length } },
      (res) => {
        let body = '';
        res.on('data', (chunk: Buffer) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.flushHeaders();
  });
}

const messages = (n: number) => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'opsy' : 'you', text: `m${i}` }));

describe('chats over HTTP', () => {
  it('401 without a token (or with a wrong one) on every chat route', async () => {
    await start();
    const { id } = await newChat();
    const routes: [string, string, unknown?][] = [
      ['GET', '/v1/chats'],
      ['POST', '/v1/chats', {}],
      ['PATCH', `/v1/chats/${id}`, { title: 'x' }],
      ['DELETE', `/v1/chats/${id}`],
      ['GET', `/v1/chats/${id}/messages`],
      ['PUT', `/v1/chats/${id}/messages`, { messages: [] }],
    ];
    for (const [method, path, body] of routes) {
      for (const headers of [JSON_HEADERS, { ...JSON_HEADERS, authorization: 'Bearer wrong-token' }]) {
        const res = await call(method, path, body, headers);
        expect(res.status, `${method} ${path}`).toBe(401);
        expect(res.headers.get('www-authenticate')).toBe('Bearer');
      }
    }
    // Nothing happened behind the 401s.
    expect(chats.list()).toHaveLength(1);
    expect(chats.list()[0].title).toBe('New chat');
  });

  it('POST creates a chat (default title, or the trimmed one); GET lists the newest update first', async () => {
    await start();
    const res = await call('POST', '/v1/chats', {});
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json; charset=utf-8');
    const { chat } = (await res.json()) as { chat: Record<string, unknown> };
    expect(chat).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      title: 'New chat',
      createdAt: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      updatedAt: chat.createdAt,
      messageCount: 0,
    });
    const b = await newChat('  Second  ');
    expect(b.title).toBe('Second');

    await call('PUT', `/v1/chats/${(chat as { id: string }).id}/messages`, { messages: messages(3) });
    const list = await call('GET', '/v1/chats');
    expect(list.status).toBe(200);
    const body = (await list.json()) as { chats: { id: string; messageCount: number }[] };
    expect(body.chats.map((c) => [c.id, c.messageCount])).toEqual([
      [chat.id, 3],
      [b.id, 0],
    ]);
  });

  it('POST: 400 for a bad title or body, 415 for another content type', async () => {
    await start();
    for (const body of [{ title: '' }, { title: '   ' }, { title: 5 }, { title: null }, { title: 'a\nb' }, [], 'null', '{bad']) {
      expect((await call('POST', '/v1/chats', body)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await call('POST', '/v1/chats', '{}', { ...AUTH, 'content-type': 'text/plain' })).status).toBe(415);
    expect(chats.list()).toEqual([]);
  });

  it('title boundary: 80 characters pass, 81 fail (POST and PATCH)', async () => {
    await start();
    expect((await call('POST', '/v1/chats', { title: 'a'.repeat(MAX_TITLE_CHARS) })).status).toBe(201);
    expect((await call('POST', '/v1/chats', { title: 'a'.repeat(MAX_TITLE_CHARS + 1) })).status).toBe(400);
    const { id } = await newChat();
    expect((await call('PATCH', `/v1/chats/${id}`, { title: 'b'.repeat(MAX_TITLE_CHARS) })).status).toBe(200);
    const res = await call('PATCH', `/v1/chats/${id}`, { title: 'b'.repeat(MAX_TITLE_CHARS + 1) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'title must be at most 80 characters' });
  });

  it('PATCH renames; 400 invalid; 404 unknown chat', async () => {
    await start();
    const { id } = await newChat('Old');
    const res = await call('PATCH', `/v1/chats/${id}`, { title: ' New name ' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { chat: { title: string } }).chat.title).toBe('New name');
    for (const body of [{}, { title: '' }, { title: 3 }, [], 'x']) {
      expect((await call('PATCH', `/v1/chats/${id}`, body)).status, JSON.stringify(body)).toBe(400);
    }
    const missing = await call('PATCH', '/v1/chats/nope', { title: 'x' });
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ error: 'chat not found' });
  });

  it('DELETE answers 204 with no body, then 404; the messages go with the chat', async () => {
    await start();
    const { id } = await newChat();
    await call('PUT', `/v1/chats/${id}/messages`, { messages: messages(2) });
    const res = await call('DELETE', `/v1/chats/${id}`);
    expect(res.status).toBe(204);
    expect(await res.text()).toBe('');
    expect((await call('DELETE', `/v1/chats/${id}`)).status).toBe(404);
    expect((await call('GET', `/v1/chats/${id}/messages`)).status).toBe(404);
    expect(chats.messages(id)).toBeUndefined();
  });

  it('PUT stores the messages and GET returns them in order with ids, widgets and times', async () => {
    await start();
    const { id } = await newChat();
    const put = await call('PUT', `/v1/chats/${id}/messages`, {
      messages: [
        { role: 'you', text: 'Fix login?' },
        { role: 'opsy', text: 'Proposed.', widget: { kind: 'action', title: 'Fix login' } },
        { role: 'you', text: 'ok', widget: null },
      ],
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { chat: { id: string; messageCount: number } }).chat).toMatchObject({
      id,
      messageCount: 3,
    });
    const res = await call('GET', `/v1/chats/${id}/messages`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messages: [
        { id: 0, role: 'you', text: 'Fix login?', widget: null, at: expect.any(String) },
        { id: 1, role: 'opsy', text: 'Proposed.', widget: { kind: 'action', title: 'Fix login' }, at: expect.any(String) },
        { id: 2, role: 'you', text: 'ok', widget: null, at: expect.any(String) },
      ],
    });

    // It replaces: the second PUT leaves exactly its own messages.
    await call('PUT', `/v1/chats/${id}/messages`, { messages: messages(1) });
    const again = (await (await call('GET', `/v1/chats/${id}/messages`)).json()) as { messages: unknown[] };
    expect(again.messages).toHaveLength(1);
  });

  it('PUT: 200 messages pass, 201 fail with 400; the old messages stay', async () => {
    await start();
    const { id } = await newChat();
    expect((await call('PUT', `/v1/chats/${id}/messages`, { messages: messages(200) })).status).toBe(200);
    const res = await call('PUT', `/v1/chats/${id}/messages`, { messages: messages(201) });
    expect(res.status).toBe(400);
    expect(chats.messages(id)).toHaveLength(200);
  });

  it('PUT: text and widget limits', async () => {
    await start();
    const { id } = await newChat();
    const put = (message: unknown) => call('PUT', `/v1/chats/${id}/messages`, { messages: [message] });
    expect((await put({ role: 'you', text: 'a'.repeat(4000) })).status).toBe(200);
    expect((await put({ role: 'you', text: 'a'.repeat(4001) })).status).toBe(400);
    expect((await put({ role: 'opsy', text: 'x', widget: { k: 'a'.repeat(20_000 - 8) } })).status).toBe(200);
    expect((await put({ role: 'opsy', text: 'x', widget: { k: 'a'.repeat(20_000 - 7) } })).status).toBe(400);
    expect((await put({ role: 'opsy', text: 'x', widget: 'string' })).status).toBe(400);
    expect((await put({ role: 'robot', text: 'x' })).status).toBe(400);
  });

  it('PUT: a bad payload leaves the old messages untouched (400 and 413)', async () => {
    await start();
    const { id } = await newChat();
    await call('PUT', `/v1/chats/${id}/messages`, { messages: messages(2) });
    const before = await (await call('GET', `/v1/chats/${id}/messages`)).json();
    const updatedBefore = chats.list()[0].updatedAt;

    const bad = [...messages(3), { role: 'oops', text: 'x' }]; // the last one is invalid
    expect((await call('PUT', `/v1/chats/${id}/messages`, { messages: bad })).status).toBe(400);
    expect((await call('PUT', `/v1/chats/${id}/messages`, '{"messages": [')).status).toBe(400);
    expect((await call('PUT', `/v1/chats/${id}/messages`, { messages: 'x' })).status).toBe(400);
    expect((await announce(`/v1/chats/${id}/messages`, MAX_MESSAGES_BODY_BYTES + 1)).status).toBe(413);

    expect(await (await call('GET', `/v1/chats/${id}/messages`)).json()).toEqual(before);
    expect(chats.list()[0].updatedAt).toBe(updatedBefore);
  });

  it('PUT: the body limit is 1 MB for this route only; 415 for another content type', async () => {
    await start();
    const { id } = await newChat();
    // Bigger than the 16 KB of the other routes, still valid: 5 messages of 4000 characters.
    const big = { messages: Array.from({ length: 5 }, () => ({ role: 'you', text: 'x'.repeat(4000) })) };
    expect(JSON.stringify(big).length).toBeGreaterThan(16 * 1024);
    expect((await call('PUT', `/v1/chats/${id}/messages`, big)).status).toBe(200);

    const res = await announce(`/v1/chats/${id}/messages`, MAX_MESSAGES_BODY_BYTES + 1);
    expect(res.status).toBe(413);
    expect(JSON.parse(res.body)).toEqual({ error: `body must be at most ${MAX_MESSAGES_BODY_BYTES} bytes` });

    // Exactly 1 MB is read (here it is not valid JSON, so 400, not 413).
    const exact = await call('PUT', `/v1/chats/${id}/messages`, ' '.repeat(MAX_MESSAGES_BODY_BYTES));
    expect(exact.status).toBe(400);

    expect((await call('PUT', `/v1/chats/${id}/messages`, '{"messages":[]}', AUTH)).status).toBe(415);
    expect(
      (await call('PUT', `/v1/chats/${id}/messages`, '{"messages":[]}', { ...AUTH, 'content-type': 'text/plain' })).status,
    ).toBe(415);

    // The other routes keep the 16 KB limit.
    const other = await call('PATCH', `/v1/chats/${id}`, { title: 'a', pad: 'x'.repeat(16 * 1024) });
    expect(other.status).toBe(413);
    const post = await call('POST', '/v1/chats', { pad: 'x'.repeat(16 * 1024) });
    expect(post.status).toBe(413);
  });

  it('404 for an unknown chat on GET messages and PUT messages', async () => {
    await start();
    expect((await call('GET', '/v1/chats/nope/messages')).status).toBe(404);
    expect((await call('PUT', '/v1/chats/nope/messages', { messages: [] })).status).toBe(404);
    expect((await call('GET', '/v1/chats/not.an.id/messages')).status).toBe(404);
  });

  it('405 with Allow for another method', async () => {
    await start();
    const { id } = await newChat();
    for (const [method, path, allow] of [
      ['PUT', '/v1/chats', 'GET, POST'],
      ['GET', `/v1/chats/${id}`, 'PATCH, DELETE'],
      ['POST', `/v1/chats/${id}/messages`, 'GET, PUT'],
    ]) {
      const res = await call(method, path, method === 'GET' ? undefined : {});
      expect(res.status, `${method} ${path}`).toBe(405);
      expect(res.headers.get('allow')).toBe(allow);
    }
  });

  it('keeps 200 chats: creating a 201st deletes the least recently updated one', async () => {
    await start();
    const first = await newChat('first');
    for (let i = 1; i < MAX_CHATS; i++) chats.create(`chat ${i}`);
    expect(chats.list()).toHaveLength(MAX_CHATS);
    expect((await call('POST', '/v1/chats', { title: 'one more' })).status).toBe(201);
    const list = ((await (await call('GET', '/v1/chats')).json()) as { chats: { id: string; title: string }[] }).chats;
    expect(list).toHaveLength(MAX_CHATS);
    expect(list.some((c) => c.id === first.id)).toBe(false);
    expect(list[0].title).toBe('one more');
  });
});
