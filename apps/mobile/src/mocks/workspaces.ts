// Sample workspaces for the switcher: Tessera (the web app's sample team, shared
// from apps/web/src/mocks, plus one more teammate), a four-person open-source team,
// and your personal space. Nothing here comes from a real team or tool.

import type { MobileWorkspace } from '../data/types';
import type { AgentClient, Person, Task } from '../data/shared';
import { tessera } from '../data/shared';
import { buildAgents, connectors } from './agents';

const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

// ---- Tessera: 12 people, a voice-AI startup ----

const ines: Person = {
  id: 'p12', name: 'Ines Duarte', initials: 'ID', role: 'Mobile engineer', tz: 'America/New_York', start: 9, end: 17,
  focus: 'Push alerts for live calls', changing: 'apps/mobile/src/alerts/push.ts · feat/push-alerts',
};

/** A wider mix of agents than the web sample, so the phone shows every kind. */
const SOURCE: Record<string, string> = { t10: 'Grok', t12: 'OpenCode', t13: 'Copilot', t15: 'Kimi', t16: 'Cursor', t18: 'Gemini CLI' };

const tesseraTasks: Task[] = [
  ...tessera.activity.map((t) => (SOURCE[t.id] ? { ...t, source: SOURCE[t.id] } : t)),
  { id: 't23', task: 'Ship push alerts for live calls', tool: 'GitHub', status: 'Working', priority: 'Normal', owner: 'p12', source: 'Copilot', detail: 'Wiring APNs tokens · feat/push-alerts', impact: 'Supervisors see escalations' },
];

const TESSERA_REPOS: [RegExp, string][] = [
  [/tts|barge|voice|echo|accent|eval/i, 'tessera/voice-gateway'],
  [/sdk/i, 'tessera/python-sdk'],
  [/gpu|autoscale|redact|key|certificate|migration/i, 'tessera/platform'],
  [/push|mobile/i, 'tessera/mobile'],
  [/.*/, 'tessera/console'],
];

// ---- Northwind: 4 people, an open-source plugin framework ----

const northwindTeam: Person[] = [
  { id: 'n1', name: 'Lena Fischer', initials: 'LF', role: 'Maintainer', tz: 'Europe/Berlin', start: 9, end: 18, focus: 'Plugin API v2', changing: 'packages/core/src/plugins.ts' },
  { id: 'n2', name: 'Omar Aziz', initials: 'OA', role: 'Docs', tz: 'Africa/Cairo', start: 10, end: 19, focus: 'Getting-started guide', changing: 'docs/guide/start.md' },
  { id: 'n3', name: 'Kai Nakamura', initials: 'KN', role: 'Release manager', tz: 'Asia/Tokyo', start: 9, end: 18, focus: 'Release 2.0-rc.1', changing: 'CHANGELOG.md' },
  { id: 'n4', name: 'Ruth Adler', initials: 'RA', role: 'Developer experience', tz: 'America/Toronto', start: 9, end: 17, focus: 'CLI onboarding', changing: 'packages/cli/src/init.ts' },
];

const northwindTasks: Task[] = [
  { id: 'nt1', task: 'Port the plugin loader to ESM', tool: 'GitHub', status: 'Needs you', priority: 'High', owner: 'n1', source: 'Claude Code', detail: 'PR #88 reviewed · asks before merging · feat/esm-loader', impact: 'Unblocks 2.0-rc.1' },
  { id: 'nt2', task: 'Rewrite the getting-started guide', tool: 'GitHub', status: 'Working', priority: 'Normal', owner: 'n2', source: 'Codex', detail: 'Drafting step 3 of 5 · docs/start-v2', impact: 'Docs for 2.0' },
  { id: 'nt3', task: 'Draft the 2.0-rc.1 changelog', tool: 'GitHub', status: 'Needs you', priority: 'Normal', owner: 'n3', source: 'Claude Code', detail: 'Agent asks about experimental hooks', impact: 'Release on Friday' },
  { id: 'nt4', task: 'Add prompts to `northwind init`', tool: 'GitHub', status: 'Working', priority: 'Normal', owner: 'n4', source: 'Cursor', detail: 'Writing tests · feat/init-prompts', impact: 'First-run setup' },
  { id: 'nt5', task: 'Triage issues labelled “bug”', tool: 'GitHub', status: 'Done', priority: 'Low', owner: 'n3', source: 'Codex', detail: '41 issues labelled · 6 closed as duplicates', impact: 'Clean backlog' },
  { id: 'nt6', task: 'Build the docs site preview', tool: 'Vercel', status: 'Failed', priority: 'Normal', owner: 'n2', source: 'Gemini CLI', detail: 'Build failed · broken link in guide/plugins.md', impact: 'Docs preview for reviewers' },
  { id: 'nt7', task: 'Sync the 2.0 milestone with open PRs', tool: 'GitHub', status: 'Working', priority: 'Low', owner: 'n1', source: 'Grok', detail: 'Matched 9 of 14 PRs to issues', impact: 'Honest milestone' },
];

