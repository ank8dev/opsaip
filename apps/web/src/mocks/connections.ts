// Who runs which agent client, the team kit, and what each teammate's agents can reach.
// Times are relative to now, so "last seen" always reads as recent sample data.

import type { AgentClient, Install, KitItem, Newcomer } from '../types';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60000).toISOString();
const DAY = 1440;

export const kit: KitItem[] = [
  { id: 'k-claude-code', name: 'Claude Code', kind: 'agent', in_kit: true },
  { id: 'k-codex', name: 'Codex', kind: 'agent', in_kit: false },
  { id: 'k-cursor', name: 'Cursor', kind: 'agent', in_kit: false },
  { id: 'k-opencode', name: 'OpenCode', kind: 'agent', in_kit: false },
  { id: 'k-claude', name: 'Claude', kind: 'agent', in_kit: false },
  { id: 'k-chatgpt', name: 'ChatGPT', kind: 'agent', in_kit: false },
  { id: 'k-linear', name: 'Linear MCP', kind: 'connector', in_kit: true },
  { id: 'k-github', name: 'GitHub MCP', kind: 'connector', in_kit: true },
  { id: 'k-sentry', name: 'Sentry MCP', kind: 'connector', in_kit: true },
  { id: 'k-notion', name: 'Notion MCP', kind: 'connector', in_kit: false },
  { id: 'k-figma', name: 'Figma MCP', kind: 'connector', in_kit: false },
  { id: 'k-review', name: 'tessera-review', kind: 'skill', in_kit: true },
  { id: 'k-release', name: 'release-notes', kind: 'skill', in_kit: false },
  { id: 'k-eval', name: 'eval-runner', kind: 'skill', in_kit: false },
];

const SOURCE: Record<string, AgentClient['source']> = {
  'Claude Code': 'plugin', Codex: 'plugin', Cursor: 'plugin', OpenCode: 'plugin', Claude: 'mcp', ChatGPT: 'mcp',
};

/** Each teammate's agent clients: [name, minutes since last seen]. */
const RUNS: Record<string, [string, number][]> = {
  p1: [['Claude Code', 2], ['Cursor', 40], ['Claude', 180]],
  p2: [['Claude Code', 1], ['Codex', 5]],
  p3: [['Claude Code', 12], ['Codex', 2 * DAY], ['ChatGPT', 300]],
  p4: [['Claude Code', 3], ['Codex', 9], ['OpenCode', 1800]],
  p5: [['Codex', 4], ['Claude Code', 6]],
  p6: [['Claude Code', 2], ['Codex', 20]],
  p7: [['Claude Code', 3 * DAY], ['Claude', 30]],
  p8: [['Codex', 8], ['Claude Code', 15], ['ChatGPT', 120]],
  p9: [['Claude Code', 6 * DAY], ['Claude', 240]],
  p10: [['Claude Code', 10]],
  p11: [['Codex', 7], ['Claude Code', 11]],
};

const clientId = (person: string, name: string) => `${person}-${name.toLowerCase().replace(/\s+/g, '-')}`;

export const clients: AgentClient[] = Object.entries(RUNS).flatMap(([person, list]) =>
  list.map(([name, m]) => ({ id: clientId(person, name), person, name, source: SOURCE[name], last_seen: minutesAgo(m) })),
);

/** What each teammate's agents have installed: [kit item, through which client, minutes since last seen]. */
const INSTALLED: Record<string, [string, string, number][]> = {
  p1: [['k-linear', 'Claude Code', 4], ['k-github', 'Claude Code', 2], ['k-sentry', 'Claude Code', 180], ['k-figma', 'Cursor', 50], ['k-review', 'Claude Code', 25]],
  p2: [['k-linear', 'Claude Code', 30], ['k-github', 'Codex', 5], ['k-sentry', 'Claude Code', 1], ['k-review', 'Claude Code', 120], ['k-release', 'Codex', DAY]],
  p3: [['k-linear', 'Claude Code', 12], ['k-sentry', 'Codex', 2 * DAY], ['k-notion', 'ChatGPT', 300], ['k-review', 'Claude Code', 180], ['k-release', 'Claude Code', 2 * DAY]],
  p4: [['k-linear', 'Claude Code', 20], ['k-github', 'Claude Code', 3], ['k-sentry', 'Codex', 9], ['k-review', 'Claude Code', 40]],
  p5: [['k-linear', 'Codex', 90], ['k-github', 'Codex', 4], ['k-sentry', 'Claude Code', 6], ['k-review', 'Claude Code', 6], ['k-eval', 'Codex', 4]],
  p6: [['k-linear', 'Claude Code', 120], ['k-github', 'Claude Code', 2], ['k-sentry', 'Claude Code', 15], ['k-review', 'Codex', 20], ['k-eval', 'Codex', 20]],
  p7: [['k-linear', 'Claude Code', 3 * DAY], ['k-github', 'Claude Code', 3 * DAY], ['k-figma', 'Claude', 30], ['k-notion', 'Claude', 30], ['k-review', 'Claude Code', 3 * DAY]],
  p8: [['k-linear', 'Claude Code', 15], ['k-github', 'Codex', 8], ['k-sentry', 'Codex', 480], ['k-notion', 'ChatGPT', 120], ['k-review', 'Claude Code', 15]],
  p9: [['k-github', 'Claude Code', 6 * DAY], ['k-sentry', 'Claude Code', 6 * DAY], ['k-notion', 'Claude', 240]],
  p10: [['k-review', 'Claude Code', 10]],
  p11: [['k-linear', 'Codex', 7], ['k-github', 'Codex', 7], ['k-sentry', 'Claude Code', 11], ['k-review', 'Claude Code', 11]],
};

export const installs: Install[] = Object.entries(INSTALLED).flatMap(([person, list]) =>
  list.map(([item, client, m]) => ({ person, item, client: clientId(person, client), last_seen: minutesAgo(m) })),
);

/** Jake joined three days ago; his agents can't reach Linear, GitHub or Sentry yet. */
export const newcomers: Newcomer[] = [{ person: 'p10', joined: minutesAgo(3 * DAY) }];
