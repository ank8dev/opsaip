// Server settings, read from environment variables once at startup.
import { fileURLToPath } from 'node:url';
import { HOW_TO_CREATE_TOKEN, tokenProblem } from './auth/accessToken';

export interface Config {
  host: string;
  port: number;
  /** SQLite file. A relative path is relative to the working directory. */
  dbPath: string;
  /** Access token for every request except the public paths. Never log it. */
  token: string;
  /** The web app build the server serves. A relative path is relative to the working directory. */
  webDir: string;
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4100;
export const DEFAULT_DB_PATH = './data/opsaip.db';
/** apps/web/dist in this repository, wherever the server is started from. */
export const DEFAULT_WEB_DIR = fileURLToPath(new URL('../../apps/web/dist', import.meta.url));

/** A setting is wrong. The message is safe to print and says how to fix it. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Read the config from env (pass process.env). Throws ConfigError on a bad value.
 *
 * OPSAIP_TOKEN is required on every host, localhost included: localhost is
 * not a security boundary (other local processes, browser DNS rebinding).
 * Error messages never contain the token.
 *
 * An empty or blank variable counts as unset. This matters for OPSAIP_HOST:
 * server.listen(port, '') would listen on ALL interfaces, not on localhost.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const host = valueOf(env.OPSAIP_HOST) ?? DEFAULT_HOST;

  const rawPort = valueOf(env.OPSAIP_PORT);
  let port = DEFAULT_PORT;
  if (rawPort !== undefined) {
    // Digits only. Number.parseInt would read "80abc" as 80.
    port = /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;
    if (!(port >= 1 && port <= 65535)) {
      throw new ConfigError('OPSAIP_PORT must be a whole number from 1 to 65535');
    }
  }

  const dbPath = valueOf(env.OPSAIP_DB) ?? DEFAULT_DB_PATH;
  const webDir = valueOf(env.OPSAIP_WEB_DIR) ?? DEFAULT_WEB_DIR;

  const token = valueOf(env.OPSAIP_TOKEN);
  if (token === undefined) {
    throw new ConfigError(`OPSAIP_TOKEN is not set. It is required on every host. ${HOW_TO_CREATE_TOKEN}`);
  }
  const problem = tokenProblem(token);
  if (problem !== undefined) throw new ConfigError(`${problem}. ${HOW_TO_CREATE_TOKEN}`);

  return { host, port, dbPath, token, webDir };
}

function valueOf(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === undefined || value === '' ? undefined : value;
}
