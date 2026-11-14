import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { UpdateInfo } from '../../data/about';
import { UpdateNote } from './UpdateNote';

const state = vi.hoisted(() => ({ update: null as UpdateInfo | null }));
vi.mock('../../state/appInfo', () => ({ useAppInfo: () => ({ about: null, update: state.update }) }));

describe('UpdateNote', () => {
  it('shows nothing without a newer release', () => {
    state.update = null;
    expect(renderToStaticMarkup(<UpdateNote />)).toBe('');
    state.update = { enabled: true, current: '0.1.0', latest: '0.1.0', url: null, newer: false };
    expect(renderToStaticMarkup(<UpdateNote />)).toBe('');
  });
  it('shows a quiet link to the release, opened safely, with no download', () => {
    state.update = { enabled: true, current: '0.1.0', latest: '0.2.0', url: 'https://github.com/ank8dev/opsaip/releases/tag/v0.2.0', newer: true };
    const out = renderToStaticMarkup(<UpdateNote />);
    expect(out).toContain('Update available · 0.2.0');
    expect(out).toContain('href="https://github.com/ank8dev/opsaip/releases/tag/v0.2.0"');
    expect(out).toContain('rel="noopener noreferrer"');
    expect(out).not.toContain('download');
  });
});
