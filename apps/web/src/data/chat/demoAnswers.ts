// Opsy's answers in Demo mode. Scripted, but never hard-coded: every name,
// title and number is computed from the tasks and people passed in, at the
// moment the question is asked. Pure: no React, no clock, no network.
//
// Opsy only knows the five suggestions below. Anything else gets an honest
// "I only understand the suggestions" instead of a guess.

import type { Person, Task, TaskStatus } from '../../types';
import { byImportance, byStatus } from '../selectors';
import { attentionOf } from '../attention';
import type {
  AgentWidget, BriefWidget, NeedsWidget, ProposalStatus, ProposalWidget, TaskLine, TaskListWidget, TextWidget, Widget,
} from './types';

export const DEMO_SOURCE = 'From the demo tasks';

/** How many task rows a widget shows before it says "and N more". */
export const MAX_ROWS = 8;

export type ChipId = 'brief' | 'needs' | 'open' | 'agent' | 'rename';

export interface Chip {
  id: ChipId;
  label: string;
  /** True when it is a question the server can answer. "Rename a task" is not: there is no rename API. */
  ask: boolean;
}

/** The suggestions under the thread. The agent chip names claude-code; the answer finds it in the data. */
export const CHIPS: readonly Chip[] = [
  { id: 'brief', label: 'Brief me', ask: true },
  { id: 'needs', label: 'What needs me?', ask: true },
  { id: 'open', label: 'What’s not done?', ask: true },
  { id: 'agent', label: 'What is claude-code doing?', ask: true },
  { id: 'rename', label: 'Rename a task', ask: false },
];

/**
 * The chips for Live mode: the three questions answered from the server's
 * tasks without an AI model (see liveAnswers.ts). Anything else typed in Live
 * is a free question for Ask.
 */
export const LIVE_CHIP_IDS: readonly ChipId[] = ['brief', 'needs', 'open'];
export const LIVE_CHIPS: readonly Chip[] = CHIPS.filter((c) => (LIVE_CHIP_IDS as readonly string[]).includes(c.id));

export const UNKNOWN_QUESTION = 'In the demo I only understand the suggestions below.';

export interface AnswerContext {
  tasks: readonly Task[];
  people: Readonly<Record<string, Person>>;
  /** Where the answer comes from, shown under it. Defaults to DEMO_SOURCE. */
  source?: string;
  /** Tasks with a permission request nobody has answered: they need you, whatever their status says. */
  pendingPermissionTaskIds?: readonly string[];
}

/**
 * The tasks as the answers see them: a task that needs you (the one shared
 * definition in data/attention.ts) has the status "Needs you", so the Brief,
 * the lists and the bar above the composer always count the same.
 */
function seen(ctx: AnswerContext): AnswerContext {
  const needs = new Set(attentionOf(ctx.tasks, ctx.pendingPermissionTaskIds).needsYou.map((t) => t.id));
  if (needs.size === 0) return ctx;
  return { ...ctx, tasks: ctx.tasks.map((t) => (needs.has(t.id) && t.status !== 'Needs you' ? { ...t, status: 'Needs you' as const } : t)) };
}

// ---- Reading the question ----

type Match = { kind: 'chip'; id: ChipId } | { kind: 'agent'; name: string };

/** Lower case, one space between words, no end punctuation, straight apostrophes. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/\s+/g, ' ').replace(/[?!.]+$/, '');
}

/**
 * Which suggestion a typed question is. Typing a chip's own words works, and
 * so does "What is <agent> doing?" for any agent name. Everything else is null.
 */
