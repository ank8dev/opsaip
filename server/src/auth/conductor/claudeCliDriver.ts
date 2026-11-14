// Drives the user's own, unmodified `claude` CLI (Claude Code) for one run.
// Opsaip never reads, stores or passes Claude credentials: the CLI uses the
// login it already has on this machine.
//
// Verified against Claude Code 2.1.325 (`claude --help`, and the parser:
// an unknown option fails with "error: unknown option", these do not) and
// the official docs:
//   https://code.claude.com/docs/en/cli-reference
//   https://code.claude.com/docs/en/headless
//   https://code.claude.com/docs/en/errors ("Permission prompt tool returned an invalid result")
//
//   claude -p                                   print (headless) mode; required by the flags below
//     --input-format stream-json                prompt and follow-ups as JSON lines on stdin
//     --output-format stream-json --verbose     events as JSON lines on stdout ("stream-json requires --verbose" with -p)
//     --resume <session id>                     (only to continue a finished run) continue that session
//                                               in the same working directory: `-r, --resume [value]`, "Resume a
//                                               conversation by session ID or name" in `claude --help`
//     --permission-mode acceptEdits             file edits in the working directories without asking
//     --mcp-config <file> --strict-mcp-config   load ONLY the Opsaip permission server (see claudeArgs)
//     --permission-prompt-tool mcp__opsaip__approve
//                                               everything that would prompt goes to that tool. Not
//                                               listed in --help, but accepted by the parser and
//                                               documented in the CLI reference (print mode only).
//
// Never --dangerously-skip-permissions or --permission-mode bypassPermissions.
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createPermissionBridge, PERMISSION_TOOL, type PermissionBridge } from './permissionBridge';
import type { AgentDriver, DriverStartOptions, RunEvent } from './driver';
import { createLineSplitter, parseAgentLine, userMessageLine } from './streamJson';
import { MAX_TOOL_CHARS, oneLine, summarizeToolCall, truncate } from './toolSummary';

/** The Claude Code version these flags and shapes were checked with. */
export const CLAUDE_TESTED_VERSION = '2.1.325';
/** After the result and closing stdin: how long `claude` may take to exit before SIGTERM. */
export const EXIT_GRACE_MS = 10_000;
/** After SIGTERM: how long before SIGKILL to the whole process group. */
export const KILL_GRACE_MS = 5_000;
/** After denying pending requests on cancel: time for the deny to reach the agent before SIGTERM. */
const DENY_FLUSH_MS = 250;
/** After the process exits: how long to wait for the rest of its output. */
const OUTPUT_DRAIN_MS = 1_000;

/**
 * The argv after the command. An array, passed to spawn without a shell. It
 * never contains the prompt (that goes to stdin) or a secret (the MCP config
 * file holds it, in a 0700 directory).
 *
 * --strict-mcp-config matters: without it, Claude Code also loads the user's
 * own MCP servers, including the Opsaip reporting server from
 * docs/CONNECT.md, and the agent would report the run's work a second time
 * as a new task.
 */
export function claudeArgs(mcpConfigPath: string, resumeSessionId?: string): string[] {
  return [
    ...(resumeSessionId === undefined ? [] : ['--resume', resumeSessionId]),
    '-p',
    '--input-format',
    'stream-json',
    '--output-format',
    'stream-json',
    '--verbose',
    '--permission-mode',
    'acceptEdits',
    '--mcp-config',
    mcpConfigPath,
    '--strict-mcp-config',
    '--permission-prompt-tool',
    PERMISSION_TOOL,
  ];
}

/**
 * The agent's environment: this server's, minus every OPSAIP_* variable (the
 * access token and the Ask key stay with the server), plus Claude Code's MCP
 * tool time limits. The permission tool blocks until the person answers, so
 * both limits are raised to `toolTimeoutMs`: MCP_TOOL_TIMEOUT (default about
 * 28 hours, set anyway so a user setting cannot shorten it) and
 * CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT (30 minutes for stdio servers by default).
 * See https://code.claude.com/docs/en/env-vars. Opsaip denies on its own
 * before that (PERMISSION_TIMEOUT_MS in runManager.ts).
 */
export function agentEnv(base: NodeJS.ProcessEnv, toolTimeoutMs: number): Record<string, string> {
  const env = withoutOpsaipVars(base);
  env.MCP_TOOL_TIMEOUT = String(toolTimeoutMs);
  env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT = String(toolTimeoutMs);
  return env;
}

