import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { parseNewTask, parseReport, type TaskStore } from '@opsaip/core';
import { createAskService, NOT_CONFIGURED } from './ask';
import { tokenProblem } from './auth/accessToken';
import type { AskProvider } from './auth/askProvider';
import { conductorRoutes, type RouteHandler } from './auth/conductor/conductorRoutes';
import type { RunManager } from './auth/conductor/runManager';
import { createRequestGuard, webFileForPath } from './auth/requestGuard';
import { readWebFile } from './webFiles';

/** Largest request body accepted, in bytes (16 KB). */
export const MAX_BODY_BYTES = 16 * 1024;

export interface AppOptions {
  store: TaskStore;
  /** Access token. Every request except the public paths must send "Authorization: Bearer <token>". */
  token: string;
  /** The web app build (apps/web/dist). Without it, the web paths answer 404. */
  webDir?: string;
  /** The AI model for POST /v1/ask (from auth/llm.ts). Without it, /v1/ask answers 503. */
  ask?: AskProvider;
  /** How long the model may take before /v1/ask answers 504. Defaults to ASK_TIMEOUT_MS. */
  askTimeoutMs?: number;
  /**
   * Conductor mode runs (auth/conductor/runManager.ts). Without it, Conductor
   * mode is off: GET /v1/conductor says so and the /v1/runs paths answer 503.
   */
  conductor?: RunManager;
  /** Called for unexpected errors (they become 500). Defaults to console.error. */
  logError?: (message: string, error: unknown) => void;
  /** One line per /v1/ask request: status and counts only. Defaults to console.log. */
  log?: (line: string) => void;
}

type Handler = RouteHandler;

/** A path parameter: one segment, no decoding, no dots or slashes (run ids are UUIDs). */
const PATH_PARAM = /^[A-Za-z0-9_-]{1,100}$/;

/**
 * Create the HTTP server. It is not listening yet: call server.listen(port, host).
 *
 *   POST /v1/reports  JSON StatusReport -> 200 { task } | 400 | 409 | 413 | 415
 *   POST /v1/ask      { question } -> 200 { answer } | 400 | 413 | 415 | 429 | 502 | 503 | 504
 *   POST /v1/tasks    { title, agent? } -> 201 { task } | 400 | 409 | 413 | 415
 *   GET  /v1/tasks    200 { tasks }
 *   GET  /v1/conductor, POST /v1/runs, GET /v1/runs/:id[/transcript], POST /v1/runs/:id/{permission,message,cancel}:
 *                     Conductor mode, see auth/conductor/conductorRoutes.ts
 *   GET  /healthz     200 "ok"
 *   GET  /, /index.html, /favicon.svg, /assets/<file>: the web app (also HEAD)
 *
 * Errors are JSON: { "error": "<reason>" }. Unknown path -> 404, known path
 * with another method -> 405 with an Allow header. A route key may have
 * ":name" segments: each matches exactly one non-empty path segment of
 * PATH_PARAM characters, every other segment must be equal, and the segment
 * count must match. The raw path is used, never decoded.
 *
 * Which paths need the access token is decided in auth/requestGuard.ts:
 * all of them except /healthz and the web app files. It is checked first:
 * before routing (so a 404 does not reveal which paths exist) and before
 * reading the body. Missing or wrong token -> 401.
 */
