import { CHIPS, LIVE_CHIPS } from '../../data/chat/demoAnswers';
import type { Chat } from './useChat';
import './Chat.css';

/** Questions to tap, under the thread. In Live mode only the ones the server can answer. */
export function Suggestions({ chat }: { chat: Chat }) {
  const chips = chat.live ? LIVE_CHIPS : CHIPS;
  return (
    <div className="op-chips" role="group" aria-label="Suggestions">
      {chips.map((c) => (
        <button key={c.id} type="button" className="op-chip" disabled={chat.busy} onClick={() => chat.send(c.label)}>
          {c.label}
        </button>
      ))}
    </div>
  );
}
