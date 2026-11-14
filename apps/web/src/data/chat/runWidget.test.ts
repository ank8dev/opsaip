import { describe, expect, it } from 'vitest';
import type { Run } from './conductor';
import {
  PERMISSION_OUTCOME_TEXT, RUN_SOURCE, RUN_STATUS_TEXT, permissionAnswered, permissionCardWidget, reconcilePermission, runCardWidget,
} from './runWidget';
import { opsyStateFor } from './opsyState';
import type { PermissionWidget } from './types';

const run: Run = { id: 'r1', taskId: 't1', status: 'running', branch: 'opsaip/run-r1' };
const withPermission: Run = {
  ...run, status: 'waiting_on_human', permission: { id: 'p1', tool: 'Bash', summary: '<b>npm test</b>' },
};

describe('runCardWidget', () => {
  it('shows the run as the server sent it, and nothing else', () => {
    expect(runCardWidget('Fix login', { ...run, lastMessage: 'Reading files' })).toEqual({
      kind: 'run', runId: 'r1', taskId: 't1', title: 'Fix login', status: 'running', branch: 'opsaip/run-r1',
      lastMessage: 'Reading files', stopping: false, source: RUN_SOURCE,
    });
  });
  it('no message yet is an empty string; no title is a plain name', () => {
    const w = runCardWidget('  ', run);
    expect(w.lastMessage).toBe('');
    expect(w.title).toBe('Claude Code run');
  });
  it('keeps text from the agent verbatim (it is drawn as text)', () => {
    const evil = '<script>alert(1)</script> [x](javascript:y) **bold**';
    expect(runCardWidget('t', { ...run, lastMessage: evil }).lastMessage).toBe(evil);
  });
  it('has plain words for every status', () => {
    expect(RUN_STATUS_TEXT).toEqual({
      queued: 'Starting', running: 'Working', waiting_on_human: 'Waiting for your answer', done: 'Done', failed: 'Failed',
    });
  });
});

describe('permission card', () => {
  it('is built from the run, with tool and summary verbatim; none without a request', () => {
    expect(permissionCardWidget(run)).toBeNull();
    expect(permissionCardWidget(withPermission)).toEqual({
      kind: 'permission', runId: 'r1', permissionId: 'p1', tool: 'Bash', summary: '<b>npm test</b>', state: 'pending', busy: false, error: '',
    });
  });

  const pending = permissionCardWidget(withPermission) as PermissionWidget;

  it('outcome: Allowed / Denied', () => {
    expect(permissionAnswered({ ...pending, busy: true }, true, { ok: true, value: run })).toMatchObject({ state: 'allowed', busy: false });
    expect(permissionAnswered({ ...pending, busy: true }, false, { ok: true, value: run })).toMatchObject({ state: 'denied', busy: false });
    expect(PERMISSION_OUTCOME_TEXT.allowed).toBe('Allowed');
    expect(PERMISSION_OUTCOME_TEXT.denied).toBe('Denied');
  });

  it('409 stale: says it was already answered or the run ended, and removes the buttons', () => {
    const w = permissionAnswered({ ...pending, busy: true }, true, { ok: false, problem: 'stale' });
    expect(w).toMatchObject({ state: 'stale', busy: false, error: '' });
    expect(PERMISSION_OUTCOME_TEXT.stale).toContain('already answered');
    expect(PERMISSION_OUTCOME_TEXT.stale).toContain('run ended');
  });

  it('another failure keeps the buttons, enables them again and shows a short message', () => {
    const w = permissionAnswered({ ...pending, busy: true }, true, { ok: false, problem: 'unreachable' });
    expect(w.state).toBe('pending');
    expect(w.busy).toBe(false);
    expect(w.error).toContain('could not reach the server');
  });

  it('reconcile: still listed stays pending; gone or run over becomes stale; an answer in flight is left alone', () => {
    expect(reconcilePermission(pending, withPermission)).toBe(pending);
    expect(reconcilePermission(pending, { ...run, status: 'running' }).state).toBe('stale');
    expect(reconcilePermission(pending, { ...withPermission, permission: { id: 'p2', tool: 'x', summary: 'y' } }).state).toBe('stale');
    expect(reconcilePermission(pending, { ...withPermission, status: 'failed' }).state).toBe('stale');
    const busy = { ...pending, busy: true };
    expect(reconcilePermission(busy, run)).toBe(busy);
    const allowed: PermissionWidget = { ...pending, state: 'allowed' };
    expect(reconcilePermission(allowed, run)).toBe(allowed);
  });
});

describe("Opsy's face for runs", () => {
  const face = (widget: Parameters<typeof opsyStateFor>[0]['widget']) => opsyStateFor({ id: 1, from: 'opsy', widget }, false);
  it('question while waiting for you, working, done, error', () => {
    expect(face(runCardWidget('t', { ...run, status: 'waiting_on_human' }))).toBe('question');
    expect(face(runCardWidget('t', run))).toBe('working');
    expect(face(runCardWidget('t', { ...run, status: 'queued' }))).toBe('working');
    expect(face(runCardWidget('t', { ...run, status: 'done' }))).toBe('done');
    expect(face(runCardWidget('t', { ...run, status: 'failed' }))).toBe('error');
  });
  it('a pending request is a question; an answered one is idle', () => {
    const p = permissionCardWidget(withPermission) as PermissionWidget;
    expect(face(p)).toBe('question');
    expect(face({ ...p, state: 'allowed' })).toBe('idle');
    expect(face({ ...p, state: 'stale' })).toBe('idle');
  });
});
