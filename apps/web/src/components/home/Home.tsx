import { motion } from 'motion/react';
import { greeting } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { rise } from '../../styles/motion';
import { useNow } from '../../lib/useNow';
import { Symbol } from '../common/Logo';
import { Composer } from './Composer';
import { TaskCard } from './TaskCard';
import { TrayBar, TrayList } from './Tray';
import './Home.css';

/** The home column: greeting, then the composer with the attention tray tucked on top. */
export function Home() {
  const { findTask } = useWorkspace();
  const ui = useUi();
  const t = ui.motion;
  const now = useNow();
  const task = findTask(ui.openTaskId);

  return (
    <div
      className="op-col"
      data-tray={ui.trayOpen ? 'open' : 'closed'}
      data-mode={task ? 'card' : undefined}
      hidden={ui.settingsOpen}
    >
      <motion.header className="op-greet" {...rise(t, 1)}>
        <Symbol className="op-symbol" />
        <h1 className="op-hello">{greeting(now)}</h1>
      </motion.header>

      <motion.div className="op-composer-wrap" {...rise(t, 2)}>
        <div className="op-tray" data-open={ui.trayOpen}>
          {task && <TaskCard key={task.id} task={task} />}
          <TrayList />
          <TrayBar />
        </div>
        <Composer task={task} />
      </motion.div>
    </div>
  );
}
