import { useRef } from 'react';
import { motion } from 'motion/react';
import { useUi } from '../../state/ui';
import { rise } from '../../styles/motion';
import { Sidebar } from '../sidebar/Sidebar';
import { Home } from '../home/Home';
import { Settings } from '../settings/Settings';
import { Baton } from '../conductor/Baton';
import { SettingsIcon } from '../common/Icons';
import './AppShell.css';

/** The whole app: sidebar | main column, plus the baton floating over both. */
export function AppShell() {
  const ui = useUi();
  const rootRef = useRef<HTMLElement>(null);
  const themeLabel = ui.theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme';

  return (
    <section ref={rootRef} className="op-home" aria-label="Opsaip home">
      <Sidebar />

      <motion.button
        type="button"
        className="op-corner-btn op-gear-btn"
        aria-label="Settings"
        title="Settings"
        aria-expanded={ui.settingsOpen}
        aria-controls="op-settings"
        onClick={() => ui.setSettingsOpen(!ui.settingsOpen)}
        {...rise(ui.motion, 1)}
      >
        <SettingsIcon />
      </motion.button>
      <motion.button
        type="button"
        className="op-corner-btn op-theme-btn"
        aria-label={themeLabel}
        title={themeLabel}
        onClick={ui.toggleTheme}
        {...rise(ui.motion, 1)}
      >
        <span className="op-theme-ico" aria-hidden="true" />
      </motion.button>

      <main className="op-main">
        <Home />
        <Settings />
      </main>

      <Baton rootRef={rootRef} />
    </section>
  );
}
