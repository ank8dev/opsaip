import { useEffect, useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { navCounts } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi, type Section } from '../../state/ui';
import { rise, slideIn } from '../../styles/motion';
import { UpdateNote } from './UpdateNote';
import { Wordmark } from '../common/Logo';
import { AgentsIcon, ChatIcon, McpIcon, RepoIcon, SettingsIcon, TeamIcon } from '../common/Icons';
import { feature } from '../../features';
import { useChats } from '../../state/chats';
import { AgentsSection } from './AgentsSection';
import { TeamSection } from './TeamSection';
import { McpSection } from './McpSection';
import { RepoSection } from './RepoSection';
import { ChatList } from './ChatList';
import './Sidebar.css';

const ALL_SECTIONS: { key: Exclude<Section, 'chat'>; title: string; Icon: typeof AgentsIcon; View: typeof AgentsSection }[] = [
  { key: 'agents', title: 'Agents', Icon: AgentsIcon, View: AgentsSection },
  { key: 'team', title: 'Team', Icon: TeamIcon, View: TeamSection },
  { key: 'mcp', title: 'MCP', Icon: McpIcon, View: McpSection },
  { key: 'repo', title: 'Repo', Icon: RepoIcon, View: RepoSection },
];

/** The sections in v0.1: Agents. Team, MCP and Repo are behind their flags (src/features.ts). */
export function sidebarSections() {
  return ALL_SECTIONS.filter((s) => s.key === 'agents' || feature(s.key));
}

/** The sidebar: a plain list of sections; opening one shows only its content. */
export function Sidebar() {
  const { ws, tasks, localTasks } = useWorkspace();
  const chats = useChats();
  const SECTIONS = sidebarSections();
  const ui = useUi();
  const t = ui.motion;
  const searchRef = useRef<HTMLInputElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const navRefs = useRef<Partial<Record<Section, HTMLButtonElement | null>>>({});
  const lastSection = useRef<Section | null>(null);

  const counts = navCounts(ws, tasks);
  const searching = !!ui.query.trim();
  const listing = ui.section === 'chat'; // the section list is showing, not one section
  const searchAll = listing && searching; // searching from the section list looks through all

  // Focus follows the move: into a section → its back button; back out → the item you came from.
  useEffect(() => {
    if (!listing) {
      backRef.current?.focus({ preventScroll: true });
      lastSection.current = ui.section;
    } else if (lastSection.current) {
      navRefs.current[lastSection.current]?.focus({ preventScroll: true });
      lastSection.current = null;
    }
  }, [ui.section, listing]);

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
      } else if (e.key === 'Escape' && !listing && !typing && !ui.openTaskId && !ui.settingsOpen) {
        ui.setSection('chat');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ui, listing]);

  const open = SECTIONS.find((s) => s.key === ui.section);

  // Search looks through the Agents list (task, note, tool) and your chats (their names). Say so when nothing matches.
  const q = ui.query.trim().toLowerCase();
  const anyHit =
    [...tasks, ...localTasks].some((x) => [x.task, x.detail, x.tool].join(' ').toLowerCase().includes(q)) ||
    chats.chats.some((c) => c.title.toLowerCase().includes(q)) ||
    SECTIONS.length > 1; // other sections do their own matching

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
          placeholder={SECTIONS.length > 1 ? 'Search everything' : 'Search tasks and chats'}
          aria-label={SECTIONS.length > 1 ? 'Search agents, people, MCP and repo' : 'Search tasks and chats'}
          autoComplete="off"
          value={ui.query}
          onChange={(e) => ui.setQuery(e.target.value)}
        />
        <span className="op-kbd" aria-hidden="true">/</span>
      </motion.label>

      <AnimatePresence mode="popLayout">
        {listing && !searchAll && (
          <motion.nav key="nav" className="op-nav" aria-label="Sections" {...slideIn(t, -1)} exit={{ opacity: 0, transition: { duration: t.fast } }}>
            <button
              type="button"
              className="op-nav-item"
              aria-current={!ui.settingsOpen && !ui.openTaskId ? 'page' : undefined}
              onClick={() => { ui.setSettingsOpen(false); ui.closeTask(); }}
            >
              <ChatIcon className="op-nav-ico" />
              <span>Chat</span>
            </button>
            <ChatList />
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
              <button ref={backRef} type="button" className="op-back" aria-label="Back to sections" onClick={() => ui.setSection('chat')}>
                <span />
              </button>
              <span className="op-sv-title">{open.title}</span>
            </div>
            <open.View mode="one" />
          </motion.div>
        )}
        {searchAll && (
          <>
            <ChatList query={ui.query} />
            {SECTIONS.map(({ key, View }) => <View key={key} mode="all" />)}
            {!anyHit && <p className="op-sv-empty" role="status">Nothing matches “{ui.query.trim()}”.</p>}
          </>
        )}
      </motion.div>

      <motion.div className="op-side-foot" {...rise(t, 3)}>
        <UpdateNote />
        <button
          type="button"
          className="op-me"
          aria-expanded={ui.settingsOpen}
          aria-controls="op-settings"
          onClick={() => ui.setSettingsOpen(!ui.settingsOpen)}
        >
          <SettingsIcon className="op-nav-ico" />
          <span className="op-me-name">Settings</span>
        </button>
      </motion.div>
    </aside>
  );
}
