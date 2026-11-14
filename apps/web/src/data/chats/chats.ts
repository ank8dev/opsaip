// Chat sessions: the list of chats and their messages, stored on the server
// (SQLite) so they survive a reload and a restart. Pure: no React. The server
// treats a message's widget as opaque JSON; this file turns a thread message
// into what is stored and back, and decides what part of the current chat is
// sent to the AI provider.
//
// Only the CURRENT chat is ever read here: no other chat can reach Ask.

import { callApi, type ApiResult } from '../chat/serverCall';
import type { ThreadMessage, Widget } from '../chat/types';

export const CHATS_PATH = '/v1/chats';
export const TITLE_MAX = 80;
export const DEFAULT_TITLE = 'New chat';
/** How many of the latest messages of the current chat go to the AI provider with a question. */
export const HISTORY_MESSAGES = 6;
/** The longest text of one history message. The server refuses more. */
export const HISTORY_TEXT_MAX = 1000;
/** The most messages kept in one chat: the oldest go first. Matches the server. */
export const MAX_MESSAGES = 200;
const MAX_TEXT = 4000;

export interface ChatInfo {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

interface StoredMessage {
  role: 'you' | 'opsy';
  text: string;
  widget?: Widget | null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ---- Reading what the server sends ----

export function parseChat(raw: unknown): ChatInfo | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, title, createdAt, updatedAt, messageCount } = raw;
  if (typeof id !== 'string' || id === '' || typeof title !== 'string') return undefined;
  if (typeof createdAt !== 'string' || typeof updatedAt !== 'string') return undefined;
  return { id, title: title.slice(0, TITLE_MAX), createdAt, updatedAt, messageCount: typeof messageCount === 'number' ? messageCount : 0 };
}

export function parseChatList(body: unknown): ChatInfo[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.chats)) return undefined;
  return body.chats.map(parseChat).filter((c): c is ChatInfo => c !== undefined);
}

function parseOneChat(body: unknown): ChatInfo | undefined {
  return isRecord(body) ? parseChat(body.chat) : undefined;
}

const WIDGET_KINDS = ['brief', 'tasks', 'needs', 'agent', 'proposal', 'text', 'run', 'permission', 'action'] as const;
/** Fields that must be arrays, or the card would crash when drawn. */
const ARRAY_FIELDS: Record<string, string[]> = { brief: ['counts'], tasks: ['tasks'], needs: ['tasks'], agent: ['counts'] };

/**
 * A stored widget that this version can draw, or null. A permission request
 * that was waiting is no longer waiting after a reload ("stale"), a Stop in
 * progress is not in progress, an approval in progress did not finish.
 */
export function restoreWidget(raw: unknown): Widget | null {
  if (!isRecord(raw) || typeof raw.kind !== 'string' || !(WIDGET_KINDS as readonly string[]).includes(raw.kind)) return null;
  for (const field of ARRAY_FIELDS[raw.kind] ?? []) if (!Array.isArray(raw[field])) return null;
  if (raw.kind === 'text' && typeof raw.text !== 'string') return null;
  const w = raw as unknown as Widget;
  if (w.kind === 'permission') return { ...w, state: w.state === 'pending' ? 'stale' : w.state, busy: false };
  if (w.kind === 'run') return { ...w, stopping: false };
  if (w.kind === 'action') return { ...w, state: w.state === 'approving' ? 'failed' : w.state };
  return w;
}

/** Stored messages as thread messages, ids from 0. Messages this version cannot draw are skipped. */
export function restoreMessages(body: unknown): ThreadMessage[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.messages)) return undefined;
  const out: ThreadMessage[] = [];
  for (const m of body.messages) {
    if (!isRecord(m) || typeof m.text !== 'string') continue;
    if (m.role === 'you') out.push({ id: out.length, from: 'you', text: m.text });
    else if (m.role === 'opsy') {
      const widget = restoreWidget(m.widget);
      if (widget !== null) out.push({ id: out.length, from: 'opsy', widget });
    }
  }
  return out;
}

// ---- What is stored, and what the AI provider gets ----

/** One line of text for a widget: what the AI provider may see as context, and a fallback label. */
export function widgetText(w: Widget): string {
  switch (w.kind) {
    case 'text': return w.text;
    case 'action': return w.answer;
    case 'brief': return `Brief: ${w.total} tasks (${w.counts.map((c) => `${c.count} ${c.status}`).join(', ')}).`;
    case 'tasks': return `${w.title}: ${w.tasks.map((t) => t.title).join('; ')}`;
    case 'needs': return `Needs you: ${w.tasks.map((t) => t.title).join('; ')}`;
    case 'agent': return `${w.agent}: ${w.counts.map((c) => `${c.count} ${c.status}`).join(', ')}`;
    case 'proposal': return `Proposed title: ${w.after}`;
    case 'run': return `Run "${w.title}": ${w.status}`;
    case 'permission': return `Permission request for ${w.tool}`;
  }
}

