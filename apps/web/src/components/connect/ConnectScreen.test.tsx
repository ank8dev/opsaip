import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readMotionTokens } from '../../styles/motion';
import { README_URL } from '../../data/source';
import { ConnectScreen } from './ConnectScreen';

const motionTokens = {
  fast: 0, base: 0, slow: 0, stagger: 0, enterStep: 0, dist: 0, blur: 0, scaleFrom: 1,
  easeOut: [0, 0, 1, 1], easeExit: [0, 0, 1, 1], easeSpring: [0, 0, 1, 1], reduced: true,
} satisfies ReturnType<typeof readMotionTokens>;

vi.mock('../../state/ui', () => ({ useUi: () => ({ motion: motionTokens }) }));
vi.mock('../../state/workspace', () => ({ useWorkspace: () => ({ connect: () => undefined }) }));
vi.mock('../opsy/Opsy', () => ({ Opsy: () => null }));

describe('ConnectScreen', () => {
  const out = renderToStaticMarkup(<ConnectScreen serverUrl="http://127.0.0.1:4100" />);

  it('shows the server address, a token field and a link to the README', () => {
    expect(out).toContain('http://127.0.0.1:4100');
    expect(out).toContain('type="password"');
    expect(out).toContain('aria-label="Access token"');
    expect(out).toContain(`href="${README_URL}"`);
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('has no name on the token field, so it can never travel in a URL', () => {
    expect(out).not.toMatch(/<input[^>]*\sname=/);
  });

  it('shows no sample data', () => {
    expect(out).not.toMatch(/demo|sample/i);
  });

  it('starts with Connect disabled until there is a token', () => {
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Connect<\/button>|<button[^>]*type="submit"[^>]*disabled/);
  });
});
