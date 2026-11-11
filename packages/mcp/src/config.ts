// MCP server settings, read from environment variables once at startup.

export interface Config {
  /** Where reports go: OPSAIP_URL + "/v1/reports". */
  reportsUrl: URL;
  /** Access token sent as "Authorization: Bearer <token>". Never log it. */
  token: string;
}

/** A setting is wrong. The message is safe to print and never contains the token. */
export class ConfigError extends Error {
  override name = 'ConfigError';
}

/**
 * Read the config from env (pass process.env). Throws ConfigError on a bad value.
 *
 *   OPSAIP_URL    the Opsaip server, e.g. http://127.0.0.1:4100. http or https,
 *                 no user:password@ part (it would end up in error messages).
 *   OPSAIP_TOKEN  the server's access token. Visible ASCII characters only.
 *
 * The token check matters for secrecy, not only for correctness: when a header
 * value is invalid (a space at the end, a newline), fetch throws an error whose
 * message contains the whole header value, token included.
 */
export function loadConfig(env: Readonly<Record<string, string | undefined>>): Config {
  const rawUrl = valueOf(env.OPSAIP_URL);
  if (rawUrl === undefined) {
    throw new ConfigError('OPSAIP_URL is not set. Set it to the Opsaip server, e.g. http://127.0.0.1:4100');
  }
  let base: URL;
  try {
    base = new URL(rawUrl);
  } catch {
    throw new ConfigError('OPSAIP_URL is not a valid URL, e.g. http://127.0.0.1:4100');
  }
  if (base.protocol !== 'http:' && base.protocol !== 'https:') {
    throw new ConfigError('OPSAIP_URL must start with http:// or https://');
  }
  if (base.username !== '' || base.password !== '') {
    throw new ConfigError('OPSAIP_URL must not contain a user name or password; use OPSAIP_TOKEN');
  }
  if (base.search !== '' || base.hash !== '') {
    throw new ConfigError('OPSAIP_URL must not have a query (?) or fragment (#)');
  }

  const token = env.OPSAIP_TOKEN;
  if (token === undefined || token.trim() === '') {
    throw new ConfigError('OPSAIP_TOKEN is not set. Use the same access token the Opsaip server uses');
  }
  // Not trimmed on purpose: a token with spaces around it is a copy-paste
  // mistake, and saying so is better than sending something else.
  if (!/^[\x21-\x7e]+$/.test(token)) {
    throw new ConfigError('OPSAIP_TOKEN must be visible ASCII characters only, with no spaces or line breaks');
  }

  // "http://host:4100" and "http://host:4100/" both mean the root; a path
  // prefix (a reverse proxy) is kept: "http://host/opsaip" -> /opsaip/v1/...
  const root = base.href.endsWith('/') ? base.href : `${base.href}/`;
  return { reportsUrl: new URL('v1/reports', root), token };
}

function valueOf(raw: string | undefined): string | undefined {
  const value = raw?.trim();
  return value === undefined || value === '' ? undefined : value;
}
