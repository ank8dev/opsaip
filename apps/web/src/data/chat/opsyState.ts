// Which face Opsy shows next to a message. Pure. Opsy is decorative, so the
// message text always says what the face means.

import type { OpsyState } from '../opsyFocus';
import type { ThreadMessage } from './types';

/**
 * - the server is offline (Live) -> offline, whatever the message;
 * - waiting for the server -> working;
 * - a brief -> hello;
 * - waiting for your OK: Needs you tasks, or a proposal before you decide -> question;
 * - everything else (answers, lists, decided proposals, errors) -> idle.
 */
export function opsyStateFor(message: Extract<ThreadMessage, { from: 'opsy' }>, serverOffline: boolean): OpsyState {
  if (serverOffline) return 'offline';
  if (message.pending) return 'working';
  switch (message.widget.kind) {
    case 'brief': return 'hello';
    case 'needs': return 'question';
    case 'proposal': return message.widget.status === 'pending' ? 'question' : 'idle';
    default: return 'idle';
  }
}
