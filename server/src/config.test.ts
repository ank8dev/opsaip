import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_DB_PATH, DEFAULT_HOST, DEFAULT_PORT, loadConfig } from './config';

// A valid token, so the tests of other settings can focus on those settings.
const TOKEN = 'a'.repeat(64);
const WITH_TOKEN = { OPSAIP_TOKEN: TOKEN };

describe('loadConfig', () => {
  const defaults = { host: DEFAULT_HOST, port: DEFAULT_PORT, dbPath: DEFAULT_DB_PATH, token: TOKEN };

  it('defaults to 127.0.0.1:4100 and ./data/opsaip.db', () => {
    expect(loadConfig(WITH_TOKEN)).toEqual({
      host: '127.0.0.1',
      port: 4100,
      dbPath: './data/opsaip.db',
      token: TOKEN,
    });
  });

  it('reads OPSAIP_HOST, OPSAIP_PORT and OPSAIP_DB', () => {
    expect(
      loadConfig({
        ...WITH_TOKEN,
        OPSAIP_HOST: '0.0.0.0',
        OPSAIP_PORT: '8080',
        OPSAIP_DB: '/var/lib/opsaip/x.db',
      }),
    ).toEqual({ host: '0.0.0.0', port: 8080, dbPath: '/var/lib/opsaip/x.db', token: TOKEN });
  });

  it('treats empty or blank values as unset, so an empty host never means "all interfaces"', () => {
    expect(loadConfig({ ...WITH_TOKEN, OPSAIP_HOST: '', OPSAIP_PORT: '', OPSAIP_DB: '' })).toEqual(
      defaults,
    );
    expect(
      loadConfig({ ...WITH_TOKEN, OPSAIP_HOST: '  ', OPSAIP_PORT: ' ', OPSAIP_DB: ' ' }),
    ).toEqual(defaults);
  });

  it('trims surrounding whitespace', () => {
    expect(
      loadConfig({
        OPSAIP_HOST: ' ::1 ',
        OPSAIP_PORT: ' 4200 ',
        OPSAIP_DB: ' a.db ',
        OPSAIP_TOKEN: ` ${TOKEN}\n`,
      }),
    ).toEqual({ host: '::1', port: 4200, dbPath: 'a.db', token: TOKEN });
  });

  it('accepts the port range edges 1 and 65535', () => {
    expect(loadConfig({ ...WITH_TOKEN, OPSAIP_PORT: '1' }).port).toBe(1);
    expect(loadConfig({ ...WITH_TOKEN, OPSAIP_PORT: '65535' }).port).toBe(65535);
  });

  it.each(['0', '65536', '-1', '1.5', '80abc', 'abc', '0x50', '1e3', '99999999999999999999'])(
    'rejects OPSAIP_PORT=%j',
    (value) => {
      const env = { ...WITH_TOKEN, OPSAIP_PORT: value };
      expect(() => loadConfig(env)).toThrow(ConfigError);
      expect(() => loadConfig(env)).toThrow('OPSAIP_PORT must be a whole number from 1 to 65535');
    },
  );
});

describe('loadConfig: OPSAIP_TOKEN', () => {
  const HOW_TO = 'Create one with: openssl rand -hex 32';
  const NOT_SET = `OPSAIP_TOKEN is not set. It is required on every host. ${HOW_TO}`;

  function errorFor(env: Record<string, string>): ConfigError {
    try {
      loadConfig(env);
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      return error as ConfigError;
    }
    throw new Error('expected loadConfig to throw');
  }

  it('is required when the host is not localhost', () => {
    for (const host of ['0.0.0.0', '::', '192.168.1.10', 'opsaip.example.com']) {
      expect(errorFor({ OPSAIP_HOST: host }).message).toBe(NOT_SET);
    }
  });

  it('is required on localhost too', () => {
    expect(errorFor({}).message).toBe(NOT_SET);
    for (const host of ['127.0.0.1', 'localhost', '::1']) {
      expect(errorFor({ OPSAIP_HOST: host }).message).toBe(NOT_SET);
    }
  });

  it('counts empty or blank as not set', () => {
    expect(errorFor({ OPSAIP_TOKEN: '' }).message).toBe(NOT_SET);
    expect(errorFor({ OPSAIP_TOKEN: ' \t ' }).message).toBe(NOT_SET);
  });

  it('must be at least 32 characters', () => {
    expect(loadConfig({ OPSAIP_TOKEN: 'x'.repeat(32) }).token).toBe('x'.repeat(32));
    expect(errorFor({ OPSAIP_TOKEN: 'x'.repeat(31) }).message).toBe(
      `OPSAIP_TOKEN must be at least 32 characters long. ${HOW_TO}`,
    );
  });

  it.each([
    ['a space inside', `${'x'.repeat(20)} ${'x'.repeat(20)}`],
    ['a tab inside', `${'x'.repeat(20)}\t${'x'.repeat(20)}`],
    ['non-ASCII', `${'x'.repeat(40)}é`],
    ['a control character', `${'x'.repeat(40)}\u0007`],
  ])('must be visible ASCII only: rejects %s', (_name, token) => {
    expect(errorFor({ OPSAIP_TOKEN: token }).message).toBe(
      `OPSAIP_TOKEN must contain only visible ASCII characters, without spaces. ${HOW_TO}`,
    );
  });

  it('accepts every visible ASCII character', () => {
    let visible = '';
    for (let code = 0x21; code <= 0x7e; code++) visible += String.fromCharCode(code);
    expect(loadConfig({ OPSAIP_TOKEN: visible }).token).toBe(visible);
  });

  it('never puts the token into an error message', () => {
    const tooShort = 'SECRET-short-123';
    const withSpace = 'SECRET-with-space SECRET-with-space-123';
    expect(errorFor({ OPSAIP_TOKEN: tooShort }).message).not.toContain('SECRET');
    expect(errorFor({ OPSAIP_TOKEN: withSpace }).message).not.toContain('SECRET');
    // And not via another setting's error either.
    expect(errorFor({ OPSAIP_TOKEN: TOKEN, OPSAIP_PORT: 'x' }).message).not.toContain(TOKEN);
  });
});