export function matchQuestion(question: string): Match | null {
  const q = normalize(question);
  const chip = CHIPS.find((c) => normalize(c.label) === q);
  if (chip) return { kind: 'chip', id: chip.id };
  const agent = /^what(?: is|'s) (.+) doing$/.exec(q);
  return agent ? { kind: 'agent', name: agent[1] } : null;
}

/** Opsy's answer to `question`, built from `ctx`. */
export function demoAnswer(question: string, input: AnswerContext): Widget {
  const ctx = seen(input);
  const match = matchQuestion(question);
  if (!match) return text(UNKNOWN_QUESTION);
  if (match.kind === 'agent') return agentAnswer(match.name, ctx);
  switch (match.id) {
    case 'brief': return briefAnswer(ctx);
    case 'needs': return needsAnswer(ctx);
    case 'open': return notDoneAnswer(ctx);
    case 'agent': return agentAnswer('claude-code', ctx);
    case 'rename': return renameAnswer(ctx);
  }
}

// ---- The answers ----

const STATUS_ORDER: readonly TaskStatus[] = ['Needs you', 'Working', 'Failed', 'Queued', 'Done'];

function text(message: string, ctx?: AnswerContext): TextWidget {
  return { kind: 'text', text: message, source: ctx?.source ?? DEMO_SOURCE };
}

/** Most important first: priority, then who has waited longest, then id so ties never depend on input order. */
const byImportanceThenId = (a: Task, b: Task) => byImportance(a, b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const byStatusThenImportance = (a: Task, b: Task) => byStatus(a, b) || byImportanceThenId(a, b);

function line(t: Task, ctx: AnswerContext): TaskLine {
  const owner = t.owner === 'me' ? 'You' : (ctx.people[t.owner]?.name ?? '');
  const out: TaskLine = { id: t.id, title: t.task, status: t.status, agent: t.source, owner, detail: t.detail };
  if (t.priority) out.priority = t.priority;
  if (t.since) out.since = t.since;
  return out;
}

function countByStatus(tasks: readonly Task[]): { status: TaskStatus; count: number }[] {
  return STATUS_ORDER
    .map((status) => ({ status, count: tasks.filter((t) => t.status === status).length }))
    .filter((c) => c.count > 0);
}

function briefAnswer(ctx: AnswerContext): Widget {
  if (!ctx.tasks.length) return text('I do not see any tasks yet.', ctx);
  const needs = ctx.tasks.filter((t) => t.status === 'Needs you').sort(byImportanceThenId);
  const failed = ctx.tasks.filter((t) => t.status === 'Failed').sort(byImportanceThenId);
  const first = needs[0] ?? failed[0];
  const widget: BriefWidget = {
    kind: 'brief',
    total: ctx.tasks.length,
    counts: countByStatus(ctx.tasks),
    next: first ? line(first, ctx) : null,
    source: ctx.source ?? DEMO_SOURCE,
  };
  return widget;
}

function needsAnswer(ctx: AnswerContext): Widget {
  const needs = ctx.tasks.filter((t) => t.status === 'Needs you').sort(byImportanceThenId);
  if (!needs.length) return text('Nothing needs you right now.', ctx);
  const widget: NeedsWidget = {
    kind: 'needs',
    tasks: needs.slice(0, MAX_ROWS).map((t) => line(t, ctx)),
    more: Math.max(0, needs.length - MAX_ROWS),
    source: ctx.source ?? DEMO_SOURCE,
  };
  return widget;
}

function notDoneAnswer(ctx: AnswerContext): Widget {
  if (!ctx.tasks.length) return text('I do not see any tasks yet.', ctx);
  const open = ctx.tasks.filter((t) => t.status !== 'Done').sort(byStatusThenImportance);
  if (!open.length) return text('Everything is done.', ctx);
  const widget: TaskListWidget = {
    kind: 'tasks',
    title: `${open.length} ${open.length === 1 ? 'task is' : 'tasks are'} not done`,
    tasks: open.slice(0, MAX_ROWS).map((t) => line(t, ctx)),
    more: Math.max(0, open.length - MAX_ROWS),
    source: ctx.source ?? DEMO_SOURCE,
  };
  return widget;
}

/** "Claude Code", "claude-code" and "claude code" are the same agent. */
const agentKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

function agentAnswer(asked: string, ctx: AnswerContext): Widget {
  const names = [...new Set(ctx.tasks.map((t) => t.source).filter(Boolean))].sort();
  const agent = agentKey(asked) === '' ? undefined : names.find((n) => agentKey(n) === agentKey(asked));
  if (agent === undefined) return text(`I do not see an agent called “${asked}” in the tasks.`, ctx);

  const mine = ctx.tasks.filter((t) => t.source === agent);
  // The latest change first; equal times by smaller id.
  const latest = (a: Task, b: Task) => (Date.parse(b.since ?? '') || 0) - (Date.parse(a.since ?? '') || 0) || (a.id < b.id ? -1 : 1);
  const working = mine.filter((t) => t.status === 'Working').sort(latest);
  const last = [...mine].sort(latest)[0];
  const widget: AgentWidget = {
    kind: 'agent',
    agent,
    counts: countByStatus(mine),
    current: working[0] ? line(working[0], ctx) : null,
    alsoWorking: Math.max(0, working.length - 1),
    last: last ? line(last, ctx) : null,
    source: ctx.source ?? DEMO_SOURCE,
  };
  return widget;
}

/**
 * Propose a clearer title for one task: the most important task that is not
 * done and has a priority, with its priority put in front: "[Urgent] Deploy…".
 * A task that already starts with "[" is skipped, so asking again moves on to
 * the next one. This only proposes: nothing is changed here.
 */
function renameAnswer(ctx: AnswerContext): Widget {
  const pick = ctx.tasks
    .filter((t) => t.status !== 'Done' && t.priority && !t.task.startsWith('['))
    .sort(byImportanceThenId)[0];
  if (!pick || !pick.priority) return text('I have no new title to suggest right now.', ctx);
  const widget: ProposalWidget = {
    kind: 'proposal',
    taskId: pick.id,
    before: pick.task,
    after: `[${pick.priority}] ${pick.task}`,
    status: 'pending',
    source: ctx.source ?? DEMO_SOURCE,
  };
  return widget;
}

// ---- Approve or cancel a proposal ----

/**
 * What Approve or Cancel does. Returns the proposal's new status and the patch
 * to apply to the task, or null when nothing should change. Approve applies
 * only if the task still has the title the proposal was made for; otherwise it
 * is "stale" and nothing is applied. A proposal that was already decided is
 * left alone. The task is never mutated here.
 */
export function decideProposal(
  proposal: ProposalWidget,
  current: Task | null | undefined,
  decision: 'approve' | 'cancel',
): { status: ProposalStatus; patch: Partial<Task> | null } {
  if (proposal.status !== 'pending') return { status: proposal.status, patch: null };
  if (decision === 'cancel') return { status: 'cancelled', patch: null };
  if (!current || current.task !== proposal.before) return { status: 'stale', patch: null };
  // A new title is not a status change: keep the time of the last one.
  const patch: Partial<Task> = { task: proposal.after };
  if (current.since !== undefined) patch.since = current.since;
  return { status: 'approved', patch };
}
