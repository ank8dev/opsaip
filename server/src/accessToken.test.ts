import { once } from 'node:events';
import { request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTaskStore } from '@opsaip/core';
import { afterEach, describe, expect, it } from 'vitest';
import { createTokenCheck, MIN_TOKEN_LENGTH, tokenProblem } from './accessToken';
import { createApp } from './app';

const TOKEN = '3f9c2a7b1e8d4c6a9b0e5f2d7c1a8b3e6d9f0c4a7b2e5d8c1f3a6b9e0d2c5f8a';

describe('tokenProblem', () => {
  it('accepts 32 or more visible ASCII characters', () => {
    expect(MIN_TOKEN_LENGTH).toBe(32);
    expect(tokenProblem('x'.repeat(32))).toBeUndefined();
    expect(tokenProblem(TOKEN)).toBeUndefined();
  });

  it('rejects shorter tokens and tokens with spaces or non-ASCII characters', () => {
    expect(tokenProblem('x'.repeat(31))).toBe('OPSAIP_TOKEN must be at least 32 characters long');
    expect(tokenProblem(`${'x'.repeat(32)} x`)).toMatch(/visible ASCII/);
    expect(tokenProblem(`${'x'.repeat(32)}ü`)).toMatch(/visible ASCII/);
  });
});

describe('createTokenCheck', () => {
  const check = createTokenCheck(TOKEN);

  it.each([
    `Bearer ${TOKEN}`,
    `bearer ${TOKEN}`, // the scheme name is case-insensitive (RFC 7235)
    `BEARER ${TOKEN}`,
    `Bearer   ${TOKEN}`, // one or more spaces after the scheme
  ])('accepts %j', (header) => {
    expect(check(header)).toBe(true);
  });

  it.each([
    ['no header', undefined],
    ['an empty header', ''],
    ['the scheme alone', 'Bearer'],
    ['the scheme and a space', 'Bearer '],
    ['the token without a scheme', TOKEN],
    ['another scheme', `Basic ${TOKEN}`],
    ['the "Token" scheme', `Token ${TOKEN}`],
    ['a tab instead of a space', `Bearer\t${TOKEN}`],
    ['a wrong token of the same length', `Bearer ${'0'.repeat(TOKEN.length)}`],
    ['the token in upper case (tokens are case-sensitive)', `Bearer ${TOKEN.toUpperCase()}`],
    ['the token minus its last character', `Bearer ${TOKEN.slice(0, -1)}`],
    ['the token plus one character', `Bearer ${TOKEN}0`],
    ['a prefix of the token', `Bearer ${TOKEN.slice(0, 8)}`],
    ['the token followed by more text', `Bearer ${TOKEN} extra`],
    ['two tokens', `Bearer ${TOKEN}, Bearer ${TOKEN}`],
  ])('rejects %s', (_name, header) => {
    expect(check(header)).toBe(false);
  });

  it('only accepts its own token', () => {
    const other = createTokenCheck('o'.repeat(64));
    expect(other(`Bearer ${TOKEN}`)).toBe(false);
    expect(other(`Bearer ${'o'.repeat(64)}`)).toBe(true);
  });
});

describe('HTTP: every request except /healthz needs the token', () => {
  let server: Server | undefined;
  let base = '';

  async function start(): Promise<void> {
    server = createApp({ store: createTaskStore(), token: TOKEN });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  afterEach(async () => {
    if (server === undefined) return;
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
    server = undefined;
  });

  const AUTH = { authorization: `Bearer ${TOKEN}` };
  const WRONG = { authorization: `Bearer ${'0'.repeat(TOKEN.length)}` };
  const REPORT = JSON.stringify({ taskId: 't1', status: 'queued', at: '2026-11-01T10:00:00Z' });

  async function expect401(res: Response): Promise<void> {
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(res.headers.get('connection')).toBe('close');
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ error: 'missing or invalid access token' });
    expect(text).not.toContain(TOKEN);
  }

  it('/healthz is open: no token, a wrong token, or another method all skip the check', async () => {
    await start();
    expect((await fetch(`${base}/healthz`)).status).toBe(200);
    expect((await fetch(`${base}/healthz`, { headers: WRONG })).status).toBe(200);
    expect((await fetch(`${base}/healthz?x=1`)).status).toBe(200);
    expect((await fetch(`${base}/healthz`, { method: 'POST' })).status).toBe(405);
  });

  it('only the exact path /healthz is open, not paths that start with it', async () => {
    await start();
    await expect401(await fetch(`${base}/healthz/x`));
    await expect401(await fetch(`${base}/healthzz`));
    await expect401(await fetch(`${base}/HEALTHZ`));
  });

  it('GET /v1/tasks: 401 without a token or with a wrong one, 200 with the right one', async () => {
    await start();
    await expect401(await fetch(`${base}/v1/tasks`));
    await expect401(await fetch(`${base}/v1/tasks`, { headers: WRONG }));
    await expect401(await fetch(`${base}/v1/tasks`, { headers: { authorization: `Basic ${TOKEN}` } }));
    expect((await fetch(`${base}/v1/tasks`, { headers: AUTH })).status).toBe(200);
  });

  it('POST /v1/reports: 401 without the token, and nothing is stored', async () => {
    await start();
    const json = { 'content-type': 'application/json' };
    await expect401(await fetch(`${base}/v1/reports`, { method: 'POST', headers: json, body: REPORT }));
    await expect401(
      await fetch(`${base}/v1/reports`, { method: 'POST', headers: { ...json, ...WRONG }, body: REPORT }),
    );
    const res = await fetch(`${base}/v1/tasks`, { headers: AUTH });
    expect(await res.json()).toEqual({ tasks: [] });

    const ok = await fetch(`${base}/v1/reports`, {
      method: 'POST',
      headers: { ...json, ...AUTH },
      body: REPORT,
    });
    expect(ok.status).toBe(200);
  });

  it('checks the token before anything else: body, content type, path, method', async () => {
    await start();
    // Invalid JSON, wrong content type: still 401, not 400 or 415.
    await expect401(
      await fetch(`${base}/v1/reports`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{not json',
      }),
    );
    await expect401(await fetch(`${base}/v1/reports`, { method: 'POST', body: 'x' }));
    // Unknown path: 401, so paths cannot be discovered without the token.
    await expect401(await fetch(`${base}/v1/secret-admin`));
    expect((await fetch(`${base}/v1/secret-admin`, { headers: AUTH })).status).toBe(404);
    // Known path, wrong method: 401 too.
    await expect401(await fetch(`${base}/v1/tasks`, { method: 'DELETE' }));
  });

  it('answers 401 without waiting for the body', async () => {
    await start();
    // Headers promise 1 MB, no body is ever sent. A server that read the body
    // first would never answer, and the test would time out.
    const { port } = server!.address() as AddressInfo;
    const status = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          method: 'POST',
          path: '/v1/reports',
          headers: { 'content-type': 'application/json', 'content-length': 1_000_000 },
        },
        (res) => {
          res.resume();
          req.destroy();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.flushHeaders();
    });
    expect(status).toBe(401);
  });

  it('createApp refuses a weak token, like loadConfig does', () => {
    const store = createTaskStore();
    expect(() => createApp({ store, token: '' })).toThrow(TypeError);
    expect(() => createApp({ store, token: 'x'.repeat(31) })).toThrow('at least 32 characters');
    expect(() => createApp({ store, token: `${'x'.repeat(32)} y` })).toThrow('visible ASCII');
  });

  it('does not accept the token from the query string', async () => {
    await start();
    await expect401(await fetch(`${base}/v1/tasks?access_token=${TOKEN}`));
  });
});
