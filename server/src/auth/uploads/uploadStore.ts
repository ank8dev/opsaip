// Uploaded files waiting to be used by one Ask question or one Agent run.
// In server memory only: never written to disk, never logged, forgotten after
// a TTL and on restart. Each upload is bound to its purpose.
import { randomUUID } from 'node:crypto';
import type { FileKind } from '../askProvider';
import { MAX_FILES } from './fileTypes';

export type UploadPurpose = 'ask' | 'agent';

/** How long an upload waits to be used. */
export const UPLOAD_TTL_MS = 15 * 60_000;
/** All waiting uploads together, in bytes. */
export const UPLOADS_MAX_TOTAL_BYTES = 256 * 1024 * 1024;

export interface UploadedFile {
  id: string;
  /** Sanitized display text. Never a path. */
  name: string;
  /** The detected mime type. */
  mime: string;
  kind: FileKind;
  /** The extension of the detected type (generated names use it). */
  ext: string;
  size: number;
  bytes: Uint8Array;
}

/** What the browser is told about a file, and what a transcript entry keeps. */
export interface AttachmentInfo {
  name: string;
  kind: FileKind;
  size: number;
}

export const UNKNOWN_UPLOAD = 'an attachment is unknown or has expired: attach the file again';

export type Taken = { ok: true; files: UploadedFile[] } | { ok: false; error: string };

export interface UploadStore {
  /** Keep a file. Undefined: the store is full. */
  put(purpose: UploadPurpose, file: Omit<UploadedFile, 'id'>): UploadedFile | undefined;
  /** Forget one upload; false if it was not there. Used when a person removes a chip. */
  delete(id: string): boolean;
  /** The files for these ids (all must be there, for this purpose), without removing them. */
  peek(ids: readonly string[], purpose: UploadPurpose): Taken;
  /** Forget these uploads (after use). */
  consume(ids: readonly string[]): void;
  /** Stop the cleanup timer. */
  close(): void;
}

export interface UploadStoreOptions {
  ttlMs?: number;
  maxTotalBytes?: number;
  now?: () => number;
}

export function createUploadStore({
  ttlMs = UPLOAD_TTL_MS,
  maxTotalBytes = UPLOADS_MAX_TOTAL_BYTES,
  now = Date.now,
}: UploadStoreOptions = {}): UploadStore {
  const items = new Map<string, { purpose: UploadPurpose; file: UploadedFile; expiresAt: number }>();
  let total = 0;

  const drop = (id: string): boolean => {
    const item = items.get(id);
    if (item === undefined) return false;
    total -= item.file.size;
    items.delete(id);
    return true;
  };
  const sweep = (): void => {
    const t = now();
    for (const [id, item] of items) if (item.expiresAt <= t) drop(id);
  };
  // A timer, so expired files do not sit in memory until the next request.
  const timer = setInterval(sweep, 60_000);
  timer.unref();

  return {
    put(purpose, file) {
      sweep();
      if (total + file.size > maxTotalBytes) return undefined;
      const stored: UploadedFile = { ...file, id: randomUUID() };
      items.set(stored.id, { purpose, file: stored, expiresAt: now() + ttlMs });
      total += stored.size;
      return stored;
    },
    delete(id) {
      sweep();
      return drop(id);
    },
    peek(ids, purpose) {
      sweep();
      const files: UploadedFile[] = [];
      for (const id of ids) {
        const item = items.get(id);
        if (item === undefined || item.purpose !== purpose) return { ok: false, error: UNKNOWN_UPLOAD };
        files.push(item.file);
      }
      return { ok: true, files };
    },
    consume(ids) {
      for (const id of ids) drop(id);
    },
    close: () => clearInterval(timer),
  };
}

export type ParsedIds = { ok: true; ids: string[] } | { ok: false; reason: string };

/** The "attachments" field of a request body: absent, or up to MAX_FILES distinct upload ids. */
export function parseAttachmentIds(value: unknown): ParsedIds {
  if (value === undefined) return { ok: true, ids: [] };
  if (!Array.isArray(value)) return { ok: false, reason: 'attachments must be a list of upload ids' };
  if (value.length > MAX_FILES) return { ok: false, reason: `at most ${MAX_FILES} attachments per message` };
  const ids: string[] = [];
  for (const id of value) {
    if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
      return { ok: false, reason: 'attachments must be a list of upload ids' };
    }
    if (ids.includes(id)) return { ok: false, reason: 'an attachment is listed twice' };
    ids.push(id);
  }
  return { ok: true, ids };
}

export const infoOf = ({ name, kind, size }: UploadedFile): AttachmentInfo => ({ name, kind, size });
