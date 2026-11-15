import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { RepositoriesView, addFailureText, removeFailureText, sentence, type ViewProps } from './RepositoriesSection';

const tokens = {
  fast: 0, base: 0, slow: 0, stagger: 0, enterStep: 0, dist: 0, blur: 0, scaleFrom: 1,
  easeOut: [0, 0, 1, 1], easeExit: [0, 0, 1, 1], easeSpring: [0, 0, 1, 1], reduced: true,
};
vi.mock('../../state/ui', () => ({ useUi: () => ({ motion: tokens, settingsOpen: true }) }));
vi.mock('../../state/workspace', () => ({ useWorkspace: () => ({ readOnly: true, api: {} }) }));

const app = { id: 'r1', name: 'web-app', path: '/Users/me/code/web-app', isDefault: false };
const main = { id: 'default', name: 'opsaip', path: '/Users/me/code/opsaip', isDefault: true };
const noop = () => {};
const view = (over: Partial<ViewProps> = {}) =>
  renderToStaticMarkup(
    <RepositoriesView
      list={{ status: 'ready', repos: [main, app] }} path="" busy={null} problem={null} done="" canChoose={false}
      onPath={noop} onAdd={noop} onRemove={noop} onChoose={noop} {...over}
    />,
  );

describe('Settings > Repositories', () => {
  it('lists each repository with its folder name and path, and Remove for the added ones only', () => {
    const out = view();
    expect(out).toContain('web-app');
    expect(out).toContain('/Users/me/code/web-app');
    expect(out).toContain('/Users/me/code/opsaip');
    expect(out.match(/>Remove</g)).toHaveLength(1);
    expect(out).toContain('>Default<');
    expect(out).toContain('OPSAIP_CONDUCTOR_DIR');
  });

  it('has the path field and Add (disabled while the field is empty), and no Choose folder in a browser', () => {
    const out = view();
    expect(out).toContain('aria-label="Repository path"');
    expect(out).toMatch(/<button[^>]*disabled[^>]*>Add</);
    expect(out).not.toContain('Choose folder');
    expect(out).not.toContain('placeholder=');
  });

  it('shows Choose folder only when the desktop app offers its picker', () => {
    expect(view({ canChoose: true })).toContain('>Choose folder<');
  });

  it('enables Add once there is a path, and disables every button while a request runs', () => {
    expect(view({ path: '/Users/me/code/x' })).toMatch(/<button[^>]*type="submit"(?![^>]*disabled)[^>]*>Add</);
    const busy = view({ path: '/x', busy: 'add' });
    expect(busy).toContain('>Adding…<');
    expect(busy).toMatch(/<button[^>]*disabled[^>]*>Remove</);
    expect(view({ busy: 'r1' })).toContain('>Removing…<');
  });

  it('shows the server’s refusal for a path, as text, tied to the field', () => {
    const out = view({ problem: { on: 'add', text: 'Not added. The path is not a folder.' } });
    expect(out).toContain('role="alert"');
    expect(out).toContain('Not added. The path is not a folder.');
    expect(out).toContain('aria-invalid="true"');
    expect(out).toContain('aria-describedby="op-repo-add-problem"');
  });

  it('shows a refused removal under that repository, and nowhere else', () => {
    const out = view({ problem: { on: 'r1', text: 'Not removed. A run is active in this repository: stop it or wait until it has ended.' } });
    expect(out).toContain('A run is active in this repository');
    expect(out.indexOf('A run is active')).toBeGreaterThan(out.indexOf('web-app'));
    expect(out).not.toContain('aria-invalid="true"');
  });

  it('draws what comes from the server as text, never as HTML', () => {
    const evil = '<img src=x onerror=alert(1)>';
    const out = view({ list: { status: 'ready', repos: [{ ...app, name: evil, path: evil }] }, problem: { on: 'add', text: evil } });
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });

  it('says what happened for a screen reader', () => {
    expect(view({ done: 'Added web-app.' })).toMatch(/role="status"[^>]*>Added web-app\.</);
  });

  it('an empty list says to add one; a failed read says so; neither shows a dead Remove', () => {
    const empty = view({ list: { status: 'ready', repos: [] } });
    expect(empty).toContain('No repositories yet');
    expect(empty).not.toContain('>Remove<');
    expect(view({ list: { status: 'failed', text: 'I could not reach the server.' } })).toContain('Could not read the list');
    expect(view({ list: { status: 'loading' } })).toContain('Reading the list…');
  });

  it('on a server that cannot run Conductor mode: says so and offers no form', () => {
    const out = view({ list: { status: 'off' } });
    expect(out).toContain('Not available');
    expect(out).toContain('OPSAIP_HOST');
    expect(out).not.toContain('aria-label="Repository path"');
  });
});

describe('what the page says about a refusal', () => {
  it('capitalises the server’s reason and ends it with a full stop', () => {
    expect(sentence('the path is not a folder')).toBe('The path is not a folder.');
    expect(sentence(' Already there. ')).toBe('Already there.');
    expect(sentence('  ')).toBe('');
  });

  it('adding: the server’s own message, for each refused path', () => {
    expect(addFailureText({ ok: false, problem: 'bad-request', reason: 'the path must be absolute (it starts with / on macOS and Linux)' })).toBe(
      'Not added. The path must be absolute (it starts with / on macOS and Linux).',
    );
    expect(addFailureText({ ok: false, problem: 'conflict', reason: 'this repository is already in the list' })).toBe('Not added. This repository is already in the list.');
    expect(addFailureText({ ok: false, problem: 'unreachable' })).toContain('could not reach the server');
    expect(addFailureText({ ok: false, problem: 'conductor-off' })).toContain('OPSAIP_HOST');
  });

  it('removing: a run being active is said, in the server’s words', () => {
    expect(removeFailureText({ ok: false, problem: 'conflict', reason: 'a run is active in this repository: stop it or wait until it has ended' })).toBe(
      'Not removed. A run is active in this repository: stop it or wait until it has ended.',
    );
    expect(removeFailureText({ ok: false, problem: 'repo-gone' })).toContain('already gone');
    expect(removeFailureText({ ok: false, problem: 'unauthorized' })).toContain('Settings');
  });
});
