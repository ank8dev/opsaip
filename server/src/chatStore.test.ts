import type { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  createChatStore,
  MAX_CHATS,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGES,
  MAX_TITLE_CHARS,
  MAX_WIDGET_CHARS,
  parseMessages,
  parseTitle,
  type ChatStore,
  type NewChatMessage,
} from './chatStore';
import { openDatabase } from './db';

let db: DatabaseSync;
let store: ChatStore;
let clock: number;
let ids: number;
beforeEach(() => {
  db = openDatabase(':memory:');
  clock = Date.parse('2026-11-14T10:00:00Z');
  ids = 0;
  // Every call to now() is one second later, so order is never a tie.
  store = createChatStore(db, { now: () => new Date((clock += 1000)), newId: () => `c${++ids}` });
});

const msg = (role: 'you' | 'opsy', text: string, widget: string | null = null): NewChatMessage => ({
  role,
  text,
  widget,
});

describe('chat store', () => {
  it('creates a chat and lists the most recently updated first', () => {
    const a = store.create('A');
    const b = store.create('B');
    expect(a).toEqual({
      id: 'c1',
      title: 'A',
      createdAt: '2026-11-14T10:00:01.000Z',
      updatedAt: '2026-11-14T10:00:01.000Z',
      messageCount: 0,
    });
    expect(store.list().map((c) => c.id)).toEqual([b.id, a.id]);
    store.replaceMessages(a.id, [msg('you', 'hi')]);
    expect(store.list().map((c) => [c.id, c.messageCount])).toEqual([
      [a.id, 1],
      [b.id, 0],
    ]);
    expect(Object.getPrototypeOf(store.list()[0])).toBe(Object.prototype);
  });

  it('renames a chat and moves it to the top', () => {
    const a = store.create('A');
    store.create('B');
    const renamed = store.rename(a.id, 'A2')!;
    expect(renamed.title).toBe('A2');
    expect(renamed.createdAt).toBe(a.createdAt);
    expect(renamed.updatedAt > a.updatedAt).toBe(true);
    expect(store.list()[0].id).toBe(a.id);
    expect(store.rename('nope', 'x')).toBeUndefined();
  });

  it('replaces the messages: ids are the 0-based order, widgets come back as objects', () => {
    const chat = store.create('A');
    expect(store.messages(chat.id)).toEqual([]);
    const updated = store.replaceMessages(chat.id, [
      msg('you', 'What waits?'),
      msg('opsy', 'Fix login.', '{"type":"card","n":[1,2]}'),
    ])!;
    expect(updated.messageCount).toBe(2);
    expect(updated.updatedAt > chat.updatedAt).toBe(true);
    expect(store.messages(chat.id)).toEqual([
      { id: 0, role: 'you', text: 'What waits?', widget: null, at: updated.updatedAt },
      { id: 1, role: 'opsy', text: 'Fix login.', widget: { type: 'card', n: [1, 2] }, at: updated.updatedAt },
    ]);

    // Replacing with fewer (or none) really drops the rest.
    store.replaceMessages(chat.id, [msg('you', 'only')]);
    expect(store.messages(chat.id)!.map((m) => m.text)).toEqual(['only']);
    store.replaceMessages(chat.id, []);
    expect(store.messages(chat.id)).toEqual([]);
  });

  it('answers undefined / false for an unknown chat', () => {
    expect(store.messages('nope')).toBeUndefined();
    expect(store.replaceMessages('nope', [msg('you', 'x')])).toBeUndefined();
    expect(store.remove('nope')).toBe(false);
    expect(db.prepare('SELECT count(*) AS n FROM chat_messages').get()).toEqual({ n: 0 });
  });

  it('deletes a chat with its messages and no other chat', () => {
    const a = store.create('A');
    const b = store.create('B');
    store.replaceMessages(a.id, [msg('you', 'a1'), msg('opsy', 'a2')]);
    store.replaceMessages(b.id, [msg('you', 'b1')]);
    expect(store.remove(a.id)).toBe(true);
    expect(store.list().map((c) => c.id)).toEqual([b.id]);
    expect(db.prepare('SELECT chat_id FROM chat_messages').all()).toEqual([{ chat_id: b.id }]);
  });

  it('a failing replace leaves the old messages untouched', () => {
    const chat = store.create('A');
    store.replaceMessages(chat.id, [msg('you', 'old 1'), msg('opsy', 'old 2')]);
    const before = store.messages(chat.id);
    const beforeChat = store.list()[0];
    // The second message breaks the CHECK on role, after the old ones were
    // deleted and the first new one was inserted.
    const bad = [msg('you', 'new 1'), { role: 'admin', text: 'x', widget: null } as unknown as NewChatMessage];
    expect(() => store.replaceMessages(chat.id, bad)).toThrow();
    expect(store.messages(chat.id)).toEqual(before);
    expect(store.list()[0]).toEqual(beforeChat);
    // The connection is usable afterwards (the transaction was rolled back).
    expect(store.replaceMessages(chat.id, [msg('you', 'fine')])?.messageCount).toBe(1);
  });

  it('keeps at most 200 chats: the 201st deletes the least recently updated one', () => {
    const first = store.create('first');
    const second = store.create('second');
    for (let i = 2; i < MAX_CHATS; i++) store.create(`chat ${i}`);
    expect(store.list()).toHaveLength(MAX_CHATS);
    // Updating "first" makes "second" the least recently updated.
    store.rename(first.id, 'first, renamed');
    const oldest = store.list()[MAX_CHATS - 1];
    expect(oldest.id).toBe(second.id);
    const extra = store.create('extra');

    const list = store.list();
    expect(list).toHaveLength(MAX_CHATS);
    expect(list.some((c) => c.id === oldest.id)).toBe(false);
    expect(list[0].id).toBe(extra.id);
    expect(list.some((c) => c.id === first.id)).toBe(true);
  });

  it('deleting the oldest chat to make room takes its messages along', () => {
    const first = store.create('first');
    store.replaceMessages(first.id, [msg('you', 'doomed')]);
    // "first" was updated before every chat below was created: it is the oldest.
    for (let i = 1; i < MAX_CHATS; i++) store.create(`chat ${i}`);
    expect(store.list()).toHaveLength(MAX_CHATS);
    store.create('one more');
    expect(store.list()).toHaveLength(MAX_CHATS);
    expect(store.messages(first.id)).toBeUndefined();
    expect(db.prepare('SELECT count(*) AS n FROM chat_messages').get()).toEqual({ n: 0 });
  });
});

