// Upload one file: POST /v1/uploads?purpose=ask|agent with the raw bytes. The
// server checks the content, keeps the file briefly and answers with an id; the
// message then names ids, never bytes. Pure: no React. Never throws.
// The token goes only in the Authorization header. File names and contents are
// never logged.

import { problemFor, serverReason, type Problem } from '../chat/problems';
import type { AttachmentKind, AttachPurpose } from './capabilities';

export const UPLOADS_PATH = '/v1/uploads';

export interface Upload {
  id: string;
  /** Sanitized by the server: shown as text. */
  name: string;
  mime: string;
  kind: AttachmentKind;
  size: number;
}

export type UploadResult = { ok: true; upload: Upload } | { ok: false; problem: Problem; reason?: string };

const KINDS: readonly unknown[] = ['image', 'video', 'pdf', 'text'];

export function parseUploadResponse(body: unknown): Upload | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined;
  const u = (body as { upload?: unknown }).upload;
  if (typeof u !== 'object' || u === null || Array.isArray(u)) return undefined;
  const { id, name, mime, kind, size } = u as Record<string, unknown>;
  if (typeof id !== 'string' || id.trim() === '' || typeof name !== 'string' || typeof mime !== 'string') return undefined;
  if (!KINDS.includes(kind) || typeof size !== 'number' || !Number.isFinite(size)) return undefined;
  return { id, name: name.slice(0, 200), mime, kind: kind as AttachmentKind, size };
}

export async function uploadFile(
  token: string, purpose: AttachPurpose, file: Blob & { name: string }, signal: AbortSignal, fetchImpl: typeof fetch = globalThis.fetch,
): Promise<UploadResult> {
  let res: Response;
  try {
    res = await fetchImpl(`${UPLOADS_PATH}?purpose=${purpose}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        'content-type': file.type || 'application/octet-stream',
        'x-filename': encodeURIComponent(file.name).slice(0, 600),
      },
      body: file,
      signal,
      cache: 'no-store',
      redirect: 'error',
    });
  } catch {
    return { ok: false, problem: 'unreachable' };
  }
  let body: unknown;
  try { body = await res.json(); } catch { body = undefined; }
  if (!res.ok) {
    const problem = problemFor('upload', res.status);
    const reason = problem === 'bad-request' ? serverReason(body) : undefined;
    return reason === undefined ? { ok: false, problem } : { ok: false, problem, reason };
  }
  const upload = parseUploadResponse(body);
  return upload === undefined ? { ok: false, problem: 'bad-response' } : { ok: true, upload };
}

/** DELETE /v1/uploads/:id, when a chip is removed. Best effort: the server also forgets uploads by itself. */
export async function deleteUpload(token: string, id: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<void> {
  try {
    await fetchImpl(`${UPLOADS_PATH}/${encodeURIComponent(id)}`, {
      method: 'DELETE', headers: { authorization: `Bearer ${token}` }, cache: 'no-store', redirect: 'error',
    });
  } catch {
    // Nothing to do: the server drops it after its time limit.
  }
}

/** A short text for a failed upload, safe to show. */
export function uploadProblemText(problem: Problem, reason?: string): string {
  switch (problem) {
    case 'bad-request': return reason ?? 'The server did not accept this file.';
    case 'too-large': return 'The file is too large for the server.';
    case 'unauthorized': return 'The server rejected the token. Open Settings, then Server, to reconnect.';
    case 'unreachable': return 'I could not reach the server.';
    default: return 'The file could not be uploaded. Try again.';
  }
}
