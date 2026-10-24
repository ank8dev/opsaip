// The phone's own shapes: workspaces and the one thread with the Opsaip agent.
// Teammates and tasks reuse the web types (apps/web/src/types.ts).

import type { AgentClient, Person, Task } from './shared';

export type WorkspaceKind = 'team' | 'personal';

/** What an agent is doing, as the phone shows it. */
export type AgentState = 'running' | 'waiting' | 'failed' | 'done' | 'idle';

export interface RunStep {
  min: number;            // minutes before now
  text: string;
  tone?: 'done' | 'error' | 'ask';
}

/** One run of an agent: a task, from start to now. */
export interface Run {
  id: string;
  title: string;
  state: AgentState;
  repo?: string;
  branch?: string;
  steps: RunStep[];       // oldest first
  result?: string;
}

/** A coding agent one person runs, as Opsaip sees it. */
export interface MobileAgent {
  id: string;
  name: string;           // "Claude Code", "Codex", "Gemini CLI"…
  owner: string;          // Person.id, or 'me'
  state: AgentState;
  /** The run it is on now (or just finished); its first entry in `runs`. */
  runs: Run[];
  connectors: string[];   // what it can reach: "GitHub", "Linear"…
  lastSeen: number;       // minutes ago
}

export interface Connector {
  name: string;           // "Linear"
  source: 'MCP' | 'plugin' | 'OAuth';
  lastSeen: number;       // minutes ago
  inKit: boolean;
}

export interface MobileWorkspace {
  id: string;
  name: string;
  kind: WorkspaceKind;
  /** One or two letters on the workspace tile, Slack-style. */
  monogram: string;
  members: Person[];
  tasks: Task[];
  clients: AgentClient[];
  agents: MobileAgent[];
  connectors: Connector[];
  channels: string[];     // Slack channels: "#fjord-pilot"
}

// ---- The composer: the same four modes as on desktop ----

export type Mode = 'task' | 'message' | 'agent' | 'announce';

export type Recipient =
  | { kind: 'opsaip' }
  | { kind: 'person'; id: string }
  | { kind: 'channel'; name: string }
  | { kind: 'agent'; id: string }
  | { kind: 'workspace' };

export interface Attachment {
  id: string;
  kind: 'photo' | 'camera' | 'file' | 'connector';
  label: string;
}

/** What a decision is waiting on. "later" carries a reminder; "dropped" lets it go. */
export type ItemState = 'pending' | 'approved' | 'later' | 'dropped';

/** How the agent sorts your decisions in the brief. */
export type Bucket = 'now' | 'today' | 'wait';
export const BUCKETS: Bucket[] = ['now', 'today', 'wait'];
export const BUCKET_LABEL: Record<Bucket, string> = { now: 'Now', today: 'Today', wait: 'Can wait' };

export interface DiffFile {
  path: string;
  add: number;
  del: number;
}

export type ApprovalKind = 'merge' | 'slack' | 'status' | 'dependency' | 'deploy';

export interface Approval {
  kind: ApprovalKind;
  title: string;
  owner: string;          // Person.id whose agent asks
  agent: string;          // "Claude Code", "Codex"
  taskId?: string;
  summary: string;        // one line: why it matters
  facts: string[];        // short mono facts: "PR #418", "6 files", "checks passed"
  diff?: DiffFile[];      // a short summary only; the full diff stays on desktop
  slack?: { channel: string; text: string };
  status?: { tool: string; ref: string; from: string; to: string };
  primary: string;        // "Merge", "Send", "Move to In Review"
  done: string;           // "Merged", "Sent", "Moved"
  followUp: string;       // what Opsaip says once it is done
}

export interface Question {
  owner: string;
  agent: string;
  taskId?: string;
  text: string;
  options: string[];
  followUp: (answer: string) => string;
}

interface Base {
  id: string;
  at: number; // epoch ms
}

/** A decision the agent hands you, one at a time. */
interface Decides {
  bucket: Bucket;
  /** The workspace it belongs to, when that is not the thread's own. */
  ws?: string;
  /** Set once you pick a reminder after "Not now". */
  remindAt?: number;
  /** When you decided — "Undo" shows for a few seconds after. */
  decidedAt?: number;
}

export type ThreadItem =
  | (Base & { kind: 'brief' })
  | (Base & { kind: 'agent'; text: string })
  | (Base & { kind: 'user'; text: string; mode?: Mode; to?: string; attachments?: Attachment[] })
  /** What you sent from the composer, being carried out: confirmation → working → result or a question. */
  | (Base & {
      kind: 'run';
      mode: Mode;
      title: string;
      by: string;          // "Aiko’s Codex", "Opsaip", "Slack"
      agentId?: string;
      state: 'queued' | 'working' | 'done' | 'asking';
      steps: { at: number; text: string }[];
      result?: string;
      question?: { text: string; options: string[]; answer?: string };
    })
  /** The agent asks you something of its own: "Start with the first?" */
  | (Base & { kind: 'ask'; text: string; options: string[]; answer?: string })
  /** Where your decisions live: one open at a time, the rest as rows. */
  | (Base & { kind: 'queue' })
  /** Another workspace, from your personal space: "Tessera · 2 need you". */
  | (Base & { kind: 'elsewhere'; from: string })
  | (Base & Decides & { kind: 'approval'; approval: Approval; state: ItemState })
  | (Base & Decides & { kind: 'question'; question: Question; answer?: string; state: ItemState })
  | (Base & Decides & { kind: 'drift'; person: string; missing: string[]; source: string; state: ItemState })
  | (Base & Decides & { kind: 'memories'; memoryIds: string[]; state: ItemState | 'flagged' })
  | (Base & Decides & { kind: 'desktop'; title: string; text: string; owner?: string; state: ItemState });

export type ThreadItemKind = ThreadItem['kind'];
export type Decision = Extract<ThreadItem, { bucket: Bucket }>;

export function isDecision(item: ThreadItem): item is Decision {
  return 'bucket' in item;
}

/** Decisions still waiting on you. */
export function isOpen(item: ThreadItem): item is Decision {
  return isDecision(item) && item.state === 'pending';
}

/** The one line a decision shows when it is not the open one. */
export function openTitle(item: ThreadItem): string {
  switch (item.kind) {
    case 'approval':
      return item.approval.title;
    case 'question':
      return item.question.text.split(/[—:?]/)[0].trim();
    case 'drift':
      return 'Send setup links to a new teammate';
    case 'memories':
      return `Review ${item.memoryIds.length} new team memories`;
    case 'desktop':
      return item.title;
    default:
      return '';
  }
}
