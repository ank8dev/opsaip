// GET /v1/about: server version, Node version and the Claude Code CLI version.
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** Runs `claude --version`; resolves with its stdout, rejects when it cannot run. */
export type ExecClaude = () => Promise<string>;

export const CLAUDE_TIMEOUT_MS = 3000;
export const CLAUDE_CACHE_MS = 5 * 60 * 1000;

export interface About {
  server: { version: string };
  node: string;
  claude: string | null;
}

/** The "version" field of server/package.json (found relative to this file: works under tsx and vitest). */
export function readServerVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** The environment of the claude child: PATH and HOME only, never an OPSAIP_* variable. */
export function minimalEnv(env: Readonly<Record<string, string | undefined>> = process.env): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot']) {
    if (env[key] !== undefined) out[key] = env[key];
  }
  return out;
}

/** The subset of execFile this file uses, so a test can see the arguments and the env. */
export type ExecFileFn = (
  file: string,
  args: string[],
  options: { timeout: number; env: NodeJS.ProcessEnv; maxBuffer: number; windowsHide: boolean },
  callback: (error: Error | null, stdout: string | Buffer) => void,
) => unknown;

/** The real exec: `claude --version`, no shell, fixed arguments, 3 s timeout, minimal env. */
export function createClaudeExec(run: ExecFileFn = execFile as unknown as ExecFileFn): ExecClaude {
  return () =>
    new Promise((resolve, reject) => {
      run(
        'claude',
        ['--version'],
        { timeout: CLAUDE_TIMEOUT_MS, env: minimalEnv(), maxBuffer: 64 * 1024, windowsHide: true },
        (error, stdout) => (error === null ? resolve(String(stdout)) : reject(error)),
      );
    });
}

/** The first MAJOR.MINOR.PATCH token of the output, or null. */
export function parseClaudeVersion(output: string): string | null {
  return /(?<![\d.])\d+\.\d+\.\d+(?![\d.])/.exec(output)?.[0] ?? null;
}

export interface AboutOptions {
  version?: string;
  exec?: ExecClaude;
  now?: () => number;
}

/** The about answer; the claude version is cached for 5 minutes (a miss is cached too). */
export function createAbout({
  version = readServerVersion(),
  exec = createClaudeExec(),
  now = Date.now,
}: AboutOptions = {}): () => Promise<About> {
  let cached: { at: number; value: string | null } | undefined;
  let inFlight: Promise<string | null> | undefined;

  async function claudeVersion(): Promise<string | null> {
    if (cached !== undefined && now() - cached.at < CLAUDE_CACHE_MS) return cached.value;
    inFlight ??= exec()
      .then(parseClaudeVersion, () => null)
      .then((value) => {
        cached = { at: now(), value };
        return value;
      })
      .finally(() => {
        inFlight = undefined;
      });
    return inFlight;
  }

  return async () => ({ server: { version }, node: process.version, claude: await claudeVersion() });
}
