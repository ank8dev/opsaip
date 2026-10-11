import { Fragment, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { isLocal } from '../../types';
import { waitingFor } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { listItem } from '../../styles/motion';
import { useNow } from '../../lib/useNow';
import { StatusDot } from '../common/StatusDot';

/** The summary line: "2 need you now · 3 can wait". Opens and closes the list. */
export function TrayBar() {
  const { decisionTasks, attentionTasks, localTasks } = useWorkspace();
  const { trayLevel, trayOpen, setTrayOpen } = useUi();
  const all = decisionTasks();
  const now = attentionTasks(trayLevel);
  const later = all.length - now.length;
  const yoursRunning = localTasks.some((t) => t.status !== 'Done' && t.status !== 'Needs you');

  const parts = [
    now.length ? (
      <><b className="op-n">{now.length}</b> {now.length === 1 ? 'needs you now' : 'need you now'}</>
    ) : (
      <>Nothing needs you right now</>
    ),
    later > 0 && <><b className="op-n">{later}</b> can wait</>,
    yoursRunning && <>yours just started</>,
  ].filter(Boolean);

  return (
    <button
      type="button"
      className="op-tray-bar op-grid"
      aria-expanded={trayOpen}
      aria-controls="op-tray-body"
      onClick={() => setTrayOpen(!trayOpen)}
    >
      <span className="op-dotbox" data-baton="tray" aria-hidden="true"><span className="op-dot" /></span>
      <span className="op-sum">
        {parts.map((p, i) => (
          <span key={i} className="op-sum-part">
            {i > 0 && <span className="op-sum-sep">·</span>}
            {p}
          </span>
        ))}
      </span>
      <span className="op-chev-cell" aria-hidden="true"><span className="op-chev" /></span>
    </button>
  );
}

/** Only decisions that matter right now: "Needs you", and tools that disagree. */
export function TrayList() {
  const { attentionTasks, people } = useWorkspace();
  const ui = useUi();
  const t = ui.motion;
  const now = useNow();
  const tasks = attentionTasks(ui.trayLevel);

  // Each time the tray opens, the rows drop in again.
  const [opened, setOpened] = useState(0);
  useEffect(() => { if (ui.trayOpen) setOpened((n) => n + 1); }, [ui.trayOpen]);

  return (
    <div className="op-tray-body" id="op-tray-body">
      <div className="op-tray-clip">
        <div className="op-panel">
          <div className="op-scroll">
            <ul key={opened} className="op-list" aria-label="Needs you now">
              {tasks.map((task, i) => {
                const conflict = task.status !== 'Needs you'; // here only because its tools disagree
                const owner = isLocal(task) ? 'You' : people[task.owner]?.name;
                return (
                  <motion.li key={task.id} className="op-li" {...listItem(t, i)}>
                    <button
                      type="button"
                      className={`op-item op-grid${task.status === 'Failed' ? ' op-fail' : ''}`}
                      data-current={task.id === ui.openTaskId || undefined}
                      onClick={() => ui.openTask(task.id)}
                    >
                      <span className="op-c1"><StatusDot status={task.status} batonKey={task.id} /></span>
                      <span className="op-c2"><span className="op-title">{task.task}</span></span>
                      <span className="op-c3">{task.tool && <span className="op-tag">{task.tool}</span>}</span>
                      <span className={`op-c4${conflict ? ' op-flag' : ''}`}>{conflict ? 'Out of sync' : task.status}</span>
                      <span className="op-sub">
                        {task.priority && (
                          <Fragment>
                            <span className={task.priority === 'Urgent' ? 'op-prio-urgent' : ''}>{task.priority}</span>
                            {' · '}
                          </Fragment>
                        )}
                        {[task.impact || task.detail, owner, waitingFor(task, now.getTime())].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                  </motion.li>
                );
              })}
              {!tasks.length && <li className="op-empty">Nothing needs you right now</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
