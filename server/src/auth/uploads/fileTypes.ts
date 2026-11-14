// What a file really is, decided by its CONTENT (magic bytes, UTF-8), never
// by the declared mime or the name alone. The name's extension must also fit
// the content: a "photo.png" that holds text is refused. SVG, HTML, archives
// and executables are never accepted.
import type { FileKind, FileTypeCapability } from '../askProvider';

const MB = 1024 * 1024;

/** Extensions of text and code files that may be attached (no html, no svg, no xml). */
export const TEXT_EXTENSIONS: readonly string[] = [
  'txt', 'md', 'json', 'yaml', 'yml', 'toml', 'csv', 'tsv', 'log', 'ini', 'cfg', 'sql',
  'py', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'java', 'kt', 'go', 'rs', 'rb', 'php', 'cs', 'swift',
  'sh', 'c', 'h', 'cpp', 'hpp', 'css',
];

/** Every kind Agent mode takes (the worktree holds the file; the agent reads it). */
export const AGENT_TYPES: readonly FileTypeCapability[] = [
  { id: 'image', label: 'Images', mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'], extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'], maxBytes: 20 * MB },
  { id: 'video', label: 'Videos', mimes: ['video/mp4', 'video/quicktime', 'video/webm'], extensions: ['mp4', 'mov', 'webm'], maxBytes: 100 * MB },
  { id: 'pdf', label: 'PDF', mimes: ['application/pdf'], extensions: ['pdf'], maxBytes: 20 * MB },
  { id: 'text', label: 'Text and code', mimes: ['text/plain'], extensions: [...TEXT_EXTENSIONS], maxBytes: 20 * MB },
];
/** All files of one Agent message together, in bytes. */
export const AGENT_MAX_TOTAL_BYTES = 200 * MB;
/** Most files per message, for Ask and Agent mode. */
export const MAX_FILES = 5;

export interface Sniffed {
  kind: FileKind;
  mime: string;
  /** The extension a saved file gets (text: see savedExtension). */
  ext: string;
  /** Extensions a file of this content may carry. */
  fits: readonly string[];
}

const startsWith = (bytes: Uint8Array, signature: readonly number[], at = 0): boolean =>
  bytes.length >= at + signature.length && signature.every((byte, i) => bytes[at + i] === byte);
const ascii = (bytes: Uint8Array, from: number, to: number): string =>
  String.fromCharCode(...bytes.subarray(from, to));

/** Number of leading bytes enough for sniffBinary. */
export const SNIFF_BYTES = 16;

/** The binary type of the first bytes, or undefined (text, or unknown). */
export function sniffBinary(bytes: Uint8Array): Sniffed | undefined {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { kind: 'image', mime: 'image/png', ext: 'png', fits: ['png'] };
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return { kind: 'image', mime: 'image/jpeg', ext: 'jpg', fits: ['jpg', 'jpeg'] };
  }
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') {
    return { kind: 'image', mime: 'image/gif', ext: 'gif', fits: ['gif'] };
  }
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return { kind: 'image', mime: 'image/webp', ext: 'webp', fits: ['webp'] };
  }
  if (ascii(bytes, 0, 5) === '%PDF-') {
    return { kind: 'pdf', mime: 'application/pdf', ext: 'pdf', fits: ['pdf'] };
  }
  if (ascii(bytes, 4, 8) === 'ftyp') {
    // ISO base media: "qt  " is QuickTime, other brands are MP4.
    return ascii(bytes, 8, 12) === 'qt  '
      ? { kind: 'video', mime: 'video/quicktime', ext: 'mov', fits: ['mov', 'mp4'] }
      : { kind: 'video', mime: 'video/mp4', ext: 'mp4', fits: ['mp4', 'mov'] };
  }
  // EBML header. detectFile also checks the DocType (WebM, not Matroska).
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) {
    return { kind: 'video', mime: 'video/webm', ext: 'webm', fits: ['webm'] };
  }
  return undefined;
}

// Signatures of things never accepted, even under a text extension.
const REFUSED: ReadonlyArray<readonly number[]> = [
  [0x50, 0x4b, 0x03, 0x04], // zip, jar, docx...
  [0x50, 0x4b, 0x05, 0x06],
  [0x52, 0x61, 0x72, 0x21], // rar
  [0x37, 0x7a, 0xbc, 0xaf], // 7z
  [0x1f, 0x8b], // gzip
  [0x42, 0x5a, 0x68], // bzip2
  [0xfd, 0x37, 0x7a, 0x58], // xz
  [0x7f, 0x45, 0x4c, 0x46], // ELF
  [0x4d, 0x5a], // MZ (Windows exe, dll)
  [0xfe, 0xed, 0xfa, 0xce], // Mach-O
  [0xfe, 0xed, 0xfa, 0xcf],
  [0xce, 0xfa, 0xed, 0xfe],
  [0xcf, 0xfa, 0xed, 0xfe],
  [0xca, 0xfe, 0xba, 0xbe],
];
const MARKUP_START = /^(<svg|<\?xml|<!doctype|<html|<head|<body|<script|<iframe)/i;

export type Detected =
  | { ok: true; kind: FileKind; mime: string; ext: string }
  | { ok: false; reason: string };

export const NOT_ALLOWED = 'this file type is not allowed';
export const CONTENT_MISMATCH = 'the file content does not match its type';

/**
 * Decide what a whole file is. `ext` is the lower case extension of the
 * (sanitized) name, "" if none. The result is never based on a declared mime.
 */
export function detectFile(bytes: Uint8Array, ext: string): Detected {
  const binary = sniffBinary(bytes);
  if (binary !== undefined) {
    // WebM says "webm" in its DocType, near the start (Matroska says "matroska").
    if (binary.mime === 'video/webm' && !ascii(bytes, 0, 64).includes('webm')) return { ok: false, reason: NOT_ALLOWED };
    if (ext !== '' && !binary.fits.includes(ext)) return { ok: false, reason: CONTENT_MISMATCH };
    return { ok: true, kind: binary.kind, mime: binary.mime, ext: binary.ext };
  }
  if (REFUSED.some((signature) => startsWith(bytes, signature))) return { ok: false, reason: NOT_ALLOWED };

  if (!TEXT_EXTENSIONS.includes(ext)) {
    // A known media extension on other content is a mismatch, anything else is not allowed.
    const media = AGENT_TYPES.some((type) => type.id !== 'text' && type.extensions.includes(ext));
    return { ok: false, reason: media ? CONTENT_MISMATCH : NOT_ALLOWED };
  }
  if (bytes.includes(0)) return { ok: false, reason: CONTENT_MISMATCH };
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: CONTENT_MISMATCH };
  }
  if (MARKUP_START.test(text.replace(/^﻿/, '').trimStart().slice(0, 32))) {
    return { ok: false, reason: NOT_ALLOWED };
  }
  return { ok: true, kind: 'text', mime: 'text/plain', ext };
}

/** True if a detected type is one of the capability's types (mime and extension both). */
export function typeFor(
  types: readonly FileTypeCapability[],
  detected: { kind: FileKind; mime: string; ext: string },
): FileTypeCapability | undefined {
  return types.find(
    (type) => type.id === detected.kind && type.mimes.includes(detected.mime) &&
      (detected.kind !== 'text' || type.extensions.includes(detected.ext)),
  );
}
