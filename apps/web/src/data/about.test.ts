import { describe, expect, it } from 'vitest';
import { APP_VERSION, RELEASES_PREFIX, fetchAbout, fetchUpdate, isReleaseUrl, parseAbout, parseUpdate, updateText } from './about';

const signal = new AbortController().signal;
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status });
const rec = (res: Response) => {
  const calls: { url: string; init: RequestInit }[] = [];
  return { calls, impl: (async (url: string, init: RequestInit) => { calls.push({ url, init }); return res; }) as unknown as typeof fetch };
};

describe('app version', () => {
  it('is set at build time from package.json', () => {
    expect(APP_VERSION).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('parseAbout', () => {
  it('reads versions, and null for a Claude CLI that was not found', () => {
    expect(parseAbout({ server: { version: '0.1.0' }, node: 'v22.23.2', claude: '2.1.325' })).toEqual({ serverVersion: '0.1.0', node: 'v22.23.2', claude: '2.1.325' });
    expect(parseAbout({ server: { version: '0.1.0' }, node: 'v22', claude: null })!.claude).toBeNull();
    expect(parseAbout({ server: { version: '0.1.0' }, node: 'v22', claude: '  ' })!.claude).toBeNull();
  });
  it('refuses a body that is not about', () => {
    for (const bad of [null, [], {}, { server: {}, node: 'v' }, { server: { version: 1 }, node: 'v' }, { server: { version: '1' } }]) expect(parseAbout(bad)).toBeUndefined();
  });
});

describe('release links', () => {
  it('only link to this repository’s releases', () => {
    expect(isReleaseUrl(`${RELEASES_PREFIX}/tag/v0.2.0`)).toBe(true);
    expect(isReleaseUrl(RELEASES_PREFIX)).toBe(true);
    for (const bad of ['https://github.com/evil/opsaip/releases/tag/v1', 'https://github.com/ank8dev/opsaip/releases-evil', 'javascript:alert(1)',
      'http://github.com/ank8dev/opsaip/releases/tag/v1', 'https://github.com/ank8dev/opsaip/releases/x y', 5, null]) {
      expect(isReleaseUrl(bad)).toBe(false);
    }
  });
});

describe('parseUpdate', () => {
  const ok = { enabled: true, current: '0.1.0', latest: '0.2.0', url: `${RELEASES_PREFIX}/tag/v0.2.0`, newer: true, checkedAt: 'x' };
  it('announces a newer version with its link', () => {
    expect(parseUpdate(ok)).toEqual({ enabled: true, current: '0.1.0', latest: '0.2.0', url: ok.url, newer: true });
  });
  it('never announces without a safe link, or when disabled', () => {
    expect(parseUpdate({ ...ok, url: 'https://evil.example/x' })!.newer).toBe(false);
    expect(parseUpdate({ ...ok, url: null })!.newer).toBe(false);
    expect(parseUpdate({ ...ok, latest: null })!.newer).toBe(false);
    expect(parseUpdate({ ...ok, enabled: false })!.newer).toBe(false);
  });
  it('is not newer when the server says it is not', () => {
    expect(parseUpdate({ ...ok, newer: false })!.newer).toBe(false);
  });
  it('refuses a body that is not an update', () => {
    for (const bad of [null, {}, { enabled: 'yes', current: '1' }, { enabled: true }]) expect(parseUpdate(bad)).toBeUndefined();
  });
});

describe('updateText', () => {
  it('says what it knows', () => {
    expect(updateText(null)).toBe('Not checked yet.');
    expect(updateText({ enabled: false, current: '1', latest: null, url: null, newer: false })).toContain('off');
    expect(updateText({ enabled: true, current: '1', latest: '2.0.0', url: RELEASES_PREFIX, newer: true })).toBe('Version 2.0.0 is available.');
    expect(updateText({ enabled: true, current: '1', latest: '1', url: null, newer: false })).toBe('You are up to date.');
  });
});

describe('calls', () => {
  it('GET with the token, and unauthorized maps', async () => {
    const r = rec(json(200, { server: { version: '0.1.0' }, node: 'v22' }));
    expect((await fetchAbout('tok', signal, r.impl)).ok).toBe(true);
    expect(r.calls[0]).toMatchObject({ url: '/v1/about', init: { method: 'GET' } });
    expect((r.calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(await fetchUpdate('t', signal, rec(json(401, {})).impl)).toEqual({ ok: false, problem: 'unauthorized' });
    expect(rec(json(200, {})).calls).toEqual([]);
  });
});
