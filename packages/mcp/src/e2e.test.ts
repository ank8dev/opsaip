// End to end: the real Opsaip server (npm run server), the real MCP server
// process (bin/opsaip-mcp.mjs) and the official MCP client talking to it over
// stdio, the way Claude Code or Codex do. Results are checked through
// GET /v1/tasks on the server.
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import {
  freePort,
  spawnServer,
  stopServer,
  waitUntilListening,
  type ServerProcess,
} from '@opsaip/server/testing';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

const BIN = fileURLToPath(new URL('../bin/opsaip-mcp.mjs', import.meta.url));
const TOKEN = 'mcp-e2e-test-token-0123456789abcdef0123';
const OTHER_TOKEN = 'mcp-e2e-wrong-token-0123456789abcdef012';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let dir: string;
let server: ServerProcess;
let baseUrl: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'opsaip-mcp-e2e-'));
  const port = await freePort();
  baseUrl = `http://127.0.0.1:${port}`;
  server = spawnServer({
    OPSAIP_HOST: '127.0.0.1',
    OPSAIP_PORT: String(port),
    OPSAIP_DB: join(dir, 'opsaip.db'),
    OPSAIP_TOKEN: TOKEN,
  });
  await waitUntilListening(server);
}, 30_000);

afterAll(async () => {
  if (server !== undefined) await stopServer(server);
  rmSync(dir, { recursive: true, force: true });
});

/** Everything the MCP side showed: tool texts and the MCP process's stderr. */
let seen: string[] = [];
const clients: Client[] = [];

afterEach(async () => {
  for (const client of clients.splice(0)) await client.close();
  // The token must never come back to the agent or be printed.
  for (const text of seen) {
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain(OTHER_TOKEN);
  }
  seen = [];
});

/** Start the MCP server as a child process and connect a client named `agent` to it. */
async function connect(env: { OPSAIP_URL: string; OPSAIP_TOKEN: string }, agent = 'claude-code'): Promise<Client> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [BIN],
    env,
    stderr: 'pipe',
  });
  transport.stderr?.on('data', (chunk: Buffer) => seen.push(chunk.toString()));
  const client = new Client({ name: agent, version: '0.0.0-test' });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
  const result = (await client.callTool({ name, arguments: args })) as CallToolResult;
  for (const item of result.content) if (item.type === 'text') seen.push(item.text);
  return result;
}

function textOf(result: CallToolResult): string {
  return result.content.map((item) => (item.type === 'text' ? item.text : '')).join('\n');
}

async function tasks(): Promise<Record<string, unknown>[]> {
  const res = await fetch(`${baseUrl}/v1/tasks`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.status).toBe(200);
  return ((await res.json()) as { tasks: Record<string, unknown>[] }).tasks;
}

async function taskById(id: string): Promise<Record<string, unknown> | undefined> {
  return (await tasks()).find((task) => task.id === id);
}

async function startTask(client: Client, title: string): Promise<string> {
  const result = await call(client, 'start_task', { title });
  expect(result.isError, textOf(result)).toBeFalsy();
  const { taskId } = result.structuredContent as { taskId: string };
  return taskId;
}

const ok = () => ({ OPSAIP_URL: baseUrl, OPSAIP_TOKEN: TOKEN });

