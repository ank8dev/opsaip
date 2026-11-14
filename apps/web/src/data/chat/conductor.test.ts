import { describe, expect, it } from 'vitest';
import {
  startRunExact,
  RUN_PROMPT_MAX, RUN_TITLE_MAX, answerPermission, cancelRun, conductorOffNote, conductorStateFrom, fetchConductorStatus, fetchRun,
  isRunActive, parseConductorStatus, parseRunResponse, promptProblem, runTitleFrom, sendFollowUp, startRun,
} from './conductor';
import { CONDUCTOR_DOCS_URL, CONDUCTOR_OFF_NOTE } from './problems';

const signal = new AbortController().signal;

function fakeFetch(res: Response | Error) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    if (res instanceof Error) throw res;
    return res;
  }) as unknown as typeof fetch;
  return { impl, calls };
}
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const run = { id: 'r1', taskId: 't1', status: 'running', branch: 'opsaip/run-r1', worktree: '/home/x/.opsaip/worktrees/r1' };

describe('runTitleFrom', () => {
  it('is the first line, trimmed', () => {
    expect(runTitleFrom('  Fix the login bug  \nthen add tests\nand more')).toBe('Fix the login bug');
    expect(runTitleFrom('\n\n  Second line wins after blanks \nx')).toBe('Second line wins after blanks');
    expect(runTitleFrom('a\r\nb')).toBe('a');
    expect(runTitleFrom('a\rb')).toBe('a');
  });

  it('keeps a title of exactly 200 characters, and adds no ellipsis', () => {
    const t = 'x'.repeat(RUN_TITLE_MAX);
    expect(runTitleFrom(t)).toBe(t);
  });

  it('cuts a longer line to 200 characters with "…", only when cut', () => {
    const out = runTitleFrom('y'.repeat(500));
    expect(out).toHaveLength(RUN_TITLE_MAX);
    expect(out.endsWith('…')).toBe(true);
    expect(out.slice(0, -1)).toBe('y'.repeat(199));
    expect(runTitleFrom('y'.repeat(201))).toHaveLength(200);
  });

  it('never cuts an emoji in half', () => {
    // 199 units of text, then a surrogate pair straddling the cut.
    const out = runTitleFrom(`${'a'.repeat(198)}😀😀😀`);
    expect(out.length).toBeLessThanOrEqual(RUN_TITLE_MAX);
    expect(out).toBe(`${'a'.repeat(198)}…`);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])/.test(out)).toBe(false);
    const emoji = runTitleFrom('😀'.repeat(300));
    expect(emoji.length).toBeLessThanOrEqual(RUN_TITLE_MAX);
    expect(emoji.endsWith('…')).toBe(true);
    expect(emoji.slice(0, -1)).toBe('😀'.repeat(99));
  });

  it('a long first line of a multi-line prompt is cut, the rest ignored', () => {
    const out = runTitleFrom(`${'z'.repeat(300)}\nsecond`);
    expect(out).toHaveLength(RUN_TITLE_MAX);
    expect(out).not.toContain('second');
  });

  it('always fits the server limit (String.length <= 200)', () => {
    for (const s of ['a', '😀', 'é'.repeat(250), '😀a'.repeat(120), ' '.repeat(10) + 'b'.repeat(400)]) {
      expect(runTitleFrom(s).length).toBeLessThanOrEqual(RUN_TITLE_MAX);
    }
  });
});

describe('promptProblem', () => {
  it('accepts 1 to 12 000 characters', () => {
    expect(promptProblem('do it')).toBeUndefined();
    expect(promptProblem('x'.repeat(RUN_PROMPT_MAX))).toBeUndefined();
  });
  it('refuses blank and too long', () => {
    expect(promptProblem('  \n ')).toBeDefined();
    expect(promptProblem('x'.repeat(RUN_PROMPT_MAX + 1))).toContain('12000');
  });
});

