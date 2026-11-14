import { describe, expect, it } from 'vitest';
import { ACTIVE_RUN_KEY, clearActiveRun, loadActiveRun, saveActiveRun } from './activeRun';

function memory(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    data,
  };
}

const throwing = {
  getItem: () => { throw new Error('blocked'); },
  setItem: () => { throw new Error('blocked'); },
  removeItem: () => { throw new Error('blocked'); },
};

describe('active run storage', () => {
  it('uses the key opsaip.activeRun', () => {
    expect(ACTIVE_RUN_KEY).toBe('opsaip.activeRun');
  });

  it('saves and loads id and title', () => {
    const s = memory();
    saveActiveRun({ id: 'r1', title: 'Fix login' }, s);
    expect(loadActiveRun(s)).toEqual({ id: 'r1', title: 'Fix login' });
  });

  it('clear forgets it', () => {
    const s = memory();
    saveActiveRun({ id: 'r1', title: 'x' }, s);
    clearActiveRun(s);
    expect(loadActiveRun(s)).toBeNull();
    expect(s.data.size).toBe(0);
  });

  it('a plain id works too', () => {
    expect(loadActiveRun(memory({ [ACTIVE_RUN_KEY]: 'abc-123' }))).toEqual({ id: 'abc-123', title: '' });
  });

  it('junk is ignored', () => {
    for (const raw of ['', '   ', '{', '{}', '{"id":5}', '{"id":""}', '[]', '{"id":null}']) {
      expect(loadActiveRun(memory({ [ACTIVE_RUN_KEY]: raw }))).toBeNull();
    }
    expect(loadActiveRun(memory({ [ACTIVE_RUN_KEY]: '{"id":"r","title":5}' }))).toEqual({ id: 'r', title: '' });
  });

  it('a throwing storage never throws', () => {
    expect(loadActiveRun(throwing)).toBeNull();
    expect(() => saveActiveRun({ id: 'r', title: 't' }, throwing)).not.toThrow();
    expect(() => clearActiveRun(throwing)).not.toThrow();
  });

  it('no storage at all never throws', () => {
    expect(loadActiveRun(undefined)).toBeNull();
  });
});
