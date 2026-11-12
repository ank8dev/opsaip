// What the window may load, open and ask for. Pure functions; main.ts wires
// them into Electron. Every rule fails closed: anything not listed is refused.
import { isAppUrl } from './appFiles.js';

/**
 * Requests from the window's session. Only the app's own origin (the API goes
 * through it too), and data: images. DevTools only in development.
 */
export function isAllowedWindowRequest(raw: string, opts: { devTools: boolean }): boolean {
  if (isAppUrl(raw)) return true;
  const url = parse(raw);
  if (url === null) return false;
  if (url.protocol === 'data:') return true;
  return opts.devTools && url.protocol === 'devtools:';
}

/** Requests from the API session (the main process's forwarding): the server's origin only. */
export function isAllowedApiRequest(raw: string, serverBase: string | null): boolean {
  if (serverBase === null) return false;
  const url = parse(raw);
  return url !== null && url.origin === new URL(serverBase).origin;
}

/** May the window navigate to this URL? Only within the app. */
export function isInAppNavigation(raw: string): boolean {
  return isAppUrl(raw);
}

const EXTERNAL_PROTOCOLS = new Set(['https:', 'http:', 'mailto:']);

/**
 * A link that leaves the app opens in the default browser (or mail app).
 * Returns the URL to hand to the OS, or null to drop it (file:, javascript:,
 * custom app schemes, anything else).
 */
export function externalUrl(raw: string): string | null {
  const url = parse(raw);
  if (url === null || !EXTERNAL_PROTOCOLS.has(url.protocol)) return null;
  return url.href;
}

/** Web permissions: only writing to the clipboard (the "copy" buttons). */
export function isAllowedPermission(permission: string): boolean {
  return permission === 'clipboard-sanitized-write';
}

function parse(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}
