// Which requests need the access token. Default deny: every path needs it,
// except an explicit list of public paths. Keep every auth decision in this
// folder: changes here need a founder review (.github/SECURITY_PATHS).
import { createTokenCheck } from './accessToken';

/** The health check: open, so a load balancer or monitor needs no token. */
export const HEALTH_PATH = '/healthz';

// A file name in the web build's assets/ folder: one path segment, the
// characters Vite uses in hashed names, and a known extension. No decoding,
// no "..", no leading dot: a path that does not match is simply not public.
const ASSET = /^\/assets\/([A-Za-z0-9_-][A-Za-z0-9._-]{0,199})$/;

/** Extension -> Content-Type for the files of the web build. Others are never served. */
export const WEB_CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * The web build file a public path serves, relative to the build folder, or
 * undefined if the path is not a web file. The web app is public: it holds no
 * data and no secrets, and it needs the token from the user to read anything.
 *
 *   /, /index.html  -> index.html
 *   /favicon.svg    -> favicon.svg
 *   /assets/<name>  -> assets/<name>, for a name with a known extension
 */
export function webFileForPath(path: string): string | undefined {
  if (path === '/' || path === '/index.html') return 'index.html';
  if (path === '/favicon.svg') return 'favicon.svg';
  const name = ASSET.exec(path)?.[1];
  if (name === undefined || name.includes('..')) return undefined;
  return Object.hasOwn(WEB_CONTENT_TYPES, extensionOf(name)) ? `assets/${name}` : undefined;
}

/** True if `path` may be requested without the token. Exact match: no prefixes, no case folding. */
export function isPublicPath(path: string): boolean {
  return path === HEALTH_PATH || webFileForPath(path) !== undefined;
}

/**
 * Make the check run before routing: true if a request for `path` with this
 * Authorization header may go on. `path` is the raw path, without the query.
 */
export function createRequestGuard(token: string): (path: string, authorization: string | undefined) => boolean {
  const isAuthorized = createTokenCheck(token);
  return (path, authorization) => isPublicPath(path) || isAuthorized(authorization);
}

/** ".js" for "index-abc.js"; "" when there is no dot. Case is kept: ".JS" is not ".js". */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}
