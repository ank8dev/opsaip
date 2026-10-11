import { useEffect, useRef, useState } from 'react';
import { useAnimate } from 'motion/react';
import { useUi } from '../../state/ui';
import { PreviewContext } from './parts';
import { ProfileSettings, WorkspaceSettings } from './PeopleSections';
import { AgentSettings, ApprovalSettings, ToolServerSettings } from './AgentSections';
import { RepositorySettings, SlackSettings, SyncSettings } from './SyncSections';
import { AppearanceSettings, DataSettings, NotificationSettings } from './PreferenceSections';
import './Settings.css';

const INDEX: [string, string][] = [
  ['set-profile', 'Profile'],
  ['set-workspace', 'Workspace'],
  ['set-agents', 'Agents'],
  ['set-approvals', 'Approvals'],
  ['set-tools', 'Tool servers'],
  ['set-sync', 'Sync'],
  ['set-repo', 'Repository'],
  ['set-slack', 'Slack'],
  ['set-notify', 'Notifications'],
  ['set-look', 'Appearance'],
  ['set-data', 'Data & privacy'],
];

const NOTE = 'Preview — changes apply on this page only and aren’t saved yet.';

/**
 * Settings. Stays mounted while closed (just hidden), so preview choices
 * survive closing and reopening, like they did in the prototype.
 */
export function Settings() {
  const ui = useUi();
  const t = ui.motion;
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const titleRef = useRef<HTMLHeadingElement>(null);
  const [current, setCurrent] = useState(INDEX[0][0]);
  const [note, setNote] = useState({ text: NOTE, flash: false });
  const noteTimer = useRef(0);

  function preview(text: string) {
    setNote({ text, flash: true });
    window.clearTimeout(noteTimer.current);
    noteTimer.current = window.setTimeout(() => setNote({ text: NOTE, flash: false }), 4000);
  }

  // Slide in each time it opens.
  useEffect(() => {
    if (!ui.settingsOpen || !scope.current) return;
    scope.current.closest('.op-main')?.scrollTo({ top: 0 });
    titleRef.current?.focus({ preventScroll: true });
    animate(
      scope.current,
      { opacity: [0, 1], x: [t.dist, 0], filter: [`blur(${t.blur}px)`, 'blur(0px)'] },
      { duration: t.slow, ease: t.easeOut },
    );
  }, [ui.settingsOpen]); // only when it opens

  // Escape closes Settings, unless you are typing.
  useEffect(() => {
    if (!ui.settingsOpen) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName ?? '';
      if (e.key === 'Escape' && !['INPUT', 'SELECT', 'TEXTAREA'].includes(tag)) {
        e.stopPropagation();
        ui.setSettingsOpen(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ui.settingsOpen, ui]);

  // The index follows the scroll.
  useEffect(() => {
    const root = scope.current?.closest('.op-main');
    if (!ui.settingsOpen || !root || !('IntersectionObserver' in window)) return;
    const spy = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) setCurrent(en.target.id); }),
      { root, rootMargin: '0px 0px -75% 0px' },
    );
    scope.current?.querySelectorAll('.op-set-sec').forEach((s) => spy.observe(s));
    return () => spy.disconnect();
  }, [ui.settingsOpen, scope]);

  return (
    <PreviewContext.Provider value={preview}>
      <div ref={scope} className="op-settings" id="op-settings" role="region" aria-labelledby="set-title" hidden={!ui.settingsOpen}>
        <div className="op-set-head">
          <button type="button" className="op-back" aria-label="Close settings" onClick={() => ui.setSettingsOpen(false)}>
            <span />
          </button>
          <h1 className="op-set-title" id="set-title" ref={titleRef} tabIndex={-1}>Settings</h1>
        </div>
        <p className="op-set-note" data-flash={note.flash} aria-live="polite">{note.text}</p>
        <div className="op-set-layout">
          <nav className="op-set-index" aria-label="Settings sections">
            {INDEX.map(([id, label]) => (
              <button
                key={id}
                type="button"
                className="op-set-link"
                aria-current={current === id}
                onClick={() => {
                  setCurrent(id);
                  document.getElementById(id)?.scrollIntoView({ behavior: t.reduced ? 'auto' : 'smooth', block: 'start' });
                }}
              >
                {label}
              </button>
            ))}
          </nav>
          <div className="op-set-body">
            <ProfileSettings />
            <WorkspaceSettings />
            <AgentSettings />
            <ApprovalSettings />
            <ToolServerSettings />
            <SyncSettings />
            <RepositorySettings />
            <SlackSettings />
            <NotificationSettings />
            <AppearanceSettings />
            <DataSettings />
          </div>
        </div>
      </div>
    </PreviewContext.Provider>
  );
}
