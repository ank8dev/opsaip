import { describe, expect, it } from 'vitest';
import {
  externalUrl,
  isAllowedApiRequest,
  isAllowedPermission,
  isAllowedWindowRequest,
  isInAppNavigation,
} from './policy.js';

describe('isAllowedWindowRequest', () => {
  const prod = { devTools: false };

  it('allows the app origin (files and /v1) and data: images', () => {
    expect(isAllowedWindowRequest('app://opsaip/assets/index.js', prod)).toBe(true);
    expect(isAllowedWindowRequest('app://opsaip/v1/tasks', prod)).toBe(true);
    expect(isAllowedWindowRequest('data:image/png;base64,AAAA', prod)).toBe(true);
  });

  it('blocks every network address, the configured server included', () => {
    for (const url of [
      'https://opsaip.example.com/v1/tasks',
      'http://127.0.0.1:4100/v1/tasks',
      'https://fonts.googleapis.com/css',
      'wss://opsaip.example.com/',
      'file:///etc/passwd',
      'app://other/x',
      'blob:app://opsaip/123',
      'not a url',
    ]) {
      expect(isAllowedWindowRequest(url, prod)).toBe(false);
    }
  });

  it('allows DevTools only in development', () => {
    expect(isAllowedWindowRequest('devtools://devtools/bundled/x.js', prod)).toBe(false);
    expect(isAllowedWindowRequest('devtools://devtools/bundled/x.js', { devTools: true })).toBe(true);
  });
});

describe('isAllowedApiRequest', () => {
  const base = 'https://opsaip.example.com/opsaip/';

  it('allows the server origin only', () => {
    expect(isAllowedApiRequest('https://opsaip.example.com/opsaip/v1/tasks', base)).toBe(true);
    expect(isAllowedApiRequest('https://opsaip.example.com:444/v1/tasks', base)).toBe(false);
    expect(isAllowedApiRequest('http://opsaip.example.com/opsaip/v1/tasks', base)).toBe(false);
    expect(isAllowedApiRequest('https://evil.example/v1/tasks', base)).toBe(false);
    expect(isAllowedApiRequest('not a url', base)).toBe(false);
  });

  it('allows nothing when no server is set', () => {
    expect(isAllowedApiRequest('https://opsaip.example.com/v1/tasks', null)).toBe(false);
  });
});

describe('navigation and external links', () => {
  it('keeps navigation inside the app', () => {
    expect(isInAppNavigation('app://opsaip/index.html')).toBe(true);
    expect(isInAppNavigation('https://opsaip.example.com/')).toBe(false);
    expect(isInAppNavigation('file:///Applications/')).toBe(false);
  });

  it('opens web and mail links in the default apps', () => {
    expect(externalUrl('https://github.com/ank8dev/opsaip')).toBe('https://github.com/ank8dev/opsaip');
    expect(externalUrl('http://example.com')).toBe('http://example.com/');
    expect(externalUrl('mailto:team@example.com')).toBe('mailto:team@example.com');
  });

  it('drops everything else', () => {
    for (const url of [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'smb://server/share',
      'x-apple.systempreferences:com.apple.preference.security',
      'app://opsaip/index.html',
      'data:text/html,hi',
      'not a url',
    ]) {
      expect(externalUrl(url)).toBeNull();
    }
  });
});

describe('isAllowedPermission', () => {
  it('allows only clipboard writes', () => {
    expect(isAllowedPermission('clipboard-sanitized-write')).toBe(true);
    for (const p of ['clipboard-read', 'media', 'geolocation', 'notifications', 'openExternal', 'fullscreen']) {
      expect(isAllowedPermission(p)).toBe(false);
    }
  });
});
