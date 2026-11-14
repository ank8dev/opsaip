// About and updates: GET /v1/about (versions) and GET /v1/update (is a newer
// release out). Live only. Pure: no React. The update check itself runs on the
// server (once a day, against GitHub Releases); the page only reads its result.
// There is no download or install: the app is not signed.

import { callApi, type ApiResult } from './chat/serverCall';

export const ABOUT_PATH = '/v1/about';
export const UPDATE_PATH = '/v1/update';

/** The app's version, set at build time from package.json. */
export const APP_VERSION: string = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : 'unknown';

/** Release links must stay on this repository's releases. */
export const RELEASES_PREFIX = 'https://github.com/ank8dev/opsaip/releases';

export interface About {
  serverVersion: string;
  node: string;
  /** The Claude Code CLI version the server found, or null. */
  claude: string | null;
}

export interface UpdateInfo {
  enabled: boolean;
  current: string;
  latest: string | null;
  url: string | null;
  newer: boolean;
}

const short = (s: string) => s.slice(0, 60);

export function parseAbout(body: unknown): About | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const b = body as { server?: unknown; node?: unknown; claude?: unknown };
  const server = b.server as { version?: unknown } | null;
  if (typeof server !== 'object' || server === null || typeof server.version !== 'string' || typeof b.node !== 'string') return undefined;
  return { serverVersion: short(server.version), node: short(b.node), claude: typeof b.claude === 'string' && b.claude.trim() !== '' ? short(b.claude.trim()) : null };
}

/** Is `url` a link to this repository's releases (and nothing else)? */
export function isReleaseUrl(url: unknown): url is string {
  return typeof url === 'string' && (url === RELEASES_PREFIX || url.startsWith(`${RELEASES_PREFIX}/`) || url.startsWith(`${RELEASES_PREFIX}?`)) && !/\s/.test(url);
}

export function parseUpdate(body: unknown): UpdateInfo | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const b = body as Record<string, unknown>;
  if (typeof b.enabled !== 'boolean' || typeof b.current !== 'string') return undefined;
  const latest = typeof b.latest === 'string' ? short(b.latest) : null;
  const url = isReleaseUrl(b.url) ? b.url : null;
  // A newer version is only announced with a safe link to it.
  const newer = b.enabled && b.newer === true && latest !== null && url !== null;
  return { enabled: b.enabled, current: short(b.current), latest, url, newer };
}

export const fetchAbout = (token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<About>> =>
  callApi({ token, action: 'about', path: ABOUT_PATH, method: 'GET', signal, fetchImpl, parse: parseAbout });

export const fetchUpdate = (token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<UpdateInfo>> =>
  callApi({ token, action: 'update', path: UPDATE_PATH, method: 'GET', signal, fetchImpl, parse: parseUpdate });

/** What Settings → About says about updates. */
export function updateText(u: UpdateInfo | null): string {
  if (u === null) return 'Not checked yet.';
  if (!u.enabled) return 'Update check is off on this server.';
  if (u.newer && u.latest !== null) return `Version ${u.latest} is available.`;
  return 'You are up to date.';
}
