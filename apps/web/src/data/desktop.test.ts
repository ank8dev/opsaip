import { afterEach, describe, expect, it, vi } from 'vitest';
import { folderPicker } from './desktop';

afterEach(() => vi.unstubAllGlobals());

describe('folderPicker', () => {
  it('is undefined in a browser (no preload) and without a window at all', () => {
    expect(folderPicker()).toBeUndefined();
    vi.stubGlobal('window', {});
    expect(folderPicker()).toBeUndefined();
    vi.stubGlobal('window', { opsaipDesktop: {} });
    expect(folderPicker()).toBeUndefined();
    vi.stubGlobal('window', { opsaipDesktop: { pickFolder: 'not a function' } });
    expect(folderPicker()).toBeUndefined();
  });

  it('gives the folder the desktop app returns, or null when the dialog was closed', async () => {
    vi.stubGlobal('window', { opsaipDesktop: { pickFolder: async () => '/Users/me/code/app' } });
    expect(await folderPicker()!()).toBe('/Users/me/code/app');
    vi.stubGlobal('window', { opsaipDesktop: { pickFolder: async () => null } });
    expect(await folderPicker()!()).toBeNull();
  });

  it('takes nothing but a non-empty string as a folder', async () => {
    for (const odd of ['', 5, {}, undefined]) {
      vi.stubGlobal('window', { opsaipDesktop: { pickFolder: async () => odd } });
      expect(await folderPicker()!(), String(odd)).toBeNull();
    }
  });
});
