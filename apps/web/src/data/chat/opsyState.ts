// Which face Opsy shows next to a message. Pure. Opsy is decorative, so the
// message text always says what the face means.

import type { AgentTaskStatus } from '@opsaip/core';
import type { OpsyState } from '../opsyFocus';
import type { ThreadMessage } from './types';

const RUN_STATE: Record<AgentTaskStatus, OpsyState> = {
  queued: 'working',
  running: 'working',
  waiting_on_human: 'question',
  done: 'done',
  failed: 'error',
};

/**
 * - the server is offline (Live) -> offline, whatever the message;
 * - waiting for the server -> working;
 * - a brief -> hello;
 * - waiting for your OK: Needs you tasks, a proposal before you decide, a run waiting
 *   for you, or a permission request you have not answered -> question;
 * - a run: starting or working -> working, done -> done, failed -> error;
 * - everything else (answers, lists, decided proposals, errors) -> idle.
 */
export function opsyStateFor(message: Extract<ThreadMessage, { from: 'opsy' }>, serverOffline: boolean): OpsyState {
  if (serverOffline) return 'offline';
  if (message.pending) return 'working';
  switch (message.widget.kind) {
    case 'brief': return 'hello';
    case 'needs': return 'question';
    case 'proposal': return message.widget.status === 'pending' ? 'question' : 'idle';
    case 'permission': return message.widget.state === 'pending' ? 'question' : 'idle';
    case 'run': return RUN_STATE[message.widget.status];
    default: return 'idle';
  }
}
