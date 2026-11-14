// What the UI says about the data source: the badge label, its tone, and a
// sentence for Settings. Pure, so every state and problem is tested.

import type { DataSource } from './poller';
import type { FetchProblem } from './source';

export type ConnectionLabel = 'Demo' | 'Not connected' | 'Connecting' | 'Live' | 'Offline';
/** muted: nothing is wrong, nothing is live; live: the accent; error: red. */
export type ConnectionTone = 'muted' | 'live' | 'error';

export interface ConnectionView {
  label: ConnectionLabel;
  tone: ConnectionTone;
  /** One or two sentences for Settings and the badge's tooltip. Never the token. */
  detail: string;
}

/** What to tell the user for each failure. A Record: a new FetchProblem fails the build until it has a text. */
export const PROBLEM_TEXT: Record<FetchProblem, string> = {
  unauthorized: 'The server rejected the token. Disconnect, then paste the right one.',
  unreachable: 'Cannot reach the server. Trying again every few seconds.',
  'server-error': 'The server answered with an error. Trying again every few seconds.',
  'bad-response': 'The server sent an answer this app does not understand. Trying again every few seconds.',
};

/** Describe `source` as of `now` (ms since epoch). */
export function describeSource(source: DataSource, now: number): ConnectionView {
  switch (source.status) {
    case 'demo':
      return { label: 'Demo', tone: 'muted', detail: 'Sample data from a fictional team. Connect your server in Settings → Server.' };
    case 'disconnected':
      return { label: 'Not connected', tone: 'muted', detail: 'Paste your server’s access token to connect.' };
    case 'connecting':
      return { label: 'Connecting', tone: 'muted', detail: 'Connecting to the server…' };
    case 'live':
      return {
        label: 'Live',
        tone: 'live',
        detail: `Tasks from your server, read-only. Updated ${ago(source.at, now)}.${hiddenNote(source.skipped)}`,
      };
    case 'offline': {
      const shown = source.at === null ? '' : ` Showing tasks from ${ago(source.at, now)}.`;
      return { label: 'Offline', tone: 'error', detail: `${PROBLEM_TEXT[source.problem]}${shown}${hiddenNote(source.skipped)}` };
    }
  }
}

/** Short form of each problem, for one line in the tray. */
export const PROBLEM_SHORT: Record<FetchProblem, string> = {
  unauthorized: 'The server rejected the token',
  unreachable: 'Can’t reach the server',
  'server-error': 'The server answered with an error',
  'bad-response': 'Can’t read the server’s answer',
};

/**
 * What the tray says when no task needs you. "Nothing needs you right now"
 * is a claim about the team, so it is made only with Demo data or a live
 * server. Without a working connection the list can be old or empty, so
 * the tray says what is wrong and how old the data is instead.
 */
export function noDecisionsText(source: DataSource, now: number): string {
  switch (source.status) {
    case 'demo':
    case 'live':
      return 'Nothing needs you right now';
    case 'disconnected':
      return 'Not connected to a server';
    case 'connecting':
      return 'Connecting to the server…';
    case 'offline': {
      const when = source.at === null ? 'no data yet' : `last updated ${ago(source.at, now)}`;
      return `${PROBLEM_SHORT[source.problem]} · ${when}`;
    }
  }
}

/** "just now", "12 s ago", "3 min ago", "2 h ago". A time in the future counts as just now. */
export function ago(at: number, now: number): string {
  const s = Math.floor((now - at) / 1000);
  if (s < 10) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)} h ago`;
}

function hiddenNote(skipped: number): string {
  if (skipped === 0) return '';
  const tasks = skipped === 1 ? '1 task is' : `${skipped} tasks are`;
  return ` ${tasks} hidden: the server sent data this app does not understand.`;
}
