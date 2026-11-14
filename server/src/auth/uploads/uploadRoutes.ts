// The HTTP endpoints for file attachments. app.ts mounts them behind the same
// access-token guard as every other /v1 path; nothing here checks the token.
//
//   GET    /v1/capabilities          200 { ask: { enabled, provider, maxFiles, maxTotalBytes, types },
//                                          agent: { enabled, maxFiles, maxTotalBytes, types } }
//   POST   /v1/uploads?purpose=ask|agent   raw body = the file; headers Content-Type (informational),
//                                     X-Filename (percent-encoded, display only)
//                                     -> 201 { upload: { id, name, mime, kind, size } }
//                                        | 400 | 413 | 429 | 503
//   DELETE /v1/uploads/:id           204 | 404
//
// The file type is decided from the file's content (fileTypes.ts). Nothing
// about a file (bytes, name) is ever logged.
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AskProvider, FileTypeCapability } from '../askProvider';
import { CONDUCTOR_OFF } from '../conductor/conductorConfig';
import type { RouteHandler } from '../conductor/conductorRoutes';
import { displayName, extensionOf } from './fileName';
import {
  AGENT_MAX_TOTAL_BYTES,
  AGENT_TYPES,
  CONTENT_MISMATCH,
  MAX_FILES,
  NOT_ALLOWED,
  detectFile,
  sniffBinary,
  typeFor,
} from './fileTypes';
import { readUpload, type Decision } from './readUpload';
import type { UploadPurpose, UploadStore } from './uploadStore';

export interface UploadRouteHelpers {
  store: UploadStore;
  /** undefined: Ask is off. */
  ask: AskProvider | undefined;
  /** Conductor mode is on. */
  agentEnabled: boolean;
  sendJson(res: ServerResponse, status: number, body: unknown, headers?: Record<string, string>): void;
}

/** The body of GET /v1/capabilities. */
export function capabilities({ ask, agentEnabled }: Pick<UploadRouteHelpers, 'ask' | 'agentEnabled'>): unknown {
  return {
    ask: {
      enabled: ask !== undefined,
      provider: ask?.displayName ?? null,
      maxFiles: MAX_FILES,
      maxTotalBytes: ask?.capabilities.maxTotalBytes ?? 0,
      types: ask?.capabilities.types ?? [],
    },
    agent: {
      enabled: agentEnabled,
      maxFiles: MAX_FILES,
      maxTotalBytes: AGENT_MAX_TOTAL_BYTES,
      types: AGENT_TYPES,
    },
  };
}

export function uploadRoutes({ store, ask, agentEnabled, sendJson }: UploadRouteHelpers): Record<string, Record<string, RouteHandler>> {
  /** The types for a purpose, or the answer to send (503) when it is not available. */
  const typesFor = (purpose: UploadPurpose): readonly FileTypeCapability[] | string => {
    if (purpose === 'agent') return agentEnabled ? AGENT_TYPES : CONDUCTOR_OFF;
    const types = ask?.capabilities.types ?? [];
    return types.length > 0 ? types : 'Ask is not configured for attachments';
  };

  return {
    '/v1/capabilities': {
      GET: (_req, res) => sendJson(res, 200, capabilities({ ask, agentEnabled })),
    },
    '/v1/uploads': {
      POST: async (req, res) => {
        const purpose = purposeOf(req);
        if (purpose === undefined) return sendJson(res, 400, { error: 'purpose must be "ask" or "agent"' });
        // Checked before reading the body: no reason to read a file that cannot be used.
        const types = typesFor(purpose);
        if (typeof types === 'string') return sendJson(res, 503, { error: types });

        const name = displayName(header(req, 'x-filename'));
        const ext = extensionOf(name);
        const hardLimit = Math.max(...types.map((type) => type.maxBytes));
        const body = await readUpload(req, hardLimit, (head) => limitFor(types, head, ext));
        if (!body.ok) {
          // The rest of the body is not read: close the connection.
          return sendJson(res, body.status, { error: body.error }, { connection: 'close' });
        }
        if (body.bytes.length === 0) return sendJson(res, 400, { error: 'the file is empty' });

        const detected = detectFile(body.bytes, ext);
        if (!detected.ok) return sendJson(res, 400, { error: detected.reason });
        const type = typeFor(types, detected);
        if (type === undefined) return sendJson(res, 400, { error: NOT_ALLOWED });
        if (body.bytes.length > type.maxBytes) {
          return sendJson(res, 413, { error: `file must be at most ${type.maxBytes} bytes` });
        }

        const stored = store.put(purpose, {
          name,
          mime: detected.mime,
          kind: detected.kind,
          ext: detected.ext,
          size: body.bytes.length,
          bytes: body.bytes,
        });
        if (stored === undefined) {
          return sendJson(res, 429, { error: 'too many files are waiting to be used: send a message or try again later' });
        }
        sendJson(res, 201, {
          upload: { id: stored.id, name: stored.name, mime: stored.mime, kind: stored.kind, size: stored.size },
        });
      },
    },
    '/v1/uploads/:id': {
      DELETE: (_req, res, { id }) => {
        if (!store.delete(id)) return sendJson(res, 404, { error: 'upload not found' });
        res.writeHead(204).end();
      },
    },
  };
}

/** The size limit for a file from its first bytes (and extension), or a reason to refuse it now. */
function limitFor(types: readonly FileTypeCapability[], head: Buffer, ext: string): Decision {
  const binary = sniffBinary(head);
  if (binary !== undefined) {
    const type = types.find((candidate) => candidate.id === binary.kind && candidate.mimes.includes(binary.mime));
    return type === undefined ? { reject: NOT_ALLOWED } : { limit: type.maxBytes };
  }
  const text = types.find((candidate) => candidate.id === 'text' && candidate.extensions.includes(ext));
  if (text !== undefined) return { limit: text.maxBytes };
  return { reject: types.some((type) => type.extensions.includes(ext)) ? CONTENT_MISMATCH : NOT_ALLOWED };
}

function purposeOf(req: IncomingMessage): UploadPurpose | undefined {
  const query = (req.url ?? '').split('?', 2)[1] ?? '';
  const purpose = new URLSearchParams(query).get('purpose');
  return purpose === 'ask' || purpose === 'agent' ? purpose : undefined;
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
