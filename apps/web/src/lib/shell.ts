// Which shell the app runs in. The macOS desktop app (apps/desktop) serves this
// build at app://opsaip/, so the protocol tells it apart from a browser tab.
// CSS keys off <html data-shell="desktop">: room for the window buttons and a
// strip to drag the window by (the desktop window has no title bar).

export const DESKTOP_PROTOCOL = 'app:';

/** Mark <html> with data-shell="desktop" inside the desktop app; do nothing in a browser. */
export function markShell(
  doc: { documentElement: { dataset: Record<string, string | undefined> } },
  location: { protocol: string },
): void {
  if (location.protocol === DESKTOP_PROTOCOL) doc.documentElement.dataset.shell = 'desktop';
}
