// The phone's state: which workspace is open, its thread with the Opsaip agent, the
// queue of decisions it hands you one at a time, and the composer. Preview only —
// lives in memory, nothing is sent anywhere.

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { router } from 'expo-router';
import type { Attachment, Bucket, Decision, ItemState, MobileWorkspace, Mode, Recipient, ThreadItem } from '../data/types';
import { BUCKETS, isDecision } from '../data/types';
import { DEFAULT_WORKSPACE, workspaces } from '../mocks/workspaces';
import { liveEvents, seedThread } from '../mocks/threads';
import { afterAnswer, plan, type Beat } from '../lib/agent';
import { NEEDS_PICK, defaultRecipient } from '../lib/compose';
import { haptic } from '../lib/haptics';
import { BRANCHES, END, ENOUGH, FREE, HELLO, LOOK_AROUND, NEXT, SKIP, TOUR_MESSAGE, branchByLabel, embedded, nextOptions, startsTour, type BranchId } from '../lib/tour';
import { useSettings, type Snooze } from './settings';

const WRITE_FIRST = 1100; // "writing your brief…" before the first item
const WRITE_STEP = 520;   // then one line after another, like someone typing them out
const THINK = 1000;       // the agent's pause before a reply

/** The decision queue of one workspace. */
export interface Queue {
  open: string | null;   // the one expanded decision
  asking: string | null; // "Remind you at…?" is showing for this one
  stage: Bucket;         // how far down Now → Today → Can wait you have gone
  paused: boolean;       // you said "Later" to going on
}

const QUEUE: Queue = { open: null, asking: null, stage: 'now', paused: false };

/** The composer: a mode, who it goes to, and what is attached. */
export interface Composer {
  mode: Mode;
  to: Recipient | null;
  attachments: Attachment[];
}

const COMPOSER: Composer = { mode: 'agent', to: { kind: 'opsaip' }, attachments: [] };

/** The landing page's guided tour: which branches you have seen, the hint on the screen it took
 *  you to, and what it waits for before it goes on. */
export interface Tour {
  seen: BranchId[];
  tip: string | null;
  waiting: { kind: 'decision' | 'run'; branch: BranchId } | null;
}

const TOUR: Tour = { seen: [], tip: null, waiting: null };
let guides = 0; // ids for the tour's lines

/** A reminder, wherever it lives. */
export interface Reminder {
  wsId: string;
  item: Decision;
  at: number;
}

interface State {
  wsId: string;
  threads: Record<string, ThreadItem[]>;
  /** How many items of each thread the agent has written so far. */
  shown: Record<string, number>;
  queues: Record<string, Queue>;
  left: string[];         // workspaces you left in this session
  composer: Composer;
  signedOut: boolean;
  typing: string | null;  // workspace the agent is writing in
  draft: string;
  focusTick: number;      // bumps when something asks the composer to focus
  cueTick: number;        // bumps when the agent speaks up; the baton reacts
  unread: Record<string, number>;
  tour: Tour;
}

type Action =
  | { type: 'switch'; id: string }
  | { type: 'show'; id: string; n: number }
  | { type: 'append'; id: string; items: ThreadItem[]; cue?: boolean }
  | { type: 'patch'; id: string; itemId: string; patch: Partial<ThreadItem> }
  | { type: 'resolve'; id: string; itemId: string; patch: Partial<ThreadItem> }
  | { type: 'queue'; id: string; q: Partial<Queue> }
  | { type: 'leave'; id: string }
  | { type: 'composer'; c: Partial<Composer> }
  | { type: 'beat'; id: string; itemId: string; beat: Beat }
  | { type: 'session'; out: boolean; wsId?: string }
  | { type: 'typing'; id: string | null }
  | { type: 'draft'; text: string }
  | { type: 'focus'; text?: string }
  | { type: 'tour'; t: Partial<Tour> };

const rank = (b: Bucket) => BUCKETS.indexOf(b);

/** Decisions in the order the queue shows them: Now, then Today, then Can wait. */
export function sorted(items: ThreadItem[]): Decision[] {
  return items.filter(isDecision).sort((a, b) => rank(a.bucket) - rank(b.bucket));
}

/** The queue shows the stages you have reached. */
export const inStage = (d: Decision, stage: Bucket) => rank(d.bucket) <= rank(stage);

