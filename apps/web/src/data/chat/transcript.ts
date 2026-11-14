// A run's conversation: GET /v1/runs/:id/transcript. Live mode only. Pure: no
// React. The server keeps it in memory (and forgets it when it restarts); the
// page keeps it in memory too, never in storage, and never logs it.
//
// Every text is from you or from the agent: untrusted, shown as plain text.

import { callApi, type ApiResult } from './serverCall';
import { RUNS_PATH } from './conductor';

/** The most entries and characters kept on the page, matching what the server keeps. */
export const MAX_ENTRIES = 200;
export const MAX_ENTRY_CHARS = 8000;

export interface TranscriptEntry {
  id: number;
  role: 'you' | 'agent';
  kind: 'prompt' | 'followup' | 'message';
  text: string;
  /** ISO time. */
  at: string;
  /** Files sent with this message (display only: name as text, kind, size). */
  attachments?: { name: string; kind: 'image' | 'video' | 'pdf' | 'text'; size: number }[];
}

export interface Transcript {
  entries: TranscriptEntry[];
  /** The run accepts no more follow-ups right now. */
  finished: boolean;
  /** Finished, but a follow-up would resume it. */
  canResume: boolean;
  /** Older entries or text were dropped. */
  truncated: boolean;
}

const ROLES = ['you', 'agent'] as const;
const KINDS = ['prompt', 'followup', 'message'] as const;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

const FILE_KINDS: readonly unknown[] = ['image', 'video', 'pdf', 'text'];
/** At most this many attachment chips are read per message. */
const MAX_FILES_PER_ENTRY = 10;

function parseEntryFiles(value: unknown): NonNullable<TranscriptEntry['attachments']> {
  if (!Array.isArray(value)) return [];
  const out: NonNullable<TranscriptEntry['attachments']> = [];
  for (const f of value.slice(0, MAX_FILES_PER_ENTRY)) {
    if (!isRecord(f) || typeof f.name !== 'string' || !FILE_KINDS.includes(f.kind) || typeof f.size !== 'number') continue;
    out.push({ name: f.name.slice(0, 200), kind: f.kind as 'image' | 'video' | 'pdf' | 'text', size: f.size });
  }
  return out;
}

/** Read `{ transcript }` from a 2xx body. An entry that breaks the contract is skipped. undefined: not a transcript. */
export function parseTranscriptResponse(body: unknown): Transcript | undefined {
  if (!isRecord(body) || !isRecord(body.transcript)) return undefined;
  const t = body.transcript;
  if (!Array.isArray(t.entries) || typeof t.finished !== 'boolean') return undefined;
  const entries: TranscriptEntry[] = [];
  for (const raw of t.entries) {
    if (!isRecord(raw)) continue;
    const { id, role, kind, text, at } = raw;
    if (typeof id !== 'number' || !Number.isInteger(id)) continue;
    if (!(ROLES as readonly unknown[]).includes(role) || !(KINDS as readonly unknown[]).includes(kind)) continue;
    if (typeof text !== 'string' || typeof at !== 'string') continue;
    const entry: TranscriptEntry = { id, role: role as TranscriptEntry['role'], kind: kind as TranscriptEntry['kind'], text: text.slice(0, MAX_ENTRY_CHARS), at };
    const files = parseEntryFiles(raw.attachments);
    if (files.length > 0) entry.attachments = files;
    entries.push(entry);
  }
  return {
    entries: entries.slice(-MAX_ENTRIES),
    finished: t.finished,
    canResume: t.canResume === true,
    truncated: t.truncated === true,
  };
}

/** GET /v1/runs/:id/transcript */
export function fetchTranscript(token: string, runId: string, signal: AbortSignal, fetchImpl?: typeof fetch): Promise<ApiResult<Transcript>> {
  return callApi({
    token, action: 'transcript', path: `${RUNS_PATH}/${encodeURIComponent(runId)}/transcript`, method: 'GET',
    signal, fetchImpl, parse: parseTranscriptResponse,
  });
}

/** Whether the input under the history can send: while the run is active, or when a follow-up would resume it. */
export function canSendFollowUp(t: Transcript): boolean {
  return !t.finished || t.canResume;
}

export const CLEARS_NOTE = 'This chat is kept in memory on your server and clears when the server restarts.';
export const EXTERNAL_NOTE = 'This agent runs outside Opsaip - read only.';
export const NO_CHAT_NOTE = 'No chat to show: this run was started before this page was opened, or the server has restarted since.';
export const FINISHED_NOTE = 'Run finished. This run cannot be continued: the server has no session to resume.';
export const RESUMABLE_NOTE = 'Run finished. A message resumes the same session in the same worktree.';

/**
 * What the Chat tab shows for a task: the run's chat (Opsaip launched it and knows the run),
 * a "no chat" note (a task you created from a Claude Code run, but this page does not know
 * the run), or the read-only note (an agent reported it through MCP, or Demo).
 */
export function chatTabMode(task: { owner: string; source: string }, live: boolean, runId: string | undefined): 'run' | 'launched-here' | 'external' {
  if (live && runId !== undefined) return 'run';
  return live && task.owner === 'me' && task.source === 'claude-code' ? 'launched-here' : 'external';
}
