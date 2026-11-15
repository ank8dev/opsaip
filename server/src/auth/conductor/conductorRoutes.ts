// The HTTP endpoints of Conductor mode. app.ts mounts them behind the same
// access-token guard as every other /v1 path; nothing here checks the token.
//
//   GET  /v1/conductor                200 { enabled, agent: "claude-code", reason? }; enabled means at least one
//                                     repository exists. When on, also { repos: [{ id, name, isDefault }]
//                                     (folder names only), active: <a run is active> }
//   GET  /v1/repos                    200 { repos: [{ id, name, path, isDefault }] } | 503
//   POST /v1/repos                    { path } -> 201 { repo } | 400 { error, code } (refused) | 409 | 413 | 415 | 503
//   DELETE /v1/repos/:id              204 | 404 | 409 (the default repository, or it has an active run) | 503
//                                     (never deletes files)
//   POST /v1/runs                     { title, prompt, repoId?, attachments? } -> 201 { run } | 400 | 404 | 409 | 413 | 415 | 500 | 503
//   GET  /v1/runs/:id                 200 { run } | 404 | 503
//   GET  /v1/runs/:id/transcript      200 { transcript: { entries: [{ id, role, kind, text, at, attachments? }], finished, canResume, truncated } } | 404 | 503
//   POST /v1/runs/:id/permission      { allow, permissionId } -> 200 { run } | 400 | 404 | 409 | 413 | 415 | 503
//   POST /v1/runs/:id/message         { text, attachments? } -> 200 { run } | 400 | 404 | 409 | 413 | 415 | 503
//                                     (to a finished run: resumes it, if canResume)
//   POST /v1/runs/:id/cancel          (no body) -> 200 { run } | 404 | 409 | 503
//
// attachments: ids from POST /v1/uploads?purpose=agent (auth/uploads); unknown or expired -> 400.
// 503: Conductor mode is off (no loopback host). 409: one run at a time, or the run is not in a
// state that accepts this (ended, no such pending request), or the repository
// failed its checks again just before the run.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { CONDUCTOR_OFF } from './conductorConfig';
import { parseFollowUp, parseNewRun, parsePermissionAnswer } from './parseRun';
import type { UploadStore } from '../uploads/uploadStore';
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
  /** Uploaded files for "attachments" (purpose agent). */
  uploads: UploadStore;
}

/** Route table entries, keyed by path pattern (":id" is one path segment). */
export function conductorRoutes({
  manager,
  readJsonBody,
  sendJson,
  uploads,
}: ConductorRouteHelpers): Record<string, Record<string, RouteHandler>> {
  const off = (res: ServerResponse): void => sendJson(res, 503, { error: CONDUCTOR_OFF });
  const send = (res: ServerResponse, result: RunResult, okStatus = 200): void => {
    if (result.ok) sendJson(res, okStatus, { run: result.run });
    else sendJson(res, result.status, { error: result.error });
  };

  return {
    '/v1/conductor': {
      GET: (_req, res) => {
        const repos = manager?.repos.list() ?? [];
        if (manager === undefined || repos.length === 0) {
          return sendJson(res, 200, { enabled: false, agent: RUN_AGENT, reason: CONDUCTOR_OFF });
        }
        sendJson(res, 200, {
          enabled: true,
          agent: RUN_AGENT,
          repos: repos.map(({ id, name, isDefault }) => ({ id, name, isDefault })),
          active: manager.active(),
        });
      },
    },
    '/v1/repos': {
      GET: (_req, res) => {
        if (manager === undefined) return off(res);
        sendJson(res, 200, { repos: manager.repos.list() });
      },
      POST: async (req, res) => {
        if (manager === undefined) return off(res);
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const input = body.input;
        const path = typeof input === 'object' && input !== null && !Array.isArray(input) ? (input as { path?: unknown }).path : undefined;
        if (typeof path !== 'string') return sendJson(res, 400, { error: 'path must be a string', code: 'invalid_path' });
        const added = manager.repos.add(path);
        if (!added.ok) return sendJson(res, added.status, { error: added.error, code: added.code });
        sendJson(res, 201, { repo: added.repo });
      },
    },
    '/v1/repos/:id': {
      DELETE: (_req, res, { id }) => {
        if (manager === undefined) return off(res);
        if (manager.repos.get(id) !== undefined && manager.activeRepoId() === id) {
          return sendJson(res, 409, { error: 'a run is active in this repository: stop it or wait until it has ended' });
        }
        const removed = manager.repos.remove(id);
        if (!removed.ok) return sendJson(res, removed.status, { error: removed.error });
        res.writeHead(204).end();
      },
    },
    '/v1/runs': {
      POST: async (req, res) => {
        // Checked first: no reason to read a body that cannot be used.
        if (manager === undefined) return off(res);
        const body = await readJsonBody(req, res);
        if (!body.ok) return;
        const parsed = parseNewRun(body.input);
        if (!parsed.ok) return sendJson(res, 400, { error: parsed.reason });
        const files = uploads.peek(parsed.value.attachments ?? [], 'agent');
        if (!files.ok) return sendJson(res, 400, { error: files.error });
        const result = await manager.start({ ...parsed.value, attachments: files.files });
        if (result.ok) uploads.consume(parsed.value.attachments ?? []); // saved in the worktree
        send(res, result, 201);
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
    '/v1/runs/:id/transcript': {
      GET: (_req, res, { id }) => {
        if (manager === undefined) return off(res);
        const transcript = manager.transcript(id);
        if (transcript === undefined) return sendJson(res, 404, { error: 'run not found' });
        sendJson(res, 200, { transcript });
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
        const files = uploads.peek(parsed.value.attachments ?? [], 'agent');
        if (!files.ok) return sendJson(res, 400, { error: files.error });
        const result = await manager.sendMessage(id, parsed.value.text, files.files);
        if (result.ok) uploads.consume(parsed.value.attachments ?? []);
        send(res, result);
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
