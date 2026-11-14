// A Proposed action card: what Opsy builds from the server's Ask answer and
// what the card's buttons do. Pure: no React. Nothing here sends anything; the
// chat calls the server only when you press Approve, with exactly the title
// and prompt on the card.

import type { AskAction } from './ask';
import type { ConductorStatus } from './conductor';
import { CONDUCTOR_DOCS_LINK, CONDUCTOR_OFF_NOTE } from './problems';
import type { ApiResult } from './serverCall';
import type { ActionWidget } from './types';

export const AGENT_NAME = 'Claude Code';

/** What the card says when it cannot be approved. */
export const RUN_ACTIVE_NOTE = 'Another run is active. Wait for it to finish or stop it, then ask again.';
export const CONDUCTOR_UNKNOWN_NOTE = 'I could not check whether Agent mode is on, so I cannot start it now. Try again in a moment.';

/**
 * The card for an action. For a run, `conductor` is the answer of a fresh
 * GET /v1/conductor and `runActiveHere` is true if this page follows an active
 * run: if Agent mode is off, the check failed, or a run is active, the card is
 * blocked and says so instead of offering Approve. A task needs no Agent mode.
 */
export function actionCard(
  answer: string,
  action: AskAction,
  conductor: ApiResult<ConductorStatus> | null,
  runActiveHere: boolean,
): ActionWidget {
  if (action.type === 'task') {
    return { kind: 'action', answer, action: 'task', agent: '', repo: '', title: action.title, prompt: '', state: 'pending', note: '' };
  }
  const base = { kind: 'action' as const, answer, action: 'run' as const, agent: AGENT_NAME, title: action.title, prompt: action.prompt };
  if (conductor === null || !conductor.ok) {
    return { ...base, repo: '', state: 'blocked', note: CONDUCTOR_UNKNOWN_NOTE };
  }
  const status = conductor.value;
  if (!status.enabled) {
    const note = status.reason === undefined ? CONDUCTOR_OFF_NOTE : `${CONDUCTOR_OFF_NOTE} ${status.reason}`;
    return { ...base, repo: '', state: 'blocked', note, link: { ...CONDUCTOR_DOCS_LINK } };
  }
  const repo = status.repo ?? '';
  if (status.active === true || runActiveHere) return { ...base, repo, state: 'blocked', note: RUN_ACTIVE_NOTE };
  return { ...base, repo, state: 'pending', note: '' };
}

/** Cancel: only a card still waiting can be cancelled; nothing is sent. */
export function cancelAction(card: ActionWidget): ActionWidget {
  return card.state === 'pending' ? { ...card, state: 'cancelled' } : card;
}

/** Approve was clicked: only a pending card goes on (so a double click sends once). Null: do nothing. */
export function beginApprove(card: ActionWidget): ActionWidget | null {
  return card.state === 'pending' ? { ...card, state: 'approving' } : null;
}

/** What Approve sends for a card: exactly the title and prompt it shows. */
export function approvedPayload(card: ActionWidget): { title: string; prompt: string } {
  return { title: card.title, prompt: card.prompt };
}
