// Conductor mode from the page: GET /v1/conductor, and the runs under
// /v1/runs. Live mode only. Pure: no React. The server contract is in
// server/src/auth/conductor/conductorRoutes.ts.
//
// Everything the agent writes (lastMessage, a permission's tool and summary)
// is untrusted text. It is kept as a plain string, cut to the server's own
// limits, and must be shown as text: never as HTML, never as Markdown.

import type { AgentTaskStatus } from '@opsaip/core';
import { STATUS_LABEL } from '../serverTasks';
import { CONDUCTOR_DOCS_LINK, CONDUCTOR_OFF_NOTE, MAX_REASON_CHARS, type Problem } from './problems';
import { callApi, type ApiResult } from './serverCall';

export const CONDUCTOR_PATH = '/v1/conductor';
export const RUNS_PATH = '/v1/runs';

/** The server's limit on a run's title, in UTF-16 code units (String.length). */
export const RUN_TITLE_MAX = 200;
/** The server's limit on a prompt or a follow-up, in UTF-16 code units. */
export const RUN_PROMPT_MAX = 12_000;
/** Limits the server applies to what the agent sends; the page cuts to the same, to be safe. */
const MAX_LAST_MESSAGE = 2000;
const MAX_SUMMARY = 300;
const MAX_TOOL = 100;

// ---- What the page sends ----

/**
 * The run's title from what you typed: the first line, trimmed, at most
 * RUN_TITLE_MAX characters. A longer line is cut on a character boundary (a
 * pair of UTF-16 units such as an emoji is never split) and ends with "…", and
 * the whole title, "…" included, still fits the server's limit.
 */
export function runTitleFrom(text: string): string {
  const line = (text.trim().split(/\r\n|\r|\n/)[0] ?? '').trim();
  if (line.length <= RUN_TITLE_MAX) return line;
  let end = RUN_TITLE_MAX - 1; // room for "…"
  const last = line.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1; // do not cut between the halves of a pair
  return `${line.slice(0, end).trimEnd()}…`;
}

/** Why `text` cannot be sent as a prompt or a follow-up, or undefined if it can. */
export function promptProblem(text: string): string | undefined {
  if (text.trim() === '') return 'write what the agent should do.';
  if (text.length > RUN_PROMPT_MAX) return `a prompt is at most ${RUN_PROMPT_MAX} characters.`;
  return undefined;
}

// ---- What the server sends ----

/**
 * GET /v1/conductor. When on: `repo` is the folder name of the repository runs work in
 * (never a path) and `active` says whether a run is active now. Older servers send neither.
 */
export type ConductorStatus = { enabled: true; repo?: string; active?: boolean } | { enabled: false; reason?: string };

/** The longest repo name kept for display. */
const MAX_REPO_CHARS = 200;

export interface RunPermission {
  id: string;
  /** The tool the agent wants to use ("Bash"). From the agent: show as text. */
  tool: string;
  /** What it would do. From the agent: show as text. */
  summary: string;
}

/** A run as GET /v1/runs/:id returns it, checked. The worktree folder is not kept: nothing here needs it. */
export interface Run {
  id: string;
  /** The task that tracks this run, in GET /v1/tasks. */
  taskId: string;
  status: AgentTaskStatus;
  branch: string;
  /** The oldest request waiting for your answer. */
  permission?: RunPermission;
  /** The agent's latest text, then its final answer. From the agent: show as text. */
  lastMessage?: string;
}

/** Not done and not failed: the run can still need polling, a follow-up or a Stop. */
export function isRunActive(status: AgentTaskStatus): boolean {
  return status !== 'done' && status !== 'failed';
}

export function parseConductorStatus(body: unknown): ConductorStatus | undefined {
  if (!isRecord(body) || typeof body.enabled !== 'boolean') return undefined;
  if (body.enabled) {
    const status: { enabled: true; repo?: string; active?: boolean } = { enabled: true };
    if (typeof body.repo === 'string' && body.repo.trim() !== '') status.repo = body.repo.trim().slice(0, MAX_REPO_CHARS);
    if (typeof body.active === 'boolean') status.active = body.active;
    return status;
  }
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  return reason === '' ? { enabled: false } : { enabled: false, reason: reason.slice(0, MAX_REASON_CHARS) };
}

