import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EMPTY_STYLE_HASH, WEB_CSP, readWebFile } from './webFiles';

let dir = '';

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'opsaip-web-'));
  mkdirSync(join(dir, 'assets'));
  mkdirSync(join(dir, 'assets', 'folder.js')); // a directory with a served extension
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>Opsaip</title>');
  writeFileSync(join(dir, 'favicon.svg'), '<svg/>');
  writeFileSync(join(dir, 'assets', 'index-abc.js'), 'console.log(1)');
  writeFileSync(join(dir, 'assets', 'index-abc.css'), 'body{}');
  writeFileSync(join(dir, 'assets', 'font-abc.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32]));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('readWebFile', () => {
  it.each([
    ['index.html', 'text/html; charset=utf-8', 'no-cache'],
    ['favicon.svg', 'image/svg+xml', 'no-cache'],
    ['assets/index-abc.js', 'text/javascript; charset=utf-8', 'public, max-age=31536000, immutable'],
    ['assets/index-abc.css', 'text/css; charset=utf-8', 'public, max-age=31536000, immutable'],
    ['assets/font-abc.woff2', 'font/woff2', 'public, max-age=31536000, immutable'],
  ])('reads %s as %s, cache %s', async (file, type, cache) => {
    const found = await readWebFile(dir, file);
    expect(found?.headers['content-type']).toBe(type);
    expect(found?.headers['cache-control']).toBe(cache);
    expect(found?.body.length).toBeGreaterThan(0);
  });

  it('sends the security headers with every file', async () => {
    const found = await readWebFile(dir, 'index.html');
    expect(found?.headers).toMatchObject({
      'content-security-policy': WEB_CSP,
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      'x-frame-options': 'DENY',
    });
  });

  it('is undefined for a missing file, a directory, or a missing build folder', async () => {
    expect(await readWebFile(dir, 'assets/missing.js')).toBeUndefined();
    expect(await readWebFile(dir, 'assets/folder.js')).toBeUndefined();
    expect(await readWebFile(join(dir, 'nope'), 'index.html')).toBeUndefined();
    expect(await readWebFile(join(dir, 'index.html'), 'index.html')).toBeUndefined(); // ENOTDIR
  });

  it('never reads a file with an extension it does not serve', async () => {
    writeFileSync(join(dir, 'secret.db'), 'x');
    expect(await readWebFile(dir, 'secret.db')).toBeUndefined();
  });
});

describe('WEB_CSP', () => {
  const directives = Object.fromEntries(
    WEB_CSP.split('; ').map((d) => [d.split(' ')[0], d.split(' ').slice(1).join(' ')]),
  );

  it('allows only this server, with no other hosts or wildcards', () => {
    expect(directives).toEqual({
      'default-src': "'self'",
      'script-src': "'self'",
      'style-src': `'self' ${EMPTY_STYLE_HASH}`,
      'img-src': "'self'",
      'font-src': "'self'",
      'connect-src': "'self'",
      'object-src': "'none'",
      'base-uri': "'none'",
      'form-action': "'none'",
      'frame-ancestors': "'none'",
    });
    expect(WEB_CSP).not.toMatch(/https?:|\*|data:|blob:/);
  });

  it('has no unsafe-inline or unsafe-eval at all', () => {
    expect(WEB_CSP).not.toContain('unsafe');
    expect(directives['script-src']).toBe("'self'");
  });

  it('allows one inline <style>: the empty one (the hash of "")', () => {
    // A known value, so a broken hash computation cannot slip through.
    expect(EMPTY_STYLE_HASH).toBe("'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='");
  });
});
