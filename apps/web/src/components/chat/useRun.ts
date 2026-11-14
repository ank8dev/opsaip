import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentTaskStatus } from '@opsaip/core';
import { clearActiveRun, loadActiveRun, saveActiveRun } from '../../data/chat/activeRun';
import { loadRunTasks, rememberRunTask, saveRunTasks } from '../../data/chat/runTasks';
import { conductorStateFrom, isRunActive, runTitleFrom, type ConductorState, type Run } from '../../data/chat/conductor';
import { problemReply } from '../../data/chat/problems';
import { permissionAnswered, permissionCardWidget, reconcilePermission, runCardWidget } from '../../data/chat/runWidget';
import type { ServerApi } from '../../data/chat/serverApi';
import type { Widget } from '../../data/chat/types';
import { useUi } from '../../state/ui';
import type { Requests } from './useRequests';

/** How often the active run is asked for while the page is visible. */
export const RUN_POLL_MS = 2000;
/** One poll gives up after this long; the next one is scheduled as usual. */
const POLL_TIMEOUT_MS = 10_000;

interface Deps {
  live: boolean;
  api: ServerApi;
  request: Requests['request'];
  /** Add your message to the thread. */
  say: (text: string) => void;
  /** Add an Opsy message; returns its id. `pending` is the "waiting" placeholder. */
  push: (widget: Widget, pending?: boolean) => number;
  /** Replace the widget of an Opsy message. */
  patch: (id: number, change: (widget: Widget) => Widget) => void;
}

/** The run being followed. At most one: the server runs one at a time. */
interface Tracked {
  id: string;
  title: string;
  /** The run card's message, or null until the first answer arrives (a run found again after a reload). */
  msgId: number | null;
  /** Permission request id -> its card's message. */
  perms: Map<string, number>;
}

/**
 * Conductor mode in the chat: whether it is on, and the one run you follow.
 * Starting it, answering its permission requests, following up and Stop all
 * go through `api`; the run card and the permission cards are thread messages
 * that this hook updates as GET /v1/runs/:id answers (every 2 s while the run
 * is active, not while the page is hidden). Live mode only.
 */
