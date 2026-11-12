import { describe, expect, it } from 'vitest';
import { WEB_CONTENT_TYPES, createRequestGuard, extensionOf, isPublicPath, webFileForPath } from './requestGuard';

const TOKEN = 'g'.repeat(64);

describe('webFileForPath', () => {
  it.each([
    ['/', 'index.html'],
    ['/index.html', 'index.html'],
    ['/favicon.svg', 'favicon.svg'],
    ['/assets/index-DblgoMGm.js', 'assets/index-DblgoMGm.js'],
    ['/assets/index-yC8p_lcT.css', 'assets/index-yC8p_lcT.css'],
    ['/assets/dm-mono-latin-400-normal--0xN8mdc.woff', 'assets/dm-mono-latin-400-normal--0xN8mdc.woff'],
    ['/assets/a.woff2', 'assets/a.woff2'],
    ['/assets/logo.svg', 'assets/logo.svg'],
  ])('%s -> %s', (path, file) => {
    expect(webFileForPath(path)).toBe(file);
  });

  it.each([
    // Not the exact public paths
    '', '/index.htm', '/INDEX.HTML', '/favicon.ico', '/favicon.svg/', '//', '/./', '/index.html/x',
    // assets/ itself, nested folders, or no file name
    '/assets', '/assets/', '/assets/sub/a.js', '/assets//a.js',
    // Traversal and tricks: never decoded, never normalized, simply not matched
    '/assets/../server/src/main.ts', '/assets/..%2fdata%2fopsaip.db', '/assets/%2e%2e/x.js', '/assets/..a.js',
    '/assets/a..js', '/assets/.hidden.js', '/assets/a.js%00.txt', '/assets/a b.js', '/assets/a.js?x', '/assets/a\\b.js',
    // Extensions that are not served, and case variants
    '/assets/a', '/assets/a.map', '/assets/a.ts', '/assets/a.json', '/assets/a.db', '/assets/a.JS', '/assets/a.html.bak',
    // A file name over 200 characters
    `/assets/${'a'.repeat(198)}.js`,
    // Other API-looking paths
    '/v1/tasks', '/healthz',
  ])('%j is not a web file', (path) => {
    expect(webFileForPath(path)).toBeUndefined();
  });

  it('accepts a file name of up to 200 characters', () => {
    expect(webFileForPath(`/assets/${'a'.repeat(197)}.js`)).toBe(`assets/${'a'.repeat(197)}.js`);
  });
});

describe('isPublicPath', () => {
  it('is true only for /healthz and the web files', () => {
    expect(isPublicPath('/healthz')).toBe(true);
    expect(isPublicPath('/')).toBe(true);
    expect(isPublicPath('/assets/index-abc.js')).toBe(true);
  });

  it.each(['/v1/tasks', '/v1/reports', '/v1', '/healthz/', '/healthzz', '/HEALTHZ', '/admin', '/assets/x.map'])(
    '%s needs the token',
    (path) => {
      expect(isPublicPath(path)).toBe(false);
    },
  );
});

describe('createRequestGuard', () => {
  const mayProceed = createRequestGuard(TOKEN);
  const RIGHT = `Bearer ${TOKEN}`;
  const WRONG = `Bearer ${'h'.repeat(64)}`;

  it('lets public paths through with any header, or none', () => {
    for (const auth of [undefined, '', WRONG, RIGHT]) {
      expect(mayProceed('/', auth)).toBe(true);
      expect(mayProceed('/healthz', auth)).toBe(true);
    }
  });

  it('lets other paths through only with the right token', () => {
    expect(mayProceed('/v1/tasks', RIGHT)).toBe(true);
    expect(mayProceed('/v1/tasks', undefined)).toBe(false);
    expect(mayProceed('/v1/tasks', WRONG)).toBe(false);
    expect(mayProceed('/assets/../v1/tasks', undefined)).toBe(false);
  });
});

describe('extensionOf', () => {
  it.each([
    ['index-abc.js', '.js'],
    ['a.b.woff2', '.woff2'],
    ['A.JS', '.JS'],
    ['noext', ''],
    ['.hidden', ''],
  ])('%s -> %j', (name, ext) => {
    expect(extensionOf(name)).toBe(ext);
  });

  it('every served extension starts with a dot and is lower case', () => {
    for (const ext of Object.keys(WEB_CONTENT_TYPES)) expect(ext).toMatch(/^\.[a-z0-9]+$/);
  });
});
