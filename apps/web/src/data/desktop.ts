// What the Opsaip desktop app (apps/desktop) adds to the page, through its
// preload script: window.opsaipDesktop. In a browser there is none, and the
// page must work without it. Pure: no React.

declare global {
  interface Window {
    /** Set by the desktop app only. */
    opsaipDesktop?: { pickFolder?: unknown };
  }
}

/**
 * The desktop app's native folder picker: it resolves to the chosen folder's
 * absolute path, or null if you closed it. undefined in a browser.
 */
export function folderPicker(): (() => Promise<string | null>) | undefined {
  const pick = typeof window === 'undefined' ? undefined : window.opsaipDesktop?.pickFolder;
  if (typeof pick !== 'function') return undefined;
  return async () => {
    const chosen: unknown = await pick();
    return typeof chosen === 'string' && chosen !== '' ? chosen : null;
  };
}
