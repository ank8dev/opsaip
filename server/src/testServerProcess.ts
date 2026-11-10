// Test helper (not a test): run src/main.ts as a real process, the way
// `npm run server` does (Node + tsx), and collect everything it prints.
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer, type AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));

export interface ServerProcess {
  child: ChildProcess;
  /** Everything printed so far, stdout and stderr together. */
  output(): string;
  /** Resolves with the exit code once the process has exited. */
  exited: Promise<number | null>;
}

/**
 * Start the server with exactly `env` as its OPSAIP_* settings: OPSAIP_*
 * variables from the environment running the tests are removed first.
 */
export function spawnServer(env: Record<string, string>): ServerProcess {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith('OPSAIP_')),
  );
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/main.ts'], {
    cwd: SERVER_DIR,
    env: { ...inherited, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout!.on('data', (chunk: Buffer) => (output += chunk.toString()));
  child.stderr!.on('data', (chunk: Buffer) => (output += chunk.toString()));
  const exited = once(child, 'exit').then(([code]) => code as number | null);
  return { child, output: () => output, exited };
}

/** Wait until the server prints that it listens; fail if it exits first. */
export async function waitUntilListening(server: ServerProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (server.output().includes('server listening')) resolve();
    };
    server.child.stdout!.on('data', check);
    check();
    void server.exited.then((code) =>
      reject(new Error(`server exited (${code}) before listening:\n${server.output()}`)),
    );
  });
}

/** Send SIGTERM and return the exit code. */
export async function stopServer(server: ServerProcess): Promise<number | null> {
  server.child.kill('SIGTERM');
  return server.exited;
}

/** A port that was free a moment ago. */
export async function freePort(): Promise<number> {
  const probe = createServer().listen(0, '127.0.0.1');
  await once(probe, 'listening');
  const { port } = probe.address() as AddressInfo;
  probe.close();
  await once(probe, 'close');
  return port;
}
