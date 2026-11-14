import { describe, expect, it } from 'vitest';
import {
  CONDUCTOR_DOCS_URL, CONDUCTOR_OFF_NOTE, MAX_REASON_CHARS, STATUS_PROBLEM, problemFor, problemReply, problemText, serverReason,
  type Action, type Problem,
} from './problems';

describe('problemFor: statuses per action', () => {
  const cases: [Action, number, Problem][] = [
    ['createTask', 400, 'bad-request'], ['createTask', 401, 'unauthorized'], ['createTask', 413, 'too-large'],
    ['createTask', 415, 'unsupported'], ['createTask', 500, 'server-error'], ['createTask', 409, 'server-error'],
    ['createTask', 503, 'server-error'],
    ['startRun', 400, 'bad-request'], ['startRun', 401, 'unauthorized'], ['startRun', 409, 'busy'],
    ['startRun', 413, 'too-large'], ['startRun', 415, 'unsupported'], ['startRun', 500, 'run-failed'],
    ['startRun', 503, 'conductor-off'], ['startRun', 502, 'server-error'],
    ['getRun', 401, 'unauthorized'], ['getRun', 404, 'not-found'], ['getRun', 503, 'conductor-off'], ['getRun', 500, 'server-error'],
    ['permission', 409, 'stale'], ['permission', 404, 'not-found'], ['permission', 400, 'bad-request'],
    ['permission', 503, 'conductor-off'], ['permission', 401, 'unauthorized'],
    ['message', 409, 'ended'], ['message', 404, 'not-found'], ['message', 413, 'too-large'], ['message', 503, 'conductor-off'],
    ['cancel', 409, 'ended'], ['cancel', 404, 'not-found'], ['cancel', 503, 'conductor-off'], ['cancel', 500, 'server-error'],
    ['conductor', 401, 'unauthorized'], ['conductor', 404, 'server-error'],
  ];
  it.each(cases)('%s %i -> %s', (action, status, problem) => {
    expect(problemFor(action, status)).toBe(problem);
  });

  it('has a table for every action', () => {
    expect(Object.keys(STATUS_PROBLEM).sort()).toEqual(['cancel', 'conductor', 'createTask', 'getRun', 'message', 'permission', 'startRun']);
  });
});

describe('serverReason', () => {
  it('reads a string error, trimmed', () => {
    expect(serverReason({ error: '  title must not be empty ' })).toBe('title must not be empty');
  });
  it('is undefined for anything else', () => {
    for (const v of [undefined, null, 'x', [], {}, { error: 5 }, { error: '   ' }, { error: null }]) expect(serverReason(v)).toBeUndefined();
  });
  it('cuts a long reason', () => {
    const r = serverReason({ error: 'x'.repeat(1000) });
    expect(r).toHaveLength(MAX_REASON_CHARS);
    expect(r?.endsWith('…')).toBe(true);
  });
});

describe('problemText and problemReply', () => {
  it('shows the server reason for a 400 and a failed start only', () => {
    expect(problemText('bad-request', 'title is missing')).toBe('The server could not use that: title is missing');
    expect(problemText('run-failed', 'worktree could not be created')).toBe('The run could not start: worktree could not be created');
    expect(problemText('server-error', 'secret detail')).not.toContain('secret');
    expect(problemText('bad-request')).toBe('The server could not use that.');
    expect(problemText('run-failed')).toBe('The run could not start.');
  });

  it('says plainly what 409 means for each action', () => {
    expect(problemText('busy')).toContain('already active');
    expect(problemText('stale')).toContain('already answered');
    expect(problemText('ended')).toContain('already ended');
  });

  it('conductor off: the plain note and the link, as text', () => {
    const r = problemReply('conductor-off');
    expect(r.text).toBe(CONDUCTOR_OFF_NOTE);
    expect(r.text).toContain('OPSAIP_CONDUCTOR_DIR');
    expect(r.link).toEqual({ label: 'How to turn it on', href: CONDUCTOR_DOCS_URL });
    expect(CONDUCTOR_DOCS_URL).toBe('https://github.com/ank8dev/opsaip#conductor-mode-experimental');
  });

  it('no other problem has a link, and every one has a text', () => {
    const all: Problem[] = [
      'bad-request', 'unauthorized', 'too-large', 'unsupported', 'conductor-off', 'busy', 'stale', 'ended', 'not-found',
      'run-failed', 'server-error', 'unreachable', 'bad-response',
    ];
    for (const p of all) {
      expect(problemText(p).length).toBeGreaterThan(10);
      expect(problemReply(p).link !== undefined).toBe(p === 'conductor-off');
    }
  });

  it('never mentions a token', () => {
    expect(problemText('unauthorized')).not.toMatch(/Bearer|[A-Za-z0-9]{30,}/);
  });
});
