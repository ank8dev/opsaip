// The server side of the permission bridge: a Unix socket per run that the
// run's permission MCP server (permissionMcp.mjs) connects to. Each request on
// it is a tool call that Claude Code wants a person to approve; the answer
// goes back on the same connection.
//
// The socket only carries questions in and answers out. A client on it can
// ask, never answer: decisions come only from decide(), which the HTTP API
// calls for the person. Even so, the socket is locked down:
//   - it lives in a fresh mkdtemp directory with mode 0700, so other users of
//     the machine cannot reach it;
//   - a client must send the run's random secret first, or it is dropped. The
//     secret travels in the MCP config FILE (inside that directory), never in
//     argv, which `ps` shows to everyone.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLineSplitter } from './streamJson';

/**
 * Where run directories are made. Not os.tmpdir(): on macOS that is a long
 * /var/folders/... path, and a Unix socket path must fit in sun_path
 * (104 bytes on macOS, 108 on Linux).
 */
export const BRIDGE_DIR_PREFIX = '/tmp/opsaip-';
/** The socket's file name in the run directory: short on purpose (see above). */
export const SOCKET_NAME = 's';
/** macOS sun_path size. A socket path must be shorter than this, in bytes. */
export const MAX_SOCKET_PATH_BYTES = 104;
/** The MCP server name in the config file: tools are named mcp__opsaip__<tool>. */
export const MCP_SERVER_NAME = 'opsaip';
/** The flag value for --permission-prompt-tool. */
export const PERMISSION_TOOL = `mcp__${MCP_SERVER_NAME}__approve`;
/** The permission MCP server script, run with this Node binary. */
export const PERMISSION_MCP_SCRIPT = fileURLToPath(new URL('./permissionMcp.mjs', import.meta.url));
/** Longest line accepted on the socket, in characters. A tool input can be a whole file. */
const MAX_SOCKET_LINE_CHARS = 4 * 1024 * 1024;
/** How long a client has to send the secret. */
const HELLO_TIMEOUT_MS = 5_000;

/** One tool call waiting for a person. */
export interface BridgeRequest {
  /** Unique within the bridge. */
  key: string;
  /** The tool Claude Code wants to use, e.g. "Bash". */
  toolName: string;
  /** The tool's input, as Claude Code sent it. */
  input: unknown;
}

export interface BridgeOptions {
  onRequest(request: BridgeRequest): void;
  /** The client gave up on a request (Claude Code cancelled the call, or the connection closed). */
  onWithdrawn(key: string): void;
  /** Written into the MCP config as the server's "timeout", in milliseconds. */
  toolTimeoutMs: number;
}

export interface PermissionBridge {
  /** The run directory (mode 0700): holds the socket and the MCP config file. */
  readonly dir: string;
  readonly socketPath: string;
  /** Pass to claude --mcp-config. */
  readonly mcpConfigPath: string;
  /** Answer a request. False if it is unknown or already answered. */
  decide(key: string, behavior: 'allow' | 'deny', message?: string): boolean;
  /** Stop listening, drop every client and delete the run directory. Safe to call twice. */
  close(): Promise<void>;
}

/** Create the run directory, the socket and the MCP config file. */
export async function createPermissionBridge(options: BridgeOptions): Promise<PermissionBridge> {
  const dir = await mkdtemp(BRIDGE_DIR_PREFIX);
  try {
    await chmod(dir, 0o700); // mkdtemp already uses 0700; make sure of it
    const socketPath = join(dir, SOCKET_NAME);
    const secret = randomBytes(32).toString('hex');
    const mcpConfigPath = join(dir, 'mcp.json');
    await writeFile(mcpConfigPath, `${JSON.stringify(mcpConfig(socketPath, secret, options.toolTimeoutMs))}\n`, {
      mode: 0o600,
    });

    const server = createServer();
    const clients = new Set<Socket>();
    /** Open requests: key -> the connection waiting for the answer and its own id. */
    const open = new Map<string, { socket: Socket; id: string }>();
    let nextConnection = 1;

    server.on('connection', (socket) => {
      const connection = nextConnection++;
      clients.add(socket);
      socket.setEncoding('utf8');
      let authenticated = false;
      const helloTimer = setTimeout(() => socket.destroy(), HELLO_TIMEOUT_MS);
      const splitter = createLineSplitter(
        (line) => {
          const message = parseObject(line);
          if (!authenticated) {
            clearTimeout(helloTimer);
            if (message?.type === 'hello' && sameSecret(message.secret, secret)) authenticated = true;
            else socket.destroy();
            return;
          }
          if (message === undefined || typeof message.id !== 'string' || message.id.length > 50) return;
          const key = `${connection}:${message.id}`;
          if (message.type === 'request') {
            if (open.has(key)) return;
            open.set(key, { socket, id: message.id });
            const toolName = typeof message.toolName === 'string' ? message.toolName : '';
            options.onRequest({ key, toolName, input: message.input });
          } else if (message.type === 'cancel') {
            if (open.delete(key)) options.onWithdrawn(key);
          }
        },
        // A line too long to read is a request that can never be answered:
        // without its id it cannot be denied either, so drop the client.
        () => socket.destroy(),
        MAX_SOCKET_LINE_CHARS,
      );
      socket.on('data', (chunk: string) => splitter.push(chunk));
      socket.on('error', () => {}); // "close" follows
      socket.on('close', () => {
        clearTimeout(helloTimer);
        clients.delete(socket);
        for (const [key, entry] of open) {
          if (entry.socket === socket) {
            open.delete(key);
            options.onWithdrawn(key);
          }
        }
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => {
        server.off('error', reject);
        resolve();
      });
    });
    server.on('error', () => {}); // after listening: nothing to do, close() cleans up

    let closed: Promise<void> | undefined;
    return {
      dir,
      socketPath,
      mcpConfigPath,
      decide(key, behavior, message) {
        const entry = open.get(key);
        if (entry === undefined) return false;
        open.delete(key);
        const decision: Record<string, string> = { type: 'decision', id: entry.id, behavior };
        if (message !== undefined) decision.message = message;
        if (!entry.socket.destroyed) entry.socket.write(`${JSON.stringify(decision)}\n`);
        return true;
      },
      close() {
        closed ??= closeAll(server, clients, open, dir);
        return closed;
      },
    };
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/**
 * The --mcp-config file: the permission server only. With --strict-mcp-config,
 * Claude Code loads nothing else.
 */
export function mcpConfig(socketPath: string, secret: string, toolTimeoutMs: number): unknown {
  return {
    mcpServers: {
      [MCP_SERVER_NAME]: {
        type: 'stdio',
        // This Node binary and an absolute script path: works whatever the
        // agent's PATH and working directory are.
        command: process.execPath,
        args: [PERMISSION_MCP_SCRIPT],
        env: { OPSAIP_BRIDGE_SOCKET: socketPath, OPSAIP_BRIDGE_SECRET: secret },
        // The per-server tool-call limit, in ms. The permission tool blocks
        // until the person answers, so it must outlast Opsaip's own wait.
        // A per-server timeout of at least 1000 also raises the idle timeout
        // floor for this server (https://code.claude.com/docs/en/mcp, "Time
        // limits on MCP tool calls").
        timeout: toolTimeoutMs,
      },
    },
  };
}

async function closeAll(
  server: Server,
  clients: Set<Socket>,
  open: Map<string, unknown>,
  dir: string,
): Promise<void> {
  open.clear();
  for (const socket of clients) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
}

function parseObject(line: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(line);
    return typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function sameSecret(given: unknown, secret: string): boolean {
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
