import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { parseReport, type TaskStore } from '@opsaip/core';
import { createTokenCheck, tokenProblem } from './accessToken';

/** Largest request body accepted, in bytes (16 KB). */
export const MAX_BODY_BYTES = 16 * 1024;

export interface AppOptions {
  store: TaskStore;
  /** Access token. Every request except /healthz must send "Authorization: Bearer <token>". */
  token: string;
  /** Called for unexpected errors (they become 500). Defaults to console.error. */
  logError?: (message: string, error: unknown) => void;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;

/**
 * Create the HTTP server. It is not listening yet: call server.listen(port, host).
 *
 *   POST /v1/reports  JSON StatusReport -> 200 { task } | 400 | 409 | 413 | 415
 *   GET  /v1/tasks    200 { tasks }
 *   GET  /healthz     200 "ok"
 *
 * Errors are JSON: { "error": "<reason>" }. Unknown path -> 404, known path
 * with another method -> 405 with an Allow header.
 *
 * Every path except /healthz needs the access token, checked first: before
 * routing (so a 404 does not reveal which paths exist) and before reading
 * the body. Missing or wrong token -> 401.
 */
export function createApp({ store, token, logError = defaultLogError }: AppOptions): Server {
  // Same rule as loadConfig, so no caller can start a server with a weak token.
  const problem = tokenProblem(token);
  if (problem !== undefined) throw new TypeError(problem);
  const isAuthorized = createTokenCheck(token);
  const routes: Record<string, Record<string, Handler>> = {
    '/healthz': {
      GET: (_req, res) => sendText(res, 200, 'ok'),
    },
    '/v1/tasks': {
      GET: (_req, res) => sendJson(res, 200, { tasks: store.all() }),
    },
    '/v1/reports': {
      POST: async (req, res) => {
        if (!isJsonContentType(req.headers['content-type'])) {
          // A browser can send a cross-site "simple" POST (text/plain, form)
          // without a CORS preflight. Requiring JSON blocks that.
          return sendJson(res, 415, { error: 'content-type must be application/json' });
        }

        const body = await readBody(req, MAX_BODY_BYTES);
        if (body === undefined) {
          // Close the connection: the rest of an oversized body is not read.
          return sendJson(res, 413, { error: `body must be at most ${MAX_BODY_BYTES} bytes` }, {
            connection: 'close',
          });
        }

        let input: unknown;
        try {
          input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body));
        } catch {
          return sendJson(res, 400, { error: 'body must be valid JSON (UTF-8)' });
        }

        const parsed = parseReport(input);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });

        const result = store.apply(parsed.report);
        if (!result.ok) return sendJson(res, 409, { error: result.reason });

        sendJson(res, 200, { task: result.task });
      },
    },
  };

  return createServer((req, res) => {
    handle(req, res).catch((error: unknown) => {
      logError('opsaip: unexpected error while handling a request', error);
      // The client gets no details: they could reveal internals.
      if (res.headersSent) res.destroy();
      else sendJson(res, 500, { error: 'internal error' });
    });
  });

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Path only, query string ignored. Not new URL(req.url, base): it reads
    // "//host/path" as another host, so "//x/v1/tasks" would route to /v1/tasks.
    const path = (req.url ?? '/').split('?', 1)[0];

    if (path !== '/healthz' && !isAuthorized(req.headers.authorization)) {
      // Same answer for a missing and a wrong token. The body is not waited
      // for, and closing the connection stops reading the rest of it.
      return sendJson(res, 401, { error: 'missing or invalid access token' }, {
        'www-authenticate': 'Bearer',
        connection: 'close',
      });
    }

    const methods = Object.hasOwn(routes, path) ? routes[path] : undefined;
    if (methods === undefined) return sendJson(res, 404, { error: 'not found' });

    const method = req.method ?? '';
    const handler = Object.hasOwn(methods, method) ? methods[method] : undefined;
    if (handler === undefined) {
      return sendJson(res, 405, { error: 'method not allowed' }, {
        allow: Object.keys(methods).join(', '),
      });
    }
    await handler(req, res);
  }
}

/** "application/json", any letter case, with or without parameters like charset. */
function isJsonContentType(header: string | undefined): boolean {
  return header?.split(';', 1)[0].trim().toLowerCase() === 'application/json';
}

/**
 * Read the whole body, or return undefined as soon as it is over `limit` bytes.
 * Both checks are needed: Content-Length can be absent (chunked transfer).
 */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > limit) {
      resolve(undefined);
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on('data', (chunk: Buffer) => {
      if (tooLarge) return; // keep draining, stop storing
      size += chunk.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        resolve(undefined);
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!tooLarge) resolve(Buffer.concat(chunks, size));
    });
    req.on('error', reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): void {
  send(res, status, 'application/json; charset=utf-8', JSON.stringify(body), headers);
}

function sendText(res: ServerResponse, status: number, text: string): void {
  send(res, status, 'text/plain; charset=utf-8', text, {});
}

function send(
  res: ServerResponse,
  status: number,
  contentType: string,
  text: string,
  headers: Record<string, string>,
): void {
  res.writeHead(status, {
    ...headers,
    'content-type': contentType,
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function defaultLogError(message: string, error: unknown): void {
  console.error(message, error);
}
