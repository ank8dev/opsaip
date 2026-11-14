import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { useChats } from '../../state/chats';
import type { ThreadMessage } from '../../data/chat/types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { rise } from '../../styles/motion';
import { ChatThread } from '../chat/ChatThread';
import { Suggestions } from '../chat/Suggestions';
import { useChat } from '../chat/useChat';
import { Composer } from './Composer';
import { TaskCard } from './TaskCard';
import { TrayBar, TrayList } from './Tray';
import './Home.css';

/**
 * The home column: the chat with Opsy, then the composer with the attention tray tucked on top.
 * Switching between Demo and a server starts a new chat: answers from one never sit next to the other.
 */
export function Home() {
  const { readOnly, api } = useWorkspace();
  const { session } = useChats();
  // Opening a saved chat loads its messages first; a new chat starts empty. The key makes the
  // thread start over for another chat, and stays the same when a new chat is saved.
  const [loaded, setLoaded] = useState<{ key: number; messages: ThreadMessage[] } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (loaded?.key === session.key) return;
    if (session.chatId === null || !readOnly) { setLoaded({ key: session.key, messages: [] }); return; }
    const c = new AbortController();
    setFailed(false);
    void api.loadMessages(session.chatId, c.signal).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok) setLoaded({ key: session.key, messages: r.value });
      else { setFailed(true); setLoaded({ key: session.key, messages: [] }); }
    });
    return () => c.abort();
  }, [session.key, session.chatId, readOnly, api, loaded?.key]);

  if (loaded?.key !== session.key) return <div className="op-col" aria-busy="true" />;
  return <HomeColumn key={`${readOnly ? 'server' : 'demo'}-${session.key}`} initial={loaded.messages} loadFailed={failed} />;
}

function HomeColumn({ initial, loadFailed }: { initial: ThreadMessage[]; loadFailed: boolean }) {
  const { findTask } = useWorkspace();
  const ui = useUi();
  const t = ui.motion;
  const task = findTask(ui.openTaskId);
  const chat = useChat(initial);

  return (
    <div
      className="op-col"
      data-tray={ui.trayOpen ? 'open' : 'closed'}
      hidden={ui.settingsOpen}
    >
      {loadFailed && <p className="op-readonly-note" role="alert">I could not load this chat’s messages. You can start over here.</p>}
      <ChatThread chat={chat} />
      <Suggestions chat={chat} />

      <motion.div className="op-composer-wrap" {...rise(t, 2)}>
        <div className="op-tray" data-open={ui.trayOpen}>
          <TrayList />
          <TrayBar />
        </div>
        <Composer task={task} chat={chat} />
      </motion.div>
      <AnimatePresence>{task && <TaskCard key="task-window" task={task} chat={chat} />}</AnimatePresence>
    </div>
  );
}