describe('parseTitle', () => {
  it('trims, and accepts 1 to 80 characters (code points)', () => {
    expect(parseTitle('  Hello  ')).toEqual({ ok: true, value: 'Hello' });
    expect(parseTitle('a')).toEqual({ ok: true, value: 'a' });
    expect(parseTitle('a'.repeat(MAX_TITLE_CHARS)).ok).toBe(true);
    expect(parseTitle('😀'.repeat(MAX_TITLE_CHARS)).ok).toBe(true);
    expect(parseTitle('a'.repeat(MAX_TITLE_CHARS + 1)).ok).toBe(false);
    expect(parseTitle('😀'.repeat(MAX_TITLE_CHARS + 1)).ok).toBe(false);
  });

  it('rejects empty, blank, non-strings and control characters', () => {
    for (const bad of ['', '   ', 5, null, undefined, {}, 'a\nb', 'a\u0000b', 'tab\there', 'bell\u0007']) {
      expect(parseTitle(bad).ok, String(bad)).toBe(false);
    }
  });
});

describe('parseMessages', () => {
  const ok = (messages: unknown) => parseMessages({ messages }).ok;

  it('accepts 0 to 200 messages', () => {
    expect(ok([])).toBe(true);
    expect(ok(Array.from({ length: MAX_MESSAGES }, () => ({ role: 'you', text: 'x' })))).toBe(true);
    expect(ok(Array.from({ length: MAX_MESSAGES + 1 }, () => ({ role: 'you', text: 'x' })))).toBe(false);
  });

  it('limits the text to 4000 characters', () => {
    expect(ok([{ role: 'opsy', text: 'a'.repeat(MAX_MESSAGE_CHARS) }])).toBe(true);
    expect(ok([{ role: 'opsy', text: 'a'.repeat(MAX_MESSAGE_CHARS + 1) }])).toBe(false);
    expect(ok([{ role: 'opsy', text: '' }])).toBe(true);
  });

  it('limits the serialized widget to 20000 characters and wants an object', () => {
    // {"k":"..."} is 8 characters around the string.
    const widget = (n: number) => ({ k: 'a'.repeat(n - 8) });
    expect(JSON.stringify(widget(MAX_WIDGET_CHARS))).toHaveLength(MAX_WIDGET_CHARS);
    expect(ok([{ role: 'opsy', text: 'x', widget: widget(MAX_WIDGET_CHARS) }])).toBe(true);
    expect(ok([{ role: 'opsy', text: 'x', widget: widget(MAX_WIDGET_CHARS + 1) }])).toBe(false);
    expect(ok([{ role: 'opsy', text: 'x', widget: null }])).toBe(true);
    for (const bad of ['str', 5, [1], true]) {
      expect(ok([{ role: 'opsy', text: 'x', widget: bad }]), String(bad)).toBe(false);
    }
  });

  it('rejects bad roles, missing fields and wrong shapes', () => {
    for (const bad of [
      [{ role: 'system', text: 'x' }],
      [{ text: 'x' }],
      [{ role: 'you' }],
      [{ role: 'you', text: 1 }],
      ['x'],
      [null],
      'x',
      {},
    ]) {
      expect(ok(bad), JSON.stringify(bad)).toBe(false);
    }
    expect(parseMessages(null).ok).toBe(false);
    expect(parseMessages([]).ok).toBe(false);
  });

  it('keeps role, text and the serialized widget, and drops other fields', () => {
    expect(parseMessages({ messages: [{ role: 'you', text: 'hi', id: 9, at: 'x', widget: { a: 1 } }] })).toEqual({
      ok: true,
      value: [{ role: 'you', text: 'hi', widget: '{"a":1}' }],
    });
  });
});
