import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';

/** Longest chat title, in characters (Unicode code points). */
export const MAX_TITLE_CHARS = 80;
/** Title of a chat created without one. */
export const DEFAULT_TITLE = 'New chat';
/** Most messages one chat keeps. */
export const MAX_MESSAGES = 200;
/** Longest message text, in characters (Unicode code points). */
export const MAX_MESSAGE_CHARS = 4000;
/** Longest widget, in characters of its serialized JSON. */
export const MAX_WIDGET_CHARS = 20_000;
/** Most chats kept. Creating one more deletes the least recently updated chat. */
export const MAX_CHATS = 200;

export type ChatRole = 'you' | 'opsy';

export interface Chat {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface ChatMessage {
  /** The position in the chat, from 0. */
  id: number;
  role: ChatRole;
  text: string;
  /** Opaque JSON the web app keeps for its own use. The server never reads or renders it. */
  widget: Record<string, unknown> | null;
  at: string;
}

export interface NewChatMessage {
  role: ChatRole;
  text: string;
  /** The serialized widget, or null. */
  widget: string | null;
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

/**
 * Chats kept in SQLite. Like the task store, the database is the only copy.
 * Methods that take a chat id return undefined (or false) for an unknown chat.
 * Each write is one transaction. They can throw if the database fails (the
 * HTTP layer turns that into a 500). Chat content is never logged.
 */
export interface ChatStore {
  /** Most recently updated first. */
  list(): Chat[];
  /** Deletes the least recently updated chat first when MAX_CHATS would be exceeded. */
  create(title: string): Chat;
  rename(id: string, title: string): Chat | undefined;
  /** false if there was no such chat. Its messages are deleted with it. */
  remove(id: string): boolean;
  messages(id: string): ChatMessage[] | undefined;
  /** Replace all messages of the chat in one transaction and touch its updatedAt. */
  replaceMessages(id: string, messages: readonly NewChatMessage[]): Chat | undefined;
}

export function createChatStore(
  db: DatabaseSync,
  { now = () => new Date(), newId = randomUUID }: { now?: () => Date; newId?: () => string } = {},
): ChatStore {
  const COLUMNS = `id, title, created_at AS createdAt, updated_at AS updatedAt,
    (SELECT count(*) FROM chat_messages WHERE chat_id = chats.id) AS messageCount`;
  const selectAll = db.prepare(`SELECT ${COLUMNS} FROM chats ORDER BY updated_at DESC, rowid DESC`);
  const selectOne = db.prepare(`SELECT ${COLUMNS} FROM chats WHERE id = ?`);
  const insertChat = db.prepare('INSERT INTO chats (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)');
  const countChats = db.prepare('SELECT count(*) AS n FROM chats');
  const deleteOldest = db.prepare(
    'DELETE FROM chats WHERE id IN (SELECT id FROM chats ORDER BY updated_at ASC, rowid ASC LIMIT ?)',
  );
  const updateTitle = db.prepare('UPDATE chats SET title = ?, updated_at = ? WHERE id = ?');
  const touch = db.prepare('UPDATE chats SET updated_at = ? WHERE id = ?');
  const deleteChat = db.prepare('DELETE FROM chats WHERE id = ?');
  const selectMessages = db.prepare(
    'SELECT seq, role, text, widget, at FROM chat_messages WHERE chat_id = ? ORDER BY seq',
  );
  const deleteMessages = db.prepare('DELETE FROM chat_messages WHERE chat_id = ?');
  const insertMessage = db.prepare(
    'INSERT INTO chat_messages (chat_id, seq, role, text, widget, at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  // BEGIN IMMEDIATE takes the write lock now, so check-then-write is atomic
  // even if another process opens the same file.
  const inTransaction = <R>(work: () => R): R => {
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // SQLite may have rolled back already. Keep the first error.
      }
      throw error;
    }
  };

  // Rows come back with a null prototype: copy them into plain objects.
  const one = (id: string): Chat | undefined => {
    const row = selectOne.get(id);
    return row === undefined ? undefined : { ...(row as unknown as Chat) };
  };

