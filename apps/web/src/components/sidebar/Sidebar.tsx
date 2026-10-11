import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { navCounts } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi, type Section } from '../../state/ui';
import { rise, slideIn } from '../../styles/motion';
import { Wordmark } from '../common/Logo';
import { Face } from '../common/Face';
import { AgentsIcon, McpIcon, RepoIcon, TeamIcon } from '../common/Icons';
import { AgentsSection } from './AgentsSection';
import { TeamSection } from './TeamSection';
import { McpSection } from './McpSection';
import { RepoSection } from './RepoSection';
import './Sidebar.css';

const SECTIONS: { key: Section; title: string; Icon: typeof AgentsIcon; View: typeof AgentsSection }[] = [
  { key: 'agents', title: 'Agents', Icon: AgentsIcon, View: AgentsSection },
  { key: 'team', title: 'Team', Icon: TeamIcon, View: TeamSection },
  { key: 'mcp', title: 'MCP', Icon: McpIcon, View: McpSection },
  { key: 'repo', title: 'Repo', Icon: RepoIcon, View: RepoSection },
];

/** The sidebar: a plain list of sections; opening one shows only its content. */
export function Sidebar() {
  const { ws, tasks } = useWorkspace();
  const ui = useUi();
  const t = ui.motion;
  const searchRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const navRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const lastSection = useRef<Section | null>(null);

  const counts = navCounts(ws, tasks);
  const searching = !!ui.query.trim();
  const searchAll = !ui.section && searching; // searching from the section list looks through all

  // Focus follows the move: into a section → its back button; back out → the item you came from.
  useEffect(() => {
    if (ui.section) {
      backRef.current?.focus({ preventScroll: true });
      lastSection.current = ui.section;
    } else if (lastSection.current) {
      navRefs.current[lastSection.current]?.focus({ preventScroll: true });
      lastSection.current = null;
    }
  }, [ui.section]);

  // "/" jumps to search; Escape clears it, or leaves the open section.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.tagName === 'SELECT' || el?.isContentEditable;
      if (e.key === '/' && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === 'Escape' && el === searchRef.current) {
        ui.setQuery('');
        searchRef.current?.blur();
      } else if (e.key === 'Escape' && ui.section && !typing && !ui.openTaskId && !ui.settingsOpen) {
        ui.setSection(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ui]);

  const open = SECTIONS.find((s) => s.key === ui.section);

  return (
    <aside className="op-side" aria-label="Workspace">
      <motion.div className="op-side-top" {...rise(t, 0)}>
        <Wordmark className="op-logo" />
      </motion.div>

      <motion.label className="op-search" {...rise(t, 1)}>
        <span className="op-search-ico" aria-hidden="true" />
        <input
          ref={searchRef}
          type="search"
          placeholder="Search everything"
          aria-label="Search agents, people, MCP and repo"
          autoComplete="off"
          value={ui.query}
          onChange={(e) => ui.setQuery(e.target.value)}
        />
        <span className="op-kbd" aria-hidden="true">/</span>
      </motion.label>

      <AnimatePresence mode="popLayout">
        {!ui.section && !searchAll && (
          <motion.nav key="nav" className="op-nav" aria-label="Sections" {...slideIn(t, -1)} exit={{ opacity: 0, transition: { duration: t.fast } }}>
            {SECTIONS.map(({ key, title, Icon }) => (
              <button
                key={key}
                ref={(el) => { navRefs.current[key] = el; }}
                type="button"
                className="op-nav-item"
                onClick={() => ui.setSection(key)}
              >
                <Icon className="op-nav-ico" />
                <span>{title}</span>
                <span className="op-nav-n">{counts[key]}</span>
                <span className="op-nav-chev" aria-hidden="true" />
              </button>
            ))}
          </motion.nav>
        )}
      </AnimatePresence>

      <motion.div className="op-svs" {...rise(t, 2)}>
        {open && (
          <motion.div key={open.key} {...slideIn(t, 1)}>
            <div className="op-sv-head">
              <button ref={backRef} type="button" className="op-back" aria-label="Back to sections" onClick={() => ui.setSection(null)}>
                <span />
              </button>
              <span className="op-sv-title">{open.title}</span>
            </div>
            <open.View mode="one" />
          </motion.div>
        )}
        {searchAll && SECTIONS.map(({ key, View }) => <View key={key} mode="all" />)}
      </motion.div>

      <motion.div className="op-side-foot" {...rise(t, 3)}>
        <button
          type="button"
          className="op-me"
          aria-expanded={ui.settingsOpen}
          aria-controls="op-settings"
          onClick={() => ui.setSettingsOpen(!ui.settingsOpen)}
        >
          <Face label={(ui.userName.trim() || 'You').charAt(0).toUpperCase()} on />
          <span>
            <span className="op-me-name">{ui.userName.trim() || 'You'}</span>
            <span className="op-me-sub">Profile and settings</span>
          </span>
          <span className="op-updown" aria-hidden="true" />
        </button>
      </motion.div>
    </aside>
  );
}
