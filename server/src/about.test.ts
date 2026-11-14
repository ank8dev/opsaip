import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createTaskStore } from '@opsaip/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CLAUDE_CACHE_MS,
  CLAUDE_TIMEOUT_MS,
  createAbout,
  createClaudeExec,
  minimalEnv,
  parseClaudeVersion,
  readServerVersion,
  type ExecFileFn,
} from './about';
import { createApp } from './app';
import type { UpdateCheck } from './updateCheck';

const TOKEN = 'about-test-token-0123456789abcdef0123456789';

describe('about', () => {
  it('reads the version of server/package.json', () => {
    expect(readServerVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('parses the first version-looking token', () => {
    expect(parseClaudeVersion('2.1.325 (Claude Code)\n')).toBe('2.1.325');
    expect(parseClaudeVersion('claude 10.0.1')).toBe('10.0.1');
    expect(parseClaudeVersion('command not found')).toBeNull();
    expect(parseClaudeVersion('')).toBeNull();
    expect(parseClaudeVersion('1.2')).toBeNull();
  });

  it('answers server, node and claude', async () => {
    const about = createAbout({ version: '1.2.3', exec: async () => '2.1.325 (Claude Code)' });
    expect(await about()).toEqual({ server: { version: '1.2.3' }, node: process.version, claude: '2.1.325' });
  });

  it('claude is null when the binary is missing, times out or prints junk', async () => {
    for (const exec of [
      () => Promise.reject(new Error('ENOENT')),
      () => Promise.reject(Object.assign(new Error('timeout'), { killed: true })),
      async () => 'hello world',
    ]) {
      expect((await createAbout({ version: '1.0.0', exec })()).claude).toBeNull();
    }
  });

  it('caches the answer for 5 minutes', async () => {
    let t = 1000;
    const exec = vi.fn().mockResolvedValue('2.1.325');
    const about = createAbout({ version: '1.0.0', exec, now: () => t });
    await about();
    await about();
    expect(exec).toHaveBeenCalledTimes(1);
    t += CLAUDE_CACHE_MS - 1;
    await about();
    expect(exec).toHaveBeenCalledTimes(1);
    t += 1;
    await about();
    expect(exec).toHaveBeenCalledTimes(2);
  });

  it('runs one exec for concurrent callers', async () => {
    const exec = vi.fn().mockResolvedValue('2.1.325');
    const about = createAbout({ version: '1.0.0', exec });
    await Promise.all([about(), about(), about()]);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  it('runs claude --version without a shell, with a 3 s timeout and no OPSAIP_ variables', async () => {
    const run = vi.fn((_file, _args, _options, callback) => callback(null, '2.1.325\n'));
    expect(await createClaudeExec(run as unknown as ExecFileFn)()).toBe('2.1.325\n');
    const [file, args, options] = run.mock.calls[0];
    expect(file).toBe('claude');
    expect(args).toEqual(['--version']);
    expect(options.timeout).toBe(CLAUDE_TIMEOUT_MS);
    expect(options.shell).toBeUndefined();
    expect(Object.keys(options.env).filter((k) => k.startsWith('OPSAIP_'))).toEqual([]);
  });

  it('minimalEnv drops everything except a few basics', () => {
    const env = minimalEnv({ PATH: '/bin', HOME: '/h', OPSAIP_TOKEN: 'secret', OPSAIP_LLM_KEY: 'k', FOO: 'x' });
    expect(env).toEqual({ PATH: '/bin', HOME: '/h' });
  });
});

describe('GET /v1/about and /v1/update', () => {
  let server: ReturnType<typeof createApp> | undefined;
  afterEach(async () => {
    if (server === undefined) return;
    server.closeAllConnections();
    server.close();
    await once(server, 'close');
    server = undefined;
  });

  async function start(options: Parameters<typeof createApp>[0] extends infer O ? Partial<O> : never) {
    server = createApp({ store: createTaskStore(), token: TOKEN, ...options });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const auth = { authorization: `Bearer ${TOKEN}` };

  it('answers 401 without a token on both routes', async () => {
    const base = await start({});
    for (const path of ['/v1/about', '/v1/update']) {
      expect((await fetch(base + path)).status).toBe(401);
      expect((await fetch(base + path, { headers: { authorization: 'Bearer wrong' } })).status).toBe(401);
    }
  });

  it('/v1/about has the documented shape', async () => {
    const base = await start({ about: createAbout({ version: '1.2.3', exec: async () => '2.1.325' }) });
    const response = await fetch(`${base}/v1/about`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      server: { version: '1.2.3' },
      node: process.version,
      claude: '2.1.325',
    });
  });

  it('/v1/about says claude: null when it is not found', async () => {
    const base = await start({ about: createAbout({ version: '1.2.3', exec: () => Promise.reject(new Error('x')) }) });
    const body = (await (await fetch(`${base}/v1/about`, { headers: auth })).json()) as { claude: unknown };
    expect(body.claude).toBeNull();
  });

  it('/v1/update is disabled by default and sends nothing', async () => {
    const base = await start({});
    const response = await fetch(`${base}/v1/update`, { headers: auth });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      enabled: false,
      current: readServerVersion(),
      latest: null,
      url: null,
      newer: false,
      checkedAt: null,
    });
  });

  it('/v1/update answers from the injected check, which stops when the server closes', async () => {
    const status = {
      enabled: true,
      current: '0.1.0',
      latest: '0.2.0',
      url: 'https://github.com/ank8dev/opsaip/releases/tag/v0.2.0',
      newer: true,
      checkedAt: '2026-01-01T00:00:00.000Z',
    };
    const updateCheck: UpdateCheck = { start: vi.fn(), stop: vi.fn(), status: () => status };
    const base = await start({ updateCheck });
    expect(await (await fetch(`${base}/v1/update`, { headers: auth })).json()).toEqual(status);
    server!.closeAllConnections();
    server!.close();
    await once(server!, 'close');
    expect(updateCheck.stop).toHaveBeenCalled();
    server = undefined;
  });
});
