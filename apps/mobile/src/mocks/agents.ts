// Agents, runs and connectors for the sample workspaces. Agents are built from the
// tasks (one agent per person and tool), so the brief, Team, the agent sheet and a
// run's timeline always agree. A few runs get a hand-written timeline; the rest get
// a plausible one from the task's own detail line. Nothing here is a real team.

import type { AgentState, Connector, MobileAgent, Run, RunStep } from '../data/types';
import type { Task } from '../data/shared';

const STATE: Record<Task['status'], AgentState> = {
  'Needs you': 'waiting',
  Working: 'running',
  Failed: 'failed',
  Queued: 'idle',
  Done: 'done',
};

/** Which state an agent shows when it has several runs: what needs you first. */
const ORDER: AgentState[] = ['waiting', 'failed', 'running', 'idle', 'done'];

export const AGENT_NAMES = ['Claude Code', 'Codex', 'Cursor', 'OpenCode', 'Gemini CLI', 'Grok', 'Kimi', 'Copilot', 'Claude'] as const;

const REACH: Record<string, string[]> = {
  'Claude Code': ['GitHub', 'Linear', 'Sentry', 'Slack'],
  Codex: ['GitHub', 'Linear'],
  Cursor: ['GitHub', 'Figma'],
  OpenCode: ['GitHub'],
  'Gemini CLI': ['GitHub', 'Sentry'],
  Grok: ['Linear', 'Slack'],
  Kimi: ['GitHub', 'Notion'],
  Copilot: ['GitHub'],
  Claude: ['Notion', 'Slack'],
};

/** A small stable number from a string, so made-up minutes stay the same between launches. */
function seed(s: string): number {
  let h = 7;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 997;
  return h;
}

function repoFor(t: Task, repos: [RegExp, string][]): string | undefined {
  if (t.tool !== 'GitHub' && t.tool !== 'Vercel') return undefined;
  return repos.find(([re]) => re.test(t.task))?.[1] ?? repos[repos.length - 1]?.[1];
}

const branchOf = (detail: string) => detail.match(/\b((?:fix|feat|chore|docs|release)\/[\w.-]+)/)?.[1];

/** A plausible timeline from a task's status and detail line. */
function stepsFor(t: Task, repo?: string): RunStep[] {
  const s = seed(t.id);
  const start = 40 + (s % 200);
  const where = repo ? `Checked out ${repo}${branchOf(t.detail) ? ` @ ${branchOf(t.detail)}` : ''}` : `Opened ${t.tool}`;
  const steps: RunStep[] = [
    { min: start, text: `Picked up “${t.task}”` },
    { min: Math.round(start * 0.8), text: where },
    { min: Math.round(start * 0.45), text: t.status === 'Done' ? 'Ran the checks: all green' : t.status === 'Failed' ? 'Started the run' : 'Made the first changes' },
  ];
  const last = t.detail.split(' · ')[0];
  if (t.status === 'Needs you') steps.push({ min: 8 + (s % 30), text: `Asked you: ${last.toLowerCase()}`, tone: 'ask' });
  else if (t.status === 'Failed') steps.push({ min: 5 * 60 + (s % 120), text: t.detail, tone: 'error' });
  else if (t.status === 'Done') steps.push({ min: 20 + (s % 90), text: t.detail, tone: 'done' });
  else if (t.status === 'Queued') steps.splice(1, 2, { min: 5, text: t.detail });
  else steps.push({ min: 1 + (s % 6), text: t.detail });
  return steps;
}

/** Hand-written timelines for the runs the demo dwells on. */
const WRITTEN: Record<string, Partial<Run>> = {
  t4: {
    steps: [
      { min: 190, text: 'Picked up TES-298: streaming TTS is slow in the EU' },
      { min: 150, text: 'Profiled the gateway: chunks wait for a full sentence' },
      { min: 95, text: 'Streamed 40 ms chunks instead; p95 820 → 410 ms on eu-north-1' },
      { min: 60, text: 'Opened PR #418 · 6 files · +142 −58' },
      { min: 34, text: 'Checks passed · reviewed by Tom' },
      { min: 31, text: 'Asked you before merging into main', tone: 'ask' },
    ],
  },
  t17: {
    steps: [
      { min: 560, text: 'Picked up “Update the Python SDK to v2”' },
      { min: 530, text: 'Regenerated the client from the v2 OpenAPI spec' },
      { min: 470, text: 'mypy: 3 errors in client.py (Optional[str] vs str)' },
      { min: 455, text: 'Build failed · type error in client.py', tone: 'error' },
    ],
    result: 'Needs a decision on how strict the v2 types should be. Retry with the errors as context, or look at it on desktop.',
  },
  t18: {
    steps: [
      { min: 420, text: 'Started the nightly accent eval (1,200 calls)' },
      { min: 380, text: 'Batch 3 of 8: GPU memory at 97%' },
      { min: 372, text: 'Eval crashed · GPU out of memory', tone: 'error' },
    ],
    result: 'The eval needs 2 GPUs since the new accent set. Retry on the bigger pool?',
  },
  t8: {
    steps: [
      { min: 75, text: 'Picked up TES-312: the agent talks over the caller' },
      { min: 60, text: 'Found it: barge-in waits for end of speech before cancelling TTS' },
      { min: 32, text: 'Cancelled TTS on the first voiced frame; opened PR #421' },
      { min: 3, text: 'Running tests · 128 of 214' },
    ],
  },
};

