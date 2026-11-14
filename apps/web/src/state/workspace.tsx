// Workspace data plus the preview edits made on this page (approve, retry,
// link a suggestion…). Edits live in memory only: nothing is written anywhere.
//
// Data comes from data/source.ts: the sample team (Demo), or the Opsaip
// server's tasks, polled every few seconds once a token is saved. Server
// data is read-only here: preview edits are not applied on top of it.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AnyTask, ChatMessage, Link, LocalTask, Person, Task, ToolName, Workspace } from '../types';
import { isLocal } from '../types';
import { byImportance, byStatus, isImportant, mapState, peopleById, type TrayLevel } from '../data/selectors';
import {
  clearConnection, fetchTasks, loadConnection, loadWorkspace, saveConnection, serverWorkspace, type Connection,
} from '../data/source';
import { askQuestion, type AskResult } from '../data/chat/ask';
import { keepLastGood, startPoller, type DataSource, type LiveState } from '../data/poller';

type SyncFlag = 'conflict' | 'suggested' | '';

interface WorkspaceValue {
  ws: Workspace;
  source: DataSource;
  /** True while showing server data: actions must not pretend to change it. */
  readOnly: boolean;
  /** Save the token and start polling. Returns a problem to show, or undefined. */
  connect: (token: string) => string | undefined;
  /** Forget the token and go back to Demo. */
  disconnect: () => void;
  /** Ask the server a question (Live only). The token stays in here. Never throws. */
  ask: (question: string, signal: AbortSignal) => Promise<AskResult>;
  people: Record<string, Person>;
  /** Tasks from the workspace, with preview edits applied (Demo only). */
  tasks: Task[];
  /** Tasks started from this page, newest first. Empty while showing server data. */
  localTasks: LocalTask[];
  /** Local tasks first, then everything else by status. */
  allTasks: AnyTask[];
  findTask: (id: string | null | undefined) => AnyTask | null;
  linksFor: (taskId: string) => Link[];
  syncFlag: (taskId: string) => SyncFlag;
  linkNote: (taskId: string) => string;
  messagesFor: (t: AnyTask) => ChatMessage[];
  /** Tasks waiting on a person: "Needs you", or tools that disagree. */
  decisionTasks: () => AnyTask[];
  attentionTasks: (level: TrayLevel) => AnyTask[];

  changeTask: (id: string, patch: Partial<Task>, msg?: ChatMessage) => void;
  addLocalTask: (t: LocalTask) => void;
  addMessage: (taskId: string, msg: ChatMessage) => void;
  resolveConflict: (taskId: string, winner: Link) => void;
  linkSuggestion: (taskId: string, link: Link) => void;
  dismissSuggestion: (taskId: string, link: Link) => void;
}

const WorkspaceContext = createContext<WorkspaceValue | null>(null);

const TOOL_ORDER: Record<ToolName, number> = { Linear: 0, GitHub: 1, Notion: 2 };

