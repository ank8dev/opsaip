import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RunChat } from './RunChat';

const tokens = {
  fast: 0, base: 0, slow: 0, stagger: 0, enterStep: 0, dist: 0, blur: 0, scaleFrom: 1,
  easeOut: [0, 0, 1, 1], easeExit: [0, 0, 1, 1], easeSpring: [0, 0, 1, 1], reduced: true,
};
vi.mock('../../state/ui', () => ({ useUi: () => ({ motion: tokens }) }));
vi.mock('../../state/workspace', () => ({ useWorkspace: () => ({ api: { transcript: () => new Promise(() => {}) } }) }));

describe('RunChat before the history arrives', () => {
  const out = renderToStaticMarkup(<RunChat runId="r1" title="T" send={async () => undefined} />);

  it('says it clears when the server restarts', () => {
    expect(out).toContain('clears when the server restarts');
  });

  it('has a message input that is disabled until the run state is known', () => {
    expect(out).toContain('aria-label="Message to the agent"');
    expect(out).toMatch(/<textarea[^>]*disabled/);
  });

  it('labels the history as a log for screen readers', () => {
    expect(out).toContain('role="log"');
  });
});
