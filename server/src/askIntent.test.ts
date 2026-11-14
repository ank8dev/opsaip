import { describe, expect, it } from 'vitest';
import { ASK_RESPONSE_SCHEMA, ONLY_CLAUDE_CODE, parseModelReply } from './askIntent';

const MAX = 4000;
const reply = (value: unknown) => parseModelReply(JSON.stringify(value), MAX);

describe('parseModelReply', () => {
  it('a valid run', () => {
    expect(
      reply({ answer: ' I will run it. ', action: { type: 'run', title: ' Fix login ', prompt: 'Fix it', agent: 'claude-code' } }),
    ).toEqual({
      answer: 'I will run it.',
      action: { type: 'run', agent: 'claude-code', title: 'Fix login', prompt: 'Fix it' },
    });
  });

  it('a run without agent defaults to claude-code; agent spellings normalize', () => {
    for (const agent of [undefined, null, 'Claude Code', 'claude_code', ' CLAUDE-CODE ']) {
      expect(reply({ answer: 'a', action: { type: 'run', title: 't', prompt: 'p', agent } }).action).toEqual({
        type: 'run',
        agent: 'claude-code',
        title: 't',
        prompt: 'p',
      });
    }
  });

  it('another agent: fixed answer, no action', () => {
    for (const agent of ['codex', 'claude', '', 5, {}]) {
      expect(reply({ answer: 'a', action: { type: 'run', title: 't', prompt: 'p', agent } })).toEqual({
        answer: ONLY_CLAUDE_CODE,
        action: null,
      });
    }
  });

  it('a valid task; agent and prompt are dropped', () => {
    expect(reply({ answer: 'a', action: { type: 'task', title: ' Write docs ', agent: 'codex', prompt: 'x' } })).toEqual({
      answer: 'a',
      action: { type: 'task', title: 'Write docs' },
    });
  });

  it('bad type, null action, no action, non-object action', () => {
    for (const action of [{ type: 'delete', title: 't' }, { title: 't' }, null, undefined, 'run', 5, [], { type: 7 }]) {
      expect(reply({ answer: 'a', action })).toEqual({ answer: 'a', action: null });
    }
  });

  it('title and prompt follow the POST /v1/runs limits', () => {
    const bad = [
      { type: 'run', title: 'x'.repeat(201), prompt: 'p' },
      { type: 'run', title: '   ', prompt: 'p' },
      { type: 'run', title: 't', prompt: 'p'.repeat(12_001) },
      { type: 'run', title: 't', prompt: '   ' },
      { type: 'run', title: 't' },
      { type: 'run', prompt: 'p' },
      { type: 'run', title: 5, prompt: 'p' },
      { type: 'run', title: 't', prompt: 5 },
      { type: 'task', title: 'x'.repeat(201) },
      { type: 'task', title: '' },
      { type: 'task' },
    ];
    for (const action of bad) expect(reply({ answer: 'keep me', action })).toEqual({ answer: 'keep me', action: null });
    expect(
      reply({ answer: 'a', action: { type: 'run', title: 'x'.repeat(200), prompt: 'p'.repeat(12_000) } }).action,
    ).not.toBeNull();
  });

  it('unknown fields are dropped', () => {
    const result = reply({
      answer: 'a',
      foo: 1,
      action: { type: 'run', title: 't', prompt: 'p', shell: 'rm -rf /', agent: 'claude-code' },
    });
    expect(Object.keys(result).sort()).toEqual(['action', 'answer']);
    expect(Object.keys(result.action!).sort()).toEqual(['agent', 'prompt', 'title', 'type']);
  });

  it('falls back to the raw trimmed text when it is not a usable JSON reply', () => {
    const raws = ['  plain text  ', '{"answer": "cut', '[1]', 'null', '"str"', '42', '{"action":null}', '{"answer":5}', '{"answer":"   "}', ''];
    for (const raw of raws) {
      expect(parseModelReply(raw, MAX)).toEqual({ answer: raw.trim(), action: null });
    }
  });

  it('truncates a huge answer, in code points, in both paths', () => {
    const long = '😀'.repeat(MAX + 10);
    for (const raw of [long, JSON.stringify({ answer: long, action: null })]) {
      const { answer } = parseModelReply(raw, MAX);
      expect(Array.from(answer)).toHaveLength(MAX + 1);
      expect(answer.endsWith('…')).toBe(true);
    }
  });
});

describe('ASK_RESPONSE_SCHEMA', () => {
  it('has a nullable action with run/task types', () => {
    expect(ASK_RESPONSE_SCHEMA.properties.action.nullable).toBe(true);
    expect(ASK_RESPONSE_SCHEMA.properties.action.properties.type.enum).toEqual(['run', 'task']);
    expect(ASK_RESPONSE_SCHEMA.required).toContain('answer');
  });
});
