import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createConnection } from 'node:net';
import { dirname } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  BRIDGE_DIR_PREFIX,
  createPermissionBridge,
  MAX_SOCKET_PATH_BYTES,
  PERMISSION_MCP_SCRIPT,
  PERMISSION_TOOL,
  type BridgeRequest,
  type PermissionBridge,
} from './permissionBridge';
import { waitFor } from './testing/conductorTestKit';

const bridges: PermissionBridge[] = [];
const children: ChildProcess[] = [];

afterEach(async () => {
  for (const child of children.splice(0)) child.kill('SIGKILL');
  await Promise.all(bridges.splice(0).map((bridge) => bridge.close()));
});

async function newBridge() {
  const requests: BridgeRequest[] = [];
  const withdrawn: string[] = [];
  const bridge = await createPermissionBridge({
    toolTimeoutMs: 120_000,
    onRequest: (request) => requests.push(request),
    onWithdrawn: (key) => withdrawn.push(key),
  });
  bridges.push(bridge);
  return { bridge, requests, withdrawn };
}

/** Start the real MCP script the way Claude Code does: command, args and env from the config file. */
function startMcp(bridge: PermissionBridge) {
  const server = (JSON.parse(readFileSync(bridge.mcpConfigPath, 'utf8')) as {
    mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
  }).mcpServers.opsaip;
  const child = spawn(server.command, server.args, { env: { ...process.env, ...server.env }, stdio: ['pipe', 'pipe', 'pipe'] });
  children.push(child);
  const responses = new Map<number, Record<string, unknown>>();
  let stderr = '';
  let buffer = '';
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (chunk: string) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const message = JSON.parse(buffer.slice(0, end)) as { id: number };
      buffer = buffer.slice(end + 1);
      responses.set(message.id, message);
    }
  });
  child.stderr!.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
  const send = (message: object) => child.stdin!.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  const call = async (id: number, method: string, params?: object) => {
    send({ id, method, params });
    return waitFor(() => responses.get(id));
  };
  return { child, send, call, responses, stderr: () => stderr };
}

const decisionOf = (response: Record<string, unknown>): Record<string, unknown> => {
  const result = response.result as { content: Array<{ type: string; text: string }>; structuredContent?: unknown };
  expect(result.content).toHaveLength(1);
  expect(result.content[0].type).toBe('text');
  expect(result.structuredContent).toBeUndefined();
  return JSON.parse(result.content[0].text) as Record<string, unknown>;
};

describe('createPermissionBridge', () => {
  it('makes a private /tmp/opsaip-* directory with a socket path under the macOS limit of 104 bytes', async () => {
    for (let i = 0; i < 5; i++) {
      const { bridge } = await newBridge();
      expect(bridge.dir.startsWith(BRIDGE_DIR_PREFIX)).toBe(true);
      expect(dirname(bridge.socketPath)).toBe(bridge.dir);
      expect(Buffer.byteLength(bridge.socketPath)).toBeLessThan(MAX_SOCKET_PATH_BYTES);
      expect(statSync(bridge.dir).mode & 0o777).toBe(0o700);
      expect(statSync(bridge.mcpConfigPath).mode & 0o777).toBe(0o600);
      expect(statSync(bridge.socketPath).isSocket()).toBe(true);
    }
  });

  it('writes an MCP config with only the Opsaip server, its secret in env, never in args', async () => {
    const { bridge } = await newBridge();
    const config = JSON.parse(readFileSync(bridge.mcpConfigPath, 'utf8')) as {
      mcpServers: Record<string, { type: string; command: string; args: string[]; env: Record<string, string>; timeout: number }>;
    };
    expect(Object.keys(config.mcpServers)).toEqual(['opsaip']);
    const server = config.mcpServers.opsaip;
    expect(server).toMatchObject({ type: 'stdio', command: process.execPath, args: [PERMISSION_MCP_SCRIPT], timeout: 120_000 });
    expect(server.env.OPSAIP_BRIDGE_SOCKET).toBe(bridge.socketPath);
    expect(server.env.OPSAIP_BRIDGE_SECRET).toMatch(/^[0-9a-f]{64}$/);
    expect(server.args.join(' ')).not.toContain(server.env.OPSAIP_BRIDGE_SECRET);
    expect(PERMISSION_TOOL).toBe('mcp__opsaip__approve');
  });

  it('close() removes the directory and the socket; twice is fine', async () => {
    const { bridge } = await newBridge();
    await bridge.close();
    await bridge.close();
    expect(existsSync(bridge.dir)).toBe(false);
  });

  it('drops a client that does not send the right secret first', async () => {
    const { bridge, requests } = await newBridge();
    const socket = createConnection(bridge.socketPath);
    let closed = false;
    socket.on('close', () => (closed = true));
    socket.on('error', () => {});
    socket.write('{"type":"hello","secret":"wrong"}\n{"type":"request","id":"1","toolName":"Bash","input":{}}\n');
    await waitFor(() => closed);
    expect(requests).toEqual([]);
  });
});

