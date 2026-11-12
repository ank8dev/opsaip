// Constant-time comparison, checked by construction: whatever the length of
// the token a client sends, the check compares two 32-byte SHA-256 digests
// with timingSafeEqual, and never compares the raw strings. (Measuring the
// time itself would give flaky tests, so it is not done here.)
import { describe, expect, it, vi } from 'vitest';

const calls = vi.hoisted(() => [] as Array<[Uint8Array, Uint8Array]>);

vi.mock('node:crypto', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:crypto')>();
  return {
    ...real,
    timingSafeEqual: (a: NodeJS.ArrayBufferView, b: NodeJS.ArrayBufferView) => {
      calls.push([a as Uint8Array, b as Uint8Array]);
      return real.timingSafeEqual(a, b);
    },
  };
});

const { createTokenCheck } = await import('./accessToken');

describe('createTokenCheck compares fixed-size digests', () => {
  const TOKEN = 't'.repeat(64);
  const check = createTokenCheck(TOKEN);

  it.each([
    ['the right token', TOKEN, true],
    ['a 1-character token', 'x', false],
    ['a token one character short', TOKEN.slice(0, -1), false],
    ['a same-length wrong token', 'u'.repeat(64), false],
    ['a 4096-character token', 'x'.repeat(4096), false],
  ])('%s: one timingSafeEqual call on two 32-byte inputs', (_name, sent, expected) => {
    calls.length = 0;
    expect(check(`Bearer ${sent}`)).toBe(expected);
    expect(calls).toHaveLength(1);
    expect(calls[0][0].byteLength).toBe(32);
    expect(calls[0][1].byteLength).toBe(32);
  });
});
