import { motion } from 'motion/react';
import { describeSource } from '../../data/connectionView';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { rise } from '../../styles/motion';
import { useNow } from '../../lib/useNow';

/** Where the data comes from: Demo, Connecting, Live or Offline. Opens Settings, where Server is first. */
export function ConnectionBadge() {
  const { source } = useWorkspace();
  const ui = useUi();
  const now = useNow(10_000);
  const view = describeSource(source, now.getTime());

  return (
    <motion.button
      type="button"
      className="op-corner-btn op-conn"
      data-tone={view.tone}
      title={view.detail}
      aria-label={`${view.label}: ${view.detail} Open server settings.`}
      aria-controls="op-settings"
      onClick={() => ui.setSettingsOpen(true)}
      {...rise(ui.motion, 1)}
    >
      <span className="op-conn-dot" aria-hidden="true" />
      {view.label}
    </motion.button>
  );
}
