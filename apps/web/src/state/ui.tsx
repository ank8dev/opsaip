// Interface state: what is open, theme and motion, and the few settings that
// change the rest of the page right away. Everything else in Settings is a
// preview kept inside the Settings components.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { ToolName } from '../types';
import type { TrayLevel } from '../data/selectors';
import { readMotionTokens, type MotionTokens } from '../styles/motion';

export type Section = 'agents' | 'team' | 'mcp' | 'repo';
export type ThemeChoice = 'system' | 'light' | 'dark';
export type MotionChoice = 'system' | 'reduce';

interface UiValue {
  theme: 'light' | 'dark';
  themeChoice: ThemeChoice;
  setThemeChoice: (t: ThemeChoice) => void;
  toggleTheme: () => void;
  motionChoice: MotionChoice;
  setMotionChoice: (m: MotionChoice) => void;
  motion: MotionTokens;

  userName: string;
  setUserName: (n: string) => void;
  statusOwner: ToolName;
  setStatusOwner: (t: ToolName) => void;
  trayLevel: TrayLevel;
  setTrayLevel: (l: TrayLevel) => void;

  section: Section | null;
  setSection: (s: Section | null) => void;
  query: string;
  setQuery: (q: string) => void;

  trayOpen: boolean;
  setTrayOpen: (open: boolean) => void;
  openTaskId: string | null;
  openTask: (id: string) => void;
  closeTask: () => void;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;

  hint: { text: string; flash: boolean };
  flashHint: (text: string) => void;
}

const UiContext = createContext<UiValue | null>(null);
const THEME_KEY = 'opsaip.theme';

function storedTheme(): ThemeChoice {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [themeChoice, setThemeChoiceState] = useState<ThemeChoice>(storedTheme);
  const [motionChoice, setMotionChoice] = useState<MotionChoice>('system');
  const systemLight = useMediaQuery('(prefers-color-scheme: light)');
  const systemReduce = useMediaQuery('(prefers-reduced-motion: reduce)');
  const theme = themeChoice === 'system' ? (systemLight ? 'light' : 'dark') : themeChoice;

  // Theme and motion live on <html>, so tokens.css applies them everywhere,
  // including menus rendered outside the app shell.
  const [motion, setMotion] = useState<MotionTokens>(readMotionTokens);
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = theme;
    if (motionChoice === 'reduce') root.dataset.motion = 'reduce';
    else delete root.dataset.motion;
    setMotion(readMotionTokens());
  }, [theme, motionChoice, systemReduce]);

  const setThemeChoice = useCallback((t: ThemeChoice) => {
    setThemeChoiceState(t);
    try {
      if (t === 'system') localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, t);
    } catch { /* private mode: the choice just isn't remembered */ }
  }, []);

  const [userName, setUserName] = useState('You');
  const [statusOwner, setStatusOwner] = useState<ToolName>('GitHub');
  const [trayLevel, setTrayLevel] = useState<TrayLevel>('high');
  const [section, setSection] = useState<Section | null>(null);
  const [query, setQuery] = useState('');
  const [trayOpen, setTrayOpen] = useState(false);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const openTask = useCallback((id: string) => {
    setSettingsOpen(false);
    setOpenTaskId(id);
  }, []);
  const closeTask = useCallback(() => setOpenTaskId(null), []);

  const [hint, setHint] = useState({ text: '', flash: false });
  const hintTimer = useRef(0);
  const flashHint = useCallback((text: string) => {
    setHint({ text, flash: true });
    window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint({ text: '', flash: false }), 5000);
  }, []);

  const value = useMemo<UiValue>(
    () => ({
      theme, themeChoice, setThemeChoice,
      toggleTheme: () => setThemeChoice(theme === 'dark' ? 'light' : 'dark'),
      motionChoice, setMotionChoice, motion,
      userName, setUserName, statusOwner, setStatusOwner, trayLevel, setTrayLevel,
      section, setSection, query, setQuery,
      trayOpen, setTrayOpen, openTaskId, openTask, closeTask, settingsOpen, setSettingsOpen,
      hint, flashHint,
    }),
    [theme, themeChoice, setThemeChoice, motionChoice, motion, userName, statusOwner, trayLevel,
      section, query, trayOpen, openTaskId, openTask, closeTask, settingsOpen, hint, flashHint],
  );

  return <UiContext.Provider value={value}>{children}</UiContext.Provider>;
}

export function useUi(): UiValue {
  const v = useContext(UiContext);
  if (!v) throw new Error('useUi must be used inside <UiProvider>');
  return v;
}

/** The motion tokens, for components that animate with Motion. */
export const useMotionTokens = () => useUi().motion;
