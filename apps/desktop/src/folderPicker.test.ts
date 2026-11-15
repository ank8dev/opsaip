import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { chosenFolder, isTrustedSender, PICK_FOLDER_CHANNEL } from './folderPicker.js';

describe('isTrustedSender', () => {
  it('trusts only the app origin', () => {
    expect(isTrustedSender('app://opsaip/index.html')).toBe(true);
    for (const url of [undefined, '', 'https://opsaip.example.com/', 'http://127.0.0.1:4100/', 'file:///tmp/x.html', 'app://other/index.html', 'about:blank']) {
      expect(isTrustedSender(url), String(url)).toBe(false);
    }
  });
});

describe('chosenFolder', () => {
  it('is the first folder chosen', () => {
    expect(chosenFolder({ canceled: false, filePaths: ['/Users/me/code/app'] })).toBe('/Users/me/code/app');
    expect(chosenFolder({ canceled: false, filePaths: ['/a', '/b'] })).toBe('/a');
  });

  it('is null when the dialog was closed or returned nothing usable', () => {
    expect(chosenFolder({ canceled: true, filePaths: ['/Users/me/code/app'] })).toBeNull();
    expect(chosenFolder({ canceled: false, filePaths: [] })).toBeNull();
    expect(chosenFolder({ canceled: false, filePaths: [''] })).toBeNull();
  });
});

describe('the preload script', () => {
  const source = readFileSync(new URL('./preload.cts', import.meta.url), 'utf8');

  it('uses the same channel as the main process', () => {
    expect(source).toContain(`'${PICK_FOLDER_CHANNEL}'`);
  });

  it('exposes only pickFolder, and nothing from Node', () => {
    expect(source).toContain("exposeInMainWorld('opsaipDesktop'");
    expect((source.match(/ipcRenderer\./g) ?? []).length).toBe(1);
    expect(source).not.toMatch(/require\(|from 'node:|from 'fs'/);
  });
});