describe('parseRunResponse', () => {
  it('reads a run, keeping only the known fields', () => {
    expect(parseRunResponse({ run: { ...run, lastMessage: 'hi', extra: 1 }, other: 1 })).toEqual({
      id: 'r1', taskId: 't1', status: 'running', branch: 'opsaip/run-r1', lastMessage: 'hi',
    });
  });

  it('reads a permission request, text kept verbatim', () => {
    const permission = { id: 'p1', tool: 'Bash', summary: '<img src=x onerror=alert(1)> **rm** -rf', extra: 1 };
    expect(parseRunResponse({ run: { ...run, status: 'waiting_on_human', permission } })?.permission).toEqual({
      id: 'p1', tool: 'Bash', summary: '<img src=x onerror=alert(1)> **rm** -rf',
    });
  });

  it('cuts agent text to the server limits', () => {
    const r = parseRunResponse({
      run: { ...run, lastMessage: 'm'.repeat(5000), permission: { id: 'p', tool: 't'.repeat(500), summary: 's'.repeat(1000) } },
    });
    expect(r?.lastMessage).toHaveLength(2000);
    expect(r?.permission?.summary).toHaveLength(300);
    expect(r?.permission?.tool).toHaveLength(100);
  });

  it('every status is accepted', () => {
    for (const status of ['queued', 'running', 'waiting_on_human', 'done', 'failed']) {
      expect(parseRunResponse({ run: { ...run, status } })?.status).toBe(status);
    }
  });

  it('malformed bodies give undefined, never a throw', () => {
    const bad: unknown[] = [
      undefined, null, 5, 'x', [], {}, { run: null }, { run: [] }, { run: 'r' },
      { run: { ...run, id: '' } }, { run: { ...run, id: '  ' } }, { run: { ...run, id: 5 } },
      { run: { ...run, taskId: 5 } }, { run: { ...run, branch: null } },
      { run: { ...run, status: 'weird' } }, { run: { ...run, status: 'toString' } }, { run: { ...run, status: 5 } },
      { run: { ...run, lastMessage: 5 } }, { run: { ...run, permission: 'p' } },
      { run: { ...run, permission: { id: 'p', tool: 'Bash' } } }, { run: { ...run, permission: { id: '', tool: 'a', summary: 'b' } } },
      { run: { ...run, permission: { id: 'p', tool: 1, summary: 'b' } } },
    ];
    for (const b of bad) expect(parseRunResponse(b)).toBeUndefined();
  });

  it('isRunActive: only done and failed are over', () => {
    expect(isRunActive('queued')).toBe(true);
    expect(isRunActive('running')).toBe(true);
    expect(isRunActive('waiting_on_human')).toBe(true);
    expect(isRunActive('done')).toBe(false);
    expect(isRunActive('failed')).toBe(false);
  });
});

describe('conductor status', () => {
  it('parses on and off, with the reason as text', () => {
    expect(parseConductorStatus({ enabled: true, agent: 'claude-code' })).toEqual({ enabled: true });
    expect(parseConductorStatus({ enabled: false, reason: ' Conductor mode is off. ' })).toEqual({ enabled: false, reason: 'Conductor mode is off.' });
    expect(parseConductorStatus({ enabled: false })).toEqual({ enabled: false });
    expect(parseConductorStatus({ enabled: false, reason: 5 })).toEqual({ enabled: false });
    expect(parseConductorStatus({ enabled: 'yes' })).toBeUndefined();
    expect(parseConductorStatus({})).toBeUndefined();
    expect(parseConductorStatus(null)).toBeUndefined();
  });

  it('GET /v1/conductor with the token', async () => {
    const { impl, calls } = fakeFetch(json(200, { enabled: false, reason: 'off' }));
    const r = await fetchConductorStatus('tok', signal, impl);
    expect(r).toEqual({ ok: true, value: { enabled: false, reason: 'off' } });
    expect(calls[0].url).toBe('/v1/conductor');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer tok' });
    expect(calls[0].init.body).toBeUndefined();
  });

  it('failures are problems, not "off"', async () => {
    expect(await fetchConductorStatus('t', signal, fakeFetch(json(401, {})).impl)).toEqual({ ok: false, problem: 'unauthorized' });
    expect(await fetchConductorStatus('t', signal, fakeFetch(json(500, {})).impl)).toEqual({ ok: false, problem: 'server-error' });
    expect(await fetchConductorStatus('t', signal, fakeFetch(new Error('x')).impl)).toEqual({ ok: false, problem: 'unreachable' });
    expect(await fetchConductorStatus('t', signal, fakeFetch(json(200, { enabled: 1 })).impl)).toEqual({ ok: false, problem: 'bad-response' });
  });

  it('state for the composer', () => {
    expect(conductorStateFrom({ ok: true, value: { enabled: true } })).toEqual({ state: 'on' });
    expect(conductorStateFrom({ ok: true, value: { enabled: false } })).toEqual({ state: 'off' });
    expect(conductorStateFrom({ ok: true, value: { enabled: false, reason: 'r' } })).toEqual({ state: 'off', reason: 'r' });
    expect(conductorStateFrom({ ok: false, problem: 'unreachable' })).toEqual({ state: 'failed', problem: 'unreachable' });
  });

  it('the off note says how to turn it on, with the link', () => {
    const n = conductorOffNote('because');
    expect(n.text).toBe(CONDUCTOR_OFF_NOTE);
    expect(n.text).toContain('set OPSAIP_CONDUCTOR_DIR to the absolute path of a git repository on the server and restart it');
    expect(n.reason).toBe('because');
    expect(n.link).toEqual({ label: 'How to turn it on', href: CONDUCTOR_DOCS_URL });
    expect(conductorOffNote().reason).toBeUndefined();
  });
});

