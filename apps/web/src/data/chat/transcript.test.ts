import { describe, expect, it } from 'vitest';
import { canSendFollowUp, chatTabMode, fetchTranscript, MAX_ENTRIES, MAX_ENTRY_CHARS, parseTranscriptResponse } from './transcript';
import { MAX_REMEMBERED, loadRunTasks, rememberRunTask, saveRunTasks } from './runTasks';

const entry = (id: number, extra: object = {}) => ({ id, role: 'agent', kind: 'message', text: `m${id}`, at: '2026-11-14T10:00:00Z', ...extra });
const body = (t: object) => ({ transcript: { entries: [], finished: false, canResume: false, truncated: false, ...t } });
const signal = new AbortController().signal;
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('parseTranscriptResponse', () => {
  it('reads entries in order with the flags', () => {
    const t = parseTranscriptResponse(body({ entries: [entry(1, { role: 'you', kind: 'prompt' }), entry(2)], finished: true, canResume: true, truncated: true }))!;
    expect(t.entries.map((e) => e.id)).toEqual([1, 2]);
    expect(t).toMatchObject({ finished: true, canResume: true, truncated: true });
  });

  it('skips broken entries and keeps the rest', () => {
    const t = parseTranscriptResponse(body({ entries: [entry(1), { id: 'x' }, entry(2, { role: 'robot' }), entry(3, { kind: 'x' }), entry(4, { text: 5 }), 7, entry(5)] }))!;
    expect(t.entries.map((e) => e.id)).toEqual([1, 5]);
  });

  it('cuts long text and keeps only the newest entries', () => {
    const many = Array.from({ length: MAX_ENTRIES + 5 }, (_, i) => entry(i + 1, i === 0 ? { text: 'x'.repeat(MAX_ENTRY_CHARS + 10) } : {}));
    const t = parseTranscriptResponse(body({ entries: many }))!;
    expect(t.entries).toHaveLength(MAX_ENTRIES);
    expect(t.entries[0].id).toBe(6);
    const long = parseTranscriptResponse(body({ entries: [entry(1, { text: 'x'.repeat(MAX_ENTRY_CHARS + 10) })] }))!;
    expect(long.entries[0].text).toHaveLength(MAX_ENTRY_CHARS);
  });

  it('refuses a body that is not a transcript', () => {
    for (const bad of [null, [], {}, { transcript: [] }, { transcript: { entries: [] } }, { transcript: { entries: 1, finished: true } }]) {
      expect(parseTranscriptResponse(bad)).toBeUndefined();
    }
  });

  it('treats a missing canResume as false (an older server)', () => {
    expect(parseTranscriptResponse({ transcript: { entries: [], finished: true } })!.canResume).toBe(false);
  });
});

describe('attachments in the history', () => {
  it('reads the files of a message as chips, dropping broken ones', () => {
    const t = parseTranscriptResponse(body({ entries: [entry(1, { role: 'you', kind: 'prompt', attachments: [
      { name: 'a.png', kind: 'image', size: 10 }, { name: 5, kind: 'image', size: 1 }, { name: 'b', kind: 'exe', size: 1 }, 'x',
    ] }), entry(2)] }))!;
    expect(t.entries[0].attachments).toEqual([{ name: 'a.png', kind: 'image', size: 10 }]);
    expect(t.entries[1].attachments).toBeUndefined();
  });
});

describe('canSendFollowUp', () => {
  const t = (finished: boolean, canResume: boolean) => ({ entries: [], finished, canResume, truncated: false });
  it('is on while active, and after the end only when it can resume', () => {
    expect(canSendFollowUp(t(false, false))).toBe(true);
    expect(canSendFollowUp(t(true, true))).toBe(true);
    expect(canSendFollowUp(t(true, false))).toBe(false);
  });
});

describe('fetchTranscript', () => {
  it('GETs the transcript of that run with the token, and maps problems', async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const impl = (async (url: string, init: RequestInit) => { calls.push({ url, init }); return json(200, body({ entries: [entry(1)] })); }) as unknown as typeof fetch;
    const r = await fetchTranscript('tok', 'run/1', signal, impl);
    expect(r.ok).toBe(true);
    expect(calls[0].url).toBe('/v1/runs/run%2F1/transcript');
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(await fetchTranscript('t', 'r', signal, (async () => json(404, {})) as unknown as typeof fetch)).toEqual({ ok: false, problem: 'not-found' });
    expect(await fetchTranscript('t', 'r', signal, (async () => json(401, {})) as unknown as typeof fetch)).toEqual({ ok: false, problem: 'unauthorized' });
  });
});

describe('run tasks memory', () => {
  it('remembers task -> run, newest last, bounded', () => {
    let m = {};
    for (let i = 0; i < MAX_REMEMBERED + 3; i++) m = rememberRunTask(m, `t${i}`, `r${i}`);
    expect(Object.keys(m)).toHaveLength(MAX_REMEMBERED);
    expect(m).not.toHaveProperty('t0');
    expect(m).toHaveProperty(`t${MAX_REMEMBERED + 2}`, `r${MAX_REMEMBERED + 2}`);
  });

  it('saves and loads, and ignores junk or blocked storage', () => {
    const store = new Map<string, string>();
    const ls = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    saveRunTasks({ a: 'r1' }, ls);
    expect(loadRunTasks(ls)).toEqual({ a: 'r1' });
    store.set('opsaip.runTasks', '[1]');
    expect(loadRunTasks(ls)).toEqual({});
    store.set('opsaip.runTasks', '{"a":5,"b":"r2"}');
    expect(loadRunTasks(ls)).toEqual({ b: 'r2' });
    expect(loadRunTasks({ getItem: () => { throw new Error('blocked'); }, setItem: () => {}, removeItem: () => {} })).toEqual({});
  });
});

describe('chatTabMode', () => {
  const mcp = { owner: '', source: 'Claude Code' };
  const mine = { owner: 'me', source: 'claude-code' };
  it('shows the run chat when the run is known', () => {
    expect(chatTabMode(mine, true, 'r1')).toBe('run');
  });
  it('says there is no chat for a Claude Code run this page does not know', () => {
    expect(chatTabMode(mine, true, undefined)).toBe('launched-here');
  });
  it('is read only for tasks an agent reported through MCP, and in Demo', () => {
    expect(chatTabMode(mcp, true, undefined)).toBe('external');
    expect(chatTabMode(mine, false, undefined)).toBe('external');
  });
});
