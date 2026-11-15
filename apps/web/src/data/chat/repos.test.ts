import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addRepo, defaultFirst, defaultRepoId, effectiveRepoId, fetchRepos, onReposChanged, parseRepoChoice, parseRepoList, parseRepoResponse,
  removeRepo, reposChanged,
} from './repos';

const signal = new AbortController().signal;
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
function fakeFetch(answer: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (answer instanceof Error) throw answer;
    return answer;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const entry = { id: 'r1', name: 'app', path: '/Users/me/code/app', isDefault: false };

describe('parsing', () => {
  it('reads a repository with its path', () => {
    expect(parseRepoList({ repos: [entry, { ...entry, id: 'default', isDefault: true }] })).toEqual([entry, { ...entry, id: 'default', isDefault: true }]);
    expect(parseRepoResponse({ repo: entry })).toEqual(entry);
  });

  it('refuses an answer with one bad entry, a missing flag or a non-list', () => {
    for (const bad of [undefined, null, [], {}, { repos: 'x' }, { repos: [{ ...entry, path: '' }] }, { repos: [{ ...entry, isDefault: 'yes' }] }, { repos: [entry, 5] }, { repos: [{ id: 'a', name: 'b' }] }]) {
      expect(parseRepoList(bad)).toBeUndefined();
    }
    expect(parseRepoResponse({ repo: { id: 'a' } })).toBeUndefined();
    expect(parseRepoResponse({})).toBeUndefined();
  });

  it('refuses a list longer than it can show, and cuts long names and paths', () => {
    expect(parseRepoList({ repos: Array.from({ length: 101 }, (_, i) => ({ ...entry, id: `r${i}` })) })).toBeUndefined();
    const cut = parseRepoList({ repos: [{ ...entry, name: 'n'.repeat(500), path: '/'.padEnd(5000, 'p') }] })![0];
    expect(cut.name).toHaveLength(200);
    expect(cut.path).toHaveLength(4096);
  });

  it('a choice has no path, even if the server sent one', () => {
    expect(parseRepoChoice({ ...entry })).toEqual({ id: 'r1', name: 'app', isDefault: false });
  });
});

describe('which repository a run uses', () => {
  const a = { id: 'a', name: 'a', isDefault: false };
  const d = { id: 'd', name: 'd', isDefault: true };

  it('the default one, else the first, else none', () => {
    expect(defaultRepoId([a, d])).toBe('d');
    expect(defaultRepoId([a])).toBe('a');
    expect(defaultRepoId([])).toBeUndefined();
  });

  it('your choice counts only while it is still in the list', () => {
    expect(effectiveRepoId([a, d], 'a')).toBe('a');
    expect(effectiveRepoId([a, d], 'gone')).toBe('d');
    expect(effectiveRepoId([a, d], undefined)).toBe('d');
    expect(effectiveRepoId([], 'a')).toBeUndefined();
  });

  it('puts the default repository first and keeps the rest in order', () => {
    expect(defaultFirst([a, { ...a, id: 'b' }, d]).map((r) => r.id)).toEqual(['d', 'a', 'b']);
  });
});

describe('the calls', () => {
  it('GET /v1/repos with the token', async () => {
    const { impl, calls } = fakeFetch(json(200, { repos: [entry] }));
    expect(await fetchRepos('tok', signal, impl)).toEqual({ ok: true, value: [entry] });
    expect(calls[0].url).toBe('/v1/repos');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer tok' });
  });

  it('503 is "Conductor mode is not available"; a bad answer is bad-response', async () => {
    expect(await fetchRepos('t', signal, fakeFetch(json(503, { error: 'off' })).impl)).toEqual({ ok: false, problem: 'conductor-off' });
    expect(await fetchRepos('t', signal, fakeFetch(json(200, { repos: 3 })).impl)).toEqual({ ok: false, problem: 'bad-response' });
    expect(await fetchRepos('t', signal, fakeFetch(new Error('down')).impl)).toEqual({ ok: false, problem: 'unreachable' });
  });

  it('POST sends the path exactly as typed, and reads the new repository', async () => {
    const { impl, calls } = fakeFetch(json(201, { repo: entry }));
    expect(await addRepo('tok', '  /Users/me/code/app ', signal, impl)).toEqual({ ok: true, value: entry });
    expect(calls[0].url).toBe('/v1/repos');
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ path: '  /Users/me/code/app ' });
  });

  it.each([
    ['not_absolute', 'the path must be absolute (it starts with / on macOS and Linux)'],
    ['is_home', 'this is your home folder itself: choose a repository inside it'],
  ])('a refused path (%s) comes back with the server message', async (code, error) => {
    const r = await addRepo('t', 'x', signal, fakeFetch(json(400, { error, code })).impl);
    expect(r).toEqual({ ok: false, problem: 'bad-request', reason: error });
  });

  it('409 (duplicate, too many) keeps the reason', async () => {
    const r = await addRepo('t', '/a', signal, fakeFetch(json(409, { error: 'this repository is already in the list', code: 'duplicate' })).impl);
    expect(r).toEqual({ ok: false, problem: 'conflict', reason: 'this repository is already in the list' });
  });

  it('DELETE forgets by id (encoded) and a 204 is success', async () => {
    const { impl, calls } = fakeFetch(new Response(null, { status: 204 }));
    expect(await removeRepo('tok', 'a/b c', signal, impl)).toEqual({ ok: true, value: true });
    expect(calls[0].url).toBe('/v1/repos/a%2Fb%20c');
    expect(calls[0].init.method).toBe('DELETE');
  });

  it('remove is refused (409) while a run is active, with the server reason; 404 is gone', async () => {
    const reason = 'a run is active in this repository: stop it or wait until it has ended';
    expect(await removeRepo('t', 'a', signal, fakeFetch(json(409, { error: reason })).impl)).toEqual({ ok: false, problem: 'conflict', reason });
    expect(await removeRepo('t', 'a', signal, fakeFetch(json(404, { error: 'repository not found' })).impl)).toEqual({ ok: false, problem: 'repo-gone' });
    expect(await removeRepo('t', 'a', signal, fakeFetch(json(401, {})).impl)).toEqual({ ok: false, problem: 'unauthorized' });
  });
});

describe('reposChanged', () => {
  const stops: (() => void)[] = [];
  afterEach(() => { for (const stop of stops.splice(0)) stop(); });

  it('tells every subscriber, until it unsubscribes', () => {
    const one = vi.fn();
    const two = vi.fn();
    const stopOne = onReposChanged(one);
    stops.push(onReposChanged(two), stopOne);
    reposChanged();
    stopOne();
    reposChanged();
    expect(one).toHaveBeenCalledTimes(1);
    expect(two).toHaveBeenCalledTimes(2);
  });
});
