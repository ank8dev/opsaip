// The native folder picker the web page can ask for (Settings > Repositories >
// Choose folder). The page cannot open a native dialog itself: it asks the
// main process through the preload script (preload.cts), which exposes one
// function, window.opsaipDesktop.pickFolder(). Pure rules here; main.ts wires
// them to Electron's dialog.
import { isAppUrl } from './appFiles.js';

/** The IPC channel. preload.cts says the same string (it is a CommonJS file and cannot import this one). */
export const PICK_FOLDER_CHANNEL = 'opsaip:pick-folder';

/** Only the app's own page may open the dialog (never a frame or a page that is not app://opsaip/...). */
export function isTrustedSender(frameUrl: string | undefined): boolean {
  return frameUrl !== undefined && isAppUrl(frameUrl);
}

/** What the dialog returned, as the one path the page gets: the first chosen folder, or null if it was closed. */
export function chosenFolder(result: { canceled: boolean; filePaths: readonly string[] }): string | null {
  if (result.canceled) return null;
  const first = result.filePaths[0];
  return typeof first === 'string' && first !== '' ? first : null;
}
