// Read files of the web app build (apps/web/dist) for the server to send.
// Which paths are public, and which file each one maps to, is decided in
// auth/requestGuard.ts; this module only reads the file and sets headers.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WEB_CONTENT_TYPES, extensionOf } from './auth/requestGuard';

/**
 * Content-Security-Policy for the web app. Everything from this server only:
 * no inline scripts, no other hosts, no plugins, no <base>, no native form
 * submits (the token form must never submit to a URL), and no framing.
 *
 * One inline style is allowed: the EMPTY one. motion's AnimatePresence
 * mode="popLayout" (the sidebar) adds an empty <style> element and fills it
 * through CSSOM (insertRule), which CSP does not check. Allowing only the hash
 * of "" keeps every <style> with content blocked: safer than 'unsafe-inline'.
 * The desktop app (apps/desktop/src/appFiles.ts) does the same.
 */
export const EMPTY_STYLE_HASH = `'sha256-${createHash('sha256').update('').digest('base64')}'`;

export const WEB_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  `style-src 'self' ${EMPTY_STYLE_HASH}`,
  "img-src 'self'",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY_HEADERS = {
  'content-security-policy': WEB_CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
} as const;

export interface WebFile {
  body: Buffer;
  headers: Record<string, string>;
}

/**
 * Read `file` (from webFileForPath) inside `dir`. Undefined if it does not
 * exist. Other read errors throw: they are server faults (500).
 *
 * Hashed files in assets/ never change, so browsers may keep them for a
 * year; index.html and favicon.svg are checked again on every load.
 */
export async function readWebFile(dir: string, file: string): Promise<WebFile | undefined> {
  const contentType = WEB_CONTENT_TYPES[extensionOf(file)];
  if (contentType === undefined) return undefined;

  let body: Buffer;
  try {
    body = await readFile(join(dir, file));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') return undefined;
    throw error;
  }

  return {
    body,
    headers: {
      ...SECURITY_HEADERS,
      'content-type': contentType,
      'cache-control': file.startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    },
  };
}