describe('startRun', () => {
  it('POSTs { title, prompt }: title is the first line, prompt is the whole text', async () => {
    const { impl, calls } = fakeFetch(json(201, { run }));
    const r = await startRun('tok', 'Fix login\nUse the new API', signal, impl);
    expect(r).toEqual({ ok: true, value: { id: 'r1', taskId: 't1', status: 'running', branch: 'opsaip/run-r1' } });
    expect(calls[0].url).toBe('/v1/runs');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.redirect).toBe('error');
    expect(calls[0].init.cache).toBe('no-store');
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer tok', 'content-type': 'application/json' });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ title: 'Fix login', prompt: 'Fix login\nUse the new API' });
  });

  it('does not call the server for a blank or too long prompt', async () => {
    for (const text of ['', '  \n', 'x'.repeat(RUN_PROMPT_MAX + 1)]) {
      const { impl, calls } = fakeFetch(json(201, { run }));
      expect(await startRun('t', text, signal, impl)).toMatchObject({ ok: false, problem: 'bad-request' });
      expect(calls).toHaveLength(0);
    }
  });

  it.each([
    [400, 'bad-request'], [401, 'unauthorized'], [409, 'busy'], [413, 'too-large'], [415, 'unsupported'],
    [500, 'run-failed'], [503, 'conductor-off'], [502, 'server-error'],
  ] as const)('status %i -> %s', async (status, problem) => {
    const r = await startRun('t', 'do it', signal, fakeFetch(json(status, { error: 'the reason' })).impl);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toBe(problem);
      // Only a 400 and a failed start carry the server's reason.
      expect(r.reason).toBe(problem === 'bad-request' || problem === 'run-failed' ? 'the reason' : undefined);
    }
  });

  it('a malformed 201 is bad-response; a network error is unreachable', async () => {
    expect(await startRun('t', 'x', signal, fakeFetch(json(201, { run: { id: 'r' } })).impl)).toEqual({ ok: false, problem: 'bad-response' });
    expect(await startRun('t', 'x', signal, fakeFetch(new Error('down')).impl)).toEqual({ ok: false, problem: 'unreachable' });
  });
});

describe('fetchRun', () => {
  it('GET /v1/runs/:id, id encoded', async () => {
    const { impl, calls } = fakeFetch(json(200, { run }));
    await fetchRun('t', 'a/b c', signal, impl);
    expect(calls[0].url).toBe('/v1/runs/a%2Fb%20c');
    expect(calls[0].init.method).toBe('GET');
  });
  it('404 is not-found, 503 is conductor-off', async () => {
    expect(await fetchRun('t', 'r', signal, fakeFetch(json(404, { error: 'run not found' })).impl)).toEqual({ ok: false, problem: 'not-found' });
    expect(await fetchRun('t', 'r', signal, fakeFetch(json(503, {})).impl)).toEqual({ ok: false, problem: 'conductor-off' });
  });
});

describe('answerPermission', () => {
  it('POSTs { allow, permissionId } and returns the run', async () => {
    const { impl, calls } = fakeFetch(json(200, { run }));
    const r = await answerPermission('tok', 'r1', 'p1', true, signal, impl);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('/v1/runs/r1/permission');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ allow: true, permissionId: 'p1' });
    await answerPermission('tok', 'r1', 'p1', false, signal, impl);
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ allow: false, permissionId: 'p1' });
  });
  it('409 is stale: already answered, or the run ended', async () => {
    expect(await answerPermission('t', 'r', 'p', true, signal, fakeFetch(json(409, { error: 'x' })).impl)).toEqual({ ok: false, problem: 'stale' });
  });
  it('other statuses', async () => {
    expect(await answerPermission('t', 'r', 'p', true, signal, fakeFetch(json(404, {})).impl)).toEqual({ ok: false, problem: 'not-found' });
    expect(await answerPermission('t', 'r', 'p', true, signal, fakeFetch(json(401, {})).impl)).toEqual({ ok: false, problem: 'unauthorized' });
    expect(await answerPermission('t', 'r', 'p', true, signal, fakeFetch(json(503, {})).impl)).toEqual({ ok: false, problem: 'conductor-off' });
    expect(await answerPermission('t', 'r', 'p', true, signal, fakeFetch(json(500, {})).impl)).toEqual({ ok: false, problem: 'server-error' });
  });
});

