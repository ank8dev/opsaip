// Chat sessions: the list of chats on the server, and which one is open.
// Live only (Demo has one throwaway thread). A new chat is not created on the
// server until its first message, so there are never empty chats in the list.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { DEFAULT_TITLE, nextSession, titleFrom, titleProblem, type ChatInfo, type Session } from '../data/chats/chats';
import { useWorkspace } from './workspace';

interface ChatsValue {
  /** Chats are kept on the server: false in Demo, where there is no list. */
  enabled: boolean;
  chats: ChatInfo[];
  session: Session;
  /** The list could not be loaded or changed; text for a person. '' if fine. */
  error: string;
  newChat: () => void;
  openChat: (id: string) => void;
  /** Resolves with a problem to show, or undefined. */
  rename: (id: string, title: string) => Promise<string | undefined>;
  remove: (id: string) => Promise<void>;
  /** The id of the open chat, creating it on the server first if it is new. Undefined if that failed. */
  ensureChat: (firstQuestion: string) => Promise<string | undefined>;
  /** True for a chat deleted from the list: a late save must not bring it back. */
  wasDeleted: (id: string) => boolean;
  /** A chat's row changed (saved messages): update the list. */
  touch: (chat: ChatInfo) => void;
}

const ChatsContext = createContext<ChatsValue | null>(null);

export function ChatsProvider({ children }: { children: ReactNode }) {
  const { api, readOnly } = useWorkspace();
  const [chats, setChats] = useState<ChatInfo[]>([]);
  const [session, setSession] = useState<Session>({ key: 0, chatId: null });
  const [error, setError] = useState('');
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const creating = useRef<Promise<string | undefined> | null>(null);
  const deleted = useRef(new Set<string>());
  const wasDeleted = useCallback((id: string) => deleted.current.has(id), []);

  // Load the list when the app is live.
  useEffect(() => {
    if (!readOnly) { setChats([]); return; }
    const c = new AbortController();
    void api.listChats(c.signal).then((r) => {
      if (c.signal.aborted) return;
      if (r.ok) { setChats(r.value); setError(''); } else setError('I could not load your chats.');
    });
    return () => c.abort();
  }, [api, readOnly]);

  const newChat = useCallback(() => setSession((s) => nextSession(s, { type: 'new' })), []);
  const openChat = useCallback((id: string) => setSession((s) => nextSession(s, { type: 'open', chatId: id })), []);

  const rename = useCallback(async (id: string, title: string) => {
    const why = titleProblem(title);
    if (why !== undefined) return why;
    const r = await api.renameChat(id, title, new AbortController().signal);
    if (!r.ok) return 'I could not rename this chat.';
    setChats((list) => list.map((c) => (c.id === id ? r.value : c)));
    return undefined;
  }, [api]);

  const remove = useCallback(async (id: string) => {
    const r = await api.deleteChat(id, new AbortController().signal);
    if (!r.ok && r.problem !== 'not-found') { setError('I could not delete this chat.'); return; }
    setError('');
    deleted.current.add(id);
    setChats((list) => list.filter((c) => c.id !== id));
    setSession((s) => nextSession(s, { type: 'deleted', chatId: id }));
  }, [api]);

  const ensureChat = useCallback(async (firstQuestion: string): Promise<string | undefined> => {
    const open = sessionRef.current.chatId;
    if (open !== null) return open;
    if (creating.current === null) {
      creating.current = (async () => {
        const r = await api.createChat(titleFrom(firstQuestion) || DEFAULT_TITLE, new AbortController().signal);
        creating.current = null;
        if (!r.ok) { setError('I could not save this chat.'); return undefined; }
        setChats((list) => [r.value, ...list.filter((c) => c.id !== r.value.id)]);
        setSession((s) => nextSession(s, { type: 'created', chatId: r.value.id }));
        return r.value.id;
      })();
    }
    return creating.current;
  }, [api]);

  const touch = useCallback((chat: ChatInfo) => {
    setChats((list) => [chat, ...list.filter((c) => c.id !== chat.id)]);
  }, []);

  const value = useMemo<ChatsValue>(
    () => ({ enabled: readOnly, chats, session, error, newChat, openChat, rename, remove, ensureChat, wasDeleted, touch }),
    [readOnly, chats, session, error, newChat, openChat, rename, remove, ensureChat, wasDeleted, touch],
  );
  return <ChatsContext.Provider value={value}>{children}</ChatsContext.Provider>;
}

export function useChats(): ChatsValue {
  const v = useContext(ChatsContext);
  if (!v) throw new Error('useChats must be used inside <ChatsProvider>');
  return v;
}