/** After a decision, the next one still waiting: further down first, then from the top. */
function nextOpen(items: ThreadItem[], stage: Bucket, after: string | null): string | null {
  const list = sorted(items).filter((d) => inStage(d, stage));
  const i = after ? list.findIndex((d) => d.id === after) : -1;
  const waiting = (d: Decision) => d.state === 'pending';
  return (list.slice(i + 1).find(waiting) ?? list.find(waiting))?.id ?? null;
}

/** Whether you have opened the queue: answered the agent's first question with anything but "Later". */
function started(items: ThreadItem[]): boolean {
  const ask = items.find((i) => i.kind === 'ask');
  return !!ask && ask.kind === 'ask' && !!ask.answer && ask.answer !== 'Later';
}

function reducer(s: State, a: Action): State {
  const patchIn = (list: ThreadItem[], itemId: string, patch: Partial<ThreadItem>) =>
    list.map((it) => (it.id === itemId ? ({ ...it, ...patch } as ThreadItem) : it));
  const queue = (id: string) => s.queues[id] ?? QUEUE;

  switch (a.type) {
    case 'switch':
      return { ...s, wsId: a.id, unread: { ...s.unread, [a.id]: 0 }, composer: COMPOSER };
    case 'show':
      return { ...s, shown: { ...s.shown, [a.id]: a.n } };
    case 'append': {
      const list = [...(s.threads[a.id] ?? []), ...a.items];
      // a decision arriving while nothing is open becomes the open one
      const q = queue(a.id);
      const fresh = a.items.find(isDecision);
      const open = !q.open && !q.asking && fresh && started(list) ? fresh.id : q.open;
      return {
        ...s,
        threads: { ...s.threads, [a.id]: list },
        shown: { ...s.shown, [a.id]: list.length },
        queues: { ...s.queues, [a.id]: { ...q, open } },
        cueTick: a.cue ? s.cueTick + 1 : s.cueTick,
        unread: a.id === s.wsId ? s.unread : { ...s.unread, [a.id]: (s.unread[a.id] ?? 0) + 1 },
      };
    }
    case 'patch':
      return { ...s, threads: { ...s.threads, [a.id]: patchIn(s.threads[a.id] ?? [], a.itemId, a.patch) } };
    case 'resolve': {
      const list = patchIn(s.threads[a.id] ?? [], a.itemId, a.patch);
      const q = queue(a.id);
      const open = q.open === a.itemId || !q.open ? nextOpen(list, q.stage, a.itemId) : q.open;
      return { ...s, threads: { ...s.threads, [a.id]: list }, queues: { ...s.queues, [a.id]: { ...q, open, asking: null } } };
    }
    case 'queue':
      return { ...s, queues: { ...s.queues, [a.id]: { ...queue(a.id), ...a.q } } };
    case 'leave': {
      const fallback = workspaces.find((w) => w.kind === 'personal')?.id ?? DEFAULT_WORKSPACE;
      return { ...s, left: [...s.left, a.id], wsId: s.wsId === a.id ? fallback : s.wsId, composer: s.wsId === a.id ? COMPOSER : s.composer };
    }
    case 'composer':
      return { ...s, composer: { ...s.composer, ...a.c } };
    case 'beat': {
      const list = (s.threads[a.id] ?? []).map((it) =>
        it.id === a.itemId && it.kind === 'run'
          ? { ...it, ...a.beat.patch, steps: a.beat.step ? [...it.steps, { at: Date.now(), text: a.beat.step }] : it.steps }
          : it,
      );
      return { ...s, threads: { ...s.threads, [a.id]: list } };
    }
    case 'session':
      return a.out ? { ...s, signedOut: true } : { ...init(), wsId: a.wsId ?? DEFAULT_WORKSPACE };
    case 'typing':
      return { ...s, typing: a.id };
    case 'draft':
      return { ...s, draft: a.text };
    case 'focus':
      return { ...s, draft: a.text ?? s.draft, focusTick: s.focusTick + 1 };
    case 'tour':
      return { ...s, tour: { ...s.tour, ...a.t } };
  }
}

