import { describe, expect, it } from 'vitest';
import type { Task } from '../types';
import { attentionOf, needsYouText } from './attention';

const task = (id: string, status: Task['status']) => ({ id, status }) as Task;

describe('attentionOf', () => {
  it('maps UI statuses to needs you and failed', () => {
    const r = attentionOf([task('a', 'Needs you'), task('b', 'Failed'), task('c', 'Working'), task('d', 'Queued'), task('e', 'Done')]);
    expect(r.needsYou.map((t) => t.id)).toEqual(['a']);
    expect(r.failed.map((t) => t.id)).toEqual(['b']);
  });

  it('adds a task with a pending permission, once', () => {
    const tasks = [task('a', 'Needs you'), task('c', 'Working')];
    expect(attentionOf(tasks, ['a', 'c']).needsYou.map((t) => t.id)).toEqual(['a', 'c']);
  });

  it('ignores a permission for a task it does not have', () => {
    expect(attentionOf([task('a', 'Working')], ['nope']).needsYou).toEqual([]);
  });

  it('is the same number the sidebar, bar and brief show: one function', () => {
    const tasks = [task('a', 'Needs you'), task('b', 'Needs you'), task('c', 'Failed')];
    const r = attentionOf(tasks);
    expect(r.needsYou).toHaveLength(2);
    expect(r.failed).toHaveLength(1);
  });
});

describe('needsYouText', () => {
  it('uses the right verb', () => {
    expect(needsYouText(0)).toBe('');
    expect(needsYouText(1)).toBe('1 needs you');
    expect(needsYouText(2)).toBe('2 need you');
  });
});
