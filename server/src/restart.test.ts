// Tasks survive a restart: write, restart, read back.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { createServer as createNetServer, type AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDatabase } from './db';
import { createSqliteTaskStore } from './sqliteTaskStore';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const T0 = '2026-11-01T10:00:00Z';
const T1 = '2026-11-01T10:05:00Z';
const T2 = '2026-11-01T10:10:00Z';

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'opsaip-restart-'));
  dbPath = join(dir, 'data', 'opsaip.db');
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function report(base: string, taskId: string, status: string, at: string): Promise<Response> {
  return fetch(`${base}/v1/reports`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ taskId, status, at }),
  });
}

async function tasks(base: string): Promise<unknown> {
  return ((await (await fetch(`${base}/v1/tasks`)).json()) as { tasks: unknown }).tasks;
}

const EXPECTED = [
  { id: 't1', status: 'running', updatedAt: T1 },
  { id: 't2', status: 'queued', updatedAt: T0 },
];

async function writeTasks(base: string): Promise<void> {
  for (const [taskId, status, at] of [
    ['t1', 'queued', T0],
    ['t2', 'queued', T0],
    ['t1', 'running', T1],
  ]) {
    expect((await report(base, taskId, status, at)).status).toBe(200);
  }
}

describe('restart, in process', () => {
  async function start(): Promise<{ server: Server; base: string; close: () => Promise<void> }> {
    const db = openDatabase(dbPath);
    const server = createApp({ store: createSqliteTaskStore(db) });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    return {
      server,
      base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
      async close() {
        server.closeAllConnections();
        server.close();
        await once(server, 'close');
        db.close();
      },
    };
  }

  it('reads back what was written before the restart', async () => {
    const first = await start();
    await writeTasks(first.base);
    await first.close();

    const second = await start();
    try {
      expect(await tasks(second.base)).toEqual(EXPECTED);
    } finally {
      await second.close();
    }
  });

  it('applies the rules to restored tasks from where they were', async () => {
    const first = await start();
    await writeTasks(first.base);
    await first.close();

    const second = await start();
    try {
      const back = await report(second.base, 't1', 'queued', T2);
      expect(back.status).toBe(409);
      expect(await back.json()).toEqual({ error: 'transition not allowed: running -> queued' });
      expect((await report(second.base, 't1', 'done', T2)).status).toBe(200);
      expect((await report(second.base, 't2', 'running', T0)).status).toBe(200);
    } finally {
      await second.close();
    }
  });
});

describe('restart, real process (npm run server stopped with SIGTERM)', () => {
  const children: ChildProcess[] = [];
  afterEach(() => {
    for (const child of children.splice(0)) child.kill('SIGKILL');
  });

  async function freePort(): Promise<number> {
    const probe = createNetServer().listen(0, '127.0.0.1');
    await once(probe, 'listening');
    const { port } = probe.address() as AddressInfo;
    probe.close();
    await once(probe, 'close');
    return port;
  }

  /** Start src/main.ts the way `npm run server` does (tsx), and wait until it listens. */
  async function startProcess(port: number): Promise<ChildProcess> {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
      cwd: SERVER_DIR,
      env: { ...process.env, OPSAIP_HOST: '127.0.0.1', OPSAIP_PORT: String(port), OPSAIP_DB: dbPath },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    let output = '';
    await new Promise<void>((resolve, reject) => {
      const onData = (chunk: Buffer) => {
        output += chunk.toString();
        if (output.includes('server listening')) resolve();
      };
      child.stdout!.on('data', onData);
      child.stderr!.on('data', onData);
      child.on('exit', (code) => reject(new Error(`server exited (${code}):\n${output}`)));
    });
    return child;
  }

  async function stopProcess(child: ChildProcess): Promise<number | null> {
    child.kill('SIGTERM');
    const [code] = (await once(child, 'exit')) as [number | null];
    return code;
  }

  it('reads back what was written before the restart', { timeout: 30_000 }, async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const first = await startProcess(port);
    await writeTasks(base);
    expect(await stopProcess(first)).toBe(0); // clean shutdown on SIGTERM

    const second = await startProcess(port);
    expect(await tasks(base)).toEqual(EXPECTED);
    expect(await stopProcess(second)).toBe(0);
  });
});