describe('opsaip MCP server, end to end', { timeout: 30_000 }, () => {
  it('lists the two tools', async () => {
    const client = await connect(ok());
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual(['start_task', 'update_status']);
    const update = tools.find((tool) => tool.name === 'update_status')!;
    expect(update.inputSchema.required).toEqual(['taskId', 'status']);
  });

  it('start_task creates a running task with the title and the client name as agent', async () => {
    const client = await connect(ok());
    const result = await call(client, 'start_task', { title: 'Fix the login redirect' });
    expect(result.isError).toBeFalsy();
    const { taskId } = result.structuredContent as { taskId: string };
    expect(taskId).toMatch(UUID);
    expect(textOf(result)).toContain(taskId);

    const task = await taskById(taskId);
    expect(task).toMatchObject({
      id: taskId,
      status: 'running',
      title: 'Fix the login redirect',
      agent: 'claude-code',
    });
    expect(task).not.toHaveProperty('note');
  });

  it('update_status walks a task through a question to done', async () => {
    const client = await connect(ok(), 'codex-mcp-client');
    const taskId = await startTask(client, 'Add a CSV export');

    const waiting = await call(client, 'update_status', {
      taskId,
      status: 'waiting_on_human',
      note: 'Which date format: ISO or US?',
    });
    expect(waiting.isError).toBeFalsy();
    expect(textOf(waiting)).toBe(`Task ${taskId} is now waiting_on_human.`);
    expect(await taskById(taskId)).toMatchObject({
      status: 'waiting_on_human',
      note: 'Which date format: ISO or US?',
      agent: 'codex-mcp-client',
      title: 'Add a CSV export',
    });

    await call(client, 'update_status', { taskId, status: 'running' });
    expect(await taskById(taskId)).not.toHaveProperty('note');

    const done = await call(client, 'update_status', { taskId, status: 'done' });
    expect(done.isError).toBeFalsy();
    expect(await taskById(taskId)).toMatchObject({ status: 'done', title: 'Add a CSV export' });
  });

  it('passes on the server reason when it rejects a report', async () => {
    const client = await connect(ok());
    const taskId = await startTask(client, 'Short task');
    await call(client, 'update_status', { taskId, status: 'done' });

    const again = await call(client, 'update_status', { taskId, status: 'running' });
    expect(again.isError).toBe(true);
    expect(textOf(again)).toBe(
      `Could not update task ${taskId}: the Opsaip server rejected the report: transition not allowed: done -> running`,
    );
    expect(await taskById(taskId)).toMatchObject({ status: 'done' });
  });

  it('rejects an unknown taskId', async () => {
    const client = await connect(ok());
    const result = await call(client, 'update_status', { taskId: 'no-such-task', status: 'done' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('rejected the report: unknown task');
  });

  it('rejects a whitespace-only title with the server reason, and creates nothing', async () => {
    const client = await connect(ok());
    const before = (await tasks()).length;
    const result = await call(client, 'start_task', { title: '   ' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Could not start the task: the Opsaip server rejected the report: title must not be only whitespace',
    );
    expect(await tasks()).toHaveLength(before);
  });

  it('rejects a title over 200 characters before sending anything', async () => {
    const client = await connect(ok());
    const before = (await tasks()).length;
    const result = await call(client, 'start_task', { title: 'x'.repeat(201) });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Input validation error');
    expect(await tasks()).toHaveLength(before);
  });

  it('rejects an unknown status before sending anything', async () => {
    const client = await connect(ok());
    const result = await call(client, 'update_status', { taskId: 'x', status: 'paused' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain('Input validation error');
  });

  it('says the token was rejected, without showing either token', async () => {
    const client = await connect({ OPSAIP_URL: baseUrl, OPSAIP_TOKEN: OTHER_TOKEN });
    const result = await call(client, 'start_task', { title: 'Never created' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      'Could not start the task: the Opsaip server rejected the access token: ' +
        'check that OPSAIP_TOKEN is the token the server uses',
    );
    // afterEach checks that neither token appears anywhere.
  });

  it('says the server cannot be reached when it is down', async () => {
    const downUrl = `http://127.0.0.1:${await freePort()}`;
    const client = await connect({ OPSAIP_URL: downUrl, OPSAIP_TOKEN: TOKEN });
    const result = await call(client, 'start_task', { title: 'Nowhere to go' });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      `Could not start the task: cannot reach the Opsaip server at ${downUrl}/v1/reports (ECONNREFUSED): is it running?`,
    );
  });
});

describe('opsaip MCP server, startup', { timeout: 30_000 }, () => {
  /** Run the binary with exactly `env` (plus PATH) and stdin closed. */
  async function runBin(env: Record<string, string>): Promise<{ code: number | null; stderr: string; stdout: string }> {
    const child = spawn(process.execPath, [BIN], {
      env: { PATH: process.env.PATH ?? '', ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
    child.stdin.end();
    const [code] = (await once(child, 'exit')) as [number | null];
    return { code, stderr, stdout };
  }

  it('exits with code 1 and a message when OPSAIP_TOKEN is missing', async () => {
    const { code, stderr, stdout } = await runBin({ OPSAIP_URL: baseUrl });
    expect(code).toBe(1);
    expect(stderr).toContain('opsaip-mcp: OPSAIP_TOKEN is not set');
    expect(stdout).toBe(''); // stdout belongs to the MCP protocol
  });

  it('exits with code 1 and does not print a token that has a line break', async () => {
    const { code, stderr } = await runBin({ OPSAIP_URL: baseUrl, OPSAIP_TOKEN: `${TOKEN}\n` });
    expect(code).toBe(1);
    expect(stderr).toContain('visible ASCII characters only');
    expect(stderr).not.toContain(TOKEN);
  });

  it('prints nothing on stdout when it starts', async () => {
    const { code, stderr, stdout } = await runBin({ OPSAIP_URL: baseUrl, OPSAIP_TOKEN: TOKEN });
    expect(code).toBe(0); // stdin closed: the client is gone, so it stops
    expect(stdout).toBe('');
    expect(stderr).toContain(`opsaip-mcp: ready, reporting to ${baseUrl}/v1/reports`);
    expect(stderr).not.toContain(TOKEN);
  });
});
