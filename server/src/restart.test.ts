// Tasks survive a restart: write, restart, read back.
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { openDatabase } from './db';
import { createSqliteTaskStore } from './sqliteTaskStore';
import {
  freePort,
  spawnServer,
  stopServer,
  waitUntilListening,
  type ServerProcess,
} from './testServerProcess';

const TOKEN = 'restart-test-token-0123456789abcdef';
const AUTH = { authorization: `Bearer ${TOKEN}` };
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
    headers: { ...AUTH, 'content-type': 'application/json' },
    body: JSON.stringify({ taskId, status, at }),
  });
}

async function tasks(base: string): Promise<unknown> {
  const res = await fetch(`${base}/v1/tasks`, { headers: AUTH });
  return ((await res.json()) as { tasks: unknown }).tasks;
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
    const server = createApp({ store: createSqliteTaskStore(db), token: TOKEN });
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
  const running: ServerProcess[] = [];
  afterEach(() => {
    for (const server of running.splice(0)) server.child.kill('SIGKILL');
  });

  async function start(port: number): Promise<ServerProcess> {
    const server = spawnServer({
      OPSAIP_HOST: '127.0.0.1',
      OPSAIP_PORT: String(port),
      OPSAIP_DB: dbPath,
      OPSAIP_TOKEN: TOKEN,
    });
    running.push(server);
    await waitUntilListening(server);
    return server;
  }

  it('reads back what was written before the restart', { timeout: 30_000 }, async () => {
    const port = await freePort();
    const base = `http://127.0.0.1:${port}`;

    const first = await start(port);
    await writeTasks(base);
    expect(await stopServer(first)).toBe(0); // clean shutdown on SIGTERM

    const second = await start(port);
    expect(await tasks(base)).toEqual(EXPECTED);
    expect(await stopServer(second)).toBe(0);
  });
});
