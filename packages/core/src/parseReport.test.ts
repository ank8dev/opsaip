import { describe, expect, it } from 'vitest';
import { AGENT_TASK_STATUSES, isAgentTaskStatus } from './agentTaskStatus';
import {
  MAX_AGENT_LENGTH,
  MAX_NOTE_LENGTH,
  MAX_TASK_ID_LENGTH,
  MAX_TITLE_LENGTH,
  parseReport,
} from './parseReport';

const valid = {
  taskId: 'task-1',
  status: 'running',
  at: '2026-11-01T10:05:00.000Z',
};

const withField = (key: string, value: unknown) => ({ ...valid, [key]: value });
const without = (key: keyof typeof valid) => {
  const copy: Record<string, unknown> = { ...valid };
  delete copy[key];
  return copy;
};
const reasonOf = (input: unknown) => {
  const result = parseReport(input);
  return result.ok ? null : result.reason;
};

describe('parseReport', () => {
  it('accepts a valid report', () => {
    expect(parseReport(valid)).toEqual({ ok: true, report: valid });
  });

  it('accepts a report that came through JSON.parse', () => {
    expect(parseReport(JSON.parse(JSON.stringify(valid)))).toEqual({ ok: true, report: valid });
  });

  describe('rule: input must be an object', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['an array', []],
      ['an array of a report', [valid]],
      ['a number', 42],
      ['NaN', Number.NaN],
      ['a string', 'task-1 running'],
      ['a JSON string of a valid report', JSON.stringify(valid)],
      ['a boolean', true],
      ['a function', () => valid],
    ])('rejects %s', (_label, input) => {
      expect(parseReport(input)).toEqual({ ok: false, reason: 'report must be an object' });
    });

    it('rejects an empty object (first missing field decides the reason)', () => {
      expect(reasonOf({})).toBe('taskId is missing');
    });
  });

  describe('rule: taskId is a non-empty, non-blank string, max 200 chars', () => {
    it('rejects a missing taskId', () => {
      expect(reasonOf(without('taskId'))).toBe('taskId is missing');
    });

    it.each([
      ['null', null],
      ['a number', 1],
      ['an array', ['task-1']],
      ['an object', { id: 'task-1' }],
      ['a boolean', false],
    ])('rejects taskId that is %s', (_label, taskId) => {
      expect(reasonOf(withField('taskId', taskId))).toBe('taskId must be a string');
    });

    it('rejects an empty taskId', () => {
      expect(reasonOf(withField('taskId', ''))).toBe('taskId must not be empty');
    });

    it.each([
      ['spaces', '   '],
      ['a single space', ' '],
      ['tabs and newlines', '\t\n\r'],
      ['a no-break space', '\u00A0'],
      ['a byte order mark', '\uFEFF'],
      ['a line separator', '\u2028'],
    ])('rejects taskId that is only whitespace: %s', (_label, taskId) => {
      expect(reasonOf(withField('taskId', taskId))).toBe('taskId must not be only whitespace');
    });

    it('accepts taskId with surrounding whitespace and keeps it unchanged', () => {
      const result = parseReport(withField('taskId', '  task-1 '));
      expect(result).toEqual({ ok: true, report: { ...valid, taskId: '  task-1 ' } });
    });

    it('reports the length rule first for an oversized whitespace taskId', () => {
      const taskId = ' '.repeat(MAX_TASK_ID_LENGTH + 1);
      expect(reasonOf(withField('taskId', taskId))).toBe('taskId must be at most 200 characters');
    });

    it('accepts exactly 200 characters with whitespace around a real id', () => {
      const taskId = ` ${'a'.repeat(MAX_TASK_ID_LENGTH - 2)} `;
      expect(parseReport(withField('taskId', taskId)).ok).toBe(true);
    });

    it('accepts exactly 200 characters', () => {
      const taskId = 'a'.repeat(MAX_TASK_ID_LENGTH);
      expect(parseReport(withField('taskId', taskId)).ok).toBe(true);
    });

    it('rejects 201 characters', () => {
      const taskId = 'a'.repeat(MAX_TASK_ID_LENGTH + 1);
      expect(reasonOf(withField('taskId', taskId))).toBe('taskId must be at most 200 characters');
    });
  });

  describe('rule: status is one of the AgentTaskStatus values', () => {
    it.each(AGENT_TASK_STATUSES)('accepts %s', (status) => {
      expect(parseReport(withField('status', status))).toEqual({
        ok: true,
        report: { ...valid, status },
      });
    });

    it('rejects a missing status', () => {
      expect(reasonOf(without('status'))).toBe('status is missing');
    });

    it.each([
      ['an unknown word', 'finished'],
      ['a UI label instead of the machine value', 'Waiting on human'],
      ['a different case', 'RUNNING'],
      ['surrounding spaces', ' running '],
      ['an empty string', ''],
      ['an Object.prototype key', 'toString'],
      ['__proto__', '__proto__'],
      ['null', null],
      ['a number', 1],
      ['an array', ['running']],
    ])('rejects %s', (_label, status) => {
      expect(reasonOf(withField('status', status))).toBe(
        'status must be one of: queued, running, waiting_on_human, done, failed',
      );
    });
  });

  describe('rule: at is a valid ISO 8601 timestamp', () => {
    it.each([
      '2026-11-01T10:05:00Z',
      '2026-11-01T10:05:00.1Z',
      '2026-11-01T10:05:00.123456Z',
      '2026-11-01T12:30:00+03:00',
      '2026-11-01T05:00:00-05:30',
      '2028-02-29T00:00:00Z', // leap year
      '2000-02-29T00:00:00Z', // divisible by 400: leap
      '2026-12-31T23:59:59.999Z',
    ])('accepts %s', (at) => {
      expect(parseReport(withField('at', at))).toEqual({ ok: true, report: { ...valid, at } });
    });

    it('rejects a missing at', () => {
      expect(reasonOf(without('at'))).toBe('at is missing');
    });

    it.each([
      ['null', null],
      ['a number (epoch ms)', 1793527500000],
      ['a Date object', new Date('2026-11-01T10:05:00Z')],
      ['an array', ['2026-11-01T10:05:00Z']],
    ])('rejects at that is %s', (_label, at) => {
      expect(reasonOf(withField('at', at))).toBe('at must be a string');
    });

    it.each([
      ['an empty string', ''],
      ['free text', 'yesterday'],
      ['a format Date.parse accepts but is not ISO', 'Nov 1, 2026 10:05:00 GMT'],
      ['a date without time', '2026-11-01'],
      ['no offset (local time)', '2026-11-01T10:05:00'],
      ['no seconds', '2026-11-01T10:05Z'],
      ['a space instead of T', '2026-11-01 10:05:00Z'],
      ['lowercase t and z', '2026-11-01t10:05:00z'],
      ['a comma as decimal sign', '2026-11-01T10:05:00,5Z'],
      ['a basic (no separators) format', '20261101T100500Z'],
      ['month 13', '2026-13-01T10:05:00Z'],
      ['month 00', '2026-00-01T10:05:00Z'],
      ['day 00', '2026-11-00T10:05:00Z'],
      ['February 30', '2026-02-30T10:05:00Z'],
      ['February 29 in a non-leap year', '2026-02-29T10:05:00Z'],
      ['February 29 in 1900 (divisible by 100)', '1900-02-29T10:05:00Z'],
      ['November 31', '2026-11-31T10:05:00Z'],
      ['hour 24', '2026-11-01T24:00:00Z'],
      ['minute 60', '2026-11-01T10:60:00Z'],
      ['a leap second', '2026-12-31T23:59:60Z'],
      ['an offset of 24 hours', '2026-11-01T10:05:00+24:00'],
      ['an offset without colon', '2026-11-01T10:05:00+0300'],
      ['surrounding spaces', ' 2026-11-01T10:05:00Z '],
      ['a trailing newline', '2026-11-01T10:05:00Z\n'],
    ])('rejects %s', (_label, at) => {
      expect(reasonOf(withField('at', at))).toBe(
        'at must be an ISO 8601 timestamp like 2026-11-01T10:05:00Z',
      );
    });
  });

  describe('rule: optional title, agent and note are non-blank strings within a limit', () => {
    // title needs status "queued"; the base report for each field allows it.
    const fields = [
      { name: 'title', max: MAX_TITLE_LENGTH, base: { ...valid, status: 'queued' } },
      { name: 'agent', max: MAX_AGENT_LENGTH, base: valid },
      { name: 'note', max: MAX_NOTE_LENGTH, base: valid },
    ] as const;

    it('has the limits 200, 100 and 500', () => {
      expect([MAX_TITLE_LENGTH, MAX_AGENT_LENGTH, MAX_NOTE_LENGTH]).toEqual([200, 100, 500]);
    });

    it('accepts a report with all three fields and copies them', () => {
      const input = {
        ...valid,
        status: 'queued',
        title: 'Fix login',
        agent: 'claude-code',
        note: 'picked up',
      };
      expect(parseReport(input)).toEqual({ ok: true, report: input });
    });

    describe.each(fields)('$name', ({ name, max, base }) => {
      const make = (value: unknown) => ({ ...base, [name]: value });

      it('is optional: without it the report has no such key', () => {
        const result = parseReport(base);
        expect(result.ok && Object.hasOwn(result.report, name)).toBe(false);
      });

      it('accepts exactly the limit and keeps the value unchanged', () => {
        const value = ` ${'a'.repeat(max - 2)} `;
        expect(parseReport(make(value))).toEqual({ ok: true, report: make(value) });
      });

      it('rejects one character over the limit', () => {
        expect(reasonOf(make('a'.repeat(max + 1)))).toBe(
          `${name} must be at most ${max} characters`,
        );
      });

      it('reports the length rule first for an oversized whitespace value', () => {
        expect(reasonOf(make(' '.repeat(max + 1)))).toBe(
          `${name} must be at most ${max} characters`,
        );
      });

      it('rejects an empty string', () => {
        expect(reasonOf(make(''))).toBe(`${name} must not be empty`);
      });

      it.each([' ', '\t\n', '\u00A0'])('rejects only whitespace (%j)', (value) => {
        expect(reasonOf(make(value))).toBe(`${name} must not be only whitespace`);
      });

      it.each([
        ['null', null],
        ['a number', 1],
        ['an array', ['x']],
        ['an object', { text: 'x' }],
        ['a boolean', true],
      ])('rejects %s', (_label, value) => {
        expect(reasonOf(make(value))).toBe(`${name} must be a string`);
      });
    });

    it.each(AGENT_TASK_STATUSES.filter((status) => status !== 'queued'))(
      'rejects a title with status %s',
      (status) => {
        expect(reasonOf({ ...valid, status, title: 'Fix login' })).toBe(
          'title is only allowed with status "queued"',
        );
      },
    );

    it('checks the status rule for title before its value', () => {
      expect(reasonOf({ ...valid, status: 'running', title: null })).toBe(
        'title is only allowed with status "queued"',
      );
    });

    it('checks the required fields before the optional ones', () => {
      expect(reasonOf({ ...without('at'), agent: 7 })).toBe('at is missing');
    });

    it.each(AGENT_TASK_STATUSES)('accepts agent and note with status %s', (status) => {
      const input = { ...valid, status, agent: 'codex', note: 'Which branch?' };
      expect(parseReport(input)).toEqual({ ok: true, report: input });
    });

    it('does not echo the input value in the reason', () => {
      const reason = reasonOf(withField('note', 'x'.repeat(10_000)));
      expect(reason).toBe('note must be at most 500 characters');
    });
  });

  describe('rule: unknown extra fields are ignored and not copied', () => {
    it('drops extra fields and returns only taskId, status, at', () => {
      const result = parseReport({ ...valid, secret: 'x', nested: { a: 1 }, updatedAt: 'y' });
      expect(result).toEqual({ ok: true, report: valid });
      if (result.ok) expect(Object.keys(result.report).sort()).toEqual(['at', 'status', 'taskId']);
    });

    it('returns a new object, not the input', () => {
      const input = { ...valid };
      const result = parseReport(input);
      expect(result.ok && result.report).not.toBe(input);
    });

    it('does not let __proto__ in the JSON leak into the report', () => {
      const input = JSON.parse(`{"taskId":"task-1","status":"running","at":"${valid.at}","__proto__":{"polluted":true}}`);
      const result = parseReport(input);
      expect(result).toEqual({ ok: true, report: valid });
      expect(result.ok && Object.getPrototypeOf(result.report)).toBe(Object.prototype);
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    });
  });

  describe('never throws', () => {
    it('rejects an object whose getter throws', () => {
      const input = {
        ...valid,
        get status(): string {
          throw new Error('boom');
        },
      };
      expect(parseReport(input)).toEqual({ ok: false, reason: 'report could not be read' });
    });

    it('rejects a Proxy that throws on every read', () => {
      const input = new Proxy(
        {},
        {
          get() {
            throw new Error('boom');
          },
        },
      );
      expect(parseReport(input)).toEqual({ ok: false, reason: 'report could not be read' });
    });

    it('does not echo the input value in the reason', () => {
      const reason = reasonOf(withField('status', 'x'.repeat(10_000)));
      expect(reason).not.toContain('xxx');
    });
  });
});

describe('isAgentTaskStatus', () => {
  it('is true for every status and false for anything else', () => {
    for (const status of AGENT_TASK_STATUSES) expect(isAgentTaskStatus(status)).toBe(true);
    for (const value of ['hasOwnProperty', 'constructor', '', null, undefined, 0, {}]) {
      expect(isAgentTaskStatus(value)).toBe(false);
    }
  });
});
