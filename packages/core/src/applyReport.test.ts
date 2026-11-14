import { describe, expect, it } from 'vitest';
import { applyReport, type AgentTask, type StatusReport } from './applyReport';

const task: AgentTask = {
  id: 'task-1',
  status: 'queued',
  updatedAt: '2026-11-01T10:00:00.000Z',
};

const report = (overrides: Partial<StatusReport> = {}): StatusReport => ({
  taskId: 'task-1',
  status: 'running',
  at: '2026-11-01T10:05:00.000Z',
  ...overrides,
});

describe('applyReport', () => {
  describe('rule 1: the transition must be allowed by canTransition', () => {
    it('rejects a forbidden transition with a reason', () => {
      const result = applyReport({ ...task, status: 'done' }, report({ status: 'running' }));
      expect(result).toEqual({ ok: false, reason: 'transition not allowed: done -> running' });
    });

    it('rejects a self-transition', () => {
      const result = applyReport(task, report({ status: 'queued' }));
      expect(result.ok).toBe(false);
    });

    it('checks the transition before staleness (a report that is both gets the transition reason)', () => {
      const result = applyReport(
        { ...task, status: 'done' },
        report({ status: 'running', at: '2026-11-01T09:00:00.000Z' }),
      );
      expect(result).toEqual({ ok: false, reason: 'transition not allowed: done -> running' });
    });
  });

  describe('rule 2: a report older than task.updatedAt is stale', () => {
    it('ignores an older report with a reason', () => {
      const result = applyReport(task, report({ at: '2026-11-01T09:59:59.999Z' }));
      expect(result).toEqual({
        ok: false,
        reason: 'stale report: 2026-11-01T09:59:59.999Z is older than 2026-11-01T10:00:00.000Z',
      });
    });

    it('compares instants, not strings (different UTC offsets)', () => {
      // 12:30+03:00 is 09:30Z, which is before 10:00Z, although "12:30" > "10:00" as text.
      const result = applyReport(task, report({ at: '2026-11-01T12:30:00+03:00' }));
      expect(result.ok).toBe(false);
    });

    it('treats an equal timestamp as not stale', () => {
      const result = applyReport(task, report({ at: task.updatedAt }));
      expect(result.ok).toBe(true);
    });
  });

  describe('rule 3: otherwise apply the report', () => {
    it('returns the task with the new status and updatedAt = report.at', () => {
      const result = applyReport(task, report());
      expect(result).toEqual({
        ok: true,
        task: { id: 'task-1', status: 'running', updatedAt: '2026-11-01T10:05:00.000Z' },
      });
    });

    it('does not mutate the input task', () => {
      const input = { ...task };
      applyReport(input, report());
      expect(input).toEqual(task);
    });

    it('keeps extra fields of the task', () => {
      const result = applyReport({ ...task, title: 'Fix login' }, report());
      expect(result.ok && result.task.title).toBe('Fix login');
    });
  });

  describe('optional fields of an accepted report', () => {
    const full: AgentTask = {
      ...task,
      status: 'running',
      title: 'Fix login',
      agent: 'claude-code',
      note: 'started',
    };

    it('sets agent and note from the report', () => {
      const result = applyReport(task, report({ agent: 'codex', note: 'on it' }));
      expect(result.ok && result.task).toEqual({
        ...task,
        status: 'running',
        updatedAt: '2026-11-01T10:05:00.000Z',
        agent: 'codex',
        note: 'on it',
      });
    });

    it('keeps title and agent when the report has none', () => {
      const result = applyReport(full, report({ status: 'done' }));
      expect(result.ok && result.task.title).toBe('Fix login');
      expect(result.ok && result.task.agent).toBe('claude-code');
    });

    it('replaces agent when the report names another one', () => {
      const result = applyReport(full, report({ status: 'done', agent: 'codex' }));
      expect(result.ok && result.task.agent).toBe('codex');
    });

    it('clears the note when the report has none (the key is removed)', () => {
      const waiting = { ...full, status: 'waiting_on_human' as const, note: 'Which branch?' };
      const result = applyReport(waiting, report({ status: 'running' }));
      expect(result.ok && Object.hasOwn(result.task, 'note')).toBe(false);
    });

    it('replaces the note with the new one', () => {
      const result = applyReport(full, report({ status: 'waiting_on_human', note: 'Which branch?' }));
      expect(result.ok && result.task.note).toBe('Which branch?');
    });

    it('replaces the title on a retry (failed -> queued) that has one', () => {
      const failed = { ...full, status: 'failed' as const };
      const result = applyReport(failed, report({ status: 'queued', title: 'Fix login, take 2' }));
      expect(result.ok && result.task.title).toBe('Fix login, take 2');
    });

    it('changes nothing on a rejected report', () => {
      const input = { ...full };
      const result = applyReport(input, report({ status: 'queued', note: 'x' }));
      expect(result.ok).toBe(false);
      expect(input).toEqual(full);
    });
  });

  describe('source', () => {
    it('is kept by every accepted report, and a report cannot change or clear it', () => {
      const mine: AgentTask = { ...task, source: 'you' };
      const result = applyReport(mine, { ...report(), source: undefined } as StatusReport);
      expect(result.ok && result.task.source).toBe('you');
      const forged = applyReport(task, { ...report(), source: 'you' } as StatusReport);
      expect(forged.ok && Object.hasOwn(forged.task, 'source')).toBe(false);
    });
  });

  describe('never throws', () => {
    it('rejects a report for another task', () => {
      const result = applyReport(task, report({ taskId: 'task-2' }));
      expect(result.ok).toBe(false);
    });

    it.each(['', 'not a date', 'yesterday-ish'])('rejects an invalid report.at %j', (at) => {
      expect(applyReport(task, report({ at })).ok).toBe(false);
    });

    it('rejects an invalid task.updatedAt', () => {
      expect(applyReport({ ...task, updatedAt: 'garbage' }, report()).ok).toBe(false);
    });

    it('rejects an unknown status coming from the wire', () => {
      const bad = report({ status: 'exploded' as StatusReport['status'] });
      expect(applyReport(task, bad).ok).toBe(false);
    });

    it('rejects a task with an unknown status', () => {
      const bad = { ...task, status: 'exploded' as AgentTask['status'] };
      expect(applyReport(bad, report()).ok).toBe(false);
    });

    it('rejects null and undefined instead of throwing', () => {
      expect(applyReport(null as unknown as AgentTask, report()).ok).toBe(false);
      expect(applyReport(task, undefined as unknown as StatusReport).ok).toBe(false);
    });
  });
});
