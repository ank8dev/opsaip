// The thread Opsaip writes for each workspace: a short morning brief, one question
// ("Start with the first?") and your decisions, sorted into Now / Today / Can wait.
// `live` items arrive while the app is open, to show the agent speaking up on its
// own. Times are relative to now, so the thread reads the same any day. Built from
// the shared Tessera data where it exists.

import type { Bucket, ThreadItem } from '../data/types';
import { isDecision } from '../data/types';
import { firstName, lastSeen, missingFromKit, tessera } from '../data/shared';

const MIN = 60_000;

/** The brief goes out at 08:30, or 90 minutes ago if it is earlier than that. */
export function briefTime(now = Date.now()): number {
  const d = new Date(now);
  d.setHours(8, 30, 0, 0);
  return Math.min(d.getTime(), now - 90 * MIN);
}

/** Today at h:00 — a reminder already set before you opened the app. */
function todayAt(h: number): number {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  if (d.getTime() < Date.now()) d.setDate(d.getDate() + 1);
  return d.getTime();
}

const person = (id: string) => tessera.team.find((p) => p.id === id);

function jakeDrift(at: number): ThreadItem | null {
  const n = tessera.newcomers[0];
  const p = n && person(n.person);
  if (!p) return null;
  const missing = missingFromKit(tessera, p.id).map((i) => i.name);
  if (!missing.length) return null;
  const client = tessera.clients.filter((c) => c.person === p.id).sort((a, b) => b.last_seen.localeCompare(a.last_seen))[0];
  const source = client
    ? `${firstName(p.name)}’s ${client.name} ${client.source === 'plugin' ? 'plugin' : 'MCP'}, ${lastSeen(client.last_seen)}`
    : 'no agent connected yet';
  return { kind: 'drift', id: 'drift-jake', at, bucket: 'today', person: p.id, missing, source, state: 'pending' };
}

/** The agent's first question, from what it sorted into Now and Today. */
function askFor(items: ThreadItem[], at: number): ThreadItem[] {
  const count = (b: Bucket) => items.filter((i) => isDecision(i) && i.bucket === b && i.state === 'pending').length;
  const now = count('now');
  const today = count('today');
  const ask = now
    ? { text: `${now} ${now === 1 ? 'thing needs' : 'things need'} you now. Start with ${now === 1 ? 'it' : 'the first'}?`, options: ['Start', 'Show the list'] }
    : today
      ? { text: `Nothing needs you right now. ${today === 1 ? 'One thing' : `${today} things`} for later today — look now?`, options: ['Show me', 'Later'] }
      : null;
  return ask ? [{ kind: 'ask', id: 'ask', at, ...ask }, { kind: 'queue', id: 'queue', at }] : [];
}

/** Brief first, then the question and the queue it opens. */
function compose(t0: number, rest: (ThreadItem | null)[]): ThreadItem[] {
  const items = rest.filter((i): i is ThreadItem => i !== null);
  const decisions = items.filter(isDecision);
  const others = items.filter((i) => !isDecision(i));
  return [{ kind: 'brief', id: 'brief', at: t0 }, ...askFor(decisions, t0 + 60_000), ...decisions, ...others];
}

