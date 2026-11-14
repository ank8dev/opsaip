import { describe, expect, it } from 'vitest';
import { actionCard, approvedPayload, beginApprove, cancelAction, CONDUCTOR_UNKNOWN_NOTE, RUN_ACTIVE_NOTE } from './actions';
import type { AskAction } from './ask';
import { CONDUCTOR_OFF_NOTE } from './problems';

const run: AskAction = { type: 'run', agent: 'claude-code', title: 'Fix the tests', prompt: 'Fix the failing tests in notes.py.\nKeep it small.' };
const task: AskAction = { type: 'task', title: 'Write the README' };
const on = (extra: object = {}) => ({ ok: true as const, value: { enabled: true as const, repo: 'opsaip-playground', active: false, ...extra } });

describe('actionCard for a run', () => {
  it('shows the agent, the repo and the exact prompt, waiting for Approve', () => {
    const c = actionCard('I will fix them.', run, on(), false);
    expect(c).toMatchObject({ kind: 'action', action: 'run', agent: 'Claude Code', repo: 'opsaip-playground', title: run.title, state: 'pending' });
    expect(c.prompt).toBe((run as { prompt: string }).prompt);
  });

  it('is blocked, with a reason, when Agent mode is off', () => {
    const c = actionCard('x', run, { ok: true, value: { enabled: false, reason: 'No repo set.' } }, false);
    expect(c.state).toBe('blocked');
    expect(c.note).toContain(CONDUCTOR_OFF_NOTE);
    expect(c.note).toContain('No repo set.');
    expect(c.link?.href).toMatch(/^https:/);
  });

  it('is blocked when a run is active on the server, or on this page', () => {
    expect(actionCard('x', run, on({ active: true }), false)).toMatchObject({ state: 'blocked', note: RUN_ACTIVE_NOTE });
    expect(actionCard('x', run, on(), true)).toMatchObject({ state: 'blocked', note: RUN_ACTIVE_NOTE });
  });

  it('is blocked, not approvable, when Agent mode could not be checked', () => {
    expect(actionCard('x', run, { ok: false, problem: 'unreachable' }, false)).toMatchObject({ state: 'blocked', note: CONDUCTOR_UNKNOWN_NOTE });
    expect(actionCard('x', run, null, false).state).toBe('blocked');
  });

  it('works with an older server that sends no repo or active flag', () => {
    const c = actionCard('x', run, { ok: true, value: { enabled: true } }, false);
    expect(c).toMatchObject({ state: 'pending', repo: '' });
  });
});

describe('actionCard for a task', () => {
  it('needs no Agent mode, even when it is off or a run is active', () => {
    expect(actionCard('ok', task, { ok: true, value: { enabled: false } }, true)).toMatchObject({ action: 'task', title: task.title, state: 'pending' });
    expect(actionCard('ok', task, null, false).state).toBe('pending');
  });
});

describe('Approve and Cancel', () => {
  const card = actionCard('x', run, on(), false);

  it('Approve sends exactly the title and prompt on the card, unchanged', () => {
    const odd = actionCard('x', { ...run, title: '  Odd  title ', prompt: '  line 1\n\n  line 2  ' }, on(), false);
    expect(approvedPayload(odd)).toEqual({ title: '  Odd  title ', prompt: '  line 1\n\n  line 2  ' });
  });

  it('Approve goes on once: a second click does nothing', () => {
    const first = beginApprove(card)!;
    expect(first.state).toBe('approving');
    expect(beginApprove(first)).toBeNull();
  });

  it('a blocked, cancelled or finished card cannot be approved', () => {
    expect(beginApprove({ ...card, state: 'blocked' })).toBeNull();
    expect(beginApprove({ ...card, state: 'cancelled' })).toBeNull();
    expect(beginApprove({ ...card, state: 'approved' })).toBeNull();
  });

  it('Cancel marks only a pending card cancelled', () => {
    expect(cancelAction(card).state).toBe('cancelled');
    expect(cancelAction({ ...card, state: 'approved' }).state).toBe('approved');
    expect(cancelAction({ ...card, state: 'approving' }).state).toBe('approving');
  });
});
