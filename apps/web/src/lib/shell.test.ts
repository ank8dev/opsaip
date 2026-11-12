import { describe, expect, it } from 'vitest';
import { markShell } from './shell';

const fakeDocument = () => ({ documentElement: { dataset: {} as Record<string, string | undefined> } });

describe('markShell', () => {
  it('marks the desktop app (served at app://opsaip/)', () => {
    const doc = fakeDocument();
    markShell(doc, { protocol: 'app:' });
    expect(doc.documentElement.dataset.shell).toBe('desktop');
  });

  it('leaves a browser tab unmarked', () => {
    for (const protocol of ['https:', 'http:', 'file:', 'App:']) {
      const doc = fakeDocument();
      markShell(doc, { protocol });
      expect(doc.documentElement.dataset.shell).toBeUndefined();
    }
  });
});