describe('sendFollowUp', () => {
  it('POSTs { text }', async () => {
    const { impl, calls } = fakeFetch(json(200, { run }));
    expect((await sendFollowUp('tok', 'r1', 'and add tests', signal, impl)).ok).toBe(true);
    expect(calls[0].url).toBe('/v1/runs/r1/message');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: 'and add tests' });
  });
  it('409 means the run ended', async () => {
    expect(await sendFollowUp('t', 'r', 'x', signal, fakeFetch(json(409, {})).impl)).toEqual({ ok: false, problem: 'ended' });
  });
  it('does not call the server for blank text', async () => {
    const { impl, calls } = fakeFetch(json(200, { run }));
    expect(await sendFollowUp('t', 'r', '  ', signal, impl)).toMatchObject({ ok: false, problem: 'bad-request' });
    expect(calls).toHaveLength(0);
  });
});

describe('cancelRun', () => {
  it('POSTs with no body and no content-type', async () => {
    const { impl, calls } = fakeFetch(json(200, { run: { ...run, status: 'failed' } }));
    const r = await cancelRun('tok', 'r1', signal, impl);
    expect(r).toMatchObject({ ok: true, value: { status: 'failed' } });
    expect(calls[0].url).toBe('/v1/runs/r1/cancel');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.headers).not.toHaveProperty('content-type');
    expect(calls[0].init.headers).toMatchObject({ authorization: 'Bearer tok' });
  });
  it('409 means the run ended; 404 not found', async () => {
    expect(await cancelRun('t', 'r', signal, fakeFetch(json(409, {})).impl)).toEqual({ ok: false, problem: 'ended' });
    expect(await cancelRun('t', 'r', signal, fakeFetch(json(404, {})).impl)).toEqual({ ok: false, problem: 'not-found' });
  });
});

describe('the token', () => {
  it('is only in the Authorization header', async () => {
    const { impl, calls } = fakeFetch(json(200, { run }));
    await answerPermission('SECRET-TOKEN', 'r', 'p', true, signal, impl);
    expect(calls[0].url).not.toContain('SECRET-TOKEN');
    expect(calls[0].init.body as string).not.toContain('SECRET-TOKEN');
  });
});

describe('startRunExact and the conductor status extras', () => {
  it('sends exactly the title and prompt it was given, spaces and blank lines included', async () => {
    const { impl, calls } = fakeFetch(json(201, { run: { id: 'r', taskId: 't', status: 'running', branch: 'b' } }));
    const r = await startRunExact('tok', { title: '  Odd  title ', prompt: '  a\n\n b  ' }, signal, impl);
    expect(r.ok).toBe(true);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ title: '  Odd  title ', prompt: '  a\n\n b  ' });
  });

  it('does not send a title or prompt the server would refuse', async () => {
    const { impl, calls } = fakeFetch(json(201, {}));
    expect(await startRunExact('t', { title: ' ', prompt: 'x' }, signal, impl)).toMatchObject({ ok: false, problem: 'bad-request' });
    expect(await startRunExact('t', { title: 'x', prompt: '' }, signal, impl)).toMatchObject({ ok: false, problem: 'bad-request' });
    expect(calls).toHaveLength(0);
  });

  it('reads repo and active from GET /v1/conductor, and works without them', () => {
    expect(parseConductorStatus({ enabled: true, repo: 'play', active: true })).toEqual({ enabled: true, repo: 'play', active: true });
    expect(parseConductorStatus({ enabled: true })).toEqual({ enabled: true });
  });
});

describe('attachments in runs and follow-ups', () => {
  const okRun = { run: { id: 'r', taskId: 't', status: 'running', branch: 'b' } };

  it('start sends the ids next to the exact title and prompt', async () => {
    const { impl, calls } = fakeFetch(json(201, okRun));
    await startRun('tok', 'Fix it\nplease', signal, impl, ['u1']);
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ title: 'Fix it', prompt: 'Fix it\nplease', attachments: ['u1'] });
    const b = fakeFetch(json(201, okRun));
    await startRunExact('tok', { title: 'T', prompt: 'P', attachments: ['u9'] }, signal, b.impl);
    expect(JSON.parse(String(b.calls[0].init.body))).toEqual({ title: 'T', prompt: 'P', attachments: ['u9'] });
  });

  it('a follow-up sends the ids, and the old body when there are none', async () => {
    const a = fakeFetch(json(200, okRun));
    await sendFollowUp('tok', 'r', 'look', signal, a.impl, ['u2']);
    expect(JSON.parse(String(a.calls[0].init.body))).toEqual({ text: 'look', attachments: ['u2'] });
    const b = fakeFetch(json(200, okRun));
    await sendFollowUp('tok', 'r', 'look', signal, b.impl);
    expect(JSON.parse(String(b.calls[0].init.body))).toEqual({ text: 'look' });
  });
});
