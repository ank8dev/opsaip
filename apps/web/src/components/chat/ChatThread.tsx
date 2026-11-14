import { useEffect, useRef } from 'react';
import { motion } from 'motion/react';
import { greeting } from '../../data/selectors';
import { latestOpsyId, opsyStateFor } from '../../data/chat/opsyState';
import { useUi } from '../../state/ui';
import { rise } from '../../styles/motion';
import { useNow } from '../../lib/useNow';
import { Opsy } from '../opsy/Opsy';
import { WidgetView } from './Widgets';
import type { Chat } from './useChat';
import './Chat.css';

/** Larger than before: there is only one Opsy on screen, so it can be seen. */
const AVATAR = 56;

/**
 * The conversation with Opsy. One Opsy: only its latest message has the avatar,
 * and the avatar's mood is that message's state. Older messages keep an empty
 * column of the same width, so text does not move when a new message arrives.
 * The avatar is decorative, so every message says what it means in words.
 *
 * Motion: the avatar enters with `rise` from styles/motion.ts, the same
 * entrance as the rest of the app (reduced motion is already in the tokens).
 */
export function ChatThread({ chat }: { chat: Chat }) {
  const ui = useUi();
  const t = ui.motion;
  const now = useNow();
  const scroller = useRef<HTMLDivElement>(null);
  const { messages } = chat;
  const avatarId = latestOpsyId(messages);

  // A new question scrolls to the top of the view, so a long answer is read from its start.
  useEffect(() => {
    const you = scroller.current?.querySelectorAll('.op-turn-you');
    you?.[you.length - 1]?.scrollIntoView({ block: 'start', behavior: t.reduced ? 'auto' : 'smooth' });
  }, [messages.length, t.reduced]);

  // A request that needs you is brought into view, even when a long run card sits above it.
  const needsYou = messages.filter((m) => m.from === 'opsy' && m.widget.kind === 'permission' && m.widget.state === 'pending').length;
  useEffect(() => {
    if (needsYou === 0) return;
    const cards = scroller.current?.querySelectorAll('.op-w-perm[data-status="pending"]');
    cards?.[cards.length - 1]?.scrollIntoView({ block: 'nearest', behavior: t.reduced ? 'auto' : 'smooth' });
  }, [needsYou, t.reduced]);

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
                  <div className="op-turn-avatar" style={{ width: AVATAR, height: AVATAR }}>
                    {m.id === avatarId && (
                      <motion.div {...rise(t, 0)}>
                        <Opsy state={opsyStateFor(m, chat.serverOffline)} size={AVATAR} />
                      </motion.div>
                    )}
                  </div>
                  <div className="op-turn-body">
                    <span className="op-sr-only">Opsy: </span>
                    <WidgetView
                      widget={m.widget}
                      onDecide={(d) => chat.decide(m.id, d)}
                      onAnswer={(allow) => void chat.answerPermission(m.id, allow)}
                      onStop={() => void chat.stop()}
                    />
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
