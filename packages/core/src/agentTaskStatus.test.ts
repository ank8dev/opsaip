import { describe, expect, it } from 'vitest';
import { canTransition, type AgentTaskStatus } from './agentTaskStatus';

type Pair = [AgentTaskStatus, AgentTaskStatus];

describe('canTransition', () => {
  const allowed: Pair[] = [
    ['queued', 'running'],
    ['running', 'waiting_on_human'],
    ['running', 'done'],
    ['running', 'failed'],
    ['waiting_on_human', 'running'],
    ['waiting_on_human', 'failed'],
    ['failed', 'queued'],
  ];

  it.each(allowed)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  const forbidden: Pair[] = [
    ['done', 'running'], // done is final
    ['done', 'queued'], // done is final, even for a retry
    ['queued', 'done'], // cannot finish without running
    ['failed', 'running'], // retry goes through the queue
    ['waiting_on_human', 'done'], // must resume running first
    ['running', 'running'], // no self-transitions
  ];

  it.each(forbidden)('forbids %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });
});