/**
 * A copy of `base` without OPSAIP_* variables (any letter case). For every
 * process a run starts, git included (its hooks run with this environment).
 */
export function withoutOpsaipVars(base: NodeJS.ProcessEnv): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [name, value] of Object.entries(base)) {
    if (value !== undefined && !name.toUpperCase().startsWith('OPSAIP_')) env[name] = value;
  }
  return env;
}

export interface ClaudeCliDriverOptions {
  /**
   * The program and the arguments before claudeArgs. Production: ["claude"].
   * Tests inject the fake agent here; there is no environment override.
   */
  command: readonly string[];
  /** Claude Code's MCP tool-call limit for the permission tool, in ms. */
  toolTimeoutMs: number;
  /** Defaults to process.env. Filtered by agentEnv. */
  env?: NodeJS.ProcessEnv;
  exitGraceMs?: number;
  killGraceMs?: number;
}

/**
 * One `claude -p` process per run, in stream-json mode. The turn lifecycle:
 * the prompt goes in as the first stdin line; follow-ups as more lines while
 * the turn runs; the first `result` ends the run: stdin is closed, permission
 * requests that still arrive are denied, and if the process has not exited
 * EXIT_GRACE_MS later it is stopped (background work the agent started ends
 * with it).
 */
export function createClaudeCliDriver(options: ClaudeCliDriverOptions): AgentDriver {
  const { command, toolTimeoutMs } = options;
  const exitGraceMs = options.exitGraceMs ?? EXIT_GRACE_MS;
  const killGraceMs = options.killGraceMs ?? KILL_GRACE_MS;
  if (command.length === 0) throw new TypeError('command must name a program');

  let child: ChildProcess | undefined;
  let bridge: PermissionBridge | undefined;
  let emit: (event: RunEvent) => void = () => {};
  let startCalled = false;
  let started = false;
  let turnEnded = false;
  let stopping = false;
  let finished = false;
  const timers = new Set<NodeJS.Timeout>();
  /** permission id -> bridge key, and back. */
  const pending = new Map<string, string>();
  const idOfKey = new Map<string, string>();
  let resolveExit: () => void = () => {};
  const exitPromise = new Promise<void>((resolve) => (resolveExit = resolve));

  const later = (ms: number, work: () => void): void => {
    const timer = setTimeout(() => {
      timers.delete(timer);
      work();
    }, ms);
    timers.add(timer);
  };

  const denyAll = (message: string): boolean => {
    let any = false;
    for (const [id, key] of pending) {
      pending.delete(id);
      idOfKey.delete(key);
      if (bridge?.decide(key, 'deny', message)) any = true;
    }
    return any;
  };

  const endInput = (): void => {
    if (child?.stdin && !child.stdin.writableEnded) child.stdin.end();
  };

  const terminate = (): void => {
    const proc = child;
    if (proc === undefined || finished) return;
    proc.kill('SIGTERM');
    later(killGraceMs, () => {
      if (finished || proc.pid === undefined) return;
      try {
        // The whole group: the agent and anything it started (detached: true).
        process.kill(-proc.pid, 'SIGKILL');
      } catch {
        proc.kill('SIGKILL');
      }
    });
  };

  const finish = (code: number | null, signal: string | null, startFailed: boolean): void => {
    if (finished) return;
    finished = true;
    for (const timer of timers) clearTimeout(timer);
    timers.clear();
    pending.clear();
    idOfKey.clear();
    const event: RunEvent = { type: 'exited', code, signal, startFailed };
    void (bridge?.close() ?? Promise.resolve())
      .catch(() => {})
      .then(() => {
        emit(event);
        emit = () => {};
        resolveExit();
      });
  };

  const onLine = (line: string): void => {
    const parsed = parseAgentLine(line);
    if (parsed === undefined || turnEnded || stopping) return;
    if (parsed.kind === 'init') {
      if (parsed.sessionId !== undefined) emit({ type: 'session', sessionId: parsed.sessionId });
    } else if (parsed.kind === 'message') emit({ type: 'message', text: parsed.text });
    else if (parsed.kind === 'result') {
      turnEnded = true;
      endInput();
      denyAll('The run has ended in Opsaip, so this was denied.');
      later(exitGraceMs, terminate);
      emit(parsed.text === undefined ? { type: 'result', ok: parsed.ok } : { type: 'result', ok: parsed.ok, text: parsed.text });
    }
  };

  return {
    agent: 'claude-code',

    async start({ cwd, prompt, resumeSessionId, onEvent }: DriverStartOptions) {
      if (startCalled || finished) throw new Error('this driver was already used or stopped');
      startCalled = true;
      emit = onEvent;
      try {
        bridge = await createPermissionBridge({
          toolTimeoutMs,
          onRequest(request) {
            if (turnEnded || stopping) {
              bridge?.decide(request.key, 'deny', 'The run has ended in Opsaip, so this was denied.');
              return;
            }
            const id = randomUUID();
            pending.set(id, request.key);
            idOfKey.set(request.key, id);
            const tool = truncate(oneLine(request.toolName), MAX_TOOL_CHARS) || 'unknown tool';
            emit({ type: 'permissionRequested', permission: { id, tool, summary: summarizeToolCall(request.toolName, request.input) } });
          },
          onWithdrawn(key) {
            const id = idOfKey.get(key);
            if (id === undefined) return;
            idOfKey.delete(key);
            pending.delete(id);
            emit({ type: 'permissionWithdrawn', permissionId: id });
          },
        });
      } catch {
        // No temporary directory or socket: the agent cannot be started.
        return finish(null, null, true);
      }
      // cancel() came while the bridge was being made: never start the agent.
      if (stopping) return finish(null, null, true);

      const [file, ...before] = command;
      let proc: ChildProcess;
      try {
        proc = spawn(file, [...before, ...claudeArgs(bridge.mcpConfigPath, resumeSessionId)], {
          cwd,
          env: agentEnv(options.env ?? process.env, toolTimeoutMs),
          stdio: ['pipe', 'pipe', 'pipe'],
          shell: false,
          // Its own process group, so a SIGKILL also reaches what it started.
          detached: true,
        });
      } catch {
        return finish(null, null, true);
      }
      child = proc;

      let exit: { code: number | null; signal: string | null } | undefined;
      let outputEnded = false;
      const settle = (): void => {
        if (exit !== undefined && outputEnded) finish(exit.code, exit.signal, false);
      };
      proc.once('spawn', () => {
        started = true;
        emit({ type: 'started' });
      });
      proc.on('error', () => {
        // Spawn failed (e.g. ENOENT: claude is not installed). After a
        // successful spawn, "error" means a kill() failed; "exit" still comes.
        if (!started) finish(null, null, true);
      });
      proc.once('exit', (code, signal) => {
        exit = { code, signal };
        // A process the agent started may still hold stdout open.
        later(OUTPUT_DRAIN_MS, () => finish(code, signal, false));
        settle();
      });

      const splitter = createLineSplitter(onLine);
      proc.stdout!.setEncoding('utf8');
      proc.stdout!.on('data', (chunk: string) => splitter.push(chunk));
      proc.stdout!.on('end', () => {
        outputEnded = true;
        settle();
      });
      proc.stdout!.on('error', () => {});
      // Never logged: it can hold anything the agent printed.
      proc.stderr!.resume();
      proc.stderr!.on('error', () => {});
      proc.stdin!.on('error', () => {}); // EPIPE once the agent has exited
      proc.stdin!.write(userMessageLine(prompt));
    },

    sendMessage(text) {
      if (child === undefined || !started || turnEnded || stopping || finished) return false;
      if (child.stdin === null || child.stdin.writableEnded) return false;
      child.stdin.write(userMessageLine(text));
      return true;
    },

    answerPermission(permissionId, allow, message) {
      const key = pending.get(permissionId);
      if (key === undefined || bridge === undefined) return false;
      pending.delete(permissionId);
      idOfKey.delete(key);
      return bridge.decide(key, allow ? 'allow' : 'deny', allow ? undefined : (message ?? 'The person denied this in Opsaip.'));
    },

    cancel(denyMessage = 'The person stopped this run in Opsaip.') {
      if (stopping || finished) return exitPromise;
      stopping = true;
      if (child === undefined) {
        // Not spawned. If start() is still preparing, it sees `stopping` and
        // ends the run itself; otherwise there is nothing to stop.
        if (!startCalled || bridge !== undefined) finish(null, null, true);
        return exitPromise;
      }
      const denied = denyAll(denyMessage);
      endInput();
      later(denied ? DENY_FLUSH_MS : 0, terminate);
      return exitPromise;
    },
  };
}