function init(): State {
  const threads = Object.fromEntries(workspaces.map((w) => [w.id, seedThread(w.id)]));
  return {
    wsId: DEFAULT_WORKSPACE,
    threads,
    shown: Object.fromEntries(workspaces.map((w) => [w.id, 0])),
    queues: {},
    left: [],
    composer: COMPOSER,
    signedOut: false,
    typing: null,
    // on the landing page, the composer opens with the tour's first message typed in
    draft: embedded() ? TOUR_MESSAGE : '',
    focusTick: 0,
    cueTick: 0,
    unread: {},
    tour: TOUR,
  };
}

/** Lines the agent writes into the thread; decisions live in the queue instead. */
export const inStream = (item: ThreadItem) => !isDecision(item);

interface Store {
  state: State;
  ws: MobileWorkspace;
  /** Workspaces you are still in. */
  spaces: MobileWorkspace[];
  thread: ThreadItem[];       // what the agent has written so far
  decisions: Decision[];      // every decision in this workspace, queue order
  queue: Queue;
  started: boolean;           // you opened the queue
  writing: boolean;           // still writing the brief
  decisionsOf: (wsId: string) => Decision[];
  /** Decisions waiting in Now: the badge and the switcher count. */
  nowCount: (wsId: string) => number;
  switchTo: (id: string) => void;
  leave: (id: string) => void;
  /** The agent's own question, answered with a quick reply. */
  reply: (itemId: string, option: string) => void;
  /** Open a stage from the brief, or the next one from the queue's "Keep going". */
  goTo: (bucket: Bucket) => void;
  pause: () => void;
  openItem: (itemId: string) => void;
  decide: (itemId: string, state: ItemState | 'flagged') => void;
  answer: (itemId: string, option: string) => void;
  /** "Not now": the agent asks when to remind you. */
  notNow: (itemId: string) => void;
  remind: (itemId: string, snooze: Snooze | 'drop') => void;
  keepAsking: () => void;
  /** Take a decision back, while "Undo" shows. */
  undo: (itemId: string) => void;
  /** Every reminder in every workspace, soonest first. */
  reminders: Reminder[];
  snoozeReminder: (wsId: string, itemId: string, at: number) => void;
  deleteReminder: (wsId: string, itemId: string) => void;
  setMode: (mode: Mode) => void;
  setRecipient: (to: Recipient) => void;
  attach: (a: Omit<Attachment, 'id'>) => void;
  detach: (id: string) => void;
  /** Answer a run's question back to you. */
  answerRun: (itemId: string, option: string) => void;
  signOut: () => void;
  signIn: () => void;
  send: (text: string) => void;
  setDraft: (text: string) => void;
  focusComposer: (text?: string) => void;
  /** A quick reply to one of the tour's steps. */
  pickGuide: (itemId: string, option: string) => void;
  /** Leave the tour's hint and go back to the thread. */
  backToTour: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, init);
  const { settings } = useSettings();
  const prefs = useRef(settings);
  useLayoutEffect(() => {
    prefs.current = settings;
  });
  const latest = useRef(state);
  useLayoutEffect(() => {
    latest.current = state;
  });
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const later = useCallback((ms: number, fn: () => void) => {
    timers.current.push(setTimeout(fn, ms));
  }, []);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  // ---- the agent writes first: its lines appear one after another, once per workspace ----
  const wsId = state.wsId;
  useEffect(() => {
    const items = latest.current.threads[wsId] ?? [];
    const from = latest.current.shown[wsId] ?? 0;
    if (from >= items.length) return;
    const ids: ReturnType<typeof setTimeout>[] = [];
    let delay = from === 0 ? WRITE_FIRST : 0;
    for (let n = from + 1; n <= items.length; n++) {
      ids.push(setTimeout(() => dispatch({ type: 'show', id: wsId, n }), delay));
      // decisions and the queue appear with the lines around them, not as lines of their own
      if (inStream(items[n - 1]) && items[n - 1].kind !== 'queue') delay += WRITE_STEP;
    }
    return () => ids.forEach(clearTimeout);
  }, [wsId]);

  // ---- live events: the agent speaks up on its own while the app is open ----
  useEffect(() => {
    for (const w of workspaces) {
      for (const [delay, items] of liveEvents(w.id)) {
        later(delay, () => {
          dispatch({ type: 'typing', id: w.id });
          later(THINK, () => {
            dispatch({ type: 'typing', id: null });
            // passive: the baton cues, the phone stays still
            dispatch({ type: 'append', id: w.id, items: items.map((it) => ({ ...it, at: Date.now() })), cue: true });
          });
        });
      }
    }
  }, [later]);

  /** The agent answers after a short pause, in the workspace it was asked in. */
  const say = useCallback(
    (id: string, items: ThreadItem[], then?: () => void) => {
      dispatch({ type: 'typing', id });
      later(THINK, () => {
        dispatch({ type: 'typing', id: null });
        dispatch({ type: 'append', id, items, cue: true });
        then?.();
      });
    },
    [later],
  );

  const spaces = useMemo(() => workspaces.filter((w) => !state.left.includes(w.id)), [state.left]);
  const ws = spaces.find((w) => w.id === state.wsId) ?? spaces[0];
  const all = useMemo(() => state.threads[ws.id] ?? [], [state.threads, ws.id]);
  const shown = state.shown[ws.id] ?? 0;

  const reminders = useMemo(
    () =>
      spaces
        .flatMap((w) => sorted(state.threads[w.id] ?? []).filter((d) => d.state === 'later' && d.remindAt).map((d) => ({ wsId: w.id, item: d, at: d.remindAt! })))
        .sort((a, b) => a.at - b.at),
    [spaces, state.threads],
  );

  const store = useMemo<Store>(() => {
    const cur = () => latest.current.wsId;
    const items = (id = cur()) => latest.current.threads[id] ?? [];
    const find = (itemId: string) => items().find((i) => i.id === itemId);
    const q = (id = cur()) => latest.current.queues[id] ?? QUEUE;
    const decisionsOf = (id: string) => sorted(latest.current.threads[id] ?? []);
    const firstIn = (id: string, bucket: Bucket) => decisionsOf(id).find((d) => d.bucket === bucket && d.state === 'pending')?.id ?? null;

    const goTo = (bucket: Bucket) => {
      const id = cur();
      const ask = items(id).find((i) => i.kind === 'ask');
      if (ask?.kind === 'ask' && (!ask.answer || ask.answer === 'Later')) {
        dispatch({ type: 'patch', id, itemId: ask.id, patch: { answer: ask.options[0] } });
      }
      const stage = rank(bucket) > rank(q(id).stage) ? bucket : q(id).stage;
      dispatch({ type: 'queue', id, q: { stage, open: firstIn(id, bucket), asking: null, paused: false } });
    };

    // ---- the guided tour ----
    const guide = (text: string, options: string[]): ThreadItem => ({ kind: 'guide', id: `g-${Date.now().toString(36)}-${(guides++).toString(36)}`, at: Date.now(), text, options });
    const line = (text: string): ThreadItem => ({ kind: 'agent', id: `t-${Date.now().toString(36)}-${(guides++).toString(36)}`, at: Date.now(), text });
    /** After a branch: what it showed, then where next — or the end, once every branch is seen. */
    const goOn = (branch: BranchId) => {
      const t = latest.current.tour;
      if (t.waiting && t.waiting.branch !== branch) return;
      dispatch({ type: 'tour', t: { waiting: null } });
      const b = BRANCHES.find((x) => x.id === branch);
      const left = nextOptions(t.seen);
      const said = b ? `${b.after} ` : '';
      say(cur(), [left.length > 1 ? guide(`${said}${NEXT[t.seen.length % NEXT.length]}`, left) : line(`${said}${END}`)]);
    };
    /** Something the tour was waiting for happened. */
    const waited = (kind: 'decision' | 'run') => {
      const w = latest.current.tour.waiting;
      if (w?.kind === kind) later(900, () => goOn(w.branch));
    };

    return {
      state,
      ws,
      spaces,
      thread: all.slice(0, shown),
      decisions: sorted(all),
      queue: state.queues[ws.id] ?? QUEUE,
      started: started(all),
      writing: shown === 0 && all.length > 0,
      decisionsOf,
      nowCount: (id) => decisionsOf(id).filter((d) => d.bucket === 'now' && d.state === 'pending').length,

      switchTo: (id) => {
        if (id === cur()) return;
        haptic.select();
        dispatch({ type: 'switch', id });
      },

      leave: (id) => {
        haptic.select();
        dispatch({ type: 'leave', id });
      },

      reply: (itemId, option) => {
        const id = cur();
        const ask = find(itemId);
        if (ask?.kind !== 'ask' || ask.answer) return;
        haptic.select();
        dispatch({ type: 'patch', id, itemId, patch: { answer: option } });
        if (option === 'Later') return;
        // "Start" / "Show me" opens the first decision; "Show the list" leaves them all as rows
        const first = decisionsOf(id).find((d) => d.state === 'pending');
        if (!first) return;
        const open = option === ask.options[0] ? first.id : null;
        dispatch({ type: 'queue', id, q: { open, stage: rank(first.bucket) > rank(q(id).stage) ? first.bucket : q(id).stage } });
      },

      goTo,
      pause: () => {
        haptic.select();
        dispatch({ type: 'queue', id: cur(), q: { paused: true } });
      },

      openItem: (itemId) => {
        const d = find(itemId);
        if (!d || !isDecision(d)) return;
        haptic.select();
        // opening one from elsewhere (a reminder) also opens the queue
        const ask = items().find((i) => i.kind === 'ask');
        if (ask?.kind === 'ask' && (!ask.answer || ask.answer === 'Later')) dispatch({ type: 'patch', id: cur(), itemId: ask.id, patch: { answer: ask.options[0] } });
        const stage = rank(d.bucket) > rank(q().stage) ? d.bucket : q().stage;
        dispatch({ type: 'queue', id: cur(), q: { open: itemId, asking: null, stage } });
      },

      decide: (itemId, next) => {
        dispatch({ type: 'resolve', id: cur(), itemId, patch: { state: next, decidedAt: Date.now() } as Partial<ThreadItem> });
        waited('decision');
      },

      answer: (itemId, option) => {
        const item = find(itemId);
        if (item?.kind !== 'question') return;
        haptic.select();
        dispatch({ type: 'resolve', id: cur(), itemId, patch: { answer: option, state: 'approved', decidedAt: Date.now() } as Partial<ThreadItem> });
        waited('decision');
      },

      notNow: (itemId) => {
        haptic.select();
        dispatch({ type: 'queue', id: cur(), q: { open: itemId, asking: itemId } });
      },

      remind: (itemId, snooze) => {
        haptic.success();
        const patch = snooze === 'drop' ? { state: 'dropped' } : { state: 'later', remindAt: snooze.at() };
        dispatch({ type: 'resolve', id: cur(), itemId, patch: patch as Partial<ThreadItem> });
        waited('decision');
      },

      keepAsking: () => dispatch({ type: 'queue', id: cur(), q: { asking: null } }),

      undo: (itemId) => {
        haptic.select();
        const id = cur();
        dispatch({ type: 'patch', id, itemId, patch: { state: 'pending', decidedAt: undefined, remindAt: undefined, answer: undefined } as Partial<ThreadItem> });
        dispatch({ type: 'queue', id, q: { open: itemId, asking: null } });
      },

      reminders,
      snoozeReminder: (id, itemId, at) => {
        haptic.success();
        dispatch({ type: 'patch', id, itemId, patch: { remindAt: at } as Partial<ThreadItem> });
      },
      deleteReminder: (id, itemId) => {
        haptic.select();
        dispatch({ type: 'patch', id, itemId, patch: { state: 'dropped', remindAt: undefined } as Partial<ThreadItem> });
      },

      setMode: (mode) => {
        haptic.select();
        const w = workspaces.find((x) => x.id === cur()) ?? workspaces[0];
        dispatch({ type: 'composer', c: { mode, to: NEEDS_PICK.includes(mode) ? null : defaultRecipient(mode, w, prefs.current.defaultAgent.agent) } });
      },
      setRecipient: (to) => {
        haptic.select();
        dispatch({ type: 'composer', c: { to } });
      },
      attach: (a) => {
        haptic.light();
        dispatch({ type: 'composer', c: { attachments: [...latest.current.composer.attachments, { ...a, id: `${a.kind}-${Date.now().toString(36)}` }] } });
      },
      detach: (attId) => {
        haptic.light();
        dispatch({ type: 'composer', c: { attachments: latest.current.composer.attachments.filter((x) => x.id !== attId) } });
      },

      send: (text) => {
        const t = text.trim();
        if (!t) return;
        const id = cur();
        const w = workspaces.find((x) => x.id === id) ?? workspaces[0];
        const c = latest.current.composer;
        haptic.send();
        dispatch({
          type: 'append',
          id,
          items: [{ kind: 'user', id: `u-${Date.now().toString(36)}`, at: Date.now(), text: t, mode: c.mode, to: c.to ? recipientTag(c.mode, c.to, w) : undefined, attachments: c.attachments }],
        });
        dispatch({ type: 'draft', text: '' });
        dispatch({ type: 'composer', c: { attachments: [] } });
        if (embedded() && startsTour(t)) {
          dispatch({ type: 'tour', t: { ...TOUR } });
          say(id, [guide(HELLO, [...BRANCHES.map((b) => b.label), LOOK_AROUND])]);
          return;
        }
        const p = plan(t, c.mode, c.to, w, sorted(items(id)), c.attachments);
        say(id, p.items, () => {
          const runId = p.runId;
          if (!runId) return;
          for (const beat of p.beats) later(beat.ms, () => dispatch({ type: 'beat', id, itemId: runId, beat }));
          // the tour's "hand off a task" goes on once the run is done
          const w = latest.current.tour.waiting;
          if (w?.kind === 'run') later(Math.max(0, ...p.beats.map((b) => b.ms)) + 600, () => waited('run'));
        });
      },

      answerRun: (itemId, option) => {
        const id = cur();
        const r = find(itemId);
        if (r?.kind !== 'run' || !r.question || r.question.answer) return;
        haptic.select();
        dispatch({ type: 'beat', id, itemId, beat: { ms: 0, patch: { question: { ...r.question, answer: option } } } });
        for (const beat of afterAnswer(option)) later(beat.ms, () => dispatch({ type: 'beat', id, itemId, beat }));
      },

      signOut: () => dispatch({ type: 'session', out: true }),
      signIn: () => {
        haptic.success();
        dispatch({ type: 'session', out: false, wsId: prefs.current.defaultWorkspace });
      },

      setDraft: (text) => dispatch({ type: 'draft', text }),
      focusComposer: (text) => dispatch({ type: 'focus', text }),

      pickGuide: (itemId, option) => {
        const id = cur();
        const g = find(itemId);
        if (g?.kind !== 'guide' || g.answer) return;
        haptic.select();
        dispatch({ type: 'patch', id, itemId, patch: { answer: option } as Partial<ThreadItem> });
        if (option === LOOK_AROUND) return say(id, [line(FREE)]);
        if (option === ENOUGH) return say(id, [line(END)]);
        if (option === SKIP) {
          const w = latest.current.tour.waiting;
          if (w) goOn(w.branch);
          return;
        }
        const b = branchByLabel(option);
        if (!b) return;
        const seen = [...latest.current.tour.seen, b.id];
        dispatch({ type: 'tour', t: { seen, waiting: b.wait === 'none' ? null : { kind: b.wait, branch: b.id } } });
        say(id, [guide(b.say, b.wait === 'none' ? [] : [SKIP])], () => {
          if (b.id === 'needs') goTo('now');
          if (b.draft) dispatch({ type: 'focus', text: b.draft });
          if (b.go) {
            const go = b.go;
            // the next step is waiting in the thread when you come back
            later(700, () => {
              dispatch({ type: 'tour', t: { tip: b.tip ?? null } });
              router.navigate(go as never);
              later(600, () => goOn(b.id));
            });
          }
        });
      },
      backToTour: () => {
        dispatch({ type: 'tour', t: { tip: null } });
        router.navigate('/' as never);
      },
    };
  }, [state, ws, spaces, all, shown, say, later, reminders]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('useStore outside StoreProvider');
  return s;
}

/** Agents working right now in the open workspace — what the baton conducts. */
export function useRunning() {
  const { ws, state } = useStore();
  const runs = (state.threads[ws.id] ?? []).filter((i) => i.kind === 'run' && i.state === 'working').length;
  return ws.agents.filter((a) => a.state === 'running').length + runs;
}

/** "Codex", "#fjord-pilot", "Mira" — how a sent message is labelled in the thread. */
function recipientTag(mode: Mode, to: Recipient, ws: MobileWorkspace): string {
  switch (to.kind) {
    case 'opsaip': return 'Opsaip';
    case 'person': return ws.members.find((p) => p.id === to.id)?.name.split(' ')[0] ?? 'Teammate';
    case 'channel': return to.name;
    case 'agent': return ws.agents.find((a) => a.id === to.id)?.name ?? workspaces.flatMap((w) => w.agents).find((a) => a.id === to.id)?.name ?? 'Agent';
    case 'workspace': return mode === 'announce' ? `Everyone in ${ws.name}` : ws.name;
  }
}
