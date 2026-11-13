import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Link, Task } from '../../types';
import { LinkedItems } from './LinkedItems';

// LinkedItems reads its data from the two providers. Stub them with only what
// it uses, so this test renders the component itself and nothing else.
let links: Link[] = [];
vi.mock('../../state/workspace', () => ({
  useWorkspace: () => ({
    linksFor: () => links,
    linkNote: () => '',
    resolveConflict: () => {},
    linkSuggestion: () => {},
    dismissSuggestion: () => {},
  }),
}));
vi.mock('../../state/ui', () => ({ useUi: () => ({ statusOwner: 'GitHub' }) }));

const task = { id: 't1', task: 'Fix login', tool: '', status: 'Needs you', owner: '', source: '', detail: '' } as Task;
const link = {
  id: 'l1', task: 't1', tool: 'GitHub', ref: '#12', title: 'Fix login', state: 'Open', status: 'Working', sync: 'In sync', note: '',
} as Link;

describe('LinkedItems', () => {
  it('a task with no links: says it is not linked, and not where status comes from', () => {
    links = [];
    const html = renderToStaticMarkup(<LinkedItems task={task} />);
    expect(html).toContain('Not linked to Linear, GitHub or Notion yet');
    expect(html).not.toContain('Status comes from');
  });

  it('a task with a link: says where status comes from', () => {
    links = [link];
    const html = renderToStaticMarkup(<LinkedItems task={task} />);
    expect(html).toContain('Status comes from GitHub');
    expect(html).not.toContain('Not linked');
  });
});
