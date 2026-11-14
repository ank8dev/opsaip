import { describe, expect, it } from 'vitest';
import { latestOpsyId, opsyStateFor } from './opsyState';
import type { ProposalStatus, ThreadMessage, Widget } from './types';

type OpsyMessage = Extract<ThreadMessage, { from: 'opsy' }>;
const msg = (widget: Widget, pending?: boolean): OpsyMessage => ({ id: 1, from: 'opsy', widget, pending });
const proposal = (status: ProposalStatus): Widget => ({ kind: 'proposal', taskId: 'a', before: 'x', after: 'y', status });

describe('opsyStateFor', () => {
  it('a brief says hello', () => {
    expect(opsyStateFor(msg({ kind: 'brief', total: 1, counts: [], next: null }), false)).toBe('hello');
  });

  it('waiting for your OK asks a question: Needs you, and a proposal before you decide', () => {
    expect(opsyStateFor(msg({ kind: 'needs', tasks: [], more: 0 }), false)).toBe('question');
    expect(opsyStateFor(msg(proposal('pending')), false)).toBe('question');
  });

  it('a decided proposal is idle', () => {
    for (const s of ['approved', 'cancelled', 'stale'] as const) expect(opsyStateFor(msg(proposal(s)), false)).toBe('idle');
  });

  it('answers, lists and agents are idle', () => {
    expect(opsyStateFor(msg({ kind: 'text', text: 'hi' }), false)).toBe('idle');
    expect(opsyStateFor(msg({ kind: 'tasks', title: 't', tasks: [], more: 0 }), false)).toBe('idle');
    expect(opsyStateFor(msg({ kind: 'agent', agent: 'a', counts: [], current: null, alsoWorking: 0, last: null }), false)).toBe('idle');
  });

  it('a message still waiting for the server is working', () => {
    expect(opsyStateFor(msg({ kind: 'text', text: 'Asking…' }, true), false)).toBe('working');
  });

  it('an offline server wins over everything', () => {
    for (const w of [{ kind: 'brief', total: 0, counts: [], next: null }, proposal('pending'), { kind: 'text', text: 'x' }] as Widget[]) {
      expect(opsyStateFor(msg(w), true)).toBe('offline');
    }
    expect(opsyStateFor(msg({ kind: 'text', text: 'x' }, true), true)).toBe('offline');
  });
});

describe('latestOpsyId', () => {
  const you = (id: number): ThreadMessage => ({ id, from: 'you', text: 'hi' });
  const opsy = (id: number): ThreadMessage => ({ id, from: 'opsy', widget: { kind: 'text', text: 'ok' } });

  it('is null before Opsy has said anything', () => {
    expect(latestOpsyId([])).toBeNull();
    expect(latestOpsyId([you(1)])).toBeNull();
  });

  it('is the latest message from Opsy, even when you spoke after it', () => {
    expect(latestOpsyId([you(1), opsy(2), you(3), opsy(4), you(5)])).toBe(4);
    expect(latestOpsyId([opsy(1), you(2)])).toBe(1);
  });

  it('moves on when a newer message arrives, so only one message has the avatar', () => {
    const before = [you(1), opsy(2)];
    const after = [...before, you(3), opsy(4)];
    expect(latestOpsyId(before)).toBe(2);
    expect(latestOpsyId(after)).toBe(4);
  });
});
