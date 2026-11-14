import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { greeting } from '../../data/selectors';
import { opsyStateFor } from '../../data/chat/opsyState';
import { useUi } from '../../state/ui';
import { rise } from '../../styles/motion';
import { useNow } from '../../lib/useNow';
import { Opsy } from '../opsy/Opsy';
import { WidgetView } from './Widgets';
import type { Chat } from './useChat';
import './Chat.css';

const AVATAR = 32;

/**
 * The conversation with Opsy. Opsy's avatar next to each of its messages shows
 * the message's mood; it is decorative, so every message says what it means in
 * words.
 */
export function ChatThread({ chat }: { chat: Chat }) {
  const ui = useUi();
  const t = ui.motion;
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const { messages } = chat;

  // A new question scrolls to the top of the view, so a long answer is read from its start.
  useEffect(() => {
    const you = scroller.current?.querySelectorAll('.op-turn-you');
    you?.[you.length - 1]?.scrollIntoView({ block: 'start', behavior: t.reduced ? 'auto' : 'smooth' });
  }, [messages.length, t.reduced]);

  return (
    <div className="op-thread" ref={scroller}>
      {messages.length === 0 ? (
        <motion.header className="op-intro" {...rise(t, 1)}>
          <Opsy state={chat.serverOffline ? 'offline' : 'hello'} size={72} />
          <h1 className="op-hello">{greeting(now)}</h1>
          <p className="op-intro-sub">
            {chat.live
              ? 'Ask me about the tasks on your server.'
              : 'Ask me about the demo team’s tasks. Pick a suggestion below.'}
          </p>
        </motion.header>
      ) : (
        <>
          <h1 className="op-sr-only">Chat with Opsy</h1>
          <div className="op-turns" role="log" aria-label="Conversation with Opsy" aria-relevant="additions text">
            {messages.map((m) =>
              m.from === 'you' ? (
                <motion.div key={m.id} className="op-turn op-turn-you" {...rise(t, 0)}>
                  <p className="op-bub"><span className="op-sr-only">You: </span>{m.text}</p>
                </motion.div>
              ) : (
                <motion.div key={m.id} className="op-turn op-turn-opsy" {...rise(t, 0)}>
                  <Opsy state={opsyStateFor(m, chat.serverOffline)} size={AVATAR} />
                  <div className="op-turn-body">
                    <span className="op-sr-only">Opsy: </span>
                    <WidgetView widget={m.widget} onDecide={(d) => chat.decide(m.id, d)} />
                  </div>
                </motion.div>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
