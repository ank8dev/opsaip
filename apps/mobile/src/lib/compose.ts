// The composer's four modes, as on desktop: who a message can go to, what the
// field says, and how a recipient reads in a chip.

import type { MobileAgent, MobileWorkspace, Mode, Recipient } from '../data/types';
import { clockFor, firstName } from '../data/shared';
import { workspaces } from '../mocks/workspaces';

export const MODES: { mode: Mode; label: string; hint: string }[] = [
  { mode: 'task', label: 'Task', hint: 'Hand a task to a teammate' },
  { mode: 'message', label: 'Message', hint: 'Slack, to a person or a channel' },
  { mode: 'agent', label: 'Agent', hint: 'Run a task with an AI agent' },
  { mode: 'announce', label: 'Announce', hint: 'Post to the whole workspace' },
];

export const MODE_LABEL: Record<Mode, string> = { task: 'Task', message: 'Message', agent: 'Agent', announce: 'Announce' };

/** Your own agents: the ones in your personal space. */
export const myAgents = (): MobileAgent[] => workspaces.find((w) => w.kind === 'personal')?.agents ?? [];

/** Any agent, from any workspace. */
export function findAgent(id: string): { agent: MobileAgent; ws: MobileWorkspace } | null {
  for (const ws of workspaces) {
    const agent = ws.agents.find((a) => a.id === id);
    if (agent) return { agent, ws };
  }
  return null;
}

export function ownerName(owner: string, ws: MobileWorkspace): string {
  if (owner === 'me') return 'You';
  return firstName(ws.members.find((p) => p.id === owner)?.name) || 'Someone';
}

/** "Aiko’s Codex", "Your Claude Code". */
export function agentLabel(a: MobileAgent, ws: MobileWorkspace): string {
  return a.owner === 'me' ? `Your ${a.name}` : `${ownerName(a.owner, ws)}’s ${a.name}`;
}

/** Agents you can hand work to here: yours first, then your teammates'. */
export function agentsFor(ws: MobileWorkspace): MobileAgent[] {
  const mine = ws.kind === 'personal' ? [] : myAgents();
  return [...mine, ...ws.agents];
}

/** The short name on the recipient chip. */
export function recipientName(r: Recipient | null, ws: MobileWorkspace): string {
  if (!r) return 'Choose…';
  switch (r.kind) {
    case 'opsaip': return 'Opsaip';
    case 'person': return firstName(ws.members.find((p) => p.id === r.id)?.name) || 'Someone';
    case 'channel': return r.name;
    case 'agent': {
      const found = findAgent(r.id);
      return found ? found.agent.name : 'Agent';
    }
    case 'workspace': return ws.name;
  }
}

export function placeholderFor(mode: Mode, r: Recipient | null, ws: MobileWorkspace): string {
  const name = recipientName(r, ws);
  if (!r) return mode === 'task' ? 'Pick a teammate first' : 'Pick who it goes to';
  switch (mode) {
    case 'task': return `Give ${name} a task…`;
    case 'message': return `Message ${name}…`;
    case 'agent': return r.kind === 'opsaip' ? 'Ask Opsaip anything…' : `Ask ${name} to…`;
    case 'announce': return `Announce to ${ws.name}…`;
  }
}

/** Modes that wait for you to choose who, in the picker. */
export const NEEDS_PICK: Mode[] = ['task', 'message'];

/** Where a mode starts when you pick it. Task and Message start empty: you choose. */
export function defaultRecipient(mode: Mode, ws: MobileWorkspace, defaultAgent: string): Recipient | null {
  switch (mode) {
    case 'agent': {
      const mine = agentsFor(ws).find((a) => a.owner === 'me' && a.name === defaultAgent);
      return mine ? { kind: 'agent', id: mine.id } : { kind: 'opsaip' };
    }
    case 'task': {
      const someone = ws.members.find((p) => clockFor(p).working) ?? ws.members[0];
      return someone ? { kind: 'person', id: someone.id } : null;
    }
    case 'message':
      return ws.channels[0] ? { kind: 'channel', name: ws.channels[0] } : null;
    case 'announce':
      return { kind: 'workspace' };
  }
}

export const sameRecipient = (a: Recipient | null, b: Recipient | null) => JSON.stringify(a) === JSON.stringify(b);
