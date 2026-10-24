// What happens after you send. Mock only: a few readable rules, no model.
//
//   confirmation  one line from Opsaip: who picked it up
//   working card  a run that moves through a few steps
//   then          a result, or a question back to you
//
// Setup, rights and anything destructive are pinned to the desktop inbox instead.

import type { Attachment, MobileWorkspace, Mode, Recipient, ThreadItem } from '../data/types';
import { isOpen, openTitle } from '../data/types';
import { firstName } from '../data/shared';
import { agentLabel, agentsFor, findAgent } from './compose';

const DESKTOP_ONLY = /\b(delete|remove|revoke|rights?|permissions?|roles?|admin|mcp|connectors?|workflows?|install|access)\b/i;
const STATUS = /\b(status|progress|how(?:'s| is| are)|what(?:'s| is) (?:up|happening|running)|update|needs? me)\b/i;
const AGENT_NAMES = ['Claude Code', 'Codex', 'Cursor', 'OpenCode', 'Gemini CLI', 'Grok', 'Kimi', 'Copilot', 'Claude'];

let seq = 0;
const nextId = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`;
let asked = 0; // every other agent run asks a question back, so the demo shows both endings

type Run = Extract<ThreadItem, { kind: 'run' }>;

/** One beat of a run: after `ms`, add a step and maybe change its state. */
export interface Beat {
  ms: number;
  step?: string;
  patch?: Partial<Pick<Run, 'state' | 'result' | 'question'>>;
}

export interface Plan {
  items: ThreadItem[];
  /** The run the beats belong to. */
  runId?: string;
  beats: Beat[];
}

function short(text: string, max = 64): string {
  const t = text.trim().replace(/\s+/g, ' ').replace(/[.!]+$/, '');
  const one = t ? t[0].toUpperCase() + t.slice(1) : 'Follow up on this';
  return one.length > max ? `${one.slice(0, max - 1)}…` : one;
}

const withFiles = (a: Attachment[]) => (a.length ? ` with ${a.length === 1 ? a[0].label : `${a.length} attachments`}` : '');

function run(mode: Mode, title: string, by: string, agentId?: string): Run {
  return { kind: 'run', id: nextId('run'), at: Date.now(), mode, title, by, agentId, state: 'queued', steps: [] };
}

function line(text: string): ThreadItem {
  return { kind: 'agent', id: nextId('a'), at: Date.now(), text };
}

/** An agent doing the work: a few steps, then a result or a question. */
function agentBeats(title: string, repo: string, branch: string, ask: boolean): Beat[] {
  const beats: Beat[] = [
    { ms: 900, step: 'Picked it up', patch: { state: 'working' } },
    { ms: 2300, step: `Reading ${repo}` },
    { ms: 3900, step: `Changing 3 files on ${branch}` },
  ];
  if (ask) {
    beats.push({
      ms: 5600,
      step: 'Has a question for you',
      patch: {
        state: 'asking',
        question: { text: `Two ways to do “${title}”: keep the change small, or clean up the module around it first?`, options: ['Keep it small', 'Clean up first'] },
      },
    });
  } else {
    beats.push({ ms: 6200, step: 'Checks passed', patch: { state: 'done', result: `Opened a draft PR on ${branch} · 3 files · checks passed` } });
  }
  return beats;
}

const branchFor = (title: string) =>
  `feat/${title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 3).join('-') || 'change'}`;

export function plan(text: string, mode: Mode, to: Recipient | null, ws: MobileWorkspace, open: ThreadItem[], attachments: Attachment[]): Plan {
  const title = short(text);
  const files = withFiles(attachments);

  if (DESKTOP_ONLY.test(text)) {
    return { items: [line('That one is for your desk — setup, access and anything destructive stay there. I pinned it to the top of your desktop inbox.')], beats: [] };
  }

  // ---- Opsaip itself: the manager answers, or hands the work to an agent ----
  if (mode === 'agent' && (!to || to.kind === 'opsaip')) {
    if (STATUS.test(text)) {
      const working = ws.agents.filter((a) => a.state === 'running').length;
      const waiting = open.filter(isOpen);
      const next = waiting[0] ? ` First up: ${openTitle(waiting[0]).replace(/^./, (c) => c.toLowerCase())}.` : '';
      return {
        items: [line(waiting.length
          ? `${working} agents are running. ${waiting.length} ${waiting.length === 1 ? 'thing needs' : 'things need'} you.${next}`
          : `${working} agents are running and nothing needs you. I’ll stay quiet until something does.`)],
        beats: [],
      };
    }
    const lower = text.toLowerCase();
    const named = AGENT_NAMES.find((n) => lower.includes(n.toLowerCase()));
    const agent = agentsFor(ws).find((a) => a.owner === 'me' && (!named || a.name === named)) ?? agentsFor(ws)[0];
    const r = run('agent', title, agent ? agentLabel(agent, ws) : 'Your agent', agent?.id);
    const ask = asked++ % 2 === 1;
    return {
      items: [line(`On it. I gave it to ${agent ? agentLabel(agent, ws).replace(/^Your/, 'your') : 'your agent'}${files}.`), r],
      runId: r.id,
      beats: agentBeats(title, agent?.runs[0]?.repo ?? 'the repo', branchFor(title), ask),
    };
  }

  switch (mode) {
    case 'agent': {
      const found = to?.kind === 'agent' ? findAgent(to.id) : null;
      const label = found ? agentLabel(found.agent, found.ws) : 'The agent';
      const r = run('agent', title, label, found?.agent.id);
      const busy = found?.agent.state === 'running';
      const ask = asked++ % 2 === 1;
      return {
        items: [line(`${label} has it${files}.${busy ? ' It finishes its current run first, then starts.' : ''}`), r],
        runId: r.id,
        beats: agentBeats(title, found?.agent.runs[0]?.repo ?? 'the repo', branchFor(title), ask),
      };
    }

    case 'task': {
      const person = to?.kind === 'person' ? ws.members.find((p) => p.id === to.id) : undefined;
      const name = person ? firstName(person.name) : 'Your teammate';
      const theirs = person ? ws.agents.find((a) => a.owner === person.id && a.state !== 'failed') : undefined;
      const by = theirs ? `${name}’s ${theirs.name}` : `${name}’s agent`;
      const r = run('task', title, by, theirs?.id);
      return {
        items: [line(`Handed to ${name}${files}. ${by} picks it up in the current session.`), r],
        runId: r.id,
        beats: [
          { ms: 1200, step: `${name} accepted`, patch: { state: 'working' } },
          { ms: 3000, step: `${theirs?.name ?? 'The agent'} is working on ${branchFor(title)}` },
          { ms: 6000, step: 'Done', patch: { state: 'done', result: `PR #${430 + (seq % 60)} is ready for ${name}’s review` } },
        ],
      };
    }

    case 'message': {
      const where = to?.kind === 'channel' ? to.name : to?.kind === 'person' ? firstName(ws.members.find((p) => p.id === to.id)?.name) : 'Slack';
      const dm = to?.kind === 'person';
      const r = run('message', title, dm ? `Slack · DM to ${where}` : `Slack · ${where}`);
      return {
        items: [line(`Sending it to ${where} as you${files}.`), r],
        runId: r.id,
        beats: [
          { ms: 800, step: 'Sending', patch: { state: 'working' } },
          { ms: 1800, step: dm ? 'Delivered' : `Posted to ${where}`, patch: { state: 'done', result: dm ? `Delivered · ${where} is typing…` : `Posted · ${3 + (seq % 5)} people saw it` } },
        ],
      };
    }

    case 'announce': {
      const people = ws.members.length;
      const r = run('announce', title, `Announcement · ${ws.name}`);
      return {
        items: [line(`Announcing to ${ws.name}${files}: ${people ? `${people} people,` : 'everyone,'} pinned in ${ws.channels.find((c) => c === '#general') ?? 'the workspace'}.`), r],
        runId: r.id,
        beats: [
          { ms: 900, step: 'Posted and pinned', patch: { state: 'working' } },
          { ms: 3200, step: 'Read receipts coming in', patch: { state: 'done', result: `Seen by ${Math.max(1, Math.round(people * 0.4))} of ${people || 1} so far` } },
        ],
      };
    }
  }
}

/** You answered a run's question: it goes on and finishes. */
export function afterAnswer(option: string): Beat[] {
  return [
    { ms: 400, step: `You: ${option}`, patch: { state: 'working' } },
    { ms: 2600, step: 'Checks passed', patch: { state: 'done', result: `Went with “${option.toLowerCase()}”. Draft PR is up · checks passed` } },
  ];
}
