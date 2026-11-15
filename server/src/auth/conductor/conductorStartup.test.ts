// The real server process (src/main.ts) with OPSAIP_CONDUCTOR_DIR. No run is
// started here: production runs the real `claude`, which these tests must
// never do (runManager.test.ts covers runs with the fake agent).
import { basename, join } from 'node:path';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { freePort, spawnServer, stopServer, waitUntilListening, type ServerProcess } from '../../testServerProcess';
import { cleanUp, makeRepo, tempDir } from './testing/conductorTestKit';

const TOKEN = 'conductor-startup-0123456789abcdef0123456789';
const running: ServerProcess[] = [];

afterAll(cleanUp);
afterEach(() => {
  for (const server of running.splice(0)) server.child.kill('SIGKILL');
});

function spawn(env: Record<string, string>): ServerProcess {
  const server = spawnServer({ OPSAIP_DB: join(tempDir(), 'opsaip.db'), OPSAIP_TOKEN: TOKEN, ...env });
  running.push(server);
  return server;
}

describe('startup with Conductor mode', { timeout: 30_000 }, () => {
  it('refuses to start with a bad OPSAIP_CONDUCTOR_DIR, without printing the path', async () => {
    const dir = join(tempDir(), 'client-acme-private');
    const server = spawn({ OPSAIP_PORT: String(await freePort()), OPSAIP_CONDUCTOR_DIR: dir });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('OPSAIP_CONDUCTOR_DIR is set, but the path does not exist');
    expect(server.output()).not.toContain('client-acme');
    expect(server.output()).not.toContain('listening');
  });

  it('refuses to start on a non-loopback host', async () => {
    const server = spawn({ OPSAIP_HOST: '0.0.0.0', OPSAIP_PORT: String(await freePort()), OPSAIP_CONDUCTOR_DIR: makeRepo() });
    expect(await server.exited).toBe(1);
    expect(server.output()).toContain('OPSAIP_HOST must be one of');
  });

  it('starts with a valid repository, says Conductor mode is on, never prints the path, and stops cleanly', async () => {
    const repo = makeRepo();
    const port = await freePort();
    const server = spawn({ OPSAIP_PORT: String(port), OPSAIP_CONDUCTOR_DIR: repo });
    await waitUntilListening(server);
    const res = await fetch(`http://127.0.0.1:${port}/v1/conductor`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(await res.json()).toEqual({
      enabled: true,
      agent: 'claude-code',
      repos: [{ id: 'default', name: basename(repo), isDefault: true }],
      active: false,
    });
    expect(await stopServer(server)).toBe(0);
    expect(server.output()).toContain('Conductor mode is on');
    expect(server.output()).not.toContain(repo);
  });

  it('adds a repository without OPSAIP_CONDUCTOR_DIR, keeps it after a restart, and says it is on', async () => {
    const home = tempDir('opsaip-home-');
    const repo = makeRepo(home, 'my-app');
    const db = join(tempDir(), 'opsaip.db');
    const env = { OPSAIP_DB: db, HOME: home, USERPROFILE: home };
    const headers = { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' };

    const port = await freePort();
    const first = spawn({ ...env, OPSAIP_PORT: String(port) });
    await waitUntilListening(first);
    const added = await fetch(`http://127.0.0.1:${port}/v1/repos`, { method: 'POST', headers, body: JSON.stringify({ path: repo }) });
    expect(added.status).toBe(201);
    expect(await stopServer(first)).toBe(0);
    expect(first.output()).toContain('Conductor mode is off');

    const port2 = await freePort();
    const second = spawn({ ...env, OPSAIP_PORT: String(port2) });
    await waitUntilListening(second);
    const list = await fetch(`http://127.0.0.1:${port2}/v1/repos`, { headers });
    expect(((await list.json()) as { repos: Array<{ name: string }> }).repos.map((r) => r.name)).toEqual(['my-app']);
    expect(await stopServer(second)).toBe(0);
    expect(second.output()).toContain('Conductor mode is on (experimental, agent claude-code, 1 repository)');
    expect(second.output()).not.toContain(repo);
  });

  it('a server on another host has no repository endpoints', async () => {
    const port = await freePort();
    const server = spawn({ OPSAIP_HOST: '0.0.0.0', OPSAIP_PORT: String(port) });
    await waitUntilListening(server);
    const res = await fetch(`http://127.0.0.1:${port}/v1/repos`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(503);
    expect(await stopServer(server)).toBe(0);
  });

  it('says how to turn it on when it is off', async () => {
    const server = spawn({ OPSAIP_PORT: String(await freePort()) });
    await waitUntilListening(server);
    expect(await stopServer(server)).toBe(0);
    expect(server.output()).toContain('Conductor mode is off (add a repository in Settings > Repositories, or set OPSAIP_CONDUCTOR_DIR)');
  });
});
