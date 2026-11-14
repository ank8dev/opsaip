// Why a call to the server failed, and what Opsy says about it. Pure: no
// React. Shared by the clients for tasks and Conductor runs (tasks.ts,
// conductor.ts). Texts never contain the token. The only server text allowed
// in is a 400's or a failed start's own reason, shown as plain text.

import type { TextWidget } from './types';

/** Where the README says how to turn Conductor mode on. */
export const CONDUCTOR_DOCS_URL = 'https://github.com/ank8dev/opsaip#conductor-mode-experimental';

export const CONDUCTOR_OFF_NOTE =
  'Conductor mode is off. To let Opsaip start Claude Code on your Mac, set OPSAIP_CONDUCTOR_DIR to the absolute ' +
  'path of a git repository on the server and restart it.';

export const CONDUCTOR_DOCS_LINK = { label: 'How to turn it on', href: CONDUCTOR_DOCS_URL } as const;

/** The server's own reason is cut to this many characters before it is shown. */
export const MAX_REASON_CHARS = 300;

export type Problem =
  | 'bad-request'    // 400: the server explains why (reason)
  | 'unauthorized'   // 401
  | 'too-large'      // 413
  | 'unsupported'    // 415
  | 'conductor-off'  // 503
  | 'busy'           // 409 on start: a run is already active
  | 'stale'          // 409 on a permission answer: already answered, or the run ended
  | 'ended'          // 409 on a follow-up or Stop: the run ended
  | 'not-found'      // 404: the server does not know that run
  | 'run-failed'     // 500 on start: the worktree or task could not be created (reason)
  | 'server-error'   // any other status
  | 'unreachable'    // network error, redirect, or aborted
  | 'bad-response';  // 2xx that does not match the contract

/** The calls this app makes. Each maps statuses to problems in its own way. */
export type Action = 'createTask' | 'conductor' | 'startRun' | 'getRun' | 'permission' | 'message' | 'cancel';

/** Status -> problem, per action. Any status not listed is a 'server-error'. */
export const STATUS_PROBLEM: Record<Action, Readonly<Record<number, Problem>>> = {
  createTask: { 400: 'bad-request', 401: 'unauthorized', 413: 'too-large', 415: 'unsupported' },
  conductor: { 401: 'unauthorized' },
  startRun: {
    400: 'bad-request', 401: 'unauthorized', 409: 'busy', 413: 'too-large', 415: 'unsupported',
    500: 'run-failed', 503: 'conductor-off',
  },
  getRun: { 401: 'unauthorized', 404: 'not-found', 503: 'conductor-off' },
  permission: {
    400: 'bad-request', 401: 'unauthorized', 404: 'not-found', 409: 'stale', 413: 'too-large', 415: 'unsupported',
    503: 'conductor-off',
  },
  message: {
    400: 'bad-request', 401: 'unauthorized', 404: 'not-found', 409: 'ended', 413: 'too-large', 415: 'unsupported',
    503: 'conductor-off',
  },
  cancel: { 401: 'unauthorized', 404: 'not-found', 409: 'ended', 503: 'conductor-off' },
};

export function problemFor(action: Action, status: number): Problem {
  return STATUS_PROBLEM[action][status] ?? 'server-error';
}

/** What Opsy says for each problem. A Record: a new Problem fails the build until it has a text. */
const PROBLEM_TEXT: Record<Problem, string> = {
  'bad-request': 'The server could not use that.',
  unauthorized: 'The server rejected the token. Open Settings, then Server, to reconnect.',
  'too-large': 'That is too long for the server to take. Try a shorter one.',
  unsupported: 'The server could not read what this page sent. Update the app and the server so they match.',
  'conductor-off': CONDUCTOR_OFF_NOTE,
  busy: 'A run is already active. Opsaip runs one at a time: wait for it to finish, or stop it.',
  stale: 'That request was already answered, or the run has ended.',
  ended: 'That run has already ended.',
  'not-found': 'The server no longer knows that run. It forgets runs when it restarts.',
  'run-failed': 'The run could not start.',
  'server-error': 'The server answered with an error. Try again in a moment.',
  unreachable: 'I could not reach the server. Check that it is running, then try again.',
  'bad-response': 'The server sent an answer this app does not understand.',
};

/** The server's `error` string, trimmed and cut, or undefined. Only ever shown as text. */
export function serverReason(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'string') return undefined;
  const text = error.trim();
  if (text === '') return undefined;
  return text.length > MAX_REASON_CHARS ? `${text.slice(0, MAX_REASON_CHARS - 1)}…` : text;
}

/** The sentence for a problem. A 400 and a failed start add the server's reason. */
export function problemText(problem: Problem, reason?: string): string {
  const base = PROBLEM_TEXT[problem];
  if (reason === undefined || (problem !== 'bad-request' && problem !== 'run-failed')) return base;
  return problem === 'bad-request' ? `The server could not use that: ${reason}` : `The run could not start: ${reason}`;
}

/** Opsy's message for a problem. Conductor off links to the README. */
export function problemReply(problem: Problem, reason?: string): TextWidget {
  const reply: TextWidget = { kind: 'text', text: problemText(problem, reason) };
  if (problem === 'conductor-off') reply.link = { ...CONDUCTOR_DOCS_LINK };
  return reply;
}
