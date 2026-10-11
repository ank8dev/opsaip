// The shape of an Opsaip workspace. Field names match what the Opsaip server
// will send (snake_case), so mock data and real API data are interchangeable.

export type TaskStatus = 'Needs you' | 'Working' | 'Failed' | 'Queued' | 'Done';
export type Priority = 'Urgent' | 'High' | 'Normal' | 'Low';

/** A teammate. Work hours are whole hours in their own time zone. */
export interface Person {
  id: string;
  name: string;
  initials: string;
  role: string;
  tz: string;
  start: number;
  end: number;
  focus: string;
  changing: string;
}

/** A task an agent (Claude Code, Codex) is working on for a teammate. */
export interface Task {
  id: string;
  task: string;
  tool: string;
  status: TaskStatus;
  priority?: Priority;
  owner: string;          // Person.id, or 'me' for tasks you started
  source: string;         // the agent: "Claude Code", "Codex", "Opsaip"
  detail: string;
  impact?: string;
  since?: string;         // ISO time of the last status change
}

export type MessageRole = 'user' | 'assistant' | 'tool';

/** One message of an agent's chat, as exported by the agent. */
export interface TranscriptMessage {
  task_id: string;
  seq: number;
  role: MessageRole;
  text: string;
}

/** A message shown in a task's chat. `via` marks messages you sent from Opsaip. */
export interface ChatMessage {
  role: MessageRole;
  text: string;
  via?: string;
}

export type McpStatus = 'Connected' | 'Needs auth' | 'Error' | 'Offline';

/** An MCP link: an agent reporting into Opsaip ("in"), or a tool server Opsaip calls ("out"). */
export interface McpConnection {
  id: string;
  name: string;
  direction: 'in' | 'out';
  owner: string;
  status: McpStatus;
  transport: string;
  auth: string;
  endpoint: string;
  tools: string;
  last_seen: string;
  note: string;
}

export interface Repo {
  name: string;
  url: string;
  default_branch: string;
  protection: string;
  visibility: string;
  last_push: string;
  last_push_by: string;
}

export interface RepoAccess {
  person: string;
  role: string;
  agent_rights: string;
}

export interface Branch {
  branch: string;
  person: string;
  task: string;
  pr: string;
  state: 'Open' | 'Merged';
  updated: string;
}

export type WorkspaceRole = 'Owner' | 'Admin' | 'Member' | 'Viewer';

export interface Member {
  person: string;
  role: WorkspaceRole;
}

export interface Channel {
  channel: string;
  status: McpStatus;
  account: string;
}

export type ToolName = 'Linear' | 'GitHub' | 'Notion';
export type SyncState = 'In sync' | 'Conflict' | 'Suggested' | 'Kept';

/** A Linear issue, GitHub PR or Notion page linked to a task, and whether it agrees. */
export interface Link {
  id: string;
  task: string;
  tool: ToolName;
  ref: string;
  title: string;
  state: string;    // the tool's own state name
  status: string;   // the same state in Opsaip words
  sync: SyncState;
  note: string;
  dismissed?: boolean;
}

/** How one Opsaip status is named in each tool. */
export interface StatusMapRow {
  status: string;
  linear: string;
  github: string;
  notion: string;
}

export interface Workspace {
  team: Person[];
  activity: Task[];
  transcripts: TranscriptMessage[];
  mcp: McpConnection[];
  repo: Repo | null;
  repoAccess: RepoAccess[];
  branches: Branch[];
  members: Member[];
  channels: Channel[];
  links: Link[];
  statusMap: StatusMapRow[];
}

/** A task started from this page. Preview only: lives in memory, not saved. */
export interface LocalTask extends Task {
  local: true;
  msgs: ChatMessage[];
}

export type AnyTask = Task | LocalTask;

export function isLocal(t: AnyTask): t is LocalTask {
  return 'local' in t && t.local === true;
}
