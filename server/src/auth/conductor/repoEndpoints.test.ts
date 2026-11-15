// /v1/repos and runs in a chosen repository, through the real HTTP app with the fake agent.
import { once } from 'node:events';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { createTaskStore } from '@opsaip/core';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app';
import { CONDUCTOR_OFF } from './conductorConfig';
import { createRepoRegistry } from './repoRegistry';
import { createRunManager, type RunManager } from './runManager';
import { cleanUp, fakeCommand, git, makeRepo, readRecord, tempDir, waitFor } from './testing/conductorTestKit';

const TOKEN = 'repo-endpoints-token-0123456789abcdef';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const JSON_HEADERS = { ...AUTH, 'content-type': 'application/json' };

let server: Server | undefined;
let manager: RunManager | undefined;

afterAll(cleanUp);
afterEach(async () => {
  await manager?.stopActive();
  manager = undefined;
  if (server === undefined) return;
  server.closeAllConnections();
  server.close();
  await once(server, 'close');
  server = undefined;
});

async function setUp(options: { scenario?: string; defaultDir?: string; off?: boolean } = {}) {
  const home = tempDir('opsaip-home-');
  const worktreesDir = join(tempDir(), 'worktrees');
  const recordFile = join(tempDir(), 'record.jsonl');
  const store = createTaskStore();
  const logs: string[] = [];
  manager = options.off
    ? undefined
    : createRunManager({
        store,
        repos: createRepoRegistry({ defaultDir: options.defaultDir, home }),
        worktreesDir,
        agentCommand: fakeCommand(options.scenario ?? 'success', recordFile),
        log: (line) => logs.push(line),
      });
  server = createApp({ store, token: TOKEN, conductor: manager });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = (method: string, path: string, body?: unknown, headers: Record<string, string> = JSON_HEADERS) =>
    fetch(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = async (res: Response) => (await res.json()) as Record<string, any>;
  const addRepo = async (path: string) => {
    const res = await call('POST', '/v1/repos', { path });
    return { status: res.status, body: await json(res) };
  };
  const ended = (runId: string) => waitFor(() => logs.some((line) => line.includes(`run ${runId} ended`)));
  return { home, worktreesDir, recordFile, call, json, addRepo, ended, logs };
}

describe('GET/POST/DELETE /v1/repos', () => {
  it('needs the token', async () => {
    const t = await setUp();
    for (const [method, path] of [['GET', '/v1/repos'], ['POST', '/v1/repos'], ['DELETE', '/v1/repos/x']]) {
      expect((await t.call(method, path, undefined, {})).status).toBe(401);
    }
  });

  it('starts empty; adding makes Conductor mode on', async () => {
    const t = await setUp();
    expect(await t.json(await t.call('GET', '/v1/repos'))).toEqual({ repos: [] });
    expect(await t.json(await t.call('GET', '/v1/conductor'))).toMatchObject({ enabled: false });
    const app = makeRepo(t.home, 'app');
    const added = await t.addRepo(app);
    expect(added.status).toBe(201);
    expect(added.body.repo).toMatchObject({ name: 'app', path: app, isDefault: false });
    expect(await t.json(await t.call('GET', '/v1/repos'))).toEqual({ repos: [added.body.repo] });
    expect(await t.json(await t.call('GET', '/v1/conductor'))).toEqual({
      enabled: true,
      agent: 'claude-code',
      repos: [{ id: added.body.repo.id, name: 'app', isDefault: false }],
      active: false,
    });
    // The capabilities for agent attachments follow.
    expect((await t.json(await t.call('GET', '/v1/capabilities'))).agent.enabled).toBe(true);
  });

  it('lists OPSAIP_CONDUCTOR_DIR as the default repository, first', async () => {
    const defaultDir = makeRepo();
    const t = await setUp({ defaultDir });
    const added = await t.addRepo(makeRepo(t.home, 'app'));
    const list = (await t.json(await t.call('GET', '/v1/repos'))).repos;
    expect(list.map((repo: any) => [repo.id, repo.isDefault])).toEqual([['default', true], [added.body.repo.id, false]]);
  });

  it.each([
    ['not_absolute', () => 'relative/path'],
    ['not_found', (home: string) => join(home, 'missing')],
    ['is_root', () => '/'],
    ['system_folder', () => '/etc'],
    ['is_home', (home: string) => home],
    ['opsaip_folder', (home: string) => makeRepo(join(home, '.opsaip'), 'x')],
    ['outside_home', () => makeRepo()],
    ['not_git', (home: string) => { mkdirSync(join(home, 'plain')); return join(home, 'plain'); }],
  ])('refuses with code %s and stores nothing', async (code, pick) => {
    const t = await setUp();
    const { status, body } = await t.addRepo(pick(t.home));
    expect(status).toBe(400);
    expect(body.code).toBe(code);
    expect(typeof body.error).toBe('string');
    expect(JSON.stringify(body)).not.toContain(t.home);
    expect((await t.json(await t.call('GET', '/v1/repos'))).repos).toEqual([]);
  });

  it('refuses a body that is not { path: string } and a repeat', async () => {
    const t = await setUp();
    expect((await t.call('POST', '/v1/repos', { path: 5 })).status).toBe(400);
    expect((await t.call('POST', '/v1/repos', [])).status).toBe(400);
    expect((await t.call('POST', '/v1/repos', undefined, { ...AUTH, 'content-type': 'text/plain' })).status).toBe(415);
    const app = makeRepo(t.home, 'app');
    expect((await t.addRepo(app)).status).toBe(201);
    expect(await t.addRepo(app)).toMatchObject({ status: 409, body: { code: 'duplicate' } });
  });

  it('DELETE forgets the repository and leaves its files; a second DELETE is a 404', async () => {
    const t = await setUp();
    const app = makeRepo(t.home, 'app');
    const id = (await t.addRepo(app)).body.repo.id;
    expect((await t.call('DELETE', `/v1/repos/${id}`)).status).toBe(204);
    expect(existsSync(join(app, 'README.md'))).toBe(true);
    expect((await t.json(await t.call('GET', '/v1/repos'))).repos).toEqual([]);
    expect((await t.call('DELETE', `/v1/repos/${id}`)).status).toBe(404);
  });

  it('DELETE refuses the default repository', async () => {
    const t = await setUp({ defaultDir: makeRepo() });
    const res = await t.call('DELETE', '/v1/repos/default');
    expect(res.status).toBe(409);
    expect((await t.json(res)).error).toContain('OPSAIP_CONDUCTOR_DIR');
  });

  it('DELETE is refused while the repository has an active run, and works after it', async () => {
    const t = await setUp({ scenario: 'hang' });
    const id = (await t.addRepo(makeRepo(t.home, 'busy'))).body.repo.id;
    const other = (await t.addRepo(makeRepo(t.home, 'idle'))).body.repo.id;
    const run = (await t.json(await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p', repoId: id }))).run;
    const refused = await t.call('DELETE', `/v1/repos/${id}`);
    expect(refused.status).toBe(409);
    expect((await t.json(refused)).error).toContain('active');
    // Another repository is not affected by this run.
    expect((await t.call('DELETE', `/v1/repos/${other}`)).status).toBe(204);
    await t.call('POST', `/v1/runs/${run.id}/cancel`);
    await manager!.stopActive();
    expect((await t.call('DELETE', `/v1/repos/${id}`)).status).toBe(204);
  });

  it('405 with Allow for other methods', async () => {
    const t = await setUp();
    expect((await t.call('PUT', '/v1/repos', {})).headers.get('allow')).toBe('GET, POST');
    expect((await t.call('GET', '/v1/repos/x')).headers.get('allow')).toBe('DELETE');
  });

  it('503 with the Conductor off text when there is no manager (not a loopback server)', async () => {
    const t = await setUp({ off: true });
    for (const [method, path, body] of [['GET', '/v1/repos'], ['POST', '/v1/repos', { path: '/x' }], ['DELETE', '/v1/repos/x']] as const) {
      const res = await t.call(method, path, body);
      expect(res.status).toBe(503);
      expect(await t.json(res)).toEqual({ error: CONDUCTOR_OFF });
    }
  });
});

describe('POST /v1/runs with repoId', () => {
  it('runs in the chosen repository: worktree under <worktrees>/<repo id>/<run id>, the agent works there', async () => {
    const t = await setUp({ defaultDir: makeRepo() });
    const a = (await t.addRepo(makeRepo(t.home, 'alpha'))).body.repo;
    const b = (await t.addRepo(makeRepo(t.home, 'beta'))).body.repo;
    const res = await t.call('POST', '/v1/runs', { title: 'Fix it', prompt: 'please', repoId: b.id });
    expect(res.status).toBe(201);
    const run = (await t.json(res)).run;
    expect(run).toMatchObject({ repoId: b.id, repoName: 'beta', worktree: join(t.worktreesDir, b.id, run.id) });
    await t.ended(run.id);
    expect(readRecord(t.recordFile).find((entry) => entry.event === 'env')!.cwd).toBe(run.worktree);
    expect(git(b.path, 'branch', '--list', run.branch)).toContain(run.branch);
    expect(git(a.path, 'branch', '--list', run.branch)).toBe(''); // not in the other repository
    expect(readdirSync(join(t.worktreesDir, b.id))).toEqual([run.id]);
    expect(existsSync(join(t.worktreesDir, a.id))).toBe(false);
  });

  it('without repoId: the default repository', async () => {
    const defaultDir = makeRepo();
    const t = await setUp({ defaultDir });
    await t.addRepo(makeRepo(t.home, 'alpha'));
    const run = (await t.json(await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p' }))).run;
    expect(run).toMatchObject({ repoId: 'default', worktree: join(t.worktreesDir, 'default', run.id) });
    await t.ended(run.id);
  });

  it('without repoId and without a default: the only repository; with two, a 400', async () => {
    const t = await setUp();
    expect((await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p' })).status).toBe(400); // none at all
    const first = (await t.addRepo(makeRepo(t.home, 'one'))).body.repo;
    const run = (await t.json(await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p' }))).run;
    expect(run.repoId).toBe(first.id);
    await t.ended(run.id);
    await t.addRepo(makeRepo(t.home, 'two'));
    const res = await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p' });
    expect(res.status).toBe(400);
    expect((await t.json(res)).error).toContain('repoId');
  });

  it('an unknown or malformed repoId is a 404 or a 400, and creates no task', async () => {
    const t = await setUp();
    await t.addRepo(makeRepo(t.home, 'one'));
    expect((await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p', repoId: 'nope' })).status).toBe(404);
    expect((await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p', repoId: 7 })).status).toBe(400);
    expect((await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p', repoId: '' })).status).toBe(400);
    expect((await t.json(await t.call('GET', '/v1/tasks'))).tasks).toEqual([]);
  });

  it('checks the repository again right before the run: a repository that changed is a 409 and nothing is created', async () => {
    const t = await setUp();
    const repo = (await t.addRepo(makeRepo(t.home, 'one'))).body.repo;
    rmSync(join(repo.path, '.git'), { recursive: true });
    const res = await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p', repoId: repo.id });
    expect(res.status).toBe(409);
    expect((await t.json(res)).error).toContain('cannot be used now');
    expect(existsSync(t.worktreesDir)).toBe(false);
    expect((await t.json(await t.call('GET', '/v1/tasks'))).tasks).toEqual([]);
  });

  it('still one active run at a time, across repositories', async () => {
    const t = await setUp({ scenario: 'hang' });
    const a = (await t.addRepo(makeRepo(t.home, 'a'))).body.repo;
    const b = (await t.addRepo(makeRepo(t.home, 'b'))).body.repo;
    expect((await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p', repoId: a.id })).status).toBe(201);
    expect((await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p', repoId: b.id })).status).toBe(409);
  });

  it('a follow-up that resumes a finished run needs its repository to still be listed', async () => {
    const t = await setUp();
    const repo = (await t.addRepo(makeRepo(t.home, 'one'))).body.repo;
    const run = (await t.json(await t.call('POST', '/v1/runs', { title: 'T', prompt: 'p', repoId: repo.id }))).run;
    await t.ended(run.id);
    await t.call('DELETE', `/v1/repos/${repo.id}`);
    const res = await t.call('POST', `/v1/runs/${run.id}/message`, { text: 'more' });
    expect(res.status).toBe(409);
    expect((await t.json(res)).error).toContain('repository');
  });
});
