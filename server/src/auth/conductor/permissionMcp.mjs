// The Opsaip permission server for Conductor mode: a tiny stdio MCP server
// that Claude Code starts for one run (via --mcp-config) and calls through
// --permission-prompt-tool mcp__opsaip__approve whenever a tool call needs a
// person's approval. It does not decide anything itself: it forwards each
// request to the Opsaip server over the run's Unix socket and returns the
// person's answer.
//
// Plain .mjs with no dependencies, so `node <this file>` runs it without a
// TypeScript loader. MCP is implemented by hand: JSON-RPC 2.0, one message per
// line on stdin/stdout. Only initialize, notifications/initialized, ping,
// tools/list, tools/call and notifications/cancelled are handled.
//
// Settings come from its environment, set in the run's MCP config file (never
// in argv, which `ps` shows):
//   OPSAIP_BRIDGE_SOCKET  the Unix socket path of the run
//   OPSAIP_BRIDGE_SECRET  the run's secret, sent first on the socket
//
// Socket protocol, one JSON object per line:
//   -> {"type":"hello","secret":"..."}                       once, first
//   -> {"type":"request","id":"7","toolName":"Bash","input":{...},"toolUseId":"..."}
//   -> {"type":"cancel","id":"7"}                             Claude Code gave up on it
//   <- {"type":"decision","id":"7","behavior":"allow"|"deny","message":"..."}
//
// Whatever goes wrong (no socket, socket closed, malformed answer), the
// answer is a deny: a request is never allowed without a person's "yes".
// This script prints nothing but MCP messages on stdout, and nothing on stderr.
import { createConnection } from 'node:net';

/** The tool name. With the server name "opsaip": mcp__opsaip__approve. */
const TOOL_NAME = 'approve';
/** Protocol versions this server can speak, newest first. */
const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
/** Longest line read from stdin or the socket. Longer lines are dropped. */
const MAX_LINE_CHARS = 4 * 1024 * 1024;

const socketPath = process.env.OPSAIP_BRIDGE_SOCKET ?? '';
const secret = process.env.OPSAIP_BRIDGE_SECRET ?? '';

/** JSON-RPC id of each tools/call waiting for an answer, by bridge request id. */
const waiting = new Map();
let nextRequestId = 1;
let socket;
let socketClosed = false;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

/** The tool result Claude Code expects: one text block holding the decision as JSON. */
function decisionResult(rpcId, decision) {
  send({ jsonrpc: '2.0', id: rpcId, result: { content: [{ type: 'text', text: JSON.stringify(decision) }] } });
}

function deny(rpcId, message) {
  decisionResult(rpcId, { behavior: 'deny', message });
}

function connect() {
  if (socket !== undefined || socketClosed) return;
  socket = createConnection(socketPath);
  socket.setEncoding('utf8');
  // Written now, before any request: writes before "connect" are queued in order.
  socket.write(`${JSON.stringify({ type: 'hello', secret })}\n`);
  onLines(socket, (line) => {
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message?.type !== 'decision' || typeof message.id !== 'string') return;
    const entry = waiting.get(message.id);
    if (entry === undefined) return;
    waiting.delete(message.id);
    if (message.behavior === 'allow') {
      // updatedInput is the original input: the tool runs as Claude asked.
      // Claude Code v2.1.86 to v2.1.206 needed the field; later versions accept it.
      decisionResult(entry.rpcId, { behavior: 'allow', updatedInput: entry.input });
    } else {
      deny(entry.rpcId, typeof message.message === 'string' ? message.message : 'Denied in Opsaip.');
    }
  });
  const closed = () => {
    socketClosed = true;
    for (const entry of waiting.values()) deny(entry.rpcId, 'Opsaip ended this run, so the request was denied.');
    waiting.clear();
  };
  socket.on('close', closed);
  socket.on('error', () => {}); // "close" follows and denies what is waiting
}

function handleToolCall(rpcId, params) {
  const name = params?.name;
  const args = params?.arguments;
  if (name !== TOOL_NAME) {
    send({ jsonrpc: '2.0', id: rpcId, result: { content: [{ type: 'text', text: `Unknown tool: only ${TOOL_NAME}.` }], isError: true } });
    return;
  }
  const toolName = typeof args?.tool_name === 'string' ? args.tool_name : '';
  const input = typeof args?.input === 'object' && args.input !== null ? args.input : {};
  const toolUseId = typeof args?.tool_use_id === 'string' ? args.tool_use_id : undefined;
  connect();
  if (socketClosed) return deny(rpcId, 'Opsaip is not reachable, so the request was denied.');
  const id = String(nextRequestId++);
  waiting.set(id, { rpcId, input });
  socket.write(`${JSON.stringify({ type: 'request', id, toolName, input, toolUseId })}\n`);
}

function handleCancelled(params) {
  for (const [id, entry] of waiting) {
    if (entry.rpcId === params?.requestId) {
      waiting.delete(id);
      if (!socketClosed) socket.write(`${JSON.stringify({ type: 'cancel', id })}\n`);
    }
  }
}

function handle(message) {
  if (typeof message !== 'object' || message === null) return;
  const { id, method, params } = message;
  const isRequest = id !== undefined && id !== null;
  switch (method) {
    case 'initialize': {
      const asked = params?.protocolVersion;
      send({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: {} },
          serverInfo: { name: 'opsaip-permissions', version: '0.1.0' },
        },
      });
      return;
    }
    case 'ping':
      if (isRequest) send({ jsonrpc: '2.0', id, result: {} });
      return;
    case 'tools/list':
      send({
        jsonrpc: '2.0',
        id,
        result: {
          tools: [
            {
              name: TOOL_NAME,
              description: 'Asks the person in Opsaip to allow or deny a tool call. Used by Claude Code as its permission prompt tool.',
              // No outputSchema: Claude Code wants a plain text block back.
              inputSchema: {
                type: 'object',
                properties: {
                  tool_name: { type: 'string' },
                  input: { type: 'object' },
                  tool_use_id: { type: 'string' },
                },
                required: ['tool_name', 'input'],
              },
            },
          ],
        },
      });
      return;
    case 'tools/call':
      if (isRequest) handleToolCall(id, params);
      return;
    case 'notifications/cancelled':
      handleCancelled(params);
      return;
    default:
      // Notifications (no id) are ignored; unknown requests get "method not found".
      if (isRequest) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
  }
}

/** Call onLine for each complete line. A line over MAX_LINE_CHARS is dropped, not kept in memory. */
function onLines(stream, onLine) {
  let buffer = '';
  let dropping = false;
  stream.on('data', (chunk) => {
    let text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    for (;;) {
      const end = text.indexOf('\n');
      if (end === -1) {
        if (!dropping) buffer += text;
        if (buffer.length > MAX_LINE_CHARS) {
          buffer = '';
          dropping = true;
        }
        return;
      }
      const line = buffer + text.slice(0, end);
      text = text.slice(end + 1);
      buffer = '';
      if (dropping) dropping = false;
      else if (line.trim() !== '') onLine(line);
    }
  });
}

process.stdin.setEncoding('utf8');
onLines(process.stdin, (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  handle(message);
});
// Claude Code closes stdin when the run ends: stop, and close the socket.
process.stdin.on('end', () => {
  socket?.end();
  process.exit(0);
});
