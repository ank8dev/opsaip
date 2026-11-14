// A Conductor run as chat widgets. Pure: no React. The run card and the
// "Needs you" permission card are built from the server's run and nothing
// else: Opsy never adds a fact.

import type { AgentTaskStatus } from '@opsaip/core';
import { isRunActive, type Run } from './conductor';
import { problemText } from './problems';
import type { ApiResult } from './serverCall';
import type { PermissionState, PermissionWidget, RunWidget } from './types';

/** The run's status in plain words. A Record: a new status fails the build until it has a text. */
export const RUN_STATUS_TEXT: Record<AgentTaskStatus, string> = {
  queued: 'Starting',
  running: 'Working',
  waiting_on_human: 'Waiting for your answer',
  done: 'Done',
  failed: 'Failed',
};

/** Shown under a permission request once it is not pending any more. */
export const PERMISSION_OUTCOME_TEXT: Record<Exclude<PermissionState, 'pending'>, string> = {
  allowed: 'Allowed',
  denied: 'Denied',
  stale: 'This request is no longer waiting: it was already answered, or the run ended.',
};

export const RUN_SOURCE = 'From your server’s Conductor mode';

/** The run card for `run`. `title` is what the run was started with: the server's run has none. */
export function runCardWidget(title: string, run: Run, stopping = false): RunWidget {
  return {
    kind: 'run', runId: run.id, taskId: run.taskId, title: title.trim() === '' ? 'Claude Code run' : title,
    status: run.status, branch: run.branch, lastMessage: run.lastMessage ?? '', stopping, source: RUN_SOURCE,
  };
}

/** The "Needs you" card for the run's pending request, or null if it has none. */
export function permissionCardWidget(run: Run): PermissionWidget | null {
  const p = run.permission;
  if (p === undefined) return null;
  return { kind: 'permission', runId: run.id, permissionId: p.id, tool: p.tool, summary: p.summary, state: 'pending', busy: false, error: '' };
}

/**
 * The card after the run's latest state arrived: a pending request the run no
 * longer lists (answered elsewhere, timed out, run over) becomes stale. A card
 * with an answer in flight is left to that answer.
 */
export function reconcilePermission(card: PermissionWidget, run: Run): PermissionWidget {
  if (card.state !== 'pending' || card.busy) return card;
  return isRunActive(run.status) && run.permission?.id === card.permissionId ? card : { ...card, state: 'stale' };
}

/** The card after your answer was sent: the outcome, a stale request, or an error to show with the buttons still there. */
export function permissionAnswered(card: PermissionWidget, allow: boolean, result: ApiResult<Run>): PermissionWidget {
  if (result.ok) return { ...card, state: allow ? 'allowed' : 'denied', busy: false, error: '' };
  if (result.problem === 'stale') return { ...card, state: 'stale', busy: false, error: '' };
  return { ...card, busy: false, error: problemText(result.problem, result.reason) };
}
