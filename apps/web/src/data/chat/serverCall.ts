// One call to the Opsaip server, for the clients in tasks.ts and conductor.ts.
// Pure: no React. Never throws: every failure is a Problem. The token goes
// only in the Authorization header, like fetchTasks in ../source.ts.

import { problemFor, serverReason, type Action, type Problem } from './problems';

export type ApiResult<T> = { ok: true; value: T } | { ok: false; problem: Problem; reason?: string };

export interface CallOptions<T> {
  token: string;
  action: Action;
  path: string;
  method: 'GET' | 'POST';
  /** A JSON body. Without it no body and no content-type are sent. */
  json?: unknown;
  signal: AbortSignal;
  fetchImpl?: typeof fetch;
  /** Reads a 2xx body as untrusted input. undefined means it is not what the contract says. */
  parse: (body: unknown) => T | undefined;
}

export async function callApi<T>({
  token, action, path, method, json, signal, fetchImpl = globalThis.fetch, parse,
}: CallOptions<T>): Promise<ApiResult<T>> {
  const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: 'application/json' };
  if (json !== undefined) headers['content-type'] = 'application/json';

  let res: Response;
  try {
    res = await fetchImpl(path, {
      method,
      headers,
      ...(json === undefined ? {} : { body: JSON.stringify(json) }),
      signal,
      cache: 'no-store',
      redirect: 'error', // a redirect means a misconfigured proxy; do not follow it with the token
    });
  } catch {
    return { ok: false, problem: 'unreachable' };
  }

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined; // not JSON (an HTML page from a wrong proxy target, a cut-off body), or aborted while reading
  }

  if (!res.ok) {
    const problem = problemFor(action, res.status);
    const reason = problem === 'bad-request' || problem === 'run-failed' ? serverReason(body) : undefined;
    return reason === undefined ? { ok: false, problem } : { ok: false, problem, reason };
  }

  if (body === undefined) return { ok: false, problem: signal.aborted ? 'unreachable' : 'bad-response' };
  const value = parse(body);
  return value === undefined ? { ok: false, problem: 'bad-response' } : { ok: true, value };
}
