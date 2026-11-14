import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { TaskOverlay } from './TaskOverlay';

const tokens = {
  fast: 0, base: 0, slow: 0, stagger: 0, enterStep: 0, dist: 0, blur: 0, scaleFrom: 1,
  easeOut: [0, 0, 1, 1], easeExit: [0, 0, 1, 1], easeSpring: [0, 0, 1, 1], reduced: true,
};
vi.mock('../../state/ui', () => ({ useUi: () => ({ motion: tokens, closeTask: () => {} }) }));

describe('TaskOverlay markup', () => {
  const out = renderToStaticMarkup(<TaskOverlay label="Task" title="Deploy"><p>body</p></TaskOverlay>);

  it('is a modal dialog named by its title', () => {
    expect(out).toContain('role="dialog"');
    expect(out).toContain('aria-modal="true"');
    expect(out).toMatch(/aria-labelledby="[^"]+"/);
    expect(out).toContain('Deploy');
  });

  it('has a close button for keyboard and screen readers', () => {
    expect(out).toContain('aria-label="Close task"');
  });

  it('puts the content in a body that scrolls inside the window', () => {
    expect(out).toContain('op-overlay-body');
    expect(out).toContain('<p>body</p>');
  });
});
