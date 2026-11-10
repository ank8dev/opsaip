import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_DB_PATH, DEFAULT_HOST, DEFAULT_PORT, loadConfig } from './config';

describe('loadConfig', () => {
  const defaults = { host: DEFAULT_HOST, port: DEFAULT_PORT, dbPath: DEFAULT_DB_PATH };

  it('defaults to 127.0.0.1:4100 and ./data/opsaip.db', () => {
    expect(loadConfig({})).toEqual({ host: '127.0.0.1', port: 4100, dbPath: './data/opsaip.db' });
  });

  it('reads OPSAIP_HOST, OPSAIP_PORT and OPSAIP_DB', () => {
    expect(
      loadConfig({ OPSAIP_HOST: '0.0.0.0', OPSAIP_PORT: '8080', OPSAIP_DB: '/var/lib/opsaip/x.db' }),
    ).toEqual({ host: '0.0.0.0', port: 8080, dbPath: '/var/lib/opsaip/x.db' });
  });

  it('treats empty or blank values as unset, so an empty host never means "all interfaces"', () => {
    expect(loadConfig({ OPSAIP_HOST: '', OPSAIP_PORT: '', OPSAIP_DB: '' })).toEqual(defaults);
    expect(loadConfig({ OPSAIP_HOST: '  ', OPSAIP_PORT: ' ', OPSAIP_DB: ' ' })).toEqual(defaults);
  });

  it('trims surrounding whitespace', () => {
    expect(loadConfig({ OPSAIP_HOST: ' ::1 ', OPSAIP_PORT: ' 4200 ', OPSAIP_DB: ' a.db ' })).toEqual({
      host: '::1',
      port: 4200,
      dbPath: 'a.db',
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
