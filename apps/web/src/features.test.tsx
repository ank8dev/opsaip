import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AnyTask, Task } from './types';
import { mockWorkspace } from './mocks';
import { peopleById } from './data/selectors';
import { feature, overrideFeatures, parseFeatures } from './features';
import { availableModes } from './components/home/ModeMenu';
import { Sidebar } from './components/sidebar/Sidebar';
import { AgentsSection } from './components/sidebar/AgentsSection';
import { Settings } from './components/settings/Settings';
import { TaskCard } from './components/home/TaskCard';

// The production default: every flag off. Each test says what is NOT in the page, and that its flag brings it back.

const tokens = {
  fast: 0, base: 0, slow: 0, stagger: 0, enterStep: 0, dist: 0, blur: 0, scaleFrom: 1,
  easeOut: [0, 0, 1, 1], easeExit: [0, 0, 1, 1], easeSpring: [0, 0, 1, 1], reduced: true,
};

const state = vi.hoisted(() => ({
  query: '',
  tasks: [] as unknown[],
  chats: [] as { id: string; title: string }[],
  links: [] as unknown[],
  conflict: false,
}));

vi.mock('./state/ui', () => ({
  useUi: () => ({
    motion: tokens, query: state.query, section: 'chat', settingsOpen: true, openTaskId: null, userName: 'You', statusOwner: 'GitHub',
    themeChoice: 'system', motionChoice: 'system', setSection: () => {}, setQuery: () => {}, setSettingsOpen: () => {}, closeTask: () => {},
    openTask: () => {}, setThemeChoice: () => {}, setMotionChoice: () => {}, setUserName: () => {},
  }),
  useMotionTokens: () => tokens,
}));
vi.mock('./state/chats', () => ({
  useChats: () => ({ enabled: true, chats: state.chats, session: { key: 0, chatId: null }, error: '', newChat: () => {}, openChat: () => {}, rename: async () => undefined, remove: async () => {} }),
}));
// The Picker's menu is a portal into <body>, which static rendering has no use for.
vi.mock('./components/common/Picker', () => ({
  Picker: ({ ariaLabel }: { ariaLabel: string }) => <button type="button">{ariaLabel}</button>,
  opts: (o: [string, string][]) => o.map(([value, label]) => ({ value, label })),
}));
vi.mock('./state/appInfo', () => ({ useAppInfo: () => ({ about: null, update: null }) }));
vi.mock('./state/workspace', () => ({
  useWorkspace: () => ({
    ws: mockWorkspace,
    people: peopleById(mockWorkspace.team),
    tasks: state.tasks,
    localTasks: [],
    readOnly: true,
    source: { status: 'live', lastOk: 0, error: null },
    disconnect: () => {},
    connect: () => {},
    attention: { needsYou: [], failed: [] },
    syncFlag: () => (state.conflict ? 'conflict' : 'ok'),
    messagesFor: () => [],
    linksFor: () => state.links,
    linkNote: () => '',
    resolveConflict: () => {},
    linkSuggestion: () => {},
    dismissSuggestion: () => {},
  }),
}));

const task = (id: string, title: string, over: Partial<Task> = {}): Task =>
  ({ id, task: title, tool: 'Claude Code', status: 'Working', owner: '', source: 'Claude Code', detail: 'Reading files', ...over }) as Task;

afterEach(() => {
  overrideFeatures();
  state.query = ''; state.tasks = []; state.chats = []; state.links = []; state.conflict = false;
});

describe('feature flags', () => {
  it('are all off by default and can be listed, or switched on with "all"', () => {
    const off = parseFeatures(undefined);
    expect(Object.values(off).every((v) => v === false)).toBe(true);
    expect(parseFeatures('team, mcp').team).toBe(true);
    expect(parseFeatures('team, mcp').repo).toBe(false);
    expect(parseFeatures('nope').team).toBe(false);
    expect(Object.values(parseFeatures('all')).every((v) => v === true)).toBe(true);
  });
  it('can be overridden in tests, and reset', () => {
    expect(feature('team')).toBe(false);
    overrideFeatures({ team: true });
    expect(feature('team')).toBe(true);
    overrideFeatures();
    expect(feature('team')).toBe(false);
  });
});

describe('Composer modes', () => {
  it('are Ask, Task and Agent; Message and Announce come back with their flags', () => {
    expect(availableModes().map((m) => m.key)).toEqual(['ask', 'task', 'agent']);
    overrideFeatures({ message: true });
    expect(availableModes().map((m) => m.key)).toEqual(['ask', 'task', 'message', 'agent']);
    overrideFeatures({ announce: true });
    expect(availableModes().map((m) => m.key)).toEqual(['ask', 'task', 'agent', 'announce']);
  });
});

