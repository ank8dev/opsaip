import { describe, expect, it, vi } from 'vitest';
import { MAX_BODY_BYTES, forwardApiRequest, planApiRequest, type FetchFn } from './apiProxy.js';

const BASE = 'https://opsaip.example.com/';
const TOKEN = 'Bearer ' + 'a'.repeat(64);

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`app://opsaip${path}`, init);
}

/** A fake server: records what it was sent, answers with `reply`. */
function fakeFetch(reply: () => Response = () => Response.json({ tasks: [] })) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn: FetchFn = vi.fn(async (url, init) => {
    calls.push({ url, init });
    return reply();
  });
  return { fn, calls };
}

describe('planApiRequest', () => {
  const plan = (path: string, base: string | null = BASE, method = 'GET', headers: HeadersInit = {}) =>
    planApiRequest(req(path, { method, headers }), base);

  it('maps app://opsaip/v1/... to the same path and query on the server', () => {
    expect(plan('/v1/tasks?since=2026-11-10')).toMatchObject({
      ok: true,
      url: 'https://opsaip.example.com/v1/tasks?since=2026-11-10',
      method: 'GET',
    });
    expect(plan('/v1')).toMatchObject({ ok: true, url: 'https://opsaip.example.com/v1' });
  });

  it('keeps a path prefix from serverUrl (a reverse proxy)', () => {
    expect(plan('/v1/tasks', 'https://host.example/opsaip/')).toMatchObject({
      ok: true,
      url: 'https://host.example/opsaip/v1/tasks',
    });
  });

  it('only handles /v1 and below', () => {
    for (const path of ['/', '/index.html', '/v1x', '/v10/tasks', '/assets/v1/x']) {
      expect(plan(path)).toMatchObject({ ok: false, status: 404 });
    }
  });

  it('only handles the app origin', () => {
    expect(planApiRequest(new Request('app://other/v1/tasks'), BASE)).toMatchObject({ ok: false, status: 404 });
    expect(planApiRequest(new Request('https://opsaip.example.com/v1/tasks'), BASE)).toMatchObject({
      ok: false,
      status: 404,
    });
  });

  it('cannot leave the server: dot segments and double slashes stay on it', () => {
    for (const path of ['/v1/../../etc/passwd', '/v1/%2e%2e/%2e%2e/x', '/v1//evil.example/x', '/v1/@evil.example']) {
      const p = plan(path, 'https://host.example/opsaip/');
      if (p.ok) expect(p.url.startsWith('https://host.example/opsaip/')).toBe(true);
    }
    // The URL parser removes ".." before we see it, so this is no longer under /v1.
    expect(plan('/v1/../index.html')).toMatchObject({ ok: false, status: 404 });
  });

  it('answers 503 with a fix when no server is set', () => {
    const p = plan('/v1/tasks', null);
    expect(p).toMatchObject({ ok: false, status: 503 });
    expect(!p.ok && p.error).toContain('serverUrl');
  });

  it('allows the usual methods and refuses others', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(plan('/v1/tasks', BASE, method)).toMatchObject({ ok: true, method });
    }
    expect(plan('/v1/tasks', BASE, 'OPTIONS')).toMatchObject({ ok: false, status: 405 });
  });

  it('passes Authorization and Content-Type through and nothing else', () => {
    const p = plan('/v1/reports', BASE, 'POST', {
      Authorization: TOKEN,
      'Content-Type': 'application/json',
      Cookie: 'sid=1',
      Origin: 'app://opsaip',
      'X-Forwarded-For': '10.0.0.1',
      Accept: 'application/json',
    });
    expect(p).toMatchObject({ ok: true, headers: { authorization: TOKEN, 'content-type': 'application/json' } });
    expect(p.ok && Object.keys(p.headers).sort()).toEqual(['authorization', 'content-type']);
  });

  it('adds no header that the page did not send', () => {
    expect(plan('/v1/tasks')).toMatchObject({ ok: true, headers: {} });
  });
});

describe('forwardApiRequest', () => {
  it('sends method, URL, the two headers and the body; never follows redirects or sends cookies', async () => {
    const server = fakeFetch();
    const body = JSON.stringify({ taskId: 't1', status: 'queued', at: '2026-11-10T16:00:00Z' });
    await forwardApiRequest(
      req('/v1/reports', {
        method: 'POST',
        headers: { authorization: TOKEN, 'content-type': 'application/json', cookie: 'sid=1' },
        body,
      }),
      BASE,
      server.fn,
    );
    expect(server.calls).toHaveLength(1);
    const { url, init } = server.calls[0]!;
    expect(url).toBe('https://opsaip.example.com/v1/reports');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ authorization: TOKEN, 'content-type': 'application/json' });
    expect(new TextDecoder().decode(init.body as ArrayBuffer)).toBe(body);
    expect(init.redirect).toBe('error');
    expect(init.credentials).toBe('omit');
  });

  it('sends no body with GET', async () => {
    const server = fakeFetch();
    await forwardApiRequest(req('/v1/tasks', { headers: { authorization: TOKEN } }), BASE, server.fn);
    expect(server.calls[0]!.init.body).toBeUndefined();
  });

  it('returns the server status, body and Content-Type, and drops other headers', async () => {
    const server = fakeFetch(
      () =>
        new Response('{"error":"unauthorized"}', {
          status: 401,
          headers: { 'content-type': 'application/json', 'set-cookie': 'sid=2', 'x-powered-by': 'x' },
        }),
    );
    const res = await forwardApiRequest(req('/v1/tasks'), BASE, server.fn);
    expect(res.status).toBe(401);
    expect(await res.text()).toBe('{"error":"unauthorized"}');
    expect([...res.headers.keys()]).toEqual(['content-type']);
  });

  it('handles empty responses (204, HEAD)', async () => {
    const empty = fakeFetch(() => new Response(null, { status: 204 }));
    expect((await forwardApiRequest(req('/v1/x', { method: 'DELETE' }), BASE, empty.fn)).status).toBe(204);
    const head = fakeFetch(() => new Response('ignored', { status: 200 }));
    const res = await forwardApiRequest(req('/v1/tasks', { method: 'HEAD' }), BASE, head.fn);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
  });

  it('answers 502 without details when the server cannot be reached or redirects', async () => {
    const failing: FetchFn = async () => {
      throw new Error(`net::ERR_CONNECTION_REFUSED ${TOKEN}`);
    };
    const res = await forwardApiRequest(req('/v1/tasks', { headers: { authorization: TOKEN } }), BASE, failing);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'Could not reach the Opsaip server' });
    expect(text).not.toContain('a'.repeat(64));
  });

  it('refuses bodies over the limit without calling the server', async () => {
    const server = fakeFetch();
    const res = await forwardApiRequest(
      req('/v1/reports', { method: 'POST', body: new Uint8Array(MAX_BODY_BYTES + 1) }),
      BASE,
      server.fn,
    );
    expect(res.status).toBe(413);
    expect(server.calls).toHaveLength(0);
  });

  it('returns plan errors as JSON without calling the server', async () => {
    const server = fakeFetch();
    const res = await forwardApiRequest(req('/v1/tasks'), null, server.fn);
    expect(res.status).toBe(503);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect((await res.json()) as unknown).toHaveProperty('error');
    expect(server.calls).toHaveLength(0);
  });
});
