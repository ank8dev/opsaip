// What a chat message holds. Pure data: no React. The components in
// components/chat/ draw these; data/chat/ builds them.

import type { Priority, TaskStatus } from '../../types';

/** One task as a chat widget shows it. Every field is copied from the workspace. */
export interface TaskLine {
  id: string;
  title: string;
  status: TaskStatus;
  /** The agent that reports it ("Claude Code"), or ''. */
  agent: string;
  /** Who it belongs to ("You" for tasks started here), or ''. */
  owner: string;
  priority?: Priority;
  /** The agent's note or question. */
  detail: string;
  /** ISO time of the last status change. */
  since?: string;
}

interface WidgetBase {
  /** Where the answer comes from, shown under it: "From the demo tasks". */
  source?: string;
}

/** A brief: how many tasks are in each status, and where to start. */
export interface BriefWidget extends WidgetBase {
  kind: 'brief';
  total: number;
  /** Only statuses that have tasks, in the order the sidebar uses. */
  counts: { status: TaskStatus; count: number }[];
  /** The task that needs you most, or null. */
  next: TaskLine | null;
}

/** A list of tasks, most important first. At most `shown` rows; `more` is how many are left out. */
export interface TaskListWidget extends WidgetBase {
  kind: 'tasks';
  title: string;
  tasks: TaskLine[];
  more: number;
}

/** Tasks waiting for you, with the question each agent asked. */
export interface NeedsWidget extends WidgetBase {
  kind: 'needs';
  tasks: TaskLine[];
  more: number;
}

/** One agent: what it is doing now and its last report. */
export interface AgentWidget extends WidgetBase {
  kind: 'agent';
  agent: string;
  counts: { status: TaskStatus; count: number }[];
  /** Its latest working task, or null when nothing is running. */
  current: TaskLine | null;
  /** Other tasks it is working on besides `current`. */
  alsoWorking: number;
  /** The last report: the note of its most recently updated task. */
  last: TaskLine | null;
}

/** pending: waiting for Approve or Cancel. stale: the title changed meanwhile, so nothing was applied. */
export type ProposalStatus = 'pending' | 'approved' | 'cancelled' | 'stale';

/** A suggested new title. Nothing changes until it is approved. */
export interface ProposalWidget extends WidgetBase {
  kind: 'proposal';
  taskId: string;
  before: string;
  after: string;
  status: ProposalStatus;
}

/** Plain text, and optionally one link. Rendered as text, never as HTML. */
export interface TextWidget extends WidgetBase {
  kind: 'text';
  text: string;
  link?: { label: string; href: string };
}

export type Widget = BriefWidget | TaskListWidget | NeedsWidget | AgentWidget | ProposalWidget | TextWidget;

/** A message in the thread. `pending` is the placeholder while the server thinks. */
export type ThreadMessage =
  | { id: number; from: 'you'; text: string }
  | { id: number; from: 'opsy'; widget: Widget; pending?: boolean };
