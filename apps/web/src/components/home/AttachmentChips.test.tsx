import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AttachmentChips, FileChip } from './AttachmentChips';
import type { AttachmentItem } from './useAttachments';

const tokens = {
  fast: 0, base: 0, slow: 0, stagger: 0, enterStep: 0, dist: 0, blur: 0, scaleFrom: 1,
  easeOut: [0, 0, 1, 1], easeExit: [0, 0, 1, 1], easeSpring: [0, 0, 1, 1], reduced: true,
};
vi.mock('../../state/ui', () => ({ useUi: () => ({ motion: tokens }) }));

const item = (extra: Partial<AttachmentItem>): AttachmentItem => ({ key: 'a1', name: 'shot.png', size: 2048, kind: 'image', status: 'ready', ...extra });

describe('AttachmentChips', () => {
  it('shows a chip per file with a remove button named after it', () => {
    const out = renderToStaticMarkup(<AttachmentChips items={[item({}), item({ key: 'a2', name: 'notes.txt', kind: 'text' })]} onRemove={() => {}} />);
    expect(out).toContain('aria-label="Remove shot.png"');
    expect(out).toContain('aria-label="Remove notes.txt"');
    expect(out).toContain('2 KB');
  });

  it('shows a preview for an image and a kind badge otherwise', () => {
    const out = renderToStaticMarkup(<AttachmentChips items={[item({ preview: 'blob:x' }), item({ key: 'v', name: 'a.mp4', kind: 'video' })]} onRemove={() => {}} />);
    expect(out).toContain('src="blob:x"');
    expect(out).toContain('VID');
  });

  it('says uploading and says why an upload failed, as an alert', () => {
    expect(renderToStaticMarkup(<AttachmentChips items={[item({ status: 'uploading' })]} onRemove={() => {}} />)).toContain('Uploading…');
    const err = renderToStaticMarkup(<AttachmentChips items={[item({ status: 'error', error: 'content is not a PNG' })]} onRemove={() => {}} />);
    expect(err).toContain('role="alert"');
    expect(err).toContain('content is not a PNG');
  });

  it('draws a file name as text, never as HTML', () => {
    const out = renderToStaticMarkup(<FileChip name={'<img src=x onerror=1>.png'} kind="image" size={1} />);
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });
});
