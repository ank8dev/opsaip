// Server settings, read from environment variables once at startup.

export interface Config {
  host: string;
  port: number;
  /** SQLite file. A relative path is relative to the working directory. */
  dbPath: string;
}

export const DEFAULT_HOST = '127.0.0.1';
export const DEFAULT_PORT = 4100;
export const DEFAULT_DB_PATH = './data/opsaip.db';

/** A setting is wrong. The message is safe to print and says how to fix it. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Read the config from env (pass process.env). Throws ConfigError on a bad value.
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

  return { host, port, dbPath };
}

function valueOf(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === undefined || value === '' ? undefined : value;
}