/** Tasks started from this page get ids like "local-3". */
export const LOCAL_PREFIX = 'local-';

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [demo] = useState(loadWorkspace);
  const [connection, setConnection] = useState<Connection | null>(() => loadConnection());
  const [live, setLive] = useState<LiveState | null>(null);

  useEffect(() => {
    if (connection === null) return;
    const poller = startPoller({
      fetchTasks: (signal) => fetchTasks(connection.token, signal),
      onState: (next) => setLive((prev) => keepLastGood(prev, next)),
      isHidden: () => document.hidden,
    });
    const onVisibility = () => {
      if (!document.hidden) poller.wake();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      poller.stop();
    };
  }, [connection]);

  const source: DataSource = connection === null ? { status: 'demo' } : (live ?? { status: 'connecting' });
  const readOnly = source.status !== 'demo';
  const serverTasks = source.status === 'live' || source.status === 'offline' ? source.tasks : null;
  const ws = useMemo(
    () => (readOnly ? serverWorkspace(serverTasks ?? []) : demo),
    [readOnly, serverTasks, demo],
  );

  const connect = useCallback((token: string) => {
    const saved = saveConnection(token);
    if (!saved.ok) return saved.problem;
    setLive(null);
    setConnection(saved.connection);
    return undefined;
  }, []);

  const disconnect = useCallback(() => {
    clearConnection();
    setLive(null);
    setConnection(null);
  }, []);

  const ask = useCallback(
    (question: string, signal: AbortSignal): Promise<AskResult> =>
      connection === null
        ? Promise.resolve({ ok: false, problem: 'unauthorized' })
        : askQuestion(connection.token, question, signal),
    [connection],
  );

  const [taskPatches, setTaskPatches] = useState<Record<string, Partial<Task>>>({});
  const [localTasks, setLocalTasks] = useState<LocalTask[]>([]);
  const [sentMessages, setSentMessages] = useState<Record<string, ChatMessage[]>>({});
  const [linkPatches, setLinkPatches] = useState<Record<string, Partial<Link>>>({});
  const [linkNotes, setLinkNotes] = useState<Record<string, string>>({});

  // A task is local only if it is in localTasks. Not by its id's prefix: a
  // server task id can be any string, "local-3" included. The ref lets the
  // actions below check it without being recreated on every change.
  const localIds = useMemo(() => new Set(localTasks.map((t) => t.id)), [localTasks]);
  const localIdsRef = useRef(localIds);
  localIdsRef.current = localIds;
  const isLocalId = (id: string) => localIdsRef.current.has(id);

  // Preview tasks started here are sample-data play: they are not shown next
  // to real server tasks. So on screen, local and server ids never meet.
  const shownLocal = useMemo(() => (readOnly ? [] : localTasks), [readOnly, localTasks]);

  const people = useMemo(() => peopleById(ws.team), [ws.team]);
  const tasks = useMemo(
    () =>
      // Preview edits apply to sample data only, never on top of server data.
      ws.activity.map((t) => (!readOnly && taskPatches[t.id] ? { ...t, ...taskPatches[t.id] } : t)),
    [ws.activity, taskPatches, readOnly],
  );
  const allTasks = useMemo<AnyTask[]>(() => [...shownLocal, ...tasks.slice().sort(byStatus)], [shownLocal, tasks]);

  const findTask = useCallback((id: string | null | undefined) => allTasks.find((t) => t.id === id) ?? null, [allTasks]);

  const linksFor = useCallback(
    (taskId: string) =>
      ws.links
        .filter((l) => l.task === taskId)
        .map((l) => ({ ...l, ...linkPatches[l.id] }))
        .filter((l) => !l.dismissed)
        .sort((a, b) => (TOOL_ORDER[a.tool] ?? 9) - (TOOL_ORDER[b.tool] ?? 9)),
    [ws.links, linkPatches],
  );

  const syncFlag = useCallback(
    (taskId: string): SyncFlag => {
      const ls = linksFor(taskId);
      if (ls.some((l) => l.sync === 'Conflict')) return 'conflict';
      if (ls.some((l) => l.sync === 'Suggested')) return 'suggested';
      return '';
    },
    [linksFor],
  );

  const messagesFor = useCallback(
    (t: AnyTask): ChatMessage[] => {
      if (isLocal(t)) return t.msgs;
      const exported = ws.transcripts
        .filter((m) => m.task_id === t.id)
        .sort((a, b) => a.seq - b.seq)
        .map(({ role, text }) => ({ role, text }));
      return [...exported, ...(sentMessages[t.id] ?? [])];
    },
    [ws.transcripts, sentMessages],
  );

  const decisionTasks = useCallback(() => {
    const needs = (t: AnyTask) =>
      t.status === 'Needs you' || (!isLocal(t) && t.status !== 'Done' && syncFlag(t.id) === 'conflict');
    return [...shownLocal.filter(needs), ...tasks.filter(needs)].sort(byImportance);
  }, [shownLocal, tasks, syncFlag]);

  const attentionTasks = useCallback(
    (level: TrayLevel) => decisionTasks().filter((t) => isImportant(t, level)),
    [decisionTasks],
  );

  // ---- actions ----

  // Local tasks keep their chat on the task; others in a side list per task.
  const addMessage = useCallback((taskId: string, msg: ChatMessage) => {
    if (isLocalId(taskId)) {
      setLocalTasks((list) => list.map((t) => (t.id === taskId ? { ...t, msgs: [...t.msgs, msg] } : t)));
    } else {
      setSentMessages((m) => ({ ...m, [taskId]: [...(m[taskId] ?? []), msg] }));
    }
  }, []);

  const changeTask = useCallback(
    (id: string, patch: Partial<Task>, msg?: ChatMessage) => {
      const full = { since: new Date().toISOString(), ...patch };
      if (isLocalId(id)) {
        setLocalTasks((list) => list.map((t) => (t.id === id ? { ...t, ...full } : t)));
      } else {
        setTaskPatches((p) => ({ ...p, [id]: { ...p[id], ...full } }));
      }
      if (msg) addMessage(id, msg);
    },
    [addMessage],
  );

  const addLocalTask = useCallback((t: LocalTask) => setLocalTasks((list) => [t, ...list]), []);

  const patchLink = (id: string, patch: Partial<Link>) =>
    setLinkPatches((p) => ({ ...p, [id]: { ...p[id], ...patch } }));

  // Pick one tool's status as the truth; the others follow it — except GitHub,
  // whose state always comes from the real pull request.
  const resolveConflict = useCallback(
    (taskId: string, winner: Link) => {
      const changes: string[] = [];
      linksFor(taskId).forEach((l) => {
        if (l.sync === 'Suggested') return;
        if (l.id === winner.id || l.status === winner.status) {
          if (l.sync === 'Conflict') patchLink(l.id, { sync: 'In sync' });
          return;
        }
        if (l.tool === 'GitHub') {
          patchLink(l.id, { sync: 'Kept' });
          changes.push('GitHub keeps following the real pull request');
          return;
        }
        const st = mapState(ws.statusMap, winner.status, l.tool);
        patchLink(l.id, { state: st, status: winner.status, sync: 'In sync' });
        changes.push(`${l.tool} would move to “${st}”`);
      });
      setLinkNotes((n) => ({
        ...n,
        [taskId]: `Preview — ${changes.length ? changes.join('; ') : 'nothing to change'}. Nothing was written.`,
      }));
    },
    [linksFor, ws.statusMap],
  );

  const linkSuggestion = useCallback(
    (taskId: string, l: Link) => {
      const other = linksFor(taskId).find((o) => o.id !== l.id && o.sync !== 'Suggested' && o.status !== l.status);
      if (other) {
        patchLink(l.id, {
          sync: 'Conflict',
          note: `${l.tool} ${l.ref} says “${l.state}”, ${other.tool} ${other.ref} says “${other.state}”. Which one is right?`,
        });
      } else {
        patchLink(l.id, { sync: 'In sync' });
      }
      setLinkNotes((n) => ({ ...n, [taskId]: `Preview — ${l.ref} linked to this task. Nothing was written.` }));
    },
    [linksFor],
  );

  const dismissSuggestion = useCallback((taskId: string, l: Link) => {
    patchLink(l.id, { dismissed: true });
    setLinkNotes((n) => ({ ...n, [taskId]: 'Preview — suggestion dismissed.' }));
  }, []);

  const value: WorkspaceValue = {
    ws, source, readOnly, connect, disconnect, ask, people, tasks, localTasks: shownLocal, allTasks, findTask, linksFor, syncFlag,
    linkNote: (id) => linkNotes[id] ?? '',
    messagesFor, decisionTasks, attentionTasks,
    changeTask, addLocalTask, addMessage, resolveConflict, linkSuggestion, dismissSuggestion,
  };

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceValue {
  const v = useContext(WorkspaceContext);
  if (!v) throw new Error('useWorkspace must be used inside <WorkspaceProvider>');
  return v;
}
