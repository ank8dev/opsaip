// Ask: POST /v1/ask, the server's AI answer about your tasks. Live mode only.
// Pure: no React. The token goes only in the Authorization header, like
// fetchTasks in ../source.ts, and is never part of a reply.
//
// The answer is written by a model from data agents sent. It is kept as a
// plain string and must be shown as text: never as HTML, never as Markdown.

import { RUN_PROMPT_MAX, RUN_TITLE_MAX } from './conductor';
import { TASK_TITLE_MAX } from './tasks';
import type { TextWidget } from './types';

export const ASK_PATH = '/v1/ask';

/** The server refuses longer questions (400). */
export const ASK_MAX_QUESTION = 1000;

/** Where the README says how to turn Ask on. */
export const ASK_DOCS_URL = 'https://github.com/ank8dev/opsaip#ask-optional';

export const ASK_SOURCE = 'From your server’s tasks, via Ask';

/** Why an Ask request failed. Safe to show: no token, no server details. */
export type AskProblem =
  | 'not-configured'  // 503
  | 'bad-question'    // 400
  | 'too-large'       // 413
  | 'rate-limited'    // 429
  | 'bad-gateway'     // 502
  | 'timeout'         // 504
  | 'unauthorized'    // 401
  | 'server-error'    // any other status
  | 'unreachable'     // network error, redirect, or aborted
  | 'bad-response';   // 200 without { answer: "..." }

/**
 * What the model proposed to do. The server has already validated it; the page
 * checks it again and shows it on a Proposed action card. It is never run
 * without Approve.
 */
export type AskAction =
  | { type: 'run'; agent: 'claude-code'; title: string; prompt: string }
  | { type: 'task'; title: string };

export type AskResult =
  | { ok: true; answer: string; action: AskAction | null }
  | { ok: false; problem: AskProblem; /** From a 429's Retry-After, whole seconds. */ retryAfter?: number };

const STATUS_PROBLEM: Record<number, AskProblem> = {
  400: 'bad-question',
  401: 'unauthorized',
  413: 'too-large',
  429: 'rate-limited',
  502: 'bad-gateway',
  503: 'not-configured',
  504: 'timeout',
};

/** Seconds from a Retry-After header, or undefined. Only the plain-seconds form; a date is ignored. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (value === null || !/^\s*\d{1,6}\s*$/.test(value)) return undefined;
  return Number(value);
}

/**
 * Ask the server a question. Never throws: every failure is an AskProblem.
 * An aborted request (timeout, closing the page) is "unreachable".
 */
export async function askQuestion(
  token: string,
  question: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<AskResult> {
  let res: Response;
  try {
    res = await fetchImpl(ASK_PATH, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ question }),
      signal,
      cache: 'no-store',
      redirect: 'error', // a redirect means a misconfigured proxy; do not follow it with the token
    });
  } catch {
    return { ok: false, problem: 'unreachable' };
  }

  if (!res.ok) {
    const problem = STATUS_PROBLEM[res.status] ?? 'server-error';
    if (problem === 'rate-limited') {
      const retryAfter = parseRetryAfter(res.headers.get('retry-after'));
      return retryAfter === undefined ? { ok: false, problem } : { ok: false, problem, retryAfter };
    }
    return { ok: false, problem };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return { ok: false, problem: signal.aborted ? 'unreachable' : 'bad-response' };
  }
  const record = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as { answer?: unknown; action?: unknown }) : undefined;
  const answer = record?.answer;
  if (typeof answer !== 'string' || answer.trim() === '') return { ok: false, problem: 'bad-response' };
  return { ok: true, answer, action: parseAskAction(record?.action) };
}

/**
 * The action from a 200 body, or null. Anything that is not exactly a run for
 * Claude Code or a task, with a title (and prompt) the server would accept,
 * is null: the answer is still shown, no card. Extra fields are dropped.
 */
export function parseAskAction(value: unknown): AskAction | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const a = value as { type?: unknown; agent?: unknown; title?: unknown; prompt?: unknown };
  if (typeof a.title !== 'string' || a.title.trim() === '') return null;
  if (a.type === 'task') {
    return a.title.length <= TASK_TITLE_MAX ? { type: 'task', title: a.title } : null;
  }
  if (a.type === 'run') {
    if (a.agent !== 'claude-code') return null;
    if (a.title.length > RUN_TITLE_MAX) return null;
    if (typeof a.prompt !== 'string' || a.prompt.trim() === '' || a.prompt.length > RUN_PROMPT_MAX) return null;
    return { type: 'run', agent: 'claude-code', title: a.title, prompt: a.prompt };
  }
  return null;
}

/** What Opsy says for each failure. A Record: a new AskProblem fails the build until it has a text. */
const PROBLEM_TEXT: Record<AskProblem, string> = {
  'not-configured': 'Ask is not set up on your server yet.',
  'bad-question': 'The server could not use that question. Try a shorter, plainer one.',
  'too-large': 'That question is too long. Try a shorter one.',
  'rate-limited': 'Ask is getting too many questions right now.',
  'bad-gateway': 'The AI service behind Ask did not give a usable answer. Try again in a moment.',
  timeout: 'The AI service took too long to answer. Try again in a moment.',
  unauthorized: 'The server rejected the token. Open Settings, then Server, to reconnect.',
  'server-error': 'The server answered with an error. Try again in a moment.',
  unreachable: 'I could not reach the server. Check that it is running, then try again.',
  'bad-response': 'The server sent an answer this app does not understand.',
};

/** Opsy's message for a failed Ask. 503 links to the README's Ask section. */
export function askProblemReply(problem: AskProblem, retryAfter?: number): TextWidget {
  let message = PROBLEM_TEXT[problem];
  if (problem === 'rate-limited' && retryAfter !== undefined) {
    message += ` Try again in ${retryAfter} ${retryAfter === 1 ? 'second' : 'seconds'}.`;
  } else if (problem === 'rate-limited') {
    message += ' Try again in a minute.';
  }
  const reply: TextWidget = { kind: 'text', text: message };
  if (problem === 'not-configured') reply.link = { label: 'How to turn Ask on', href: ASK_DOCS_URL };
  return reply;
}

/** Opsy's message for a result: the answer as plain text with its source line, or the problem. */
export function askReply(result: AskResult): TextWidget {
  if (!result.ok) return askProblemReply(result.problem, result.retryAfter);
  return { kind: 'text', text: result.answer, source: ASK_SOURCE };
}