/** Read `{ run }` from a 2xx body. undefined if it is not one. Extra fields are ignored. */
export function parseRunResponse(body: unknown): Run | undefined {
  if (!isRecord(body) || !isRecord(body.run)) return undefined;
  const { id, taskId, status, branch, permission, lastMessage } = body.run;
  if (typeof id !== 'string' || id.trim() === '') return undefined;
  if (typeof taskId !== 'string' || typeof branch !== 'string') return undefined;
  // hasOwn, not `in`: "toString" must not count as a status.
  if (typeof status !== 'string' || !Object.hasOwn(STATUS_LABEL, status)) return undefined;

  const run: Run = { id, taskId, status: status as AgentTaskStatus, branch };
  if (permission !== undefined) {
    if (!isRecord(permission)) return undefined;
    const { id: pid, tool, summary } = permission;
    if (typeof pid !== 'string' || pid.trim() === '' || typeof tool !== 'string' || typeof summary !== 'string') return undefined;
    run.permission = { id: pid, tool: tool.slice(0, MAX_TOOL), summary: summary.slice(0, MAX_SUMMARY) };
  }
  if (lastMessage !== undefined) {
    if (typeof lastMessage !== 'string') return undefined;
    run.lastMessage = lastMessage.slice(0, MAX_LAST_MESSAGE);
  }
  return run;
}

// ---- Clients. Each never throws. ----

const runPath = (id: string, tail = '') => `${RUNS_PATH}/${encodeURIComponent(id)}${tail}`;

/** GET /v1/conductor: is Conductor mode on? */
export function fetchConductorStatus(token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<ConductorStatus>> {
  return callApi({ token, action: 'conductor', path: CONDUCTOR_PATH, method: 'GET', signal, fetchImpl, parse: parseConductorStatus });
}

/** POST /v1/runs: the title is the first line of `text`, the prompt is all of it. */
export function startRun(token: string, text: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<Run>> {
  return startRunExact(token, { title: runTitleFrom(text), prompt: text }, signal, fetchImpl);
}

/**
 * POST /v1/runs with exactly this title and prompt, unchanged: what a Proposed
 * action card shows is what is sent. A title or prompt the server would refuse
 * is a 'bad-request' without a request.
 */
export async function startRunExact(
  token: string, run: { title: string; prompt: string }, signal: AbortSignal, fetchImpl?: typeof fetch,
): Promise<ApiResult<Run>> {
  const problem = promptProblem(run.prompt);
  if (problem !== undefined) return { ok: false, problem: 'bad-request', reason: problem };
  if (run.title.trim() === '' || run.title.length > RUN_TITLE_MAX) {
    return { ok: false, problem: 'bad-request', reason: `a title is 1 to ${RUN_TITLE_MAX} characters.` };
  }
  return callApi({
    token, action: 'startRun', path: RUNS_PATH, method: 'POST', json: { title: run.title, prompt: run.prompt },
    signal, fetchImpl, parse: parseRunResponse,
  });
}

/** GET /v1/runs/:id */
export function fetchRun(token: string, id: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<Run>> {
  return callApi({ token, action: 'getRun', path: runPath(id), method: 'GET', signal, fetchImpl, parse: parseRunResponse });
}

/** POST /v1/runs/:id/permission. A 409 is the problem 'stale'. */
export function answerPermission(
  token: string, id: string, permissionId: string, allow: boolean, signal: AbortSignal, fetchImpl?: typeof fetch,
): Promise<ApiResult<Run>> {
  return callApi({
    token, action: 'permission', path: runPath(id, '/permission'), method: 'POST', json: { allow, permissionId },
    signal, fetchImpl, parse: parseRunResponse,
  });
}

/** POST /v1/runs/:id/message: a follow-up while the run is active. A 409 is the problem 'ended'. */
export async function sendFollowUp(token: string, id: string, text: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<Run>> {
  const problem = promptProblem(text);
  if (problem !== undefined) return { ok: false, problem: 'bad-request', reason: problem };
  return callApi({
    token, action: 'message', path: runPath(id, '/message'), method: 'POST', json: { text }, signal, fetchImpl, parse: parseRunResponse,
  });
}

/** POST /v1/runs/:id/cancel (no body). A 409 is the problem 'ended'. */
export function cancelRun(token: string, id: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<Run>> {
  return callApi({ token, action: 'cancel', path: runPath(id, '/cancel'), method: 'POST', signal, fetchImpl, parse: parseRunResponse });
}

// ---- Conductor mode on or off, as the composer shows it ----

/** unknown: not asked yet. failed: the check itself failed (not the same as off). */
export type ConductorState =
  | { state: 'unknown' }
  | { state: 'checking' }
  | { state: 'on' }
  | { state: 'off'; reason?: string }
  | { state: 'failed'; problem: Problem };

export function conductorStateFrom(result: ApiResult<ConductorStatus>): ConductorState {
  if (!result.ok) return { state: 'failed', problem: result.problem };
  return result.value.enabled ? { state: 'on' } : result.value.reason === undefined ? { state: 'off' } : { state: 'off', reason: result.value.reason };
}

/** What the composer shows in Agent mode while Conductor mode is off: plain text and one link. */
export function conductorOffNote(reason?: string): { text: string; reason?: string; link: { label: string; href: string } } {
  return { text: CONDUCTOR_OFF_NOTE, ...(reason === undefined ? {} : { reason }), link: { ...CONDUCTOR_DOCS_LINK } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
