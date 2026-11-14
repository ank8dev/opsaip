import { useCallback, useEffect, useRef, useState } from 'react';
import { askProblemReply, askReply } from '../../data/chat/ask';
import { decideProposal, demoAnswer } from '../../data/chat/demoAnswers';
import type { ThreadMessage } from '../../data/chat/types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';

/** The server has 20 s to answer (it replies 504 after that); give up a little later. */
const ASK_TIMEOUT_MS = 30_000;

/**
 * The chat thread. It lives in memory only: a reload starts it over.
 * Demo: Opsy answers at once from the sample tasks. Live: the question goes to
 * the server's Ask, and the answer replaces a "waiting" message.
 */
export function useChat() {
  const { allTasks, people, readOnly, source, ask, changeTask, findTask } = useWorkspace();
  const ui = useUi();
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const nextId = useRef(0);
  const controller = useRef<AbortController | null>(null);

  // Leaving the page stops a question that is still on its way.
  useEffect(() => () => { controller.current?.abort(); controller.current = null; }, []);

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
        const widget = timedOut ? askProblemReply('timeout') : askReply(result);
        setMessages((list) => list.map((m) => (m.id === waitingId ? { id: waitingId, from: 'opsy', widget } : m)));
        setBusy(false);
      });
    },
    [busy, readOnly, allTasks, people, ask, ui],
  );

  /** Approve or Cancel a proposed change. Only Approve touches the task, and only through changeTask. */
  const decide = useCallback(
    (messageId: number, decision: 'approve' | 'cancel') => {
      const message = messages.find((m) => m.id === messageId);
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
    [messages, findTask, readOnly, changeTask],
  );

  return { messages, busy, send, decide, live: readOnly, serverOffline: source.status === 'offline' };
}

export type Chat = ReturnType<typeof useChat>;
