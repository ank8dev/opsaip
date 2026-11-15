// The repositories Conductor mode can use: GET/POST /v1/repos and
// DELETE /v1/repos/:id. Live mode only. Pure: no React. The server contract is
// in server/src/auth/conductor/conductorRoutes.ts.
//
// A repository's name and path are the user's own folders, but they still
// come from the network: they are kept as plain strings, cut to a limit, and
// shown as text only.

import { callApi, type ApiResult } from './serverCall';

export const REPOS_PATH = '/v1/repos';

/** The server allows 50 added repositories and one default; the page keeps at most this many. */
export const MAX_REPOS_SHOWN = 100;
const MAX_ID = 100;
const MAX_NAME = 200;
const MAX_PATH = 4096;

/** A repository as GET /v1/repos lists it. */
export interface RepoEntry {
  id: string;
  /** The folder name. */
  name: string;
  /** The real, absolute path on the server's machine. */
  path: string;
  /** From OPSAIP_CONDUCTOR_DIR: it cannot be removed here. */
  isDefault: boolean;
}

/** A repository as GET /v1/conductor lists it: no path. What the composer and the card choose from. */
export interface RepoChoice {
  id: string;
  name: string;
  isDefault: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.slice(0, max) : undefined;
}

/** One entry of `repos` in GET /v1/conductor, or undefined. */
export function parseRepoChoice(value: unknown): RepoChoice | undefined {
  if (!isRecord(value)) return undefined;
  const id = text(value.id, MAX_ID);
  const name = text(value.name, MAX_NAME);
  if (id === undefined || name === undefined) return undefined;
  return { id, name, isDefault: value.isDefault === true };
}

export function parseRepoEntry(value: unknown): RepoEntry | undefined {
  if (!isRecord(value)) return undefined;
  const choice = parseRepoChoice(value);
  const path = text(value.path, MAX_PATH);
  if (choice === undefined || path === undefined || typeof value.isDefault !== 'boolean') return undefined;
  return { ...choice, path };
}

/** `{ repos: [...] }`. One bad entry makes the whole answer unusable: the list would be wrong. */
export function parseRepoList(body: unknown): RepoEntry[] | undefined {
  if (!isRecord(body) || !Array.isArray(body.repos) || body.repos.length > MAX_REPOS_SHOWN) return undefined;
  const list: RepoEntry[] = [];
  for (const item of body.repos) {
    const entry = parseRepoEntry(item);
    if (entry === undefined) return undefined;
    list.push(entry);
  }
  return list;
}

/** `{ repo }` from a 201. */
export function parseRepoResponse(body: unknown): RepoEntry | undefined {
  return isRecord(body) ? parseRepoEntry(body.repo) : undefined;
}

/** The repository a run uses when you choose nothing: the default one, else the first. */
export function defaultRepoId(repos: readonly RepoChoice[]): string | undefined {
  return (repos.find((r) => r.isDefault) ?? repos[0])?.id;
}

/** The id to send: your choice if it is still in the list, else the default one. undefined: there are no repositories. */
export function effectiveRepoId(repos: readonly RepoChoice[], chosen: string | undefined): string | undefined {
  return repos.some((r) => r.id === chosen) ? chosen : defaultRepoId(repos);
}

/** The list, the default repository first (the server already sends it that way; kept if it does not). */
export function defaultFirst<T extends { isDefault: boolean }>(repos: readonly T[]): T[] {
  return [...repos.filter((r) => r.isDefault), ...repos.filter((r) => !r.isDefault)];
}

// ---- Clients. Each never throws. ----

export function fetchRepos(token: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<RepoEntry[]>> {
  return callApi({ token, action: 'repos', path: REPOS_PATH, method: 'GET', signal, fetchImpl, parse: parseRepoList });
}

/** POST /v1/repos: the path exactly as typed (the server resolves and checks it). A refusal comes with the server's reason. */
export function addRepo(token: string, path: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<RepoEntry>> {
  return callApi({ token, action: 'addRepo', path: REPOS_PATH, method: 'POST', json: { path }, signal, fetchImpl, parse: parseRepoResponse });
}

/** DELETE /v1/repos/:id: forgets the repository; the server never touches its files. */
export function removeRepo(token: string, id: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<true>> {
  return callApi({
    token, action: 'removeRepo', path: `${REPOS_PATH}/${encodeURIComponent(id)}`, method: 'DELETE', signal, fetchImpl,
    parse: () => true as const, empty: true,
  });
}

// ---- When the list changes, the composer asks again ----

type Listener = () => void;
const listeners = new Set<Listener>();

/** Settings added or removed a repository: whoever shows the list should read it again. */
export function reposChanged(): void {
  for (const listener of [...listeners]) listener();
}

/** Subscribe to reposChanged. Returns the unsubscribe function. */
export function onReposChanged(listener: Listener): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
