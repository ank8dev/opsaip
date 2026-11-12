// The desktop app's settings: one JSON file in the app's data folder,
//   ~/Library/Application Support/Opsaip/config.json
//   { "serverUrl": "https://opsaip.example.com" }
// No UI edits it. It is read once at startup.
//
// serverUrl is the only network address the app may reach, and only from the
// main process (see apiProxy.ts). Rules:
//   - https: for any host; http: only for this machine (localhost, 127.x.x.x,
//     [::1]), because the bearer token would cross the network in clear text;
//   - no user:password@ part, no query (?), no fragment (#);
//   - a path is kept as a prefix (a reverse proxy): https://host/opsaip ->
//     https://host/opsaip/v1/...

export interface DesktopConfig {
  /** The server's base URL, always ending in "/", or null: no network at all. */
  serverBase: string | null;
  /** Why the file was not used, safe to show. Undefined when it was fine or missing. */
  problem?: string;
}

const LOOPBACK_HOST = /^(localhost|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|\[::1\])$/;

/** Parse the config file's text. `null` means the file does not exist. Never throws. */
export function parseConfig(text: string | null): DesktopConfig {
  if (text === null) return { serverBase: null };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return off('config.json is not valid JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return off('config.json must be a JSON object, e.g. { "serverUrl": "https://opsaip.example.com" }');
  }

  const raw = (data as Record<string, unknown>).serverUrl;
  if (raw === undefined) return off('config.json has no "serverUrl"');
  if (typeof raw !== 'string' || raw.trim() === '') return off('"serverUrl" must be a non-empty string');

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return off('"serverUrl" is not a valid URL, e.g. https://opsaip.example.com');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return off('"serverUrl" must start with https://');
  }
  if (url.protocol === 'http:' && !LOOPBACK_HOST.test(url.hostname)) {
    return off('"serverUrl" must use https:// unless the server runs on this Mac (localhost)');
  }
  if (url.username !== '' || url.password !== '') {
    return off('"serverUrl" must not contain a user name or password');
  }
  if (url.search !== '' || url.hash !== '') {
    return off('"serverUrl" must not have a query (?) or fragment (#)');
  }

  return { serverBase: url.href.endsWith('/') ? url.href : `${url.href}/` };
}

function off(problem: string): DesktopConfig {
  return { serverBase: null, problem };
}
