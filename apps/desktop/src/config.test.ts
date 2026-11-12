import { describe, expect, it } from 'vitest';
import { parseConfig } from './config.js';

const withUrl = (serverUrl: unknown) => parseConfig(JSON.stringify({ serverUrl }));

describe('parseConfig', () => {
  it('a missing file means no server and no problem', () => {
    expect(parseConfig(null)).toEqual({ serverBase: null });
  });

  it('accepts https for any host and keeps a path prefix', () => {
    expect(withUrl('https://opsaip.example.com')).toEqual({ serverBase: 'https://opsaip.example.com/' });
    expect(withUrl(' https://opsaip.example.com:8443/ ')).toEqual({
      serverBase: 'https://opsaip.example.com:8443/',
    });
    expect(withUrl('https://host.example/opsaip')).toEqual({ serverBase: 'https://host.example/opsaip/' });
  });

  it('accepts http only for this machine', () => {
    for (const url of ['http://localhost:4100', 'http://127.0.0.1:4100', 'http://127.1.2.3', 'http://[::1]:4100']) {
      expect(withUrl(url).serverBase).not.toBeNull();
    }
    for (const url of ['http://opsaip.example.com', 'http://192.168.1.10:4100', 'http://localhost.evil.example']) {
      const c = withUrl(url);
      expect(c.serverBase).toBeNull();
      expect(c.problem).toContain('https://');
    }
  });

  it('refuses other schemes, credentials, query and fragment', () => {
    for (const url of [
      'ftp://opsaip.example.com',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'https://user:pass@opsaip.example.com',
      'https://opsaip.example.com/?a=1',
      'https://opsaip.example.com/#x',
    ]) {
      const c = withUrl(url);
      expect(c.serverBase).toBeNull();
      expect(c.problem).toBeTypeOf('string');
    }
  });

  it('never puts the password into the problem message', () => {
    expect(withUrl('https://user:hunter2@opsaip.example.com').problem).not.toContain('hunter2');
  });

  it('reports bad files instead of throwing', () => {
    for (const text of ['', '{', '[]', 'null', '"x"', '{}', '{"serverUrl": 1}', '{"serverUrl": "  "}', '{"serverUrl": "nope"}']) {
      const c = parseConfig(text);
      expect(c.serverBase).toBeNull();
      expect(c.problem).toBeTypeOf('string');
    }
  });
});
