// What you set on the phone: appearance, when the brief arrives, quiet hours, what
// may interrupt you and how "Not now" offers to remind you. Preview only — kept in
// memory like the rest of the app.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Mode } from '../data/types';
import { clock, nextAt } from '../lib/time';
import { setHaptics } from '../lib/haptics';

export type Appearance = 'system' | 'light' | 'dark';
export type Interrupt = 'approvals' | 'failures' | 'questions' | 'memory' | 'drift';
export type Presence = 'working' | 'away' | 'dnd';
/** Per workspace: everything that may interrupt, approvals only, or nothing. */
export type Override = 'all' | 'approvals' | 'muted';
export type Cadence = 'brief' | 'twice' | 'hourly';

export const PRESENCE: Record<Presence, string> = { working: 'Working', away: 'Away', dnd: 'Do not disturb' };

export interface Snooze {
  id: string;
  /** The settings row: "Later today". */
  label: string;
  /** The quick reply: "4:00 PM", "Tomorrow morning". */
  chip: () => string;
  /** In the agent's question: "Remind you at 4:00 PM, tomorrow morning, or drop it?" */
  phrase: () => string;
  at: (now?: number) => number;
}

function tomorrowMorning(now = Date.now()): number {
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

function nextMonday(now = Date.now()): number {
  const d = new Date(nextAt(9, 0, now));
  while (d.getDay() !== 1) d.setDate(d.getDate() + 1);
  return d.getTime();
}

export const SNOOZES: Snooze[] = [
  { id: 'afternoon', label: 'Later today', chip: () => clock(16), phrase: () => `at ${clock(16)}`, at: (now) => nextAt(16, 0, now) },
  { id: 'evening', label: 'This evening', chip: () => clock(18), phrase: () => `at ${clock(18)}`, at: (now) => nextAt(18, 0, now) },
  { id: 'morning', label: 'Tomorrow morning', chip: () => 'Tomorrow morning', phrase: () => 'tomorrow morning', at: tomorrowMorning },
  { id: 'monday', label: 'Next Monday', chip: () => 'Monday', phrase: () => 'on Monday', at: nextMonday },
];

export const BRIEF_TIMES = [7 * 60, 7 * 60 + 30, 8 * 60, 8 * 60 + 30, 9 * 60];

export interface Settings {
  profile: { name: string; initials: string; email: string; presence: Presence; hours: { start: number; end: number } };
  defaultWorkspace: string;
  appearance: Appearance;
  reduceMotion: boolean;
  haptics: boolean;
  briefAt: number;                     // minutes after midnight
  quiet: { on: boolean; from: number; to: number };
  interrupts: Record<Interrupt, boolean>;
  overrides: Record<string, Override>; // workspace id → override
  snoozes: string[];                   // Snooze ids offered after "Not now", in order
  defaultAgent: Record<Mode, string>;  // the agent each composer mode starts with
  elsewhere: { on: boolean; every: Cadence };
}

const DEFAULTS: Settings = {
  profile: { name: 'Robin Park', initials: 'RP', email: 'robin@tessera.dev', presence: 'working', hours: { start: 9, end: 18 } },
  defaultWorkspace: 'tessera',
  appearance: 'system',
  reduceMotion: false,
  haptics: true,
  briefAt: 8 * 60 + 30,
  quiet: { on: true, from: 22 * 60, to: 7 * 60 },
  interrupts: { approvals: true, failures: true, questions: true, memory: false, drift: true },
  overrides: { tessera: 'all', northwind: 'approvals', personal: 'all' },
  snoozes: ['afternoon', 'morning'],
  defaultAgent: { task: 'Their default', message: 'Claude', agent: 'Claude Code', announce: 'Claude' },
  elsewhere: { on: true, every: 'brief' },
};

interface Ctx {
  settings: Settings;
  set: <K extends keyof Settings>(key: K, value: Settings[K]) => void;
  /** The reminder choices "Not now" offers, in the order of SNOOZES. */
  snoozes: Snooze[];
}

const SettingsContext = createContext<Ctx | null>(null);

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(DEFAULTS);
  useEffect(() => setHaptics(settings.haptics), [settings.haptics]);
  const value = useMemo<Ctx>(
    () => ({
      settings,
      set: (key, v) => setSettings((s) => ({ ...s, [key]: v })),
      snoozes: SNOOZES.filter((s) => settings.snoozes.includes(s.id)),
    }),
    [settings],
  );
  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Ctx {
  const s = useContext(SettingsContext);
  if (!s) throw new Error('useSettings outside SettingsProvider');
  return s;
}
