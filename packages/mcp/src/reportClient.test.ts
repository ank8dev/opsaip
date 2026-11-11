// The client against a fake HTTP server, for answers the real Opsaip server
// does not give on purpose (500, HTML, no answer, a redirect). The real
// server is used in e2e.test.ts.
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { StatusReport } from '@opsaip/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createReportClient } from './reportClient';

const TOKEN = 'client-test-token-0123456789abcdef0123';
const REPORT: StatusReport = { taskId: 't1', status: 'queued', at: '2026-11-01T10:00:00Z' };

let server: Server | undefined;
let requests: { headers: IncomingMessage['headers']; body: string }[] = [];

async function fakeServer(handler: (res: ServerResponse) => void): Promise<URL> {
  requests = [];
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk: Buffer) => (body += chunk.toString()));
    req.on('end', () => {
      requests.push({ headers: req.headers, body });
      handler(res);
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return new URL(`http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/reports`);
}

afterEach(async () => {
  if (server === undefined) return;
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  server = undefined;
});

function json(status: number, body: unknown): (res: ServerResponse) => void {
  return (res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  };
}

describe('createReportClient', () => {
  it('posts the report as JSON with the bearer token and returns the task', async () => {
    const task = { id: 't1', status: 'queued', updatedAt: REPORT.at };
    const reportsUrl = await fakeServer(json(200, { task }));
    const result = await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT);
    expect(result).toEqual({ ok: true, task });
    expect(requests).toHaveLength(1);
    expect(requests[0].headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(requests[0].headers['content-type']).toBe('application/json');
    expect(JSON.parse(requests[0].body)).toEqual(REPORT);
  });

  it.each([400, 409])('passes on the server reason for %i', async (status) => {
    const reportsUrl = await fakeServer(json(status, { error: 'transition not allowed: done -> running' }));
    expect(await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT)).toEqual({
      ok: false,
      message: 'the Opsaip server rejected the report: transition not allowed: done -> running',
    });
  });

  it('says to check OPSAIP_TOKEN on 401, without the token', async () => {
    const reportsUrl = await fakeServer(json(401, { error: 'missing or invalid access token' }));
    const result = await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain('check that OPSAIP_TOKEN');
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('names the status and reason of any other answer', async () => {
    const reportsUrl = await fakeServer(json(500, { error: 'internal error' }));
    const result = await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT);
    expect(result).toEqual({
      ok: false,
      message: `the Opsaip server at ${reportsUrl.href} answered HTTP 500: internal error`,
    });
  });

  it('handles a non-JSON answer (e.g. an HTML page from a proxy)', async () => {
    const reportsUrl = await fakeServer((res) => {
      res.writeHead(502, { 'content-type': 'text/html' });
      res.end('<html>Bad gateway</html>');
    });
    const result = await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT);
    expect(result).toEqual({ ok: false, message: `the Opsaip server at ${reportsUrl.href} answered HTTP 502` });
  });

  it('rejects a 200 answer without a task', async () => {
    const reportsUrl = await fakeServer(json(200, { ok: true }));
    const result = await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT);
    expect(result).toEqual({ ok: false, message: `the Opsaip server at ${reportsUrl.href} sent an unexpected answer` });
  });

  it('shortens a very long server reason', async () => {
    const reportsUrl = await fakeServer(json(409, { error: 'x'.repeat(10_000) }));
    const result = await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT);
    expect(!result.ok && result.message.length).toBeLessThan(600);
  });

  it('does not follow a redirect (the token must not travel elsewhere)', async () => {
    let redirected = false;
    const target = createServer((_req, res) => {
      redirected = true;
      res.end();
    });
    target.listen(0, '127.0.0.1');
    await once(target, 'listening');
    try {
      const elsewhere = `http://127.0.0.1:${(target.address() as AddressInfo).port}/`;
      const reportsUrl = await fakeServer((res) => {
        res.writeHead(307, { location: elsewhere });
        res.end();
      });
      const result = await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT);
      expect(result).toEqual({ ok: false, message: `the Opsaip server at ${reportsUrl.href} answered HTTP 307` });
      expect(redirected).toBe(false);
    } finally {
      target.close();
    }
  });

  it('gives up after the timeout when the server does not answer', async () => {
    const reportsUrl = await fakeServer(() => {
      // never answer
    });
    const result = await createReportClient({ reportsUrl, token: TOKEN, timeoutMs: 200 }).send(REPORT);
    expect(result).toEqual({
      ok: false,
      message: `the Opsaip server at ${reportsUrl.href} did not answer within 0.2 s`,
    });
  });

  it('says the server cannot be reached when nothing listens', async () => {
    // Listen, note the port, close: nothing listens there now.
    const reportsUrl = await fakeServer(() => {});
    server!.close();
    await once(server!, 'close');
    server = undefined;
    const result = await createReportClient({ reportsUrl, token: TOKEN }).send(REPORT);
    expect(result).toEqual({
      ok: false,
      message: `cannot reach the Opsaip server at ${reportsUrl.href} (ECONNREFUSED): is it running?`,
    });
  });
});