export function createApp({
  store,
  token,
  webDir,
  ask,
  askTimeoutMs,
  conductor,
  logError = defaultLogError,
  log = defaultLog,
}: AppOptions): Server {
  // Same rule as loadConfig, so no caller can start a server with a weak token.
  const problem = tokenProblem(token);
  if (problem !== undefined) throw new TypeError(problem);
  const mayProceed = createRequestGuard(token);
  const answer =
    ask === undefined
      ? undefined
      : createAskService({ provider: ask, tasks: () => store.all(), log, timeoutMs: askTimeoutMs });
  const routes: Record<string, Record<string, Handler>> = {
    '/healthz': {
      GET: (_req, res) => sendText(res, 200, 'ok'),
    },
    '/v1/tasks': {
      GET: (_req, res) => sendJson(res, 200, { tasks: store.all() }),
      // A person creates a task: queued, source "you", id and time from the
      // server. Any other field in the body is ignored (see parseNewTask).
      POST: async (req, res) => {
        const body = await readJsonBody(req, res);
        if (!body.ok) return;

        const parsed = parseNewTask(body.input);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });

        const result = store.create({
          id: randomUUID(),
          ...parsed.task,
          createdAt: new Date().toISOString(),
          source: 'you',
        });
        // Only an id collision can get here (a random UUID: practically never).
        if (!result.ok) return sendJson(res, 409, { error: result.reason });

        sendJson(res, 201, { task: result.task });
      },
    },
    '/v1/reports': {
      POST: async (req, res) => {
        const body = await readJsonBody(req, res);
        if (!body.ok) return;

        const parsed = parseReport(body.input);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });

        const result = store.apply(parsed.report);
        if (!result.ok) return sendJson(res, 409, { error: result.reason });

        sendJson(res, 200, { task: result.task });
      },
    },
    '/v1/ask': {
      POST: async (req, res) => {
        // Checked first: no reason to read a body that cannot be answered.
        if (answer === undefined) return sendJson(res, 503, { error: NOT_CONFIGURED });

        const body = await readJsonBody(req, res);
        if (!body.ok) return;

        const outcome = await answer(body.input);
        sendJson(res, outcome.status, outcome.body, outcome.headers);
      },
    },
    ...conductorRoutes({ manager: conductor, readJsonBody, sendJson }),
  };

  /**
   * Read a JSON request body, or send the error response (415, 413 or 400)
   * and return ok: false.
   */
  async function readJsonBody(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<{ ok: true; input: unknown } | { ok: false }> {
    if (!isJsonContentType(req.headers['content-type'])) {
      // A browser can send a cross-site "simple" POST (text/plain, form)
      // without a CORS preflight. Requiring JSON blocks that.
      sendJson(res, 415, { error: 'content-type must be application/json' });
      return { ok: false };
    }

    const body = await readBody(req, MAX_BODY_BYTES);
    if (body === undefined) {
      // Close the connection: the rest of an oversized body is not read.
      sendJson(res, 413, { error: `body must be at most ${MAX_BODY_BYTES} bytes` }, {
        connection: 'close',
      });
      return { ok: false };
    }

    try {
      return { ok: true, input: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)) };
    } catch {
      sendJson(res, 400, { error: 'body must be valid JSON (UTF-8)' });
      return { ok: false };
    }
  }

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

    if (!mayProceed(path, req.headers.authorization)) {
      // Same answer for a missing and a wrong token. The body is not waited
      // for, and closing the connection stops reading the rest of it.
      return sendJson(res, 401, { error: 'missing or invalid access token' }, {
        'www-authenticate': 'Bearer',
        connection: 'close',
      });
    }

    const webFile = webFileForPath(path);
    if (webFile !== undefined) return sendWebFile(req, res, webFile);

    const route = matchRoute(routes, path);
    if (route === undefined) return sendJson(res, 404, { error: 'not found' });
    const { methods, params } = route;

    const method = req.method ?? '';
    const handler = Object.hasOwn(methods, method) ? methods[method] : undefined;
    if (handler === undefined) {
      return sendJson(res, 405, { error: 'method not allowed' }, {
        allow: Object.keys(methods).join(', '),
      });
    }
    await handler(req, res, params);
  }

  async function sendWebFile(req: IncomingMessage, res: ServerResponse, file: string): Promise<void> {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendJson(res, 405, { error: 'method not allowed' }, { allow: 'GET, HEAD' });
    }
    const found = webDir === undefined ? undefined : await readWebFile(webDir, file);
    if (found === undefined) return sendJson(res, 404, { error: 'not found' });
    res.writeHead(200, { ...found.headers, 'content-length': found.body.length });
    res.end(req.method === 'HEAD' ? undefined : found.body);
  }
}

/**
 * The route for a raw path and its parameters, or undefined. An exact key
 * wins; a key with ":name" segments matches as described at createApp. A
 * path that contains ":" never matches a pattern key literally.
 */
function matchRoute(
  routes: Record<string, Record<string, Handler>>,
  path: string,
): { methods: Record<string, Handler>; params: Record<string, string> } | undefined {
  if (!path.includes(':') && Object.hasOwn(routes, path)) return { methods: routes[path], params: {} };
  const segments = path.split('/');
  for (const [pattern, methods] of Object.entries(routes)) {
    if (!pattern.includes('/:')) continue;
    const parts = pattern.split('/');
    if (parts.length !== segments.length) continue;
    // No prototype: a parameter named like an Object method cannot clash.
    const params: Record<string, string> = Object.create(null);
    const matches = parts.every((part, i) => {
      if (!part.startsWith(':')) return part === segments[i];
      if (!PATH_PARAM.test(segments[i])) return false;
      params[part.slice(1)] = segments[i];
      return true;
    });
    if (matches) return { methods, params };
  }
  return undefined;
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

function defaultLog(line: string): void {
  console.log(line);
}
