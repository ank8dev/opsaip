import { createHash, timingSafeEqual } from 'node:crypto';

/** Shortest OPSAIP_TOKEN accepted. `openssl rand -hex 32` gives 64 characters. */
export const MIN_TOKEN_LENGTH = 32;

/** What a startup error says about making a token. */
export const HOW_TO_CREATE_TOKEN = 'Create one with: openssl rand -hex 32';

// Visible ASCII, no spaces: what can travel in an HTTP header unchanged.
const TOKEN_CHARS = /^[\x21-\x7e]+$/;
// "Bearer <token>". The scheme is case-insensitive (RFC 7235); Node already
// trims spaces around the whole header value.
const BEARER = /^Bearer +([\x21-\x7e]+)$/i;

/** Why `token` cannot be used as OPSAIP_TOKEN, or undefined if it can. Never contains the token. */
export function tokenProblem(token: string): string | undefined {
  if (token.length < MIN_TOKEN_LENGTH) {
    return `OPSAIP_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters long`;
  }
  if (!TOKEN_CHARS.test(token)) {
    return 'OPSAIP_TOKEN must contain only visible ASCII characters, without spaces';
  }
  return undefined;
}

/**
 * Make a check for the Authorization header: true only for "Bearer <token>"
 * with exactly `expected` as the token.
 *
 * Constant time: both tokens are hashed with SHA-256 and the two 32-byte
 * digests are compared with timingSafeEqual. Hashing first matters:
 * timingSafeEqual needs inputs of equal length, and checking the lengths
 * directly would tell an attacker the length of the real token.
 */
export function createTokenCheck(expected: string): (authorization: string | undefined) => boolean {
  const expectedDigest = sha256(expected);
  return (authorization) => {
    const match = BEARER.exec(authorization ?? '');
    // No match means no token at all; that reveals nothing about the real one.
    return match !== null && timingSafeEqual(sha256(match[1]), expectedDigest);
  };
}

function sha256(text: string): Buffer {
  return createHash('sha256').update(text, 'utf8').digest();
}
