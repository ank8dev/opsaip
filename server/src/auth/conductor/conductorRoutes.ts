// The HTTP endpoints of Conductor mode. app.ts mounts them behind the same
// access-token guard as every other /v1 path; nothing here checks the token.
//
//   GET  /v1/conductor                200 { enabled, agent: "claude-code", reason? }
//   POST /v1/runs                     { title, prompt } -> 201 { run } | 400 | 409 | 413 | 415 | 500 | 503
//   GET  /v1/runs/:id                 200 { run } | 404 | 503
//   POST /v1/runs/:id/permission      { allow, permissionId } -> 200 { run } | 400 | 404 | 409 | 413 | 415 | 503
//   POST /v1/runs/:id/message         { text } -> 200 { run } | 400 | 404 | 409 | 413 | 415 | 503
//   POST /v1/runs/:id/cancel          (no body) -> 200 { run } | 404 | 409 | 503
//
// 503: Conductor mode is off. 409: one run at a time, or the run is not in a
// state that accepts this (ended, no such pending request).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONDUCTOR_OFF } from './conductorConfig';
import { parseFollowUp, parseNewRun, parsePermissionAnswer } from './parseRun';
import { RUN_AGENT, type RunManager, type RunResult } from './runManager';

export type RouteHandler = (
  req: IncomingMessage,
  res: ServerResponse,
  params: Readonly<Record<string, string>>,
) => void | Promise<void>;

export interface ConductorRouteHelpers {
  /** undefined: Conductor mode is off. */
  manager: RunManager | undefined;
  /** app.ts's JSON body reader: sends 415, 413 or 400 itself and returns ok: false. */
  readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<{ ok: true; input: unknown } | { ok: false }>;
  sendJson(res: ServerResponse, status: number, body: unknown): void;
}

/** Route table entries, keyed by path pattern (":id" is one path segment). */
export function conductorRoutes({
  manager,
  readJsonBody,
  sendJson,
}: ConductorRouteHelpers): Record<string, Record<string, RouteHandler>> {
  const off = (res: ServerResponse): void => sendJson(res, 503, { error: CONDUCTOR_OFF });
  const send = (res: ServerResponse, result: RunResult, okStatus = 200): void => {
    if (result.ok) sendJson(res, okStatus, { run: result.run });
    else sendJson(res, result.status, { error: result.error });
  };

  return {
    '/v1/conductor': {
      GET: (_req, res) =>
        sendJson(
          res,
          200,
          manager === undefined
            ? { enabled: false, agent: RUN_AGENT, reason: CONDUCTOR_OFF }
            : { enabled: true, agent: RUN_AGENT },
        ),
    },
    '/v1/runs': {
      POST: async (req, res) => {
        // Checked first: no reason to read a body that cannot be used.
        if (manager === undefined) return off(res);
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const parsed = parseNewRun(body.input);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });
        send(res, await manager.start(parsed.value), 201);
      },
    },
    '/v1/runs/:id': {
      GET: (_req, res, { id }) => {
        if (manager === undefined) return off(res);
        const run = manager.get(id);
        if (run === undefined) return sendJson(res, 404, { error: 'run not found' });
        sendJson(res, 200, { run });
      },
    },
    '/v1/runs/:id/permission': {
      POST: async (req, res, { id }) => {
        if (manager === undefined) return off(res);
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const parsed = parsePermissionAnswer(body.input);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });
        send(res, manager.answerPermission(id, parsed.value.permissionId, parsed.value.allow));
      },
    },
    '/v1/runs/:id/message': {
      POST: async (req, res, { id }) => {
        if (manager === undefined) return off(res);
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const parsed = parseFollowUp(body.input);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });
        send(res, manager.sendMessage(id, parsed.value.text));
      },
    },
    '/v1/runs/:id/cancel': {
      // No body: the access token (an Authorization header, which a browser
      // cannot add to a cross-site request without a CORS preflight) is the guard.
      POST: (_req, res, { id }) => {
        if (manager === undefined) return off(res);
        send(res, manager.cancel(id));
      },
    },
  };
}
