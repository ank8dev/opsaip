// Where workspace data comes from. This is the one place that decides:
//
//   no saved connection -> the Connect screen. Demo (the sample team in
//                          ../mocks) exists only in dev and in tests: in a
//                          production build DEMO_ENABLED is false and the
//                          bundler removes the sample data;
//   a saved connection  -> Server: GET /v1/tasks on this page's own origin.
//
// API paths are always relative ("/v1/..."), never a host: in production the
// Opsaip server serves this app, in dev the Vite proxy forwards /v1, and the
// desktop app forwards app://opsaip/v1/* to the server.
//
// The token lives in sessionStorage: one tab only, gone when the tab closes.
// It is sent only in the Authorization header. It is never put in a URL,
// never logged, and never part of the build.

import type { Task, Workspace } from '../types';
import { mockWorkspace } from '../mocks';
import { parseTasksResponse, toUiTask } from './serverTasks';

export const TASKS_PATH = '/v1/tasks';

/** The sessionStorage key of the access token. */
export const TOKEN_KEY = 'opsaip.token';

/** A saved connection to the Opsaip server. */
export interface Connection {
  token: string;
}

/** The part of the Web Storage API used here; sessionStorage in the app, a fake in tests. */
export type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/**
 * True in dev (`npm run dev`) and in tests, false in a production build.
 * Vite replaces import.meta.env.DEV with a literal, so every `if (DEMO_ENABLED)`
 * branch, and the sample data behind it, is dropped from the production bundle.
 */
export const DEMO_ENABLED: boolean = import.meta.env.DEV;

/** The sample workspace for dev and tests. In production it is empty: users never see sample data. */
export function loadWorkspace(): Workspace {
  return DEMO_ENABLED ? mockWorkspace : serverWorkspace([]);
}

/** Where the README tells how to run and connect a server. */
export const README_URL = 'https://github.com/ank8dev/opsaip#run-the-server';

/** A workspace with only the server's tasks. Everything else is empty, not sample data. */
export function serverWorkspace(tasks: Task[]): Workspace {
  return {
    team: [], activity: tasks, clients: [], kit: [], installs: [], newcomers: [],
    memories: [], sessions: [], transcripts: [], mcp: [], repo: null, repoAccess: [],
    branches: [], members: [], channels: [], links: [], statusMap: [],
  };
}

// ---- Connection (the token) ----

/** Why `token` cannot be sent, or undefined if it can. Never contains the token. */
export function tokenProblem(token: string): string | undefined {
  if (token === '') return 'Paste the access token';
  // Visible ASCII, no spaces: what an HTTP header carries unchanged. fetch
  // would throw on other characters.
  if (!/^[\x21-\x7e]+$/.test(token)) return 'The token can only have visible ASCII characters, without spaces';
  return undefined;
}

/** The saved connection, or null for none. A blocked or broken storage counts as none. */
export function loadConnection(storage: KeyValueStore | undefined = sessionStore()): Connection | null {
  try {
    const token = storage?.getItem(TOKEN_KEY) ?? null;
    return token !== null && tokenProblem(token) === undefined ? { token } : null;
  } catch {
    return null;
  }
}

/**
 * Save the token for this tab. Returns the connection, or a problem to show.
 * Spaces around the token (from copy and paste) are removed. When storage is
 * blocked the connection still works until the page reloads.
 */
export function saveConnection(
  rawToken: string,
  storage: KeyValueStore | undefined = sessionStore(),
): { ok: true; connection: Connection } | { ok: false; problem: string } {
  const token = rawToken.trim();
  const problem = tokenProblem(token);
  if (problem !== undefined) return { ok: false, problem };
  try {
    storage?.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode or storage disabled: keep the connection in memory only.
  }
  return { ok: true, connection: { token } };
}

/** Forget the token: back to the Connect screen (Demo in dev). */
export function clearConnection(storage: KeyValueStore | undefined = sessionStore()): void {
  try {
    storage?.removeItem(TOKEN_KEY);
  } catch {
    // Nothing saved that we can reach.
  }
}

function sessionStore(): KeyValueStore | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined; // reading sessionStorage itself can throw when storage is blocked
  }
}

// ---- Server tasks ----

/** Why a request for tasks failed. Messages are safe to show: no token, no server details. */
export type FetchProblem = 'unauthorized' | 'unreachable' | 'server-error' | 'bad-response';

export type FetchTasksResult =
  | { ok: true; tasks: Task[]; skipped: number }
  | { ok: false; problem: FetchProblem };

/**
 * GET /v1/tasks with the token. Never throws: every failure is a FetchProblem.
 * An aborted request (timeout, stop) is "unreachable".
 */
export async function fetchTasks(
  token: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<FetchTasksResult> {
  let res: Response;
  try {
    res = await fetchImpl(TASKS_PATH, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
      signal,
      cache: 'no-store', // every poll must reach the server
      redirect: 'error', // a redirect means a misconfigured proxy; do not follow it with the token
    });
  } catch {
    return { ok: false, problem: 'unreachable' };
  }

  if (res.status === 401) return { ok: false, problem: 'unauthorized' };
  if (!res.ok) return { ok: false, problem: 'server-error' };

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    // Not JSON (an HTML page from a wrong proxy target, a cut-off body), or aborted while reading.
    return { ok: false, problem: signal.aborted ? 'unreachable' : 'bad-response' };
  }

  const parsed = parseTasksResponse(body);
  if (!parsed.ok) return { ok: false, problem: 'bad-response' };
  return { ok: true, tasks: parsed.tasks.map(toUiTask), skipped: parsed.skipped };
}
