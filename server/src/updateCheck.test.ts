import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHECK_INTERVAL_MS,
  RELEASES_API,
  createUpdateCheck,
  isNewer,
  parseSemver,
  updateCheckEnabled,
  validateRelease,
} from './updateCheck';

const URL_OK = 'https://github.com/ank8dev/opsaip/releases/tag/v0.2.0';
const release = (over: Record<string, unknown> = {}) => ({
  tag_name: 'v0.2.0',
  html_url: URL_OK,
  draft: false,
  prerelease: false,
  ...over,
});
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

describe('semver', () => {
  it('parses with and without the v prefix', () => {
    expect(parseSemver('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: false });
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, pre: false });
    expect(parseSemver('1.2.3-rc.1')?.pre).toBe(true);
  });
  it('rejects garbage', () => {
    for (const bad of ['', 'latest', '1.2', '1.2.3.4', 'v01.2.3', '1.2.x', 'v', null, 5, undefined]) {
      expect(parseSemver(bad)).toBeUndefined();
    }
  });
  it('compares numerically', () => {
    expect(isNewer('0.1.1', '0.1.0')).toBe(true);
    expect(isNewer('v0.10.0', '0.9.0')).toBe(true);
    expect(isNewer('0.9.0', '0.10.0')).toBe(false);
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
    expect(isNewer('0.1.0', 'v0.1.0')).toBe(false);
    expect(isNewer('0.1.0', '0.1.1')).toBe(false);
  });
  it('never calls a prerelease or garbage newer', () => {
    expect(isNewer('0.2.0-rc.1', '0.1.0')).toBe(false);
    expect(isNewer('nope', '0.1.0')).toBe(false);
    expect(isNewer('0.2.0', 'nope')).toBe(false);
  });
});

describe('validateRelease', () => {
  it('accepts a good release', () => {
    expect(validateRelease(release())).toEqual({ tag: 'v0.2.0', url: URL_OK });
  });
  it('ignores drafts, prereleases, bad tags, bad urls and other hosts', () => {
    expect(validateRelease(release({ draft: true }))).toBeUndefined();
    expect(validateRelease(release({ prerelease: true }))).toBeUndefined();
    expect(validateRelease(release({ tag_name: 'nightly' }))).toBeUndefined();
    expect(validateRelease(release({ tag_name: 'v0.2.0-rc.1' }))).toBeUndefined();
    expect(validateRelease(release({ html_url: 42 }))).toBeUndefined();
    expect(validateRelease(release({ html_url: 'https://example.com/ank8dev/opsaip/releases/1' }))).toBeUndefined();
    expect(validateRelease(release({ html_url: 'https://github.com/other/repo/releases/1' }))).toBeUndefined();
    expect(validateRelease(release({ html_url: 'https://github.com/ank8dev/opsaip/releases-evil' }))).toBeUndefined();
    expect(validateRelease(null)).toBeUndefined();
    expect(validateRelease('x')).toBeUndefined();
  });
});

describe('updateCheckEnabled', () => {
  it('is on unless off, 0 or false', () => {
    expect(updateCheckEnabled({})).toBe(true);
    expect(updateCheckEnabled({ OPSAIP_UPDATE_CHECK: 'on' })).toBe(true);
    for (const v of ['off', 'OFF', '0', 'false', ' False ']) {
      expect(updateCheckEnabled({ OPSAIP_UPDATE_CHECK: v })).toBe(false);
    }
  });
});

describe('createUpdateCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
  });
  afterEach(() => vi.useRealTimers());

  function make(fetchImpl: ReturnType<typeof vi.fn>, enabled = true) {
    const log = vi.fn();
    const check = createUpdateCheck({ current: '0.1.0', enabled, fetch: fetchImpl as unknown as typeof fetch, log });
    return { check, log };
  }

  it('checks on start and keeps the result in memory', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(release()));
    const { check } = make(fetchMock);
    check.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RELEASES_API);
    expect(init.headers).toEqual({ accept: 'application/vnd.github+json', 'user-agent': 'opsaip-update-check' });
    expect(check.status()).toEqual({
      enabled: true,
      current: '0.1.0',
      latest: '0.2.0',
      url: URL_OK,
      newer: true,
      checkedAt: '2026-01-01T00:00:00.000Z',
    });
    check.stop();
  });

  it('is not newer when the latest equals the current version', async () => {
    const { check } = make(vi.fn().mockResolvedValue(ok(release({ tag_name: 'v0.1.0' }))));
    check.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(check.status().newer).toBe(false);
    expect(check.status().latest).toBe('0.1.0');
    check.stop();
  });

  it('checks again every 24 h, not before', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(release()));
    const { check } = make(fetchMock);
    check.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    check.stop();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('does not make another timer when started twice', async () => {
    const fetchMock = vi.fn().mockResolvedValue(ok(release()));
    const { check } = make(fetchMock);
    check.start();
    check.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    check.stop();
  });

  it('keeps the last good result when a later check fails, with one log line and no body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok(release()))
      .mockRejectedValueOnce(new Error('secret network detail'))
      .mockResolvedValueOnce(new Response('rate limit body', { status: 403 }))
      .mockResolvedValueOnce(new Response('not found body', { status: 404 }))
      .mockResolvedValueOnce(new Response('{not json', { status: 200 }))
      .mockResolvedValueOnce(ok(release({ tag_name: 'v9.9.9', html_url: 'https://evil.example/x' })));
    const { check, log } = make(fetchMock);
    check.start();
    await vi.advanceTimersByTimeAsync(0);
    const good = check.status();
    expect(good.latest).toBe('0.2.0');
    for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(check.status()).toEqual(good);
    expect(log.mock.calls.map((c) => c[0])).toEqual([
      'opsaip: update check failed (network)',
      'opsaip: update check failed (status 403)',
      'opsaip: update check failed (status 404)',
      'opsaip: update check failed (network)',
    ]);
    check.stop();
  });

  it('without any result yet: latest, url and checkedAt are null', async () => {
    const { check } = make(vi.fn().mockResolvedValue(new Response('', { status: 404 })));
    check.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(check.status()).toEqual({
      enabled: true,
      current: '0.1.0',
      latest: null,
      url: null,
      newer: false,
      checkedAt: null,
    });
    check.stop();
  });

  it('disabled: zero fetch calls, no timer, empty status', async () => {
    const fetchMock = vi.fn();
    const setIntervalMock = vi.fn();
    const check = createUpdateCheck({
      current: '0.1.0',
      enabled: false,
      fetch: fetchMock as unknown as typeof fetch,
      setInterval: setIntervalMock,
    });
    check.start();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 3);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(setIntervalMock).not.toHaveBeenCalled();
    expect(check.status()).toEqual({
      enabled: false,
      current: '0.1.0',
      latest: null,
      url: null,
      newer: false,
      checkedAt: null,
    });
  });

  it('the timer is unref()d and cleared by stop()', () => {
    const timer = { unref: vi.fn() };
    const setIntervalMock = vi.fn().mockReturnValue(timer);
    const clearIntervalMock = vi.fn();
    const check = createUpdateCheck({
      current: '0.1.0',
      enabled: true,
      fetch: vi.fn().mockResolvedValue(ok(release())) as unknown as typeof fetch,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock,
    });
    check.start();
    expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), CHECK_INTERVAL_MS);
    expect(timer.unref).toHaveBeenCalledTimes(1);
    check.stop();
    expect(clearIntervalMock).toHaveBeenCalledWith(timer);
  });
});
