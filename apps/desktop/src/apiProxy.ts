// app://opsaip/v1/* -> <serverUrl>/v1/*
//
// The web app calls the API on its own origin (/v1/...), with no CORS. In the
// desktop app that origin is app://opsaip, so the main process forwards these
// requests to the configured server. What crosses:
//   request:  method, path + query, body, and only the Authorization and
//             Content-Type headers (no cookies, no Origin, nothing added);
//   response: status, body and Content-Type only (no Set-Cookie).
// A redirect is an error: following it could send the token to another host.
import { APP_HOST, APP_SCHEME, isApiPath } from './appFiles.js';

export const FORWARDED_REQUEST_HEADERS = ['authorization', 'content-type'] as const;
export const FORWARDED_RESPONSE_HEADERS = ['content-type'] as const;
export const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
/** The server takes 16 KB; this only stops a runaway page from buffering a huge body. */
export const MAX_BODY_BYTES = 1024 * 1024;

/** What forwardApiRequest needs from fetch. In the app: a session's fetch (Chromium's network stack). */
export type FetchFn = (url: string, init: RequestInit) => Promise<Response>;

export type ApiPlan =
  | { ok: true; url: string; method: string; headers: Record<string, string> }
  | { ok: false; status: number; error: string };

/** Decide where an app://opsaip/v1/... request goes and with which headers. No I/O. */
export function planApiRequest(
  req: { url: string; method: string; headers: { get(name: string): string | null } },
  serverBase: string | null,
): ApiPlan {
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return { ok: false, status: 400, error: 'bad request URL' };
  }
  if (url.protocol !== `${APP_SCHEME}:` || url.host !== APP_HOST || !isApiPath(url.pathname)) {
    return { ok: false, status: 404, error: 'not found' };
  }
  if (serverBase === null) {
    return {
      ok: false,
      status: 503,
      error: 'No Opsaip server is set. Add "serverUrl" to config.json in the app data folder.',
    };
  }
  const method = req.method.toUpperCase();
  if (!(ALLOWED_METHODS as readonly string[]).includes(method)) {
    return { ok: false, status: 405, error: `method ${method} is not allowed` };
  }

  // "/v1/tasks?x" -> "<base>v1/tasks?x"; the base may carry a path prefix.
  const target = new URL(url.pathname.slice(1) + url.search, serverBase);
  if (!target.href.startsWith(serverBase)) {
    return { ok: false, status: 400, error: 'bad request path' };
  }

  const headers: Record<string, string> = {};
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  return { ok: true, url: target.href, method, headers };
}

/** Forward one API request and build the response for the page. Never throws. */
export async function forwardApiRequest(
  request: Request,
  serverBase: string | null,
  fetchFn: FetchFn,
): Promise<Response> {
  const plan = planApiRequest(request, serverBase);
  if (!plan.ok) return jsonError(plan.status, plan.error);

  let body: ArrayBuffer | undefined;
  if (plan.method !== 'GET' && plan.method !== 'HEAD') {
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return jsonError(413, 'request body is too large');
    body = await request.arrayBuffer();
    if (body.byteLength > MAX_BODY_BYTES) return jsonError(413, 'request body is too large');
  }

  let upstream: Response;
  try {
    upstream = await fetchFn(plan.url, {
      method: plan.method,
      headers: plan.headers,
      body,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
  } catch {
    // The cause is not passed on: a fetch error can quote request details.
    return jsonError(502, 'Could not reach the Opsaip server');
  }

  const headers: Record<string, string> = {};
  for (const name of FORWARDED_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value !== null) headers[name] = value;
  }
  const noBody = plan.method === 'HEAD' || [204, 205, 304].includes(upstream.status);
  return new Response(noBody ? null : upstream.body, { status: upstream.status, headers });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