interface Build {
  tasks: Task[];
  repos: [RegExp, string][];
  /** Agents with no task right now: [owner, name, minutes since last seen]. */
  idle?: [string, string, number][];
}

export function buildAgents({ tasks, repos, idle = [] }: Build): MobileAgent[] {
  const byKey = new Map<string, MobileAgent>();
  for (const t of tasks) {
    const key = `${t.owner}-${t.source.toLowerCase().replace(/\s+/g, '-')}`;
    const repo = repoFor(t, repos);
    const run: Run = {
      id: t.id,
      title: t.task,
      state: STATE[t.status],
      repo,
      branch: branchOf(t.detail),
      steps: stepsFor(t, repo),
      result: t.status === 'Done' ? t.detail : undefined,
      ...WRITTEN[t.id],
    };
    const a = byKey.get(key) ?? { id: key, name: t.source, owner: t.owner, state: run.state, runs: [], connectors: REACH[t.source] ?? ['GitHub'], lastSeen: 1 + (seed(key) % 20) };
    a.runs.push(run);
    byKey.set(key, a);
  }
  for (const [owner, name, lastSeen] of idle) {
    const key = `${owner}-${name.toLowerCase().replace(/\s+/g, '-')}`;
    if (!byKey.has(key)) byKey.set(key, { id: key, name, owner, state: 'idle', runs: [], connectors: REACH[name] ?? ['GitHub'], lastSeen });
  }
  return [...byKey.values()].map((a) => {
    const runs = [...a.runs].sort((x, y) => ORDER.indexOf(x.state) - ORDER.indexOf(y.state));
    return { ...a, runs, state: runs[0]?.state ?? 'idle' };
  });
}

export const AGENT_STATE_LABEL: Record<AgentState, string> = {
  running: 'Running',
  waiting: 'Waiting for you',
  failed: 'Failed',
  done: 'Done',
  idle: 'Idle',
};

/** The web's task status for an agent state, so StatusDot draws it the same way. */
export const AGENT_DOT: Record<AgentState, Task['status']> = {
  running: 'Working',
  waiting: 'Needs you',
  failed: 'Failed',
  done: 'Done',
  idle: 'Queued',
};

export const connectors = {
  tessera: [
    { name: 'GitHub', source: 'MCP', lastSeen: 2, inKit: true },
    { name: 'Linear', source: 'MCP', lastSeen: 4, inKit: true },
    { name: 'Slack', source: 'OAuth', lastSeen: 1, inKit: true },
    { name: 'Sentry', source: 'MCP', lastSeen: 12, inKit: true },
    { name: 'Vercel', source: 'OAuth', lastSeen: 9, inKit: false },
    { name: 'Notion', source: 'MCP', lastSeen: 40, inKit: false },
    { name: 'Figma', source: 'MCP', lastSeen: 180, inKit: false },
  ],
  northwind: [
    { name: 'GitHub', source: 'MCP', lastSeen: 3, inKit: true },
    { name: 'Slack', source: 'OAuth', lastSeen: 5, inKit: true },
    { name: 'Vercel', source: 'OAuth', lastSeen: 70, inKit: true },
    { name: 'Sentry', source: 'MCP', lastSeen: 130, inKit: false },
  ],
  personal: [
    { name: 'GitHub', source: 'MCP', lastSeen: 9, inKit: true },
    { name: 'Notion', source: 'MCP', lastSeen: 30, inKit: true },
    { name: 'Google Calendar', source: 'OAuth', lastSeen: 15, inKit: true },
    { name: 'Gmail', source: 'OAuth', lastSeen: 120, inKit: true },
  ],
} satisfies Record<string, Connector[]>;
