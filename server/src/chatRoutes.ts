// The chat routes (/v1/chats...). The access token is checked before routing
// (auth/requestGuard.ts), so every route here is already behind it.
// Chat content (titles, messages, widgets) is never logged.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { RouteHandler } from './auth/conductor/conductorRoutes';
import { DEFAULT_TITLE, parseMessages, parseTitle, type ChatStore } from './chatStore';

/** Largest body of PUT /v1/chats/:id/messages, in bytes (1 MB). */
export const MAX_MESSAGES_BODY_BYTES = 1024 * 1024;

export interface ChatRouteHelpers {
  store: ChatStore;
  readJsonBody(
    req: IncomingMessage,
    res: ServerResponse,
    limit?: number,
  ): Promise<{ ok: true; input: unknown } | { ok: false }>;
  sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void;
}

const NOT_FOUND = { error: 'chat not found' };

/**
 *   GET    /v1/chats                 200 { chats: [{ id, title, createdAt, updatedAt, messageCount }] }
 *   POST   /v1/chats                 { title? } -> 201 { chat } | 400 | 413 | 415
 *   PATCH  /v1/chats/:id             { title } -> 200 { chat } | 400 | 404 | 413 | 415
 *   DELETE /v1/chats/:id             204 | 404
 *   GET    /v1/chats/:id/messages    200 { messages: [{ id, role, text, widget, at }] } | 404
 *   PUT    /v1/chats/:id/messages    { messages: [{ role, text, widget? }] } replaces them
 *                                    -> 200 { chat } | 400 | 404 | 413 | 415
 */
export function chatRoutes({
  store,
  readJsonBody,
  sendJson,
}: ChatRouteHelpers): Record<string, Record<string, RouteHandler>> {
  return {
    '/v1/chats': {
      GET: (_req, res) => sendJson(res, 200, { chats: store.list() }),
      POST: async (req, res) => {
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const input = body.input;
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          return sendJson(res, 400, { error: 'body must be a JSON object' });
        }
        const raw = (input as { title?: unknown }).title;
        let title = DEFAULT_TITLE;
        if (raw !== undefined) {
          const parsed = parseTitle(raw);
          if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });
          title = parsed.value;
        }
        sendJson(res, 201, { chat: store.create(title) });
      },
    },
    '/v1/chats/:id': {
      PATCH: async (req, res, params) => {
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const input = body.input;
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          return sendJson(res, 400, { error: 'body must be a JSON object with a "title" string' });
        }
        const parsed = parseTitle((input as { title?: unknown }).title);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });
        const chat = store.rename(params.id, parsed.value);
        if (chat === undefined) return sendJson(res, 404, NOT_FOUND);
        sendJson(res, 200, { chat });
      },
      DELETE: (_req, res, params) => {
        if (!store.remove(params.id)) return sendJson(res, 404, NOT_FOUND);
        res.writeHead(204);
        res.end();
      },
    },
    '/v1/chats/:id/messages': {
      GET: (_req, res, params) => {
        const messages = store.messages(params.id);
        if (messages === undefined) return sendJson(res, 404, NOT_FOUND);
        sendJson(res, 200, { messages });
      },
      PUT: async (req, res, params) => {
        const body = await readJsonBody(req, res, MAX_MESSAGES_BODY_BYTES);
        if (!body.ok) return;
        const parsed = parseMessages(body.input);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });
        const chat = store.replaceMessages(params.id, parsed.value);
        if (chat === undefined) return sendJson(res, 404, NOT_FOUND);
        sendJson(res, 200, { chat });
      },
    },
  };
}
