import { describe, expect, it } from 'vitest';
import { AGENT_TASK_STATUSES } from '@opsaip/core';
import type { TaskStatus } from '../types';
import { STATUS_LABEL, parseServerTask, parseTasksResponse, toUiTask } from './serverTasks';

// Every UI label. Typed as a Record, so `tsc -b` fails if TaskStatus gains or
// loses a label and this list is not updated.
const UI_LABELS: Record<TaskStatus, true> = {
  'Needs you': true,
  Working: true,
  Failed: true,
  Queued: true,
  Done: true,
};

const valid = { id: 't1', status: 'running', updatedAt: '2026-11-10T16:00:00Z' };

describe('STATUS_LABEL', () => {
  it('has a label for every machine status, and nothing else', () => {
    expect(Object.keys(STATUS_LABEL).sort()).toEqual([...AGENT_TASK_STATUSES].sort());
  });

  it('uses every UI label exactly once', () => {
    const labels = Object.values(STATUS_LABEL);
    expect(new Set(labels).size).toBe(labels.length);
    expect(labels.sort()).toEqual(Object.keys(UI_LABELS).sort());
  });

  it('maps each machine status to its label', () => {
    expect(STATUS_LABEL).toEqual({
      queued: 'Queued',
      running: 'Working',
      waiting_on_human: 'Needs you',
      done: 'Done',
      failed: 'Failed',
    });
  });
});

describe('parseTasksResponse', () => {
  it('reads a valid response, keeping the order', () => {
    const body = {
      tasks: [
        { ...valid, id: 'a', title: 'Fix login', agent: 'claude-code', note: 'Which branch?' },
        { ...valid, id: 'b', status: 'queued' },
      ],
    };
    expect(parseTasksResponse(body)).toEqual({
      ok: true,
      skipped: 0,
      tasks: [
        { id: 'a', status: 'running', updatedAt: valid.updatedAt, title: 'Fix login', agent: 'claude-code', note: 'Which branch?' },
        { id: 'b', status: 'queued', updatedAt: valid.updatedAt },
      ],
    });
  });

  it('accepts an empty list', () => {
    expect(parseTasksResponse({ tasks: [] })).toEqual({ ok: true, tasks: [], skipped: 0 });
  });

  it.each([null, undefined, 'tasks', 42, [], {}, { tasks: null }, { tasks: {} }, { tasks: 'x' }])(
    'rejects a body that is not { tasks: [...] }: %j',
    (body) => {
      const result = parseTasksResponse(body);
      expect(result.ok).toBe(false);
    },
  );

  it.each([
    ['not an object', 'x'],
    ['null', null],
    ['an array', [valid]],
    ['id missing', { ...valid, id: undefined }],
    ['id not a string', { ...valid, id: 7 }],
    ['id empty', { ...valid, id: '' }],
    ['id only whitespace', { ...valid, id: '  ' }],
    ['status unknown', { ...valid, status: 'paused' }],
    ['status a UI label', { ...valid, status: 'Working' }],
    ['status an Object.prototype key', { ...valid, status: 'toString' }],
    ['status __proto__', { ...valid, status: '__proto__' }],
    ['status not a string', { ...valid, status: 1 }],
    ['updatedAt missing', { ...valid, updatedAt: undefined }],
    ['updatedAt not a timestamp', { ...valid, updatedAt: 'yesterday' }],
    ['title not a string', { ...valid, title: 5 }],
    ['agent null', { ...valid, agent: null }],
    ['note an object', { ...valid, note: { text: 'hi' } }],
  ])('skips a task when %s', (_case, bad) => {
    const result = parseTasksResponse({ tasks: [bad, { ...valid, id: 'ok' }] });
    expect(result).toEqual({ ok: true, skipped: 1, tasks: [{ ...valid, id: 'ok' }] });
  });

  it('keeps the first of two tasks with the same id', () => {
    const result = parseTasksResponse({
      tasks: [{ ...valid, title: 'first' }, { ...valid, title: 'second' }],
    });
    expect(result).toEqual({ ok: true, skipped: 1, tasks: [{ ...valid, title: 'first' }] });
  });

  it('copies only the known fields', () => {
    const body = JSON.parse(
      '{"tasks":[{"id":"t1","status":"done","updatedAt":"2026-11-10T16:00:00Z","owner":"p1","__proto__":{"polluted":true}}]}',
    );
    const result = parseTasksResponse(body);
    expect(result.ok && result.tasks[0]).toEqual({ id: 't1', status: 'done', updatedAt: '2026-11-10T16:00:00Z' });
    expect(result.ok && Object.getPrototypeOf(result.tasks[0])).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('does not change its input', () => {
    const body = { tasks: [{ ...valid, extra: 1 }] };
    const copy = structuredClone(body);
    parseTasksResponse(body);
    expect(body).toEqual(copy);
  });
});

describe('toUiTask', () => {
  it('maps every field the server sends', () => {
    expect(
      toUiTask({ id: 't1', status: 'waiting_on_human', updatedAt: valid.updatedAt, title: 'Fix login', agent: 'codex', note: 'Approve?' }),
    ).toEqual({
      id: 't1',
      task: 'Fix login',
      tool: '',
      status: 'Needs you',
      owner: '',
      source: 'codex',
      detail: 'Approve?',
      since: valid.updatedAt,
    });
  });

  it('falls back to the id when there is no title, and to empty text for the rest', () => {
    expect(toUiTask({ id: 't2', status: 'queued', updatedAt: valid.updatedAt })).toEqual({
      id: 't2',
      task: 't2',
      tool: '',
      status: 'Queued',
      owner: '',
      source: '',
      detail: '',
      since: valid.updatedAt,
    });
  });

  it.each(AGENT_TASK_STATUSES)('maps status %s through STATUS_LABEL', (status) => {
    expect(toUiTask({ id: 't', status, updatedAt: valid.updatedAt }).status).toBe(STATUS_LABEL[status]);
  });
});

describe('source "you"', () => {
  it('is kept by parseTasksResponse when it is "you"', () => {
    const r = parseTasksResponse({ tasks: [{ ...valid, source: 'you' }] });
    expect(r).toEqual({ ok: true, skipped: 0, tasks: [{ ...valid, source: 'you' }] });
  });

  it('anything else is ignored, and the task is still read', () => {
    for (const source of ['codex', 'You', '', 5, null, {}, ['you']]) {
      const r = parseTasksResponse({ tasks: [{ ...valid, source }] });
      expect(r).toEqual({ ok: true, skipped: 0, tasks: [valid] });
    }
  });

  it('a task you created is yours: owner me, which the chat shows as You', () => {
    expect(toUiTask({ ...valid, source: 'you' }).owner).toBe('me');
    expect(toUiTask(valid).owner).toBe('');
  });

  it('parseServerTask reads one task, or undefined', () => {
    expect(parseServerTask({ ...valid, source: 'you', title: 'T' })).toEqual({ ...valid, source: 'you', title: 'T' });
    for (const bad of [undefined, null, 'x', [], {}, { ...valid, status: 'nope' }]) expect(parseServerTask(bad)).toBeUndefined();
  });
});
