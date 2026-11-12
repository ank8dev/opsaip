// The app:// protocol: the window loads the apps/web build from disk at
// app://opsaip/... instead of file://, so the page has a real, fixed origin
// (localStorage works, CSP 'self' means this app only) and cannot read other
// files on the disk. Paths under /v1 are the API (see apiProxy.ts), never files.
import path from 'node:path';

export const APP_SCHEME = 'app';
export const APP_HOST = 'opsaip';
export const START_URL = `${APP_SCHEME}://${APP_HOST}/index.html`;

/**
 * SHA-256 of the empty string. motion's <AnimatePresence mode="popLayout">
 * adds an EMPTY <style> element, then fills it through CSSOM (insertRule),
 * which CSP does not check. Allowing this one hash lets that work while any
 * <style> with content stays blocked. Safer than 'unsafe-inline'.
 */
export const EMPTY_STYLE_HASH = "'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='";

/**
 * Content-Security-Policy for every page response. No inline scripts, no eval.
 * connect-src 'self': the page talks only to its own origin; /v1 is forwarded
 * to the Opsaip server by the main process.
 */
export const APP_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'self' ${EMPTY_STYLE_HASH}`,
  "font-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/** True for app://opsaip/... URLs, the only origin the window may show. */
export function isAppUrl(raw: string): boolean {
  const url = parse(raw);
  return (
    url !== null &&
    url.protocol === `${APP_SCHEME}:` &&
    url.host === APP_HOST &&
    url.username === '' &&
    url.password === ''
  );
}

/** The API part of the app origin: /v1 and everything under it. */
export function isApiPath(pathname: string): boolean {
  return pathname === '/v1' || pathname.startsWith('/v1/');
}

/**
 * The file on disk for an app:// request, or null (answer 404).
 * `root` is the web build folder. The result is always inside it.
 */
export function resolveAppFile(root: string, raw: string): string | null {
  const url = parse(raw);
  if (url === null || !isAppUrl(raw)) return null;

  let rel: string;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    return null; // malformed %-escape
  }
  if (rel.includes('\0') || rel.includes('\\')) return null;
  // Lower-cased: macOS disks are case-insensitive, so /V1/x would find v1/x.
  // Decoded: /%761/x is /v1/x too.
  if (isApiPath(rel.toLowerCase())) return null;
  if (rel === '/') rel = '/index.html';

  const base = path.resolve(root);
  const file = path.resolve(base, `.${rel}`);
  return file.startsWith(base + path.sep) ? file : null;
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.txt': 'text/plain; charset=utf-8',
};

/** Headers for a file response. Unknown types are never sniffed into something runnable. */
export function fileHeaders(file: string): Record<string, string> {
  return {
    'content-type': CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
    'content-security-policy': APP_CSP,
    'x-content-type-options': 'nosniff',
  };
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
