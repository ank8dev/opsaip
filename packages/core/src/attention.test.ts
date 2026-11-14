import { describe, expect, it } from 'vitest';
import { attention, type AttentionTask } from './attention';

const t = (id: string, status: AttentionTask['status']): AttentionTask => ({ id, status });

describe('attention', () => {
  it('is empty without tasks', () => {
    expect(attention([])).toEqual({ needsYou: [], failed: [] });
  });

  it('puts waiting_on_human tasks in needsYou and failed tasks in failed', () => {
    const r = attention([t('a', 'waiting_on_human'), t('b', 'failed'), t('c', 'waiting_on_human')]);
    expect(r).toEqual({ needsYou: ['a', 'c'], failed: ['b'] });
  });

  it('lets queued, running and done tasks wait', () => {
    expect(attention([t('a', 'queued'), t('b', 'running'), t('c', 'done')])).toEqual({ needsYou: [], failed: [] });
  });

  it('counts a run once when its task waits and its permission is pending', () => {
    expect(attention([t('a', 'waiting_on_human')], ['a']).needsYou).toEqual(['a']);
  });

  it('counts a pending permission whose task is still running', () => {
    expect(attention([t('a', 'running'), t('b', 'queued')], ['a']).needsYou).toEqual(['a']);
  });

  it('counts a pending permission for a task it does not know yet', () => {
    expect(attention([], ['x']).needsYou).toEqual(['x']);
  });

  it('ignores a permission request whose task is done or failed', () => {
    const r = attention([t('a', 'done'), t('b', 'failed')], ['a', 'b']);
    expect(r).toEqual({ needsYou: [], failed: ['b'] });
  });

  it('counts the same id once, however often it appears', () => {
    const r = attention([t('a', 'waiting_on_human'), t('a', 'waiting_on_human')], ['a', 'a']);
    expect(r.needsYou).toEqual(['a']);
  });

  it('keeps task order, then permission-only ids in their order', () => {
    const r = attention([t('b', 'waiting_on_human'), t('a', 'waiting_on_human'), t('c', 'running')], ['z', 'c']);
    expect(r.needsYou).toEqual(['b', 'a', 'z', 'c']);
  });
});
