import { describe, expect, it } from 'vitest';
import { parseNewTask } from './parseNewTask';
import { MAX_AGENT_LENGTH, MAX_TITLE_LENGTH } from './parseReport';

const reasonOf = (input: unknown) => {
  const result = parseNewTask(input);
  return result.ok ? null : result.reason;
};

describe('parseNewTask', () => {
  it('accepts a title alone', () => {
    expect(parseNewTask({ title: 'Fix login' })).toEqual({ ok: true, task: { title: 'Fix login' } });
  });

  it('accepts a title and an agent, and leaves no agent key when it is absent', () => {
    expect(parseNewTask({ title: 'Fix login', agent: 'claude-code' })).toEqual({
      ok: true,
      task: { title: 'Fix login', agent: 'claude-code' },
    });
    const result = parseNewTask({ title: 'x' });
    expect(result.ok && 'agent' in result.task).toBe(false);
  });

  it('accepts what came through JSON.parse', () => {
    expect(parseNewTask(JSON.parse('{"title":"a","agent":"b"}'))).toEqual({
      ok: true,
      task: { title: 'a', agent: 'b' },
    });
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['an array', [{ title: 'a' }]],
    ['a string', '{"title":"a"}'],
    ['a number', 1],
    ['a boolean', true],
  ])('rejects %s', (_label, input) => {
    expect(parseNewTask(input)).toEqual({ ok: false, reason: 'task must be an object' });
  });

  describe('title', () => {
    it('is required', () => {
      expect(reasonOf({})).toBe('title is missing');
      expect(reasonOf({ agent: 'a' })).toBe('title is missing');
    });

    it.each([null, 5, true, {}, ['a']])('must be a string, not %j', (title) => {
      expect(reasonOf({ title })).toBe('title must be a string');
    });

    it('must not be empty or only whitespace', () => {
      expect(reasonOf({ title: '' })).toBe('title must not be empty');
      expect(reasonOf({ title: ' \t\n  ' })).toBe('title must not be only whitespace');
    });

    it('is trimmed', () => {
      expect(parseNewTask({ title: '  Fix\tlogin \n' })).toEqual({
        ok: true,
        task: { title: 'Fix\tlogin' },
      });
    });

    it('accepts exactly the maximum length and rejects one more', () => {
      expect(parseNewTask({ title: 'a'.repeat(MAX_TITLE_LENGTH) }).ok).toBe(true);
      expect(reasonOf({ title: 'a'.repeat(MAX_TITLE_LENGTH + 1) })).toBe(
        `title must be at most ${MAX_TITLE_LENGTH} characters`,
      );
    });

    it('counts the text as sent, like parseReport: padding counts toward the limit', () => {
      const padded = ` ${'a'.repeat(MAX_TITLE_LENGTH)}`;
      expect(reasonOf({ title: padded })).toBe(`title must be at most ${MAX_TITLE_LENGTH} characters`);
    });

    it('counts UTF-16 code units, like parseReport', () => {
      // One emoji is two code units.
      expect(parseNewTask({ title: '😀'.repeat(MAX_TITLE_LENGTH / 2) }).ok).toBe(true);
      expect(parseNewTask({ title: '😀'.repeat(MAX_TITLE_LENGTH / 2 + 1) }).ok).toBe(false);
    });
  });

  describe('agent', () => {
    it.each([null, 5, true, {}])('must be a string when present, not %j', (agent) => {
      expect(reasonOf({ title: 'a', agent })).toBe('agent must be a string');
    });

    it('must not be empty or only whitespace', () => {
      expect(reasonOf({ title: 'a', agent: '' })).toBe('agent must not be empty');
      expect(reasonOf({ title: 'a', agent: '   ' })).toBe('agent must not be only whitespace');
    });

    it('is kept as sent, not trimmed', () => {
      expect(parseNewTask({ title: 'a', agent: ' codex ' })).toEqual({
        ok: true,
        task: { title: 'a', agent: ' codex ' },
      });
    });

    it('accepts exactly the maximum length and rejects one more', () => {
      expect(parseNewTask({ title: 'a', agent: 'a'.repeat(MAX_AGENT_LENGTH) }).ok).toBe(true);
      expect(reasonOf({ title: 'a', agent: 'a'.repeat(MAX_AGENT_LENGTH + 1) })).toBe(
        `agent must be at most ${MAX_AGENT_LENGTH} characters`,
      );
    });
  });

  describe('unknown fields', () => {
    it('are ignored and not copied, including id, status, updatedAt and source', () => {
      const result = parseNewTask({
        title: 'a',
        id: 'mine',
        status: 'done',
        updatedAt: '2020-01-01T00:00:00Z',
        source: 'agent',
        extra: { deep: true },
      });
      expect(result).toEqual({ ok: true, task: { title: 'a' } });
    });

    it('does not pick up inherited or __proto__ fields', () => {
      const result = parseNewTask(JSON.parse('{"title":"a","__proto__":{"agent":"evil"}}'));
      expect(result).toEqual({ ok: true, task: { title: 'a' } });
    });
  });

  it('does not echo the input in a reason', () => {
    const secret = 'sk-very-secret-value';
    expect(reasonOf({ title: 5, agent: secret })).not.toContain(secret);
    expect(reasonOf({ title: 'a', agent: secret.repeat(20) })).not.toContain(secret);
  });

  it('never throws, even when a getter does', () => {
    const hostile = {
      get title(): string {
        throw new Error('boom');
      },
    };
    expect(parseNewTask(hostile)).toEqual({ ok: false, reason: 'task could not be read' });
    expect(parseNewTask(new Proxy({}, { get: () => { throw new Error('boom'); } })).ok).toBe(false);
  });
});