function tesseraSeed(t0: number): ThreadItem[] {
  const at = (m: number) => t0 + m * MIN;
  const fresh = tessera.memories.filter((m) => m.scope === 'project' && !m.reviewed).map((m) => m.id);
  return compose(t0, [
    {
      kind: 'approval', id: 'ap-418', at: at(2), bucket: 'now', state: 'pending',
      approval: {
        kind: 'merge', title: 'Merge the streaming TTS latency fix', owner: 'p5', agent: 'Codex', taskId: 't4',
        summary: 'p95 latency drops from 820 to 410 ms on the EU cluster.',
        facts: ['PR #418', '6 files', '+142 −58', 'checks passed'],
        diff: [
          { path: 'models/tts/streaming.py', add: 88, del: 31 },
          { path: 'models/tts/chunker.py', add: 27, del: 12 },
          { path: 'tests/tts/test_streaming.py', add: 14, del: 0 },
          { path: 'services/voice/gateway.ts', add: 9, del: 6 },
          { path: 'bench/tts_latency.json', add: 3, del: 8 },
          { path: 'docs/tts.md', add: 1, del: 1 },
        ],
        primary: 'Merge', done: 'Merged',
        followUp: 'Merged #418 into main. Aiko’s Codex is watching the staging rollout and will tell me if p95 moves.',
      },
    },
    {
      kind: 'approval', id: 'ap-slack', at: at(9), bucket: 'now', state: 'pending',
      approval: {
        kind: 'slack', title: 'Post the 3.2 note to #fjord-pilot', owner: 'p2', agent: 'Claude Code', taskId: 't20',
        summary: 'Drafted from the 3.2 release notes. It goes out as you.',
        facts: ['Slack', '#fjord-pilot', '14 members'],
        slack: {
          channel: '#fjord-pilot',
          text: 'Console 3.2 is on staging: streaming voice is twice as fast and the Bluetooth echo is gone. Production deploy is Monday 09:00 CET — reply here with anything that should wait.',
        },
        primary: 'Send', done: 'Sent',
        followUp: 'Posted to #fjord-pilot. I’ll bring you any reply that needs an answer.',
      },
    },
    {
      kind: 'approval', id: 'ap-status', at: at(14), bucket: 'today', state: 'pending',
      approval: {
        kind: 'status', title: 'Move TES-312 to In Review', owner: 'p5', agent: 'Claude Code', taskId: 't8',
        summary: 'PR #421 opened on GitHub 20 minutes ago, but Linear still says In Progress.',
        facts: ['TES-312', 'PR #421', 'fix/barge-in-0421'],
        status: { tool: 'Linear', ref: 'TES-312', from: 'In Progress', to: 'In Review' },
        primary: 'Move to In Review', done: 'Moved',
        followUp: 'TES-312 is In Review. Linear and GitHub agree again.',
      },
    },
    {
      kind: 'question', id: 'q-voice', at: at(21), bucket: 'today', state: 'pending',
      question: {
        owner: 'p10', agent: 'Claude Code', taskId: 't6',
        text: 'Which voice for the Fjord Bank demo on Tuesday — formal “Nordic” or friendly “Aurora”?',
        options: ['Nordic', 'Aurora', 'Ask Sana'],
        followUp: (a) =>
          a === 'Ask Sana'
            ? 'Asked Sana in Slack. I’ll pass her answer straight to Jake’s agent.'
            : `Told Jake’s agent to use ${a}. It’s recording the demo lines now.`,
      },
    },
    jakeDrift(at(33)),
    {
      kind: 'desktop', id: 'd-key', at: at(58), bucket: 'today', state: 'pending', owner: 'p11',
      title: 'Revoke the exposed telephony key',
      text: 'Noor’s Codex has a plan to revoke the old key and roll a new one. Revoking access is done on desktop.',
    },
    fresh.length ? { kind: 'memories', id: 'mem-new', at: at(47), bucket: 'wait', memoryIds: fresh, state: 'pending' } : null,
    {
      kind: 'approval', id: 'ap-deploy', at: at(52), bucket: 'wait', state: 'pending',
      approval: {
        kind: 'deploy', title: 'Deploy console 3.2 to production', owner: 'p2', agent: 'Claude Code', taskId: 't1',
        summary: 'Preview checks passed. The pilot note says Monday 09:00 CET.',
        facts: ['Vercel', 'console-3-2.vercel.app', 'preview passed'],
        primary: 'Deploy', done: 'Deployed',
        followUp: 'Deploying 3.2 to production. Tom’s agent is watching error rates for the first hour.',
      },
    },
    {
      kind: 'approval', id: 'ap-copy', at: at(-40), bucket: 'today', state: 'later', remindAt: todayAt(14),
      approval: {
        kind: 'status', title: 'Review the pricing page copy', owner: 'p8', agent: 'Claude Code', taskId: 't7',
        summary: 'Hugo’s draft is ready in Notion. Growth signs it off.',
        facts: ['Notion', 'Pricing v4'],
        status: { tool: 'Notion', ref: 'Pricing v4', from: 'Draft', to: 'Ready for sign-off' },
        primary: 'Mark ready', done: 'Marked ready',
        followUp: 'Pricing v4 is ready for sign-off. Hugo will get it this afternoon.',
      },
    },
  ]);
}

