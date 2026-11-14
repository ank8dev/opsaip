import { Fragment, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { isLocal } from '../../types';
import { waitingFor } from '../../data/selectors';
import { noDecisionsText } from '../../data/connectionView';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { listItem } from '../../styles/motion';
import { useNow } from '../../lib/useNow';
import { StatusDot } from '../common/StatusDot';

/** The summary line: "2 need you · 1 failed". Opens and closes the list. */
export function TrayBar() {
  const { attention, localTasks, source } = useWorkspace();
  const { trayOpen, setTrayOpen } = useUi();
  const clock = useNow(10_000);
  const needs = attention.needsYou.length;
  const failed = attention.failed.length;
  const yoursRunning = localTasks.some((t) => t.status !== 'Done' && t.status !== 'Needs you');

  const parts = [
    needs > 0 && <><b className="op-n">{needs}</b> {needs === 1 ? 'needs you' : 'need you'}</>,
    failed > 0 && <><b className="op-n op-n-fail">{failed}</b> failed</>,
    needs === 0 && failed === 0 && <>{noDecisionsText(source, clock.getTime())}</>,
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
      <span className="op-dotbox" aria-hidden="true"><span className="op-dot" /></span>
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

/** What needs you, then what failed: the same tasks the bar above counts. */
export function TrayList() {
  const { attention, people, source } = useWorkspace();
  const ui = useUi();
  const t = ui.motion;
  const now = useNow(10_000); // also for "last updated … ago" when offline
  const tasks = [...attention.needsYou, ...attention.failed];

  // Each time the tray opens, the rows drop in again.
  const [opened, setOpened] = useState(0);
  useEffect(() => { if (ui.trayOpen) setOpened((n) => n + 1); }, [ui.trayOpen]);

  return (
    <div className="op-tray-body" id="op-tray-body">
      <div className="op-tray-clip">
        <div className="op-panel">
          <div className="op-scroll">
            <ul key={opened} className="op-list" aria-label="Needs you and failed">
              {tasks.map((task, i) => {
                const owner = isLocal(task) ? 'You' : people[task.owner]?.name;
                const note = task.impact || task.detail; // the agent's note: text for a person
                const rest = [owner, waitingFor(task, now.getTime())].filter(Boolean).join(' · ');
                return (
                  <motion.li key={task.id} className="op-li" {...listItem(t, i)}>
                    <button
                      type="button"
                      className={`op-item op-grid${task.status === 'Failed' ? ' op-fail' : ''}`}
                      data-current={task.id === ui.openTaskId || undefined}
                      onClick={() => ui.openTask(task.id)}
                    >
                      <span className="op-c1"><StatusDot status={task.status} /></span>
                      <span className="op-c2"><span className="op-title">{task.task}</span></span>
                      <span className="op-c3">{task.tool && <span className="op-tag">{task.tool}</span>}</span>
                      <span className="op-c4">{task.status}</span>
                      <span className="op-sub">
                        {task.priority && (
                          <Fragment>
                            <span className={task.priority === 'Urgent' ? 'op-prio-urgent' : ''}>{task.priority}</span>
                            {' · '}
                          </Fragment>
                        )}
                        {note && <span className="op-note">{note}</span>}
                        {note && rest && ' · '}
                        {rest}
                      </span>
                    </button>
                  </motion.li>
                );
              })}
              {!tasks.length && <li className="op-empty">{noDecisionsText(source, now.getTime())}</li>}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