const northwindClients: AgentClient[] = [
  { id: 'n1-claude-code', person: 'n1', name: 'Claude Code', source: 'plugin', last_seen: minutesAgo(3) },
  { id: 'n2-codex', person: 'n2', name: 'Codex', source: 'plugin', last_seen: minutesAgo(6) },
  { id: 'n3-claude-code', person: 'n3', name: 'Claude Code', source: 'plugin', last_seen: minutesAgo(14) },
  { id: 'n4-cursor', person: 'n4', name: 'Cursor', source: 'plugin', last_seen: minutesAgo(2) },
];

// ---- Personal: just you and your agents ----

const personalTasks: Task[] = [
  { id: 'pt1', task: 'Fix the flaky call list test', tool: 'GitHub', status: 'Done', priority: 'Normal', owner: 'me', source: 'Claude Code', detail: '50 runs green · PR #431 ready · fix/flaky-call-list', impact: 'CI stays green' },
  { id: 'pt2', task: 'Draft the Q4 review rota', tool: 'Notion', status: 'Working', priority: 'Low', owner: 'me', source: 'Claude', detail: 'Reading last quarter’s rota', impact: 'Fair review load' },
  { id: 'pt3', task: 'Summarize this week’s unread RFCs', tool: 'Notion', status: 'Failed', priority: 'Low', owner: 'me', source: 'Kimi', detail: 'Notion token expired', impact: 'Friday reading list' },
];

const personalClients: AgentClient[] = [
  { id: 'me-claude-code', person: 'me', name: 'Claude Code', source: 'plugin', last_seen: minutesAgo(9) },
  { id: 'me-claude', person: 'me', name: 'Claude', source: 'mcp', last_seen: minutesAgo(30) },
];

export const workspaces: MobileWorkspace[] = [
  {
    id: 'tessera', name: 'Tessera', kind: 'team', monogram: 'T',
    members: [...tessera.team, ines], tasks: tesseraTasks, clients: tessera.clients,
    agents: buildAgents({ tasks: tesseraTasks, repos: TESSERA_REPOS, idle: [['p1', 'Cursor', 40], ['p9', 'Claude Code', 6 * 24 * 60], ['p12', 'Cursor', 25], ['p3', 'Codex', 2 * 24 * 60]] }),
    connectors: connectors.tessera,
    channels: ['#fjord-pilot', '#eng', '#releases', '#incidents', '#general'],
  },
  {
    id: 'northwind', name: 'Northwind', kind: 'team', monogram: 'N',
    members: northwindTeam, tasks: northwindTasks, clients: northwindClients,
    agents: buildAgents({ tasks: northwindTasks, repos: [[/docs|guide/i, 'northwind/docs'], [/cli|init/i, 'northwind/cli'], [/.*/, 'northwind/core']], idle: [['n3', 'Kimi', 90]] }),
    connectors: connectors.northwind,
    channels: ['#core', '#docs', '#releases', '#general'],
  },
  {
    id: 'personal', name: 'Personal', kind: 'personal', monogram: 'Me',
    members: [], tasks: personalTasks, clients: personalClients,
    agents: buildAgents({ tasks: personalTasks, repos: [[/.*/, 'robin/console-fork']], idle: [['me', 'Cursor', 300], ['me', 'Codex', 26 * 60]] }),
    connectors: connectors.personal,
    channels: [],
  },
];

export const DEFAULT_WORKSPACE = 'tessera';
