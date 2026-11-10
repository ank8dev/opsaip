import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_HOST, DEFAULT_PORT, loadConfig } from './config';

describe('loadConfig', () => {
  it('defaults to 127.0.0.1:4100', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 4100 });
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect(DEFAULT_PORT).toBe(4100);
  });

  it('reads OPSAIP_HOST and OPSAIP_PORT', () => {
    expect(loadConfig({ OPSAIP_HOST: '0.0.0.0', OPSAIP_PORT: '8080' })).toEqual({
      host: '0.0.0.0',
      port: 8080,
    });
  });

  it('treats empty or blank values as unset, so an empty host never means "all interfaces"', () => {
    expect(loadConfig({ OPSAIP_HOST: '', OPSAIP_PORT: '' })).toEqual({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
    });
    expect(loadConfig({ OPSAIP_HOST: '  ', OPSAIP_PORT: ' ' })).toEqual({
      host: DEFAULT_HOST,
      port: DEFAULT_PORT,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(loadConfig({ OPSAIP_HOST: ' ::1 ', OPSAIP_PORT: ' 4200 ' })).toEqual({
      host: '::1',
      port: 4200,
    });
  });

  it('accepts the port range edges 1 and 65535', () => {
    expect(loadConfig({ OPSAIP_PORT: '1' }).port).toBe(1);
    expect(loadConfig({ OPSAIP_PORT: '65535' }).port).toBe(65535);
  });

  it.each(['0', '65536', '-1', '1.5', '80abc', 'abc', '0x50', '1e3', '99999999999999999999'])(
    'rejects OPSAIP_PORT=%j',
    (value) => {
      expect(() => loadConfig({ OPSAIP_PORT: value })).toThrow(ConfigError);
      expect(() => loadConfig({ OPSAIP_PORT: value })).toThrow(
        'OPSAIP_PORT must be a whole number from 1 to 65535',
      );
    },
  );
});
