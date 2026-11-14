import { describe, expect, it } from 'vitest';
import { createLineSplitter, parseAgentLine, userMessageLine } from './streamJson';
import { summarizeToolCall, truncate } from './toolSummary';

describe('parseAgentLine', () => {
  it('reads the system init event', () => {
    expect(parseAgentLine('{"type":"system","subtype":"init","session_id":"s","tools":[]}')).toEqual({ kind: 'init' });
  });

  it('reads the text blocks of a main-thread assistant message, joined', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'One' }, { type: 'tool_use', name: 'Bash', input: {} }, { type: 'text', text: 'Two ' }] },
      parent_tool_use_id: null,
    });
    expect(parseAgentLine(line)).toEqual({ kind: 'message', text: 'One\nTwo' });
  });

  it('ignores subagent messages and messages without text', () => {
    expect(parseAgentLine('{"type":"assistant","message":{"content":[{"type":"text","text":"x"}]},"parent_tool_use_id":"toolu_1"}')).toBeUndefined();
    expect(parseAgentLine('{"type":"assistant","message":{"content":[{"type":"tool_use"}]}}')).toBeUndefined();
    expect(parseAgentLine('{"type":"assistant","message":{"content":[{"type":"text","text":"  "}]}}')).toBeUndefined();
    expect(parseAgentLine('{"type":"assistant","message":null}')).toBeUndefined();
    expect(parseAgentLine('{"type":"assistant","message":{"content":"plain"}}')).toBeUndefined();
  });

  it('reads results: ok only for subtype success without is_error', () => {
    expect(parseAgentLine('{"type":"result","subtype":"success","is_error":false,"result":" Done "}')).toEqual({ kind: 'result', ok: true, text: 'Done' });
    expect(parseAgentLine('{"type":"result","subtype":"success","is_error":true,"result":"API error"}')).toEqual({ kind: 'result', ok: false, text: 'API error' });
    expect(parseAgentLine('{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["x"]}')).toEqual({ kind: 'result', ok: false });
    expect(parseAgentLine('{"type":"result","subtype":"error_max_turns","is_error":false}')).toEqual({ kind: 'result', ok: false });
  });

  it('ignores user messages, stream events, other system events and anything malformed', () => {
    for (const line of [
      '{"type":"user","message":{"role":"user","content":[{"type":"tool_result"}]}}',
      '{"type":"stream_event","event":{}}',
      '{"type":"system","subtype":"api_retry","attempt":1}',
      '{"type":"mystery"}',
      'not json',
      '[1,2]',
      'null',
      '"result"',
      '{"type":"assist',
      '',
    ]) {
      expect(parseAgentLine(line)).toBeUndefined();
    }
  });
});

describe('userMessageLine', () => {
  it('is one JSON line in the SDKUserMessage shape, the text kept exactly', () => {
    const text = 'Fix "the" bug\nthen run tests — ok';
    const line = userMessageLine(text);
    expect(line.endsWith('\n')).toBe(true);
    expect(line.slice(0, -1)).not.toContain('\n');
    expect(JSON.parse(line)).toEqual({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null });
  });
});

describe('createLineSplitter', () => {
  it('splits lines across chunks and skips blank lines', () => {
    const lines: string[] = [];
    const splitter = createLineSplitter((line) => lines.push(line));
    splitter.push('{"a":');
    splitter.push('1}\n\n{"b":2}\n{"c"');
    splitter.push(':3}\n');
    expect(lines).toEqual(['{"a":1}', '{"b":2}', '{"c":3}']);
  });

  it('drops a line over the cap whole, keeps the next lines, and never buffers more than the cap', () => {
    const lines: string[] = [];
    let dropped = 0;
    const splitter = createLineSplitter((line) => lines.push(line), () => dropped++, 10);
    splitter.push('short\n');
    splitter.push('x'.repeat(8));
    splitter.push('x'.repeat(8)); // over the cap, no newline yet
    splitter.push('x'.repeat(1000));
    splitter.push('end of long\nafter\n');
    splitter.push('0123456789A\n'); // over the cap within one chunk
    splitter.push('ok\n');
    expect(lines).toEqual(['short', 'after', 'ok']);
    expect(dropped).toBe(2);
  });
});

describe('summarizeToolCall and truncate', () => {
  it('names the command, path, URL or query, else compact JSON, on one line', () => {
    expect(summarizeToolCall('Bash', { command: 'npm test\n  && npm run build' })).toBe('npm test && npm run build');
    expect(summarizeToolCall('Edit', { file_path: '/etc/hosts', old_string: 'a' })).toBe('/etc/hosts');
    expect(summarizeToolCall('WebFetch', { url: 'https://example.com/', prompt: 'x' })).toBe('https://example.com/');
    expect(summarizeToolCall('WebSearch', { query: 'node 22 sqlite' })).toBe('node 22 sqlite');
    expect(summarizeToolCall('mcp__github__create_issue', { title: 'Bug' })).toBe('{"title":"Bug"}');
    expect(summarizeToolCall('Bash', null)).toBe('null');
    expect(summarizeToolCall('AskUserQuestion', { questions: [{ question: 'Which DB?', options: [] }, { question: 'Tabs?' }] })).toBe('Which DB? / Tabs?');
    expect(summarizeToolCall('AskUserQuestion', { questions: 'bad' })).toBe('{"questions":"bad"}');
  });

  it('is at most 300 characters', () => {
    const summary = summarizeToolCall('Bash', { command: 'x'.repeat(5000) });
    expect(summary).toHaveLength(300);
    expect(summary.endsWith('…')).toBe(true);
  });

  it('truncate counts UTF-16 units like core and never splits a surrogate pair', () => {
    expect(truncate('abc', 3)).toBe('abc');
    expect(truncate('abcd', 3)).toBe('ab…');
    const cut = truncate('a\u{1F600}\u{1F600}', 3); // "a" + a pair at units 1-2
    expect(cut).toBe('a…');
    expect(cut.length).toBeLessThanOrEqual(3);
    expect(truncate('ab\u{1F600}', 3)).toBe('ab…');
  });
});