  return {
    list() {
      return selectAll.all().map((row) => ({ ...(row as unknown as Chat) }));
    },

    create(title) {
      const id = newId();
      const at = now().toISOString();
      return inTransaction(() => {
        const { n } = countChats.get() as { n: number };
        const excess = n + 1 - MAX_CHATS;
        if (excess > 0) deleteOldest.run(excess);
        insertChat.run(id, title, at, at);
        return one(id)!;
      });
    },

    rename(id, title) {
      return inTransaction(() => {
        if (one(id) === undefined) return undefined;
        updateTitle.run(title, now().toISOString(), id);
        return one(id);
      });
    },

    remove(id) {
      return Number(deleteChat.run(id).changes) > 0;
    },

    messages(id) {
      if (one(id) === undefined) return undefined;
      return selectMessages.all(id).map((row) => {
        const { seq, role, text, widget, at } = row as {
          seq: number;
          role: ChatRole;
          text: string;
          widget: string | null;
          at: string;
        };
        return { id: seq, role, text, widget: widget === null ? null : JSON.parse(widget), at };
      });
    },

    replaceMessages(id, messages) {
      const at = now().toISOString();
      return inTransaction(() => {
        if (one(id) === undefined) return undefined;
        deleteMessages.run(id);
        messages.forEach((message, seq) => {
          insertMessage.run(id, seq, message.role, message.text, message.widget, at);
        });
        touch.run(at, id);
        return one(id);
      });
    },
  };
}

/** A title: a string, trimmed, 1 to MAX_TITLE_CHARS characters, no control characters. */
export function parseTitle(input: unknown): Parsed<string> {
  if (typeof input !== 'string') return { ok: false, reason: 'title must be a string' };
  const title = input.trim();
  if (title === '') return { ok: false, reason: 'title must not be empty' };
  if (codePoints(title) > MAX_TITLE_CHARS) {
    return { ok: false, reason: `title must be at most ${MAX_TITLE_CHARS} characters` };
  }
  if (/\p{Cc}/u.test(title)) return { ok: false, reason: 'title must not contain control characters' };
  return { ok: true, value: title };
}

/**
 * The body of PUT /v1/chats/:id/messages: { messages: [{ role, text, widget? }] }.
 * The widget is checked for shape (a JSON object or null) and size only.
 */
export function parseMessages(input: unknown): Parsed<NewChatMessage[]> {
  const list = isRecord(input) ? input.messages : undefined;
  if (!Array.isArray(list)) return { ok: false, reason: 'body must be a JSON object with a "messages" array' };
  if (list.length > MAX_MESSAGES) {
    return { ok: false, reason: `messages must have at most ${MAX_MESSAGES} entries` };
  }
  const messages: NewChatMessage[] = [];
  for (const [i, item] of list.entries()) {
    if (!isRecord(item)) return { ok: false, reason: `messages[${i}] must be an object` };
    if (item.role !== 'you' && item.role !== 'opsy') {
      return { ok: false, reason: `messages[${i}].role must be "you" or "opsy"` };
    }
    if (typeof item.text !== 'string') return { ok: false, reason: `messages[${i}].text must be a string` };
    if (codePoints(item.text) > MAX_MESSAGE_CHARS) {
      return { ok: false, reason: `messages[${i}].text must be at most ${MAX_MESSAGE_CHARS} characters` };
    }
    let widget: string | null = null;
    if (item.widget !== undefined && item.widget !== null) {
      if (!isRecord(item.widget)) return { ok: false, reason: `messages[${i}].widget must be an object or null` };
      widget = JSON.stringify(item.widget);
      if (widget.length > MAX_WIDGET_CHARS) {
        return { ok: false, reason: `messages[${i}].widget must be at most ${MAX_WIDGET_CHARS} characters of JSON` };
      }
    }
    messages.push({ role: item.role, text: item.text, widget });
  }
  return { ok: true, value: messages };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function codePoints(text: string): number {
  return Array.from(text).length;
}
