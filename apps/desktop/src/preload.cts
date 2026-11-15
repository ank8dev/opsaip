// Runs in the window before the page, in Electron's sandbox. It gives the page
// exactly one thing: a way to ask for a folder. No Node, no file access, no
// other IPC. CommonJS (.cts): a sandboxed preload cannot be an ES module.
import { contextBridge, ipcRenderer } from 'electron';

// Keep in step with PICK_FOLDER_CHANNEL in folderPicker.ts (a test checks it).
const PICK_FOLDER_CHANNEL = 'opsaip:pick-folder';

contextBridge.exposeInMainWorld('opsaipDesktop', {
  /** Resolves to the chosen folder's absolute path, or null if the dialog was closed. */
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke(PICK_FOLDER_CHANNEL),
});
