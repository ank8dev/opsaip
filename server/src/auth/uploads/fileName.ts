// The name a person's file had. It is only display text: it is never used in
// a path (saved files get generated names, see saveAttachments.ts), and never
// logged.

/** Longest display name, in characters (code points). */
export const MAX_NAME_CHARS = 100;

/**
 * A safe display name from the X-Filename header (percent-encoded): path
 * parts removed, control and format characters (bidi controls, zero-width
 * characters) removed, leading dots and spaces dropped, cut to
 * MAX_NAME_CHARS keeping the extension. "file" if nothing is left.
 */
export function displayName(header: string | undefined): string {
  let name = header ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // Not valid percent-encoding: use it as it is, the cleaning below still applies.
  }
  // Format (Cf) covers bidi controls and zero-width characters; Cc covers NUL and the like;
  // line and paragraph separators, and the unassigned/private ranges that can hide text, go too.
  name = name
    .normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Co}\p{Cn}]/gu, '');
  name = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  name = name.replace(/^[.\s]+/u, '').trim();
  const chars = Array.from(name);
  if (chars.length > MAX_NAME_CHARS) {
    const dot = name.lastIndexOf('.');
    const ext = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : '';
    name = Array.from(name.slice(0, dot > 0 && ext !== '' ? dot : name.length))
      .slice(0, MAX_NAME_CHARS - Array.from(ext).length)
      .join('') + ext;
  }
  return name === '' ? 'file' : name;
}

/** The lower case extension of a display name without the dot, or "". Only ASCII letters and digits count. */
export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  const ext = name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : '';
}