function northwindSeed(t0: number): ThreadItem[] {
  const at = (m: number) => t0 + m * MIN;
  return compose(t0, [
    {
      kind: 'approval', id: 'ap-88', at: at(6), bucket: 'now', state: 'pending',
      approval: {
        kind: 'merge', title: 'Merge the ESM plugin loader', owner: 'n1', agent: 'Claude Code', taskId: 'nt1',
        summary: 'Unblocks 2.0-rc.1. Kai reviewed it last night.',
        facts: ['PR #88', '4 files', '+96 −71', 'checks passed'],
        diff: [
          { path: 'packages/core/src/plugins.ts', add: 61, del: 48 },
          { path: 'packages/core/src/load.ts', add: 22, del: 19 },
          { path: 'packages/core/test/plugins.test.ts', add: 12, del: 3 },
          { path: 'package.json', add: 1, del: 1 },
        ],
        primary: 'Merge', done: 'Merged',
        followUp: 'Merged #88. Kai’s agent can cut 2.0-rc.1 whenever you say.',
      },
    },
    {
      kind: 'question', id: 'q-hooks', at: at(19), bucket: 'today', state: 'pending',
      question: {
        owner: 'n3', agent: 'Claude Code', taskId: 'nt3',
        text: 'Should the rc.1 changelog mention the experimental plugin hooks, or keep them quiet until 2.1?',
        options: ['Mention them', 'Keep quiet'],
        followUp: (a) => (a === 'Mention them' ? 'Kai’s agent is adding a short “Experimental” section.' : 'Kai’s agent will leave the hooks out of the changelog.'),
      },
    },
    {
      kind: 'approval', id: 'ap-nw-slack', at: at(27), bucket: 'today', state: 'pending',
      approval: {
        kind: 'slack', title: 'Post the rc.1 heads-up to #releases', owner: 'n3', agent: 'Claude Code', taskId: 'nt3',
        summary: 'Kai’s agent drafted it from the milestone. It goes out as you.',
        facts: ['Slack', '#releases', '212 members'],
        slack: { channel: '#releases', text: '2.0-rc.1 lands Friday: ESM-only plugin loader, new `northwind init` prompts. Plugin authors — please test against rc.1 over the weekend.' },
        primary: 'Send', done: 'Sent',
        followUp: 'Posted to #releases.',
      },
    },
    {
      kind: 'approval', id: 'ap-nw-milestone', at: at(41), bucket: 'wait', state: 'pending',
      approval: {
        kind: 'status', title: 'Move 5 issues into the 2.0-rc.1 milestone', owner: 'n1', agent: 'Grok', taskId: 'nt7',
        summary: 'Their PRs are merged, but the issues still sit in Backlog.',
        facts: ['GitHub', '5 issues'],
        status: { tool: 'GitHub', ref: '5 issues', from: 'Backlog', to: '2.0-rc.1' },
        primary: 'Move 5 issues', done: 'Moved',
        followUp: 'Moved 5 issues into 2.0-rc.1. The milestone is honest again.',
      },
    },
  ]);
}

/** Your own space: your agents' work, and now and then a word about a team workspace. */
function personalSeed(t0: number): ThreadItem[] {
  return compose(t0, [
    {
      kind: 'approval', id: 'ap-431', at: t0 + 3 * MIN, bucket: 'today', state: 'pending', ws: 'personal',
      approval: {
        kind: 'merge', title: 'Merge the flaky test fix', owner: 'me', agent: 'Claude Code', taskId: 'pt1',
        summary: 'The call list test ran 50 times overnight, all green.',
        facts: ['PR #431', 'checks passed', '2 files', '+18 −9'],
        diff: [
          { path: 'tests/calls/test_list.py', add: 12, del: 7 },
          { path: 'tests/conftest.py', add: 6, del: 2 },
        ],
        primary: 'Merge', done: 'Merged',
        followUp: 'Merged #431. CI stays green.',
      },
    },
    {
      kind: 'question', id: 'q-rota', at: t0 + 4 * MIN, bucket: 'today', state: 'pending', ws: 'personal',
      question: {
        owner: 'me', agent: 'Claude',
        text: 'For the Q4 review rota: Mira is out Dec 22–Jan 2. Skip her those weeks, or swap with Leo?',
        options: ['Skip her', 'Swap with Leo'],
        followUp: (a) => (a === 'Skip her' ? 'Left Mira out for those two weeks. The rota is in Notion.' : 'Swapped Mira and Leo for those weeks. The rota is in Notion.'),
      },
    },
    { kind: 'elsewhere', id: 'else-tessera', at: t0 + 5 * MIN, from: 'tessera' },
  ]);
}

export function seedThread(workspaceId: string, now = Date.now()): ThreadItem[] {
  const t0 = briefTime(now);
  if (workspaceId === 'tessera') return tesseraSeed(t0);
  if (workspaceId === 'northwind') return northwindSeed(t0);
  return personalSeed(t0);
}

/** Something that comes up while you have the app open: [delay ms, items]. */
export function liveEvents(workspaceId: string): [number, ThreadItem[]][] {
  if (workspaceId !== 'tessera') return [];
  return [
    [
      26_000,
      [
        { kind: 'agent', id: 'a-dep', at: 0, text: 'Daniel’s Claude Code needs a quick yes on a dependency. I put it in Now.' },
        {
          kind: 'approval', id: 'ap-dep', at: 0, bucket: 'now', state: 'pending',
          approval: {
            kind: 'dependency', title: 'Add onnxruntime-gpu', owner: 'p6', agent: 'Claude Code', taskId: 't5',
            summary: 'Faster GPU inference; the image grows by 38 MB.',
            facts: ['onnxruntime-gpu 1.22', 'MIT', '+38 MB'],
            primary: 'Approve', done: 'Approved',
            followUp: 'Approved. Daniel’s agent is adding it on feat/gpu-autoscale.',
          },
        },
      ],
    ],
  ];
}
