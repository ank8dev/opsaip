// Read an upload's body with the size limit enforced WHILE reading: nothing
// beyond the limit is buffered, and reading stops at the first byte over it
// (the caller answers 413 and closes the connection).
import type { Readable } from 'node:stream';
import { SNIFF_BYTES } from './fileTypes';

/** What the first bytes say about the file: its size limit, or a reason to refuse it now. */
export type Decision = { limit: number } | { reject: string };

export type ReadResult =
  | { ok: true; bytes: Buffer }
  | { ok: false; status: 400 | 413; error: string };

const tooLarge = (limit: number): ReadResult => ({
  ok: false,
  status: 413,
  error: `file must be at most ${limit} bytes`,
});

/**
 * @param hardLimit the largest limit `decide` may return: a body over it is
 *   refused before anything is read (Content-Length) or as soon as it is
 *   reached.
 * @param decide called once, with the first SNIFF_BYTES bytes (or the whole
 *   body if shorter): the limit for this kind of file, from its content.
 */
export function readUpload(
  req: Readable & { headers: { 'content-length'?: string | string[] } },
  hardLimit: number,
  decide: (head: Buffer) => Decision,
): Promise<ReadResult> {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (declared > hardLimit) return resolve(tooLarge(hardLimit));

    const chunks: Buffer[] = [];
    let size = 0;
    let limit = hardLimit;
    let decided = false;
    let done = false;

    const stop = (result: ReadResult): void => {
      if (done) return;
      done = true;
      chunks.length = 0;
      // Stop reading: no more "data" events. The caller closes the connection.
      req.removeAllListeners('data');
      req.pause();
      resolve(result);
    };
    const decideNow = (): void => {
      decided = true;
      const head = Buffer.concat(chunks, size).subarray(0, SNIFF_BYTES);
      const decision = decide(head);
      if ('reject' in decision) return stop({ ok: false, status: 400, error: decision.reject });
      limit = Math.min(decision.limit, hardLimit);
      if (declared > limit) stop(tooLarge(limit));
    };

    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limit) return stop(tooLarge(limit));
      chunks.push(chunk);
      if (!decided && size >= SNIFF_BYTES) {
        decideNow();
        if (!done && size > limit) stop(tooLarge(limit));
      }
    });
    req.on('end', () => {
      if (done) return;
      if (!decided) decideNow();
      if (done) return;
      done = true;
      resolve({ ok: true, bytes: Buffer.concat(chunks, size) });
    });
    req.on('error', (error) => {
      if (!done) {
        done = true;
        reject(error);
      }
    });
  });
}