describe('permissionMcp.mjs (the real MCP server, over the real socket)', () => {
  it('answers initialize, ping and tools/list with one "approve" tool without outputSchema', async () => {
    const { bridge } = await newBridge();
    const mcp = startMcp(bridge);
    const init = await mcp.call(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } });
    expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', capabilities: { tools: {} } });
    mcp.send({ method: 'notifications/initialized' });
    expect((await mcp.call(2, 'ping')).result).toEqual({});
    const list = (await mcp.call(3, 'tools/list')).result as { tools: Array<Record<string, unknown>> };
    expect(list.tools.map((tool) => tool.name)).toEqual(['approve']);
    expect(list.tools[0].outputSchema).toBeUndefined();
    expect((await mcp.call(4, 'resources/list')).error).toMatchObject({ code: -32601 });
    const unknownVersion = await mcp.call(5, 'initialize', { protocolVersion: '1999-01-01' });
    expect((unknownVersion.result as { protocolVersion: string }).protocolVersion).toBe('2025-11-25');
  });

  it('forwards a tool call; allow returns the original input as updatedInput', async () => {
    const { bridge, requests } = await newBridge();
    const mcp = startMcp(bridge);
    const input = { command: 'npm test', description: 'Run tests' };
    mcp.send({ id: 7, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input, tool_use_id: 'toolu_1' } } });
    const request = await waitFor(() => requests[0]);
    expect(request).toMatchObject({ toolName: 'Bash', input });
    expect(bridge.decide(request.key, 'allow')).toBe(true);
    expect(bridge.decide(request.key, 'allow')).toBe(false); // answered already
    expect(decisionOf(await waitFor(() => mcp.responses.get(7)))).toEqual({ behavior: 'allow', updatedInput: input });
    expect(mcp.stderr()).toBe('');
  });

  it('deny returns the message', async () => {
    const { bridge, requests } = await newBridge();
    const mcp = startMcp(bridge);
    mcp.send({ id: 8, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'WebFetch', input: { url: 'https://x.test' } } } });
    const request = await waitFor(() => requests[0]);
    bridge.decide(request.key, 'deny', 'Not now');
    expect(decisionOf(await waitFor(() => mcp.responses.get(8)))).toEqual({ behavior: 'deny', message: 'Not now' });
  });

  it('a cancelled call is withdrawn on the server', async () => {
    const { bridge, requests, withdrawn } = await newBridge();
    const mcp = startMcp(bridge);
    mcp.send({ id: 9, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: {} } } });
    const request = await waitFor(() => requests[0]);
    mcp.send({ method: 'notifications/cancelled', params: { requestId: 9 } });
    await waitFor(() => withdrawn.length === 1);
    expect(withdrawn).toEqual([request.key]);
    expect(bridge.decide(request.key, 'allow')).toBe(false);
  });

  it('denies what is waiting when the bridge closes, and denies at once without a bridge', async () => {
    const { bridge, requests } = await newBridge();
    const mcp = startMcp(bridge);
    mcp.send({ id: 10, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: {} } } });
    await waitFor(() => requests[0]);
    await bridge.close();
    expect(decisionOf(await waitFor(() => mcp.responses.get(10)))).toMatchObject({ behavior: 'deny' });
    mcp.send({ id: 11, method: 'tools/call', params: { name: 'approve', arguments: { tool_name: 'Bash', input: {} } } });
    expect(decisionOf(await waitFor(() => mcp.responses.get(11)))).toMatchObject({ behavior: 'deny' });
  });

  it('survives malformed input and reports an unknown tool as a tool error', async () => {
    const { bridge } = await newBridge();
    const mcp = startMcp(bridge);
    mcp.child.stdin!.write('not json\n\n[1]\n');
    const unknown = await mcp.call(12, 'tools/call', { name: 'other', arguments: {} });
    expect(unknown.result).toMatchObject({ isError: true });
    expect((await mcp.call(13, 'ping')).result).toEqual({});
  });

  it('exits when its stdin closes (Claude Code ended)', async () => {
    const { bridge } = await newBridge();
    const mcp = startMcp(bridge);
    await mcp.call(1, 'ping');
    let exited: number | null | undefined;
    mcp.child.on('exit', (code) => (exited = code));
    mcp.child.stdin!.end();
    expect(await waitFor(() => (exited === undefined ? undefined : { code: exited }))).toEqual({ code: 0 });
  });
});
