import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Widget } from '../../data/chat/types';
import { WidgetView } from './Widgets';

vi.mock('../../state/workspace', () => ({
  useWorkspace: () => ({ findTask: (id: string) => (id === 't1' ? { detail: 'exit code 1 <b>' } : null) }),
}));
vi.mock('../../state/ui', () => ({ useUi: () => ({ openTask: () => {} }) }));

const noop = () => {};
const html = (widget: Widget) => renderToStaticMarkup(<WidgetView widget={widget} onDecide={noop} onAnswer={noop} onStop={noop} />);

const EVIL = '<img src=x onerror=alert(1)> **bold** [l](javascript:alert(1))';
const run = { kind: 'run', runId: 'r', taskId: 't1', title: 'T', status: 'running', branch: 'opsaip/run-r', lastMessage: '', stopping: false } as const;
const perm = { kind: 'permission', runId: 'r', permissionId: 'p', tool: 'Bash', summary: 'ls', state: 'pending', busy: false, error: '' } as const;

describe('run card', () => {
  it('draws agent text as text, never as HTML or Markdown', () => {
    const out = html({ ...run, title: EVIL, lastMessage: EVIL });
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<a ');
    expect(out).not.toContain('<strong');
    expect(out).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(out).toContain('**bold**');
  });

  it('shows title, status in words, branch, and Stop while active', () => {
    const out = html({ ...run, lastMessage: 'Reading files' });
    expect(out).toContain('Working');
    expect(out).toContain('Reading files');
    expect(out).toContain('opsaip/run-r');
    expect(out).toContain('>Stop<');
  });

  it('Stop is disabled while in flight', () => {
    expect(html({ ...run, stopping: true })).toMatch(/<button[^>]*disabled[^>]*>Stopping…/);
  });

  it('a finished run has no Stop; failed shows the task note as text', () => {
    expect(html({ ...run, status: 'done' })).not.toContain('Stop');
    expect(html({ ...run, status: 'done' })).toContain('It finished');
    const failed = html({ ...run, status: 'failed' });
    expect(failed).toContain('It failed: exit code 1 &lt;b&gt;');
    expect(failed).not.toContain('Stop');
  });
});

describe('permission card', () => {
  it('shows tool and summary as text with Allow and Deny', () => {
    const out = html({ ...perm, tool: EVIL, summary: EVIL });
    expect(out).toContain('Needs you');
    expect(out).toContain('>Allow<');
    expect(out).toContain('>Deny<');
    expect(out).not.toContain('<img');
    expect(out).toContain('&lt;img');
  });

  it('both buttons are disabled while an answer is in flight', () => {
    const out = html({ ...perm, busy: true });
    expect(out.match(/<button[^>]*disabled/g)).toHaveLength(2);
  });

  it('once answered: the outcome, no buttons', () => {
    const allowed = html({ ...perm, state: 'allowed' });
    expect(allowed).toContain('>Allowed<');
    expect(allowed).not.toContain('<button');
    expect(html({ ...perm, state: 'denied' })).toContain('>Denied<');
    expect(html({ ...perm, state: 'stale' })).toContain('already answered');
  });

  it('shows an error next to the buttons', () => {
    const out = html({ ...perm, error: 'I could not reach the server.' });
    expect(out).toContain('I could not reach the server.');
    expect(out).toContain('>Allow<');
  });
});

describe('text widget with the conductor link', () => {
  it('opens in a new tab with noopener noreferrer', () => {
    const out = html({ kind: 'text', text: 'off', link: { label: 'How to turn it on', href: 'https://github.com/ank8dev/opsaip#conductor-mode-experimental' } });
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
});