export function useRun({ live, api, request, say, push, patch }: Deps) {
  const ui = useUi();
  const [conductor, setConductor] = useState<ConductorState>({ state: 'unknown' });
  const conductorRef = useRef(conductor);
  conductorRef.current = conductor;
  const [run, setRun] = useState<{ id: string; status: AgentTaskStatus } | null>(null);
  const track = useRef<Tracked | null>(null);
  const answering = useRef(new Set<string>());

  // Which run belongs to which task (the Chat tab needs it). A resumed run can get a new task.
  const [runTasks, setRunTasks] = useState(loadRunTasks);
  const remember = useCallback((taskId: string, runId: string) => {
    setRunTasks((prev) => {
      const next = rememberRunTask(prev, taskId, runId);
      if (next !== prev) saveRunTasks(next);
      return next;
    });
  }, []);

  // ---- Is Conductor mode on? ----

  const checkConductor = useCallback(async () => {
    setConductor({ state: 'checking' });
    const result = await request((signal) => api.conductor(signal), { quiet: true });
    if (result !== undefined) setConductor(conductorStateFrom(result));
  }, [api, request]);

  // Once when Live mode connects ...
  useEffect(() => {
    if (live) void checkConductor();
  }, [live, checkConductor]);

  // ... and when you switch to Agent mode and it is still not known.
  const refreshConductor = useCallback(() => {
    const s = conductorRef.current.state;
    if (live && (s === 'unknown' || s === 'failed')) void checkConductor();
  }, [live, checkConductor]);

  // ---- The run ----

  /** Put the run's latest state on screen: its card, and a card for a new permission request. */
  const applyRun = useCallback(
    (view: Run) => {
      const t = track.current;
      if (t === null || t.id !== view.id) return;
      remember(view.taskId, view.id);
      if (t.msgId === null) t.msgId = push(runCardWidget(t.title, view));
      // The first time this replaces the "Starting…" placeholder; after that it keeps the Stop state.
      else patch(t.msgId, (w) => runCardWidget(t.title, view, w.kind === 'run' && w.stopping));

      for (const msgId of t.perms.values()) {
        patch(msgId, (w) => (w.kind === 'permission' ? reconcilePermission(w, view) : w));
      }
      const card = permissionCardWidget(view);
      if (card !== null && isRunActive(view.status) && !t.perms.has(card.permissionId)) {
        t.perms.set(card.permissionId, push(card));
      }

      if (isRunActive(view.status)) {
        setRun((prev) => (prev?.id === view.id && prev.status === view.status ? prev : { id: view.id, status: view.status }));
      } else {
        clearActiveRun();
        track.current = null;
        setRun(null);
      }
    },
    [push, patch, remember],
  );

  /** The run is gone (404, or Conductor mode was turned off): stop following it. */
  const forget = useCallback(
    (problem: 'not-found' | 'conductor-off') => {
      const t = track.current;
      clearActiveRun();
      track.current = null;
      setRun(null);
      if (t === null || t.msgId === null) return; // never shown: nothing to explain
      for (const msgId of t.perms.values()) {
        patch(msgId, (w) => (w.kind === 'permission' && w.state === 'pending' ? { ...w, state: 'stale', busy: false } : w));
      }
      push(problemReply(problem));
    },
    [push, patch],
  );

  // A reload: bring back the run remembered for this tab. Its card appears with the first answer.
  useEffect(() => {
    if (!live || track.current !== null) return;
    const saved = loadActiveRun();
    if (saved === null) return;
    track.current = { id: saved.id, title: saved.title, msgId: null, perms: new Map() };
    setRun({ id: saved.id, status: 'running' });
  }, [live]);

  // Poll the run every 2 s while it is active. Not while the page is hidden; it resumes when visible.
  const runId = run?.id;
  useEffect(() => {
    if (!live || runId === undefined) return;
    let stopped = false;
    let inFlight: AbortController | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick(): Promise<void> {
      timer = undefined;
      if (stopped || runId === undefined) return;
      const c = new AbortController();
      inFlight = c;
      const timeout = setTimeout(() => c.abort(), POLL_TIMEOUT_MS);
      const result = await api.getRun(runId, c.signal);
      clearTimeout(timeout);
      inFlight = null;
      if (stopped) return;

      if (result.ok) applyRun(result.value);
      else if (result.problem === 'not-found' || result.problem === 'conductor-off') return forget(result.problem);
      else if (result.problem === 'unauthorized') return; // a wrong token stays wrong
      // Anything else is a hiccup: keep the card as it is and ask again.
      if (!stopped && !document.hidden) timer = setTimeout(() => void tick(), RUN_POLL_MS);
    }
    const onVisibility = () => {
      if (!document.hidden && inFlight === null && timer === undefined) void tick();
    };

    // A run just started has its first state already: ask again in 2 s. One found after a reload: ask now.
    if (track.current?.msgId === null) void tick();
    else timer = setTimeout(() => void tick(), RUN_POLL_MS);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== undefined) clearTimeout(timer);
      inFlight?.abort();
    };
  }, [live, api, runId, applyRun, forget]);

  // ---- What you can do ----

  /** Agent mode, no run active: start one. Resolves true if it started. */
  const startRun = useCallback(
    async (text: string, attachments: readonly string[] = []): Promise<boolean> => {
      if (track.current !== null) return false;
      ui.closeTask(); // the thread is hidden while a task is open
      say(text);
      const waiting = push({ kind: 'text', text: 'Starting Claude Code…' }, true);
      const result = await request((signal) => api.startRun(text, signal, attachments));
      if (result === undefined) return false;
      if (!result.ok) {
        patch(waiting, () => problemReply(result.problem, result.reason));
        return false;
      }
      const title = runTitleFrom(text);
      track.current = { id: result.value.id, title, msgId: waiting, perms: new Map() };
      saveActiveRun({ id: result.value.id, title });
      applyRun(result.value); // the "waiting" message becomes the run card
      return true;
    },
    [ui, say, push, patch, request, api, applyRun],
  );

  /**
   * A Proposed action card was approved: start a run with exactly this title and
   * prompt (nothing from your typing is involved). Resolves true if it started;
   * on failure Opsy says why in a message and the card is marked failed.
   */
  const startRunExact = useCallback(
    async (title: string, prompt: string): Promise<boolean> => {
      if (track.current !== null) {
        push(problemReply('busy'));
        return false;
      }
      ui.closeTask();
      const waiting = push({ kind: 'text', text: 'Starting Claude Code…' }, true);
      const result = await request((signal) => api.startRunExact({ title, prompt }, signal));
      if (result === undefined) return false;
      if (!result.ok) {
        patch(waiting, () => problemReply(result.problem, result.reason));
        return false;
      }
      track.current = { id: result.value.id, title, msgId: waiting, perms: new Map() };
      saveActiveRun({ id: result.value.id, title });
      applyRun(result.value); // the "waiting" message becomes the run card
      return true;
    },
    [ui, push, patch, request, api, applyRun],
  );

  /**
   * A message to a run from its Chat tab: a follow-up while it is active, or, when it has
   * finished and can be resumed, a new turn in the same session. A resumed run is followed
   * from then on (its card comes back). Resolves with the server's answer, or undefined if
   * the request was abandoned.
   */
  const sendToRun = useCallback(
    async (runId: string, title: string, text: string, attachments: readonly string[] = []) => {
      const result = await request((signal) => api.followUp(runId, text, signal, attachments), { quiet: true });
      if (result?.ok) {
        remember(result.value.taskId, runId);
        if (track.current === null && isRunActive(result.value.status)) {
          track.current = { id: runId, title, msgId: null, perms: new Map() };
          saveActiveRun({ id: runId, title });
          setRun({ id: runId, status: result.value.status });
        }
      }
      return result;
    },
    [request, api, remember],
  );

  /** The run that belongs to a task started or continued from this page, if known. */
  const runIdForTask = useCallback((taskId: string): string | undefined => runTasks[taskId], [runTasks]);

  /** Is a run being followed on this page? */
  const runActiveNow = useCallback(() => track.current !== null, []);

  /** Agent mode while a run is active: your text goes to the agent. Resolves true if it was sent. */
  const followUp = useCallback(
    async (text: string, attachments: readonly string[] = []): Promise<boolean> => {
      const t = track.current;
      if (t === null) return false;
      ui.closeTask();
      say(text);
      const result = await request((signal) => api.followUp(t.id, text, signal, attachments));
      if (result === undefined) return false;
      if (!result.ok) {
        push(problemReply(result.problem, result.reason));
        return false;
      }
      applyRun(result.value);
      return true;
    },
    [ui, say, push, request, api, applyRun],
  );

  /** The run card's Stop button. One click; the button is disabled until the server answers. */
  const stop = useCallback(async () => {
    const t = track.current;
    if (t === null || t.msgId === null) return;
    const cardId = t.msgId;
    patch(cardId, (w) => (w.kind === 'run' && !w.stopping ? { ...w, stopping: true } : w));
    const result = await request((signal) => api.cancelRun(t.id, signal), { quiet: true });
    if (result === undefined) return;
    if (result.ok) {
      applyRun(result.value);
    } else {
      patch(cardId, (w) => (w.kind === 'run' ? { ...w, stopping: false } : w));
      push(problemReply(result.problem, result.reason));
    }
  }, [patch, push, request, api, applyRun]);

  /** A permission card's Allow or Deny. */
  const answerPermission = useCallback(
    async (messageId: number, allow: boolean) => {
      const t = track.current;
      if (t === null) return;
      let permissionId: string | undefined;
      for (const [pid, msgId] of t.perms) if (msgId === messageId) permissionId = pid;
      if (permissionId === undefined || answering.current.has(permissionId)) return;
      const pid = permissionId;
      answering.current.add(pid);
      patch(messageId, (w) => (w.kind === 'permission' && w.state === 'pending' ? { ...w, busy: true, error: '' } : w));
      const result = await request((signal) => api.answerPermission(t.id, pid, allow, signal), { quiet: true });
      answering.current.delete(pid);
      if (result === undefined) return;
      patch(messageId, (w) => (w.kind === 'permission' ? permissionAnswered(w, allow, result) : w));
      if (result.ok) applyRun(result.value);
    },
    [patch, request, api, applyRun],
  );

  return { conductor, checkConductor, refreshConductor, runActive: run !== null, runActiveNow, sendToRun, runIdForTask, startRun, startRunExact, followUp, stop, answerPermission };
}

export type RunControls = ReturnType<typeof useRun>;
