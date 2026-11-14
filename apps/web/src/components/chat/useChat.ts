import { useCallback, useEffect, useRef, useState } from 'react';
import { askProblemReply, askReply, type AskAction } from '../../data/chat/ask';
import { createTaskReply } from '../../data/chat/tasks';
import { liveChipAnswer } from '../../data/chat/liveAnswers';
import { actionCard, approvedPayload, beginApprove, cancelAction } from '../../data/chat/actions';
import { decideProposal, demoAnswer } from '../../data/chat/demoAnswers';
import type { ThreadMessage } from '../../data/chat/types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import type { ActionWidget, Widget } from '../../data/chat/types';
import { useRequests } from './useRequests';
import { useRun } from './useRun';

/** The server has 20 s to answer (it replies 504 after that); give up a little later. */
const ASK_TIMEOUT_MS = 30_000;

/**
 * The chat thread. It lives in memory only: a reload starts it over.
 * Demo: Opsy answers at once from the sample tasks. Live: the question goes to
 * the server's Ask, and the answer replaces a "waiting" message.
 */
export function useChat() {
  const { allTasks, people, readOnly, source, ask, api, changeTask, findTask, setPendingPermissionTasks, attention } = useWorkspace();
  const ui = useUi();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const requests = useRequests();

  const say = useCallback((text: string) => {
    setMessages((list) => [...list, { id: nextId.current++, from: 'you', text }]);
  }, []);
  const push = useCallback((widget: Widget, pending?: boolean): number => {
    const id = nextId.current++;
    setMessages((list) => [...list, { id, from: 'opsy', widget, ...(pending ? { pending: true } : {}) }]);
    return id;
  }, []);
  const patch = useCallback((id: number, change: (w: Widget) => Widget) => {
    setMessages((list) => list.map((m) => (m.id === id && m.from === 'opsy' ? { id, from: 'opsy', widget: change(m.widget) } : m)));
  }, []);
  const runs = useRun({ live: readOnly, api, request: requests.request, say, push, patch });

  /** Live, Task mode: create the task on the server. Resolves true if it was created. */
  const createTask = useCallback(
    async (text: string): Promise<boolean> => {
      ui.closeTask();
      say(text);
      const waiting = push({ kind: 'text', text: 'Creating the task…' }, true);
      const result = await requests.request((signal) => api.createTask(text, signal));
      if (result === undefined) return false;
      patch(waiting, () => createTaskReply(result));
      return result.ok;
    },
    [ui, say, push, patch, requests.request, api],
  );

  // Tell the sidebar and the bar which runs wait for your Allow or Deny.
  useEffect(() => {
    const taskOf = new Map<string, string>();
    for (const m of messages) if (m.from === 'opsy' && m.widget.kind === 'run') taskOf.set(m.widget.runId, m.widget.taskId);
    const ids: string[] = [];
    for (const m of messages) {
      if (m.from !== 'opsy' || m.widget.kind !== 'permission' || m.widget.state !== 'pending') continue;
      const id = taskOf.get(m.widget.runId);
      if (id !== undefined && !ids.includes(id)) ids.push(id);
    }
    setPendingPermissionTasks(ids);
  }, [messages, setPendingPermissionTasks]);
  useEffect(() => () => setPendingPermissionTasks([]), [setPendingPermissionTasks]);

  // Leaving the page stops a question that is still on its way.
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

  /**
   * The model proposed an action: turn the waiting message into a Proposed action
   * card. For a run, Agent mode is checked first, so the card can say it is off
   * or busy instead of offering Approve. Nothing is sent to an agent here.
   */
  const proposeAction = useCallback(
    async (messageId: number, answer: string, action: AskAction) => {
      const conductor = action.type === 'run' ? await requests.request((signal) => api.conductor(signal), { quiet: true }) : null;
      const card = actionCard(answer, action, conductor === undefined ? null : conductor, runs.runActiveNow());
      setMessages((list) => list.map((m) => (m.id === messageId ? { id: messageId, from: 'opsy', widget: card } : m)));
      setBusy(false);
    },
    [requests.request, api, runs.runActiveNow],
  );

  const send = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question || busy) return;
      ui.closeTask(); // the thread is hidden while a task is open
      const you: ThreadMessage = { id: nextId.current++, from: 'you', text: question };

      if (!readOnly) {
        const widget = demoAnswer(question, { tasks: allTasks, people });
        setMessages((list) => [...list, you, { id: nextId.current++, from: 'opsy', widget }]);
        return;
      }

      // The three suggestions are answered here, from the server's tasks, without Ask.
      const chip = liveChipAnswer(question, {
        tasks: allTasks, people, pendingPermissionTaskIds: attention.needsYou.map((t) => t.id),
      });
      if (chip !== null) {
        // Old or missing data must not pass as a statement about the team.
        const widget: Widget =
          source.status === 'offline' ? askProblemReply('unreachable')
          : source.status === 'connecting' ? { kind: 'text', text: 'Still connecting to the server. Try again in a moment.' }
          : chip;
        setMessages((list) => [...list, you, { id: nextId.current++, from: 'opsy', widget }]);
        return;
      }

      const waitingId = nextId.current++;
      setMessages((list) => [
        ...list, you,
        { id: waitingId, from: 'opsy', pending: true, widget: { kind: 'text', text: 'Asking your server…' } },
      ]);
      setBusy(true);
      const c = new AbortController();
      controller.current = c;
      let timedOut = false;
      const timer = window.setTimeout(() => { timedOut = true; c.abort(); }, ASK_TIMEOUT_MS);
      void ask(question, c.signal).then((result) => {
        window.clearTimeout(timer);
        if (controller.current !== c) return; // left the page meanwhile
        controller.current = null;
        if (!timedOut && result.ok && result.action !== null) {
          void proposeAction(waitingId, result.answer, result.action);
          return;
        }
        const widget = timedOut ? askProblemReply('timeout') : askReply(result);
        setMessages((list) => list.map((m) => (m.id === waitingId ? { id: waitingId, from: 'opsy', widget } : m)));
        setBusy(false);
      });
    },
    [busy, readOnly, allTasks, people, ask, ui, source.status, attention, proposeAction],
  );

  /** Approve or Cancel a Proposed action card. Only Approve sends anything, and only the card's own title and prompt. */
  const decideAction = useCallback(
    async (messageId: number, card: ActionWidget, decision: 'approve' | 'cancel') => {
      const setCard = (next: ActionWidget) => patch(messageId, (w) => (w.kind === 'action' ? next : w));
      if (decision === 'cancel') return setCard(cancelAction(card));
      const going = beginApprove(card);
      if (going === null) return; // already decided, or blocked
      setCard(going);
      const { title, prompt } = approvedPayload(card);
      let ok: boolean;
      if (card.action === 'run') {
        ok = await runs.startRunExact(title, prompt);
      } else {
        const waiting = push({ kind: 'text', text: 'Creating the task…' }, true);
        const result = await requests.request((signal) => api.createTask(title, signal));
        ok = result !== undefined && result.ok;
        if (result !== undefined) patch(waiting, () => createTaskReply(result));
      }
      setCard({ ...going, state: ok ? 'approved' : 'failed' });
    },
    [patch, push, runs.startRunExact, requests.request, api],
  );

  /** Approve or Cancel a proposed change. Only Approve touches the task, and only through changeTask. */
  const decide = useCallback(
    (messageId: number, decision: 'approve' | 'cancel') => {
      const message = messages.find((m) => m.id === messageId);
      if (message?.from === 'opsy' && message.widget.kind === 'action') {
        void decideAction(messageId, message.widget, decision);
        return;
      }
      if (!message || message.from !== 'opsy' || message.widget.kind !== 'proposal') return;
      const proposal = message.widget;
      const result = decideProposal(proposal, findTask(proposal.taskId), decision);
      if (result.patch && !readOnly) changeTask(proposal.taskId, result.patch);
      setMessages((list) =>
        list.map((m) =>
          m.id === messageId && m.from === 'opsy' && m.widget.kind === 'proposal'
            ? { ...m, widget: { ...m.widget, status: result.status } }
            : m,
        ),
      );
    },
    [messages, findTask, readOnly, changeTask, decideAction],
  );

  return {
    messages, busy: busy || requests.busy, send, decide, live: readOnly, serverOffline: source.status === 'offline',
    createTask, ...runs,
  };
}

export type Chat = ReturnType<typeof useChat>;
