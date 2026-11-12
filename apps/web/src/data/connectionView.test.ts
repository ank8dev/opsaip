import { describe, expect, it } from 'vitest';
import { PROBLEM_TEXT, ago, describeSource } from './connectionView';
import type { FetchProblem } from './source';

const NOW = 1_000_000_000;
const PROBLEMS = Object.keys(PROBLEM_TEXT) as FetchProblem[];

describe('describeSource', () => {
  it('Demo: muted, points to Settings', () => {
    const v = describeSource({ status: 'demo' }, NOW);
    expect(v).toMatchObject({ label: 'Demo', tone: 'muted' });
    expect(v.detail).toContain('Settings');
  });

  it('Connecting: muted', () => {
    expect(describeSource({ status: 'connecting' }, NOW)).toMatchObject({ label: 'Connecting', tone: 'muted' });
  });

  it('Live: the accent, read-only, and when it was updated', () => {
    const v = describeSource({ status: 'live', tasks: [], skipped: 0, at: NOW - 30_000 }, NOW);
    expect(v).toMatchObject({ label: 'Live', tone: 'live' });
    expect(v.detail).toBe('Tasks from your server, read-only. Updated 30 s ago.');
  });

  it('Live: says how many tasks were hidden', () => {
    expect(describeSource({ status: 'live', tasks: [], skipped: 1, at: NOW }, NOW).detail).toContain('1 task is hidden');
    expect(describeSource({ status: 'live', tasks: [], skipped: 3, at: NOW }, NOW).detail).toContain('3 tasks are hidden');
  });

  it.each(PROBLEMS)('Offline (%s): red, with the problem text', (problem) => {
    const v = describeSource({ status: 'offline', problem, tasks: [], skipped: 0, at: null }, NOW);
    expect(v).toEqual({ label: 'Offline', tone: 'error', detail: PROBLEM_TEXT[problem] });
  });

  it('Offline after a success: says how old the shown tasks are', () => {
    const v = describeSource({ status: 'offline', problem: 'unreachable', tasks: [], skipped: 0, at: NOW - 5 * 60_000 }, NOW);
    expect(v.detail).toBe(`${PROBLEM_TEXT.unreachable} Showing tasks from 5 min ago.`);
  });

  it('has a distinct text for every problem', () => {
    expect(PROBLEMS.sort()).toEqual(['bad-response', 'server-error', 'unauthorized', 'unreachable']);
    expect(new Set(Object.values(PROBLEM_TEXT)).size).toBe(PROBLEMS.length);
  });
});

describe('ago', () => {
  it.each([
    [0, 'just now'],
    [9_999, 'just now'],
    [-5_000, 'just now'],
    [10_000, '10 s ago'],
    [59_999, '59 s ago'],
    [60_000, '1 min ago'],
    [3_599_999, '59 min ago'],
    [3_600_000, '1 h ago'],
    [26 * 3_600_000, '26 h ago'],
  ])('%i ms -> %s', (elapsed, text) => {
    expect(ago(NOW - elapsed, NOW)).toBe(text);
  });
});