function textOf(m: ThreadMessage): string {
  return m.from === 'you' ? m.text : widgetText(m.widget);
}

/** What to store for a thread: no waiting placeholders, at most MAX_MESSAGES (the newest). */
export function toStored(messages: readonly ThreadMessage[]): StoredMessage[] {
  const settled = messages.filter((m) => !(m.from === 'opsy' && m.pending));
  return settled.slice(-MAX_MESSAGES).map((m): StoredMessage =>
    m.from === 'you'
      ? { role: 'you', text: m.text.slice(0, MAX_TEXT) }
      : { role: 'opsy', text: textOf(m).slice(0, MAX_TEXT), widget: m.widget },
  );
}

/**
 * The part of THIS chat sent to the AI provider with the next question: its
 * last few settled messages, as short text. Nothing from any other chat, and
 * no card data beyond one line of text.
 */
export function historyFor(messages: readonly ThreadMessage[]): { role: 'you' | 'opsy'; text: string }[] {
  return messages
    .filter((m) => !(m.from === 'opsy' && m.pending))
    .slice(-HISTORY_MESSAGES)
    .map((m) => ({ role: m.from, text: textOf(m).slice(0, HISTORY_TEXT_MAX) }))
    .filter((h) => h.text.trim() !== '');
}

/** A chat's title from its first question: one line, trimmed, cut on a word. */
export function titleFrom(question: string): string {
  const line = (question.trim().split(/\r\n|\r|\n/)[0] ?? '').replace(/\s+/g, ' ').trim();
  if (line === '') return DEFAULT_TITLE;
  if (line.length <= 60) return line;
  const cut = line.slice(0, 59);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/** Why a new title cannot be used, or undefined. */
export function titleProblem(title: string): string | undefined {
  const t = title.trim();
  if (t === '') return 'A chat needs a name.';
  if (Array.from(t).length > TITLE_MAX) return `At most ${TITLE_MAX} characters.`;
  return undefined;
}

// ---- Which chat is open ----

/**
 * `key` changes when the thread must start over (New chat, or another chat).
 * `chatId` is null for a new chat that has no message yet; the first message
 * creates it on the server (the key stays, so the thread does not reset).
 */
export interface Session { key: number; chatId: string | null }

export type SessionEvent =
  | { type: 'new' }
  | { type: 'open'; chatId: string }
  | { type: 'created'; chatId: string }
  | { type: 'deleted'; chatId: string };

export function nextSession(s: Session, e: SessionEvent): Session {
  switch (e.type) {
    case 'new': return { key: s.key + 1, chatId: null };
    case 'open': return s.chatId === e.chatId ? s : { key: s.key + 1, chatId: e.chatId };
    case 'created': return s.chatId === null ? { key: s.key, chatId: e.chatId } : s;
    case 'deleted': return s.chatId === e.chatId ? { key: s.key + 1, chatId: null } : s;
  }
}

// ---- Calls. Each never throws. ----

const chatPath = (id: string, tail = '') => `${CHATS_PATH}/${encodeURIComponent(id)}${tail}`;

export function listChats(token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<ChatInfo[]>> {
  return callApi({ token, action: 'chats', path: CHATS_PATH, method: 'GET', signal, fetchImpl, parse: parseChatList });
}

export function createChat(token: string, title: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<ChatInfo>> {
  return callApi({ token, action: 'chats', path: CHATS_PATH, method: 'POST', json: { title }, signal, fetchImpl, parse: parseOneChat });
}

export function renameChat(token: string, id: string, title: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<ChatInfo>> {
  return callApi({ token, action: 'chats', path: chatPath(id), method: 'PATCH', json: { title: title.trim() }, signal, fetchImpl, parse: parseOneChat });
}

export function deleteChat(token: string, id: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<true>> {
  return callApi({ token, action: 'chats', path: chatPath(id), method: 'DELETE', signal, fetchImpl, parse: () => true as const, empty: true });
}

export function loadMessages(token: string, id: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<ThreadMessage[]>> {
  return callApi({ token, action: 'chats', path: chatPath(id, '/messages'), method: 'GET', signal, fetchImpl, parse: restoreMessages });
}

export function saveMessages(
  token: string, id: string, messages: readonly ThreadMessage[], signal: AbortSignal, fetchImpl?: typeof fetch,
): Promise<ApiResult<ChatInfo>> {
  return callApi({
    token, action: 'chats', path: chatPath(id, '/messages'), method: 'PUT', json: { messages: toStored(messages) },
    signal, fetchImpl, parse: parseOneChat,
  });
}
