// What can be attached, per place: GET /v1/capabilities says what the server's
// LLM provider accepts in Ask and what Agent mode accepts. The page never
// hard-codes a provider, a type or a limit: it enables exactly what the server
// lists, and says why a file is not accepted. Pure: no React.
//
// The server checks the real content (magic bytes) of every file. The checks
// here only save an upload that would be refused, and explain it early.

import { callApi, type ApiResult } from '../chat/serverCall';

export const CAPABILITIES_PATH = '/v1/capabilities';

export type AttachmentKind = 'image' | 'video' | 'pdf' | 'text';
export type AttachPurpose = 'ask' | 'agent';

export interface AttachType {
  id: AttachmentKind;
  /** "Images", "Text and code". Shown as text. */
  label: string;
  mimes: string[];
  /** Lower case, without the dot. */
  extensions: string[];
  maxBytes: number;
}

export interface PlaceCapabilities {
  enabled: boolean;
  /** Ask only: the configured provider's display name ("Gemini"), or null. Never hard-coded here. */
  provider?: string | null;
  maxFiles: number;
  types: AttachType[];
}

export interface Capabilities {
  ask: PlaceCapabilities;
  agent: PlaceCapabilities;
}

const KINDS: readonly AttachmentKind[] = ['image', 'video', 'pdf', 'text'];
const MAX_FILES_CAP = 20;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseType(raw: unknown): AttachType | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, label, mimes, extensions, maxBytes } = raw;
  if (!(KINDS as readonly unknown[]).includes(id) || typeof label !== 'string') return undefined;
  if (!Array.isArray(mimes) || !mimes.every((m) => typeof m === 'string')) return undefined;
  if (!Array.isArray(extensions) || !extensions.every((e) => typeof e === 'string')) return undefined;
  if (typeof maxBytes !== 'number' || !Number.isFinite(maxBytes) || maxBytes <= 0) return undefined;
  return {
    id: id as AttachmentKind, label: label.slice(0, 40), mimes: mimes.map((m) => m.toLowerCase()),
    extensions: extensions.map((e) => e.toLowerCase().replace(/^\./, '')), maxBytes,
  };
}

function parsePlace(raw: unknown): PlaceCapabilities {
  const none: PlaceCapabilities = { enabled: false, provider: null, maxFiles: 0, types: [] };
  if (!isRecord(raw) || raw.enabled !== true) return none;
  const types = Array.isArray(raw.types) ? raw.types.map(parseType).filter((t): t is AttachType => t !== undefined) : [];
  const maxFiles = typeof raw.maxFiles === 'number' && Number.isInteger(raw.maxFiles) ? Math.min(Math.max(raw.maxFiles, 0), MAX_FILES_CAP) : 0;
  const provider = typeof raw.provider === 'string' && raw.provider.trim() !== '' ? raw.provider.trim().slice(0, 40) : null;
  return { enabled: types.length > 0 && maxFiles > 0, provider, maxFiles, types };
}

/** Read GET /v1/capabilities. A server without it (older) gives no attachments, not an error. Never throws. */
export function parseCapabilities(body: unknown): Capabilities | undefined {
  if (!isRecord(body)) return undefined;
  return { ask: parsePlace(body.ask), agent: parsePlace(body.agent) };
}

export const NO_CAPABILITIES: Capabilities = { ask: parsePlace(null), agent: parsePlace(null) };

export function fetchCapabilities(token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<Capabilities>> {
  return callApi({ token, action: 'capabilities', path: CAPABILITIES_PATH, method: 'GET', signal, fetchImpl, parse: parseCapabilities });
}

// ---- Is this file accepted? ----

export const BLOCKED_EXTENSIONS: Record<string, string> = {
  svg: 'SVG files can contain scripts',
  html: 'HTML files can contain scripts', htm: 'HTML files can contain scripts',
  zip: 'archives are not accepted', tar: 'archives are not accepted', gz: 'archives are not accepted', tgz: 'archives are not accepted',
  rar: 'archives are not accepted', '7z': 'archives are not accepted', bz2: 'archives are not accepted', xz: 'archives are not accepted',
  exe: 'programs are not accepted', dll: 'programs are not accepted', bat: 'programs are not accepted', cmd: 'programs are not accepted',
  msi: 'programs are not accepted', app: 'programs are not accepted', dmg: 'programs are not accepted', pkg: 'programs are not accepted',
  apk: 'programs are not accepted', jar: 'programs are not accepted', com: 'programs are not accepted', scr: 'programs are not accepted',
  so: 'programs are not accepted', dylib: 'programs are not accepted', bin: 'programs are not accepted',
};

export function extensionOf(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? '';
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${Math.round((n / (1024 * 1024)) * 10) / 10} MB`;
}

/** The type of a file by its extension or declared mime, among `types`. undefined: none. */
export function typeOf(file: { name: string; type: string }, types: readonly AttachType[]): AttachType | undefined {
  const ext = extensionOf(file.name);
  const mime = file.type.toLowerCase();
  return types.find((t) => (ext !== '' && t.extensions.includes(ext)) || (mime !== '' && t.mimes.includes(mime)));
}

/**
 * Why `file` cannot be attached, or undefined if it can. `already` is how many
 * files are attached now. `place` is the capabilities of where it would go.
 */
export function fileProblem(
  file: { name: string; size: number; type: string },
  place: PlaceCapabilities,
  purpose: AttachPurpose,
  already: number,
): string | undefined {
  if (!place.enabled) return purpose === 'ask' ? 'Files cannot be attached in Ask on this server.' : 'Files cannot be attached to agent tasks on this server.';
  if (already >= place.maxFiles) return `At most ${place.maxFiles} files per message.`;
  const ext = extensionOf(file.name);
  const blocked = BLOCKED_EXTENSIONS[ext];
  if (blocked !== undefined) return `${file.name}: ${blocked}.`;
  const type = typeOf(file, place.types);
  if (type === undefined) {
    const where = purpose === 'ask' ? (place.provider ?? 'the Ask provider') : 'agent tasks';
    return `${file.name}: ${where} does not accept ${ext === '' ? 'this kind of file' : `.${ext} files`}.`;
  }
  if (file.size === 0) return `${file.name} is empty.`;
  if (file.size > type.maxBytes) return `${file.name} is ${formatBytes(file.size)}; the limit for ${type.label.toLowerCase()} is ${formatBytes(type.maxBytes)}.`;
  return undefined;
}

/** The accept attribute of the file input: what the server lists, nothing else. */
export function acceptAttribute(place: PlaceCapabilities): string {
  return place.types.flatMap((t) => [...t.mimes, ...t.extensions.map((e) => `.${e}`)]).join(',');
}

/** "Files you attach in Ask are sent to Gemini." Names the configured provider; null when there is none. */
export function providerLine(caps: Capabilities): string | null {
  const { ask } = caps;
  return ask.enabled && ask.provider !== null && ask.provider !== undefined ? `Files you attach in Ask are sent to ${ask.provider}.` : null;
}
