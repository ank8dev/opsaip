import { createHash } from 'node:crypto';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { APP_CSP, EMPTY_STYLE_HASH, fileHeaders, isApiPath, isAppUrl, resolveAppFile } from './appFiles.js';

const ROOT = '/Applications/Opsaip.app/Contents/Resources/web';
const resolve = (url: string) => resolveAppFile(ROOT, url);

describe('resolveAppFile', () => {
  it('maps app://opsaip paths to files in the web build', () => {
    expect(resolve('app://opsaip/index.html')).toBe(path.join(ROOT, 'index.html'));
    expect(resolve('app://opsaip/')).toBe(path.join(ROOT, 'index.html'));
    expect(resolve('app://opsaip/assets/index-abc.js?v=1#x')).toBe(path.join(ROOT, 'assets/index-abc.js'));
    expect(resolve('app://opsaip/my%20file.svg')).toBe(path.join(ROOT, 'my file.svg'));
  });

  it('never leaves the web build folder', () => {
    for (const url of [
      'app://opsaip/../../etc/passwd',
      'app://opsaip/%2e%2e/%2e%2e/etc/passwd',
      'app://opsaip/assets/%2e%2e%2f%2e%2e%2fsecret',
      'app://opsaip/..%2f..%2fsecret',
      'app://opsaip/%2fetc%2fpasswd',
    ]) {
      const file = resolve(url);
      if (file !== null) expect(file.startsWith(ROOT + path.sep)).toBe(true);
    }
    expect(resolve('app://opsaip/..%2f..%2fsecret')).toBeNull();
  });

  it('refuses backslashes, NUL and broken escapes', () => {
    expect(resolve('app://opsaip/..%5c..%5csecret')).toBeNull();
    expect(resolve('app://opsaip/index.html%00.png')).toBeNull();
    expect(resolve('app://opsaip/%E0%A4%A')).toBeNull();
  });

  it('serves nothing under /v1 from disk, however it is spelled', () => {
    for (const p of ['/v1', '/v1/', '/v1/tasks', '/V1/tasks', '/%761/tasks', '/v1%2ftasks']) {
      expect(resolve(`app://opsaip${p}`)).toBeNull();
    }
    expect(resolve('app://opsaip/v1x.js')).toBe(path.join(ROOT, 'v1x.js'));
  });

  it('only serves the app origin', () => {
    expect(resolve('app://other/index.html')).toBeNull();
    expect(resolve('file:///etc/passwd')).toBeNull();
    expect(resolve('https://opsaip/index.html')).toBeNull();
    expect(resolve('not a url')).toBeNull();
  });
});

describe('isAppUrl / isApiPath', () => {
  it('recognizes the app origin only', () => {
    expect(isAppUrl('app://opsaip/index.html')).toBe(true);
    expect(isAppUrl('app://opsaip.evil.example/')).toBe(false);
    expect(isAppUrl('app://opsaip:8080/')).toBe(false);
    expect(isAppUrl('app://user@opsaip/')).toBe(false);
    expect(isAppUrl('https://opsaip/')).toBe(false);
  });

  it('matches /v1 and its children, not look-alikes', () => {
    expect(isApiPath('/v1')).toBe(true);
    expect(isApiPath('/v1/tasks')).toBe(true);
    expect(isApiPath('/v1x')).toBe(false);
    expect(isApiPath('/v10')).toBe(false);
    expect(isApiPath('/')).toBe(false);
  });
});

describe('fileHeaders', () => {
  it('sets the type, the CSP and nosniff', () => {
    expect(fileHeaders('/x/index.html')).toEqual({
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': APP_CSP,
      'x-content-type-options': 'nosniff',
    });
    expect(fileHeaders('/x/a.JS')['content-type']).toBe('text/javascript; charset=utf-8');
    expect(fileHeaders('/x/f.woff2')['content-type']).toBe('font/woff2');
    expect(fileHeaders('/x/unknown.bin')['content-type']).toBe('application/octet-stream');
  });

  it('has a strict CSP: no unsafe-inline, no eval, network only to its own origin', () => {
    expect(APP_CSP).toContain("default-src 'none'");
    expect(APP_CSP).toContain("connect-src 'self'");
    expect(APP_CSP).toContain("script-src 'self';");
    expect(APP_CSP).not.toContain('unsafe-inline');
    expect(APP_CSP).not.toContain('unsafe-eval');
    expect(APP_CSP).not.toMatch(/https?:/);
  });

  it('allows inline <style> only when it is empty (the hash of "")', () => {
    const empty = createHash('sha256').update('').digest('base64');
    expect(EMPTY_STYLE_HASH).toBe(`'sha256-${empty}'`);
    expect(APP_CSP).toContain(`style-src 'self' ${EMPTY_STYLE_HASH};`);
  });
});