describe('Sidebar', () => {
  it('has Chat and Agents only, a plain Settings button, and a search that says what it searches', () => {
    const out = renderToStaticMarkup(<Sidebar />);
    expect(out).toContain('<span>Agents</span>');
    expect(out).not.toContain('<span>Team</span>');
    expect(out).not.toContain('<span>MCP</span>');
    expect(out).not.toContain('<span>Repo</span>');
    expect(out).not.toContain('Profile and settings');
    expect(out).toContain('op-me-name">Settings<');
    expect(out).toContain('placeholder="Search tasks and chats"');
    expect(out).toContain('aria-label="Search tasks and chats"');
    expect(out).not.toContain('Search everything');
  });

  it('shows Team, MCP and Repo again with their flags', () => {
    overrideFeatures({ team: true, mcp: true, repo: true });
    const out = renderToStaticMarkup(<Sidebar />);
    expect(out).toContain('<span>Team</span>');
    expect(out).toContain('<span>MCP</span>');
    expect(out).toContain('<span>Repo</span>');
  });

  it('search finds real tasks (title, note, tool) and chats by name, and says so when nothing matches', () => {
    state.tasks = [task('1', 'Fix login bug'), task('2', 'Write docs', { detail: 'about billing' })];
    state.chats = [{ id: 'a', title: 'Billing questions' }, { id: 'b', title: 'Standup' }];

    state.query = 'billing';
    let out = renderToStaticMarkup(<Sidebar />);
    expect(out).toContain('Billing questions');
    expect(out).not.toContain('Standup');
    expect(out).not.toContain('New chat');
    expect(out).toMatch(/<li class="op-li"[^>]*>(?:(?!<\/li>).)*Write docs/);
    expect(out).toMatch(/<li class="op-li" hidden=""[^>]*>(?:(?!<\/li>).)*Fix login bug/);

    state.query = 'zzz';
    out = renderToStaticMarkup(<Sidebar />);
    expect(out).toContain('Nothing matches');
  });
});

describe('Agents list', () => {
  it('says what is true when there are no tasks', () => {
    const out = renderToStaticMarkup(<AgentsSection mode="one" />);
    expect(out).toContain('No tasks yet. Agents you connect through MCP, and runs you start here, appear here.');
  });
  it('shows "Out of sync" only with the linkedItems flag', () => {
    state.tasks = [task('1', 'Fix login')];
    state.conflict = true;
    expect(renderToStaticMarkup(<AgentsSection mode="one" />)).not.toContain('Out of sync');
    overrideFeatures({ linkedItems: true });
    expect(renderToStaticMarkup(<AgentsSection mode="one" />)).toContain('Out of sync');
  });
});

describe('Settings', () => {
  const GONE = ['Profile', 'Workspace', 'Approvals', 'Tool servers', 'Sync', 'Repository', 'Slack', 'Notifications', 'Data &amp; privacy'];

  it('has only Server, Repositories (live), Appearance and About, and no preview notes', () => {
    const out = renderToStaticMarkup(<Settings />);
    for (const id of ['set-server', 'set-look', 'set-about']) expect(out).toContain(`id="${id}"`);
    for (const word of GONE) expect(out, word).not.toContain(`>${word}<`);
    expect(out).not.toContain('id="set-profile"');
    expect(out).not.toContain('id="set-data"');
    expect(out).not.toMatch(/Preview|not saved yet|Nothing was written/);
    expect(out).not.toContain('Tessera');
  });

  it('lists Repositories in the index only while connected to a server', async () => {
    const { settingsIndex } = await import('./components/settings/Settings');
    expect(settingsIndex().map(([id]) => id)).not.toContain('set-repos');
    const live = settingsIndex(true).map(([id]) => id);
    expect(live.slice(0, 2)).toEqual(['set-server', 'set-repos']);
    // This file's workspace is live, so the section is on the page (and in its index) here.
    const page = renderToStaticMarkup(<Settings />);
    expect(page).toContain('id="set-repos"');
    expect(page).toContain('>Repositories<');
  });

  it('brings the preview sections and their note back with the flag', () => {
    overrideFeatures({ previewSettings: true });
    const out = renderToStaticMarkup(<Settings />);
    for (const id of ['set-profile', 'set-workspace', 'set-agents', 'set-approvals', 'set-tools', 'set-sync', 'set-repo', 'set-slack', 'set-notify', 'set-data']) {
      expect(out).toContain(`id="${id}"`);
    }
    expect(out).toContain('Preview — changes apply on this page only');
  });
});

describe('Task window', () => {
  const chat = { runIdForTask: () => undefined } as never;
  const t = task('1', 'Fix login') as AnyTask;

  it('has no Linked line, and no "not saved yet", in the default build', () => {
    state.links = [];
    const out = renderToStaticMarkup(<TaskCard task={t} chat={chat} />);
    expect(out).toContain('Details');
    expect(out).toContain('Chat');
    expect(out).not.toContain('Linked');
    expect(out).not.toContain('Not linked to Linear, GitHub or Notion');
    expect(out).not.toMatch(/Preview|not saved yet/);
  });

  it('shows the Linked line with the linkedItems flag', () => {
    overrideFeatures({ linkedItems: true });
    expect(renderToStaticMarkup(<TaskCard task={t} chat={chat} />)).toContain('Not linked to Linear, GitHub or Notion yet');
  });
});
