import { motion } from 'motion/react';
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
  const { readOnly } = useWorkspace();
  return <HomeColumn key={readOnly ? 'server' : 'demo'} />;
}

function HomeColumn() {
  const { findTask } = useWorkspace();
  const ui = useUi();
  const t = ui.motion;
  const task = findTask(ui.openTaskId);
  const chat = useChat();

  return (
    <div
      className="op-col"
      data-tray={ui.trayOpen ? 'open' : 'closed'}
      data-mode={task ? 'card' : undefined}
      hidden={ui.settingsOpen}
    >
      <ChatThread chat={chat} />
      <Suggestions chat={chat} />

      <motion.div className="op-composer-wrap" {...rise(t, 2)}>
        <div className="op-tray" data-open={ui.trayOpen}>
          {task && <TaskCard key={task.id} task={task} />}
          <TrayList />
          <TrayBar />
        </div>
        <Composer task={task} chat={chat} />
      </motion.div>
    </div>
  );
}
