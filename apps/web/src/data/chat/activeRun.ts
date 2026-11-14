// The run being followed, remembered for this tab so a reload brings its card
// back (and a pending request can still be answered). Pure: no React. Every
// storage access is wrapped: blocked or broken storage just means no memory,
// like the token in ../source.ts.

import type { KeyValueStore } from '../source';

export const ACTIVE_RUN_KEY = 'opsaip.activeRun';

export interface ActiveRun {
  id: string;
  /** What the run was started with: the server's run has no title. May be ''. */
  title: string;
}

function sessionStore(): KeyValueStore | undefined {
  try {
    return globalThis.sessionStorage;
  } catch {
    return undefined; // reading sessionStorage itself can throw when storage is blocked
  }
}

/** The remembered run, or null. Anything that is not a run id is ignored. */
export function loadActiveRun(storage: KeyValueStore | undefined = sessionStore()): ActiveRun | null {
  try {
    const raw = storage?.getItem(ACTIVE_RUN_KEY) ?? null;
    if (raw === null || raw.trim() === '') return null;
    if (!raw.startsWith('{')) return { id: raw.trim(), title: '' }; // just an id
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const { id, title } = value as { id?: unknown; title?: unknown };
    if (typeof id !== 'string' || id.trim() === '') return null;
    return { id, title: typeof title === 'string' ? title : '' };
  } catch {
    return null;
  }
}

export function saveActiveRun(run: ActiveRun, storage: KeyValueStore | undefined = sessionStore()): void {
  try {
    storage?.setItem(ACTIVE_RUN_KEY, JSON.stringify({ id: run.id, title: run.title }));
  } catch {
    // Private mode or storage disabled: the run is just not remembered across a reload.
  }
}

export function clearActiveRun(storage: KeyValueStore | undefined = sessionStore()): void {
  try {
    storage?.removeItem(ACTIVE_RUN_KEY);
  } catch {
    // Nothing saved that we can reach.
  }
}
