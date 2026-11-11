import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config';

const TOKEN = 'config-test-token-0123456789abcdef0123';
const URL_OK = 'http://127.0.0.1:4100';

function errorOf(env: Record<string, string | undefined>): ConfigError {
  try {
    loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) return error;
    throw error;
  }
  throw new Error('loadConfig did not throw');
}

describe('loadConfig', () => {
  it('builds the reports URL from OPSAIP_URL', () => {
    const config = loadConfig({ OPSAIP_URL: URL_OK, OPSAIP_TOKEN: TOKEN });
    expect(config.reportsUrl.href).toBe('http://127.0.0.1:4100/v1/reports');
    expect(config.token).toBe(TOKEN);
  });

  it.each([
    ['a trailing slash', 'http://127.0.0.1:4100/', 'http://127.0.0.1:4100/v1/reports'],
    ['https', 'https://opsaip.example.com', 'https://opsaip.example.com/v1/reports'],
    ['a path prefix', 'https://example.com/opsaip', 'https://example.com/opsaip/v1/reports'],
    ['a path prefix with a slash', 'https://example.com/opsaip/', 'https://example.com/opsaip/v1/reports'],
    ['spaces around it', '  http://127.0.0.1:4100  ', 'http://127.0.0.1:4100/v1/reports'],
    ['an IPv6 host', 'http://[::1]:4100', 'http://[::1]:4100/v1/reports'],
  ])('accepts OPSAIP_URL with %s', (_label, url, expected) => {
    expect(loadConfig({ OPSAIP_URL: url, OPSAIP_TOKEN: TOKEN }).reportsUrl.href).toBe(expected);
  });

  it.each([
    ['missing', undefined, 'OPSAIP_URL is not set'],
    ['empty', '', 'OPSAIP_URL is not set'],
    ['blank', '   ', 'OPSAIP_URL is not set'],
    ['not a URL', 'localhost 4100', 'OPSAIP_URL is not a valid URL'],
    ['without a scheme (host:port reads as a scheme)', 'localhost:4100', 'OPSAIP_URL must start with http:// or https://'],
    ['an IP without a scheme', '127.0.0.1:4100', 'OPSAIP_URL is not a valid URL'],
    ['another scheme', 'ftp://127.0.0.1', 'OPSAIP_URL must start with http:// or https://'],
    ['with user and password', 'http://me:secret@127.0.0.1:4100', 'must not contain a user name or password'],
    ['with a user only', 'http://me@127.0.0.1:4100', 'must not contain a user name or password'],
    ['with a query', 'http://127.0.0.1:4100?x=1', 'must not have a query'],
    ['with a fragment', 'http://127.0.0.1:4100#x', 'must not have a query'],
  ])('rejects OPSAIP_URL that is %s', (_label, url, message) => {
    expect(errorOf({ OPSAIP_URL: url, OPSAIP_TOKEN: TOKEN }).message).toContain(message);
  });

  it('does not repeat a password from OPSAIP_URL in the error', () => {
    const error = errorOf({ OPSAIP_URL: 'http://me:hunter2-secret@127.0.0.1', OPSAIP_TOKEN: TOKEN });
    expect(error.message).not.toContain('hunter2');
  });

  it.each([
    ['missing', undefined, 'OPSAIP_TOKEN is not set'],
    ['empty', '', 'OPSAIP_TOKEN is not set'],
    ['blank', '  ', 'OPSAIP_TOKEN is not set'],
    ['with a trailing space', `${TOKEN} `, 'visible ASCII characters only'],
    ['with a trailing newline', `${TOKEN}\n`, 'visible ASCII characters only'],
    ['with a space inside', 'abc def', 'visible ASCII characters only'],
    ['with a non-ASCII character', `${TOKEN}é`, 'visible ASCII characters only'],
  ])('rejects OPSAIP_TOKEN that is %s, without echoing it', (_label, token, message) => {
    const error = errorOf({ OPSAIP_URL: URL_OK, OPSAIP_TOKEN: token });
    expect(error.message).toContain(message);
    if (token !== undefined && token.trim() !== '') expect(error.message).not.toContain(token.trim());
  });

  it('checks OPSAIP_URL first', () => {
    expect(errorOf({}).message).toContain('OPSAIP_URL is not set');
  });
});
