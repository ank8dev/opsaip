import { useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { useChats } from '../../state/chats';
import { useUi } from '../../state/ui';
import { listItem } from '../../styles/motion';
import { TITLE_MAX, type ChatInfo } from '../../data/chats/chats';

/**
 * "New chat" and the list of your chats, under Chat in the sidebar. A chat can
 * be renamed (pencil) and deleted (cross, with a confirmation in place). The
 * list is the server's: it is not shown in Demo. With a `query` (search) it
 * lists only the chats whose name matches.
 *
 * Motion: rows enter with `listItem` from styles/motion.ts, like every list in
 * the sidebar; no new values; reduced motion comes from the tokens.
 */
export function ChatList({ query = '' }: { query?: string }) {
  const chats = useChats();
  const ui = useUi();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [problem, setProblem] = useState('');

  if (!chats.enabled) return null;

  // Searching: only the chats whose name matches, with no New chat button.
  const q = query.trim().toLowerCase();
  const shown = q ? chats.chats.filter((c) => c.title.toLowerCase().includes(q)) : chats.chats;
  if (q && shown.length === 0) return null;

  const leave = () => { ui.setSettingsOpen(false); ui.closeTask(); };

  return (
    <div className="op-chats" role="group" aria-label="Chats">
      {!q && (
        <button type="button" className="op-newchat" onClick={() => { leave(); chats.newChat(); }}>
          <span className="op-newchat-plus" aria-hidden="true">+</span> New chat
        </button>
      )}
      {chats.error !== '' && <p className="op-chats-note" role="alert">{chats.error}</p>}
      <ul className="op-chat-rows">
        {shown.map((c, i) => (
          <motion.li key={c.id} className="op-chat-row" {...listItem(ui.motion, Math.min(i, 8))}>
            {renaming === c.id ? (
              <RenameForm
                chat={c}
                onDone={async (title) => {
                  const why = await chats.rename(c.id, title);
                  setProblem(why ?? '');
                  if (why === undefined) setRenaming(null);
                }}
                onCancel={() => { setRenaming(null); setProblem(''); }}
                problem={problem}
              />
            ) : confirming === c.id ? (
              <div className="op-chat-confirm" role="group" aria-label={`Delete ${c.title}?`}>
                <span>Delete “{c.title}”?</span>
                <button type="button" className="op-sbtn op-sbtn-danger" onClick={() => { setConfirming(null); void chats.remove(c.id); }}>Delete</button>
                <button type="button" className="op-sbtn" onClick={() => setConfirming(null)}>Keep</button>
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="op-chat-open"
                  aria-current={chats.session.chatId === c.id ? 'true' : undefined}
                  title={c.title}
                  onClick={() => { leave(); chats.openChat(c.id); }}
                >
                  <span className="op-chat-title">{c.title}</span>
                </button>
                <button type="button" className="op-chat-act" aria-label={`Rename ${c.title}`} title="Rename" onClick={() => { setProblem(''); setRenaming(c.id); }}>✎</button>
                <button type="button" className="op-chat-act" aria-label={`Delete ${c.title}`} title="Delete" onClick={() => setConfirming(c.id)}>×</button>
              </>
            )}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function RenameForm({ chat, onDone, onCancel, problem }: {
  chat: ChatInfo; onDone: (title: string) => void | Promise<void>; onCancel: () => void; problem: string;
}) {
  const [title, setTitle] = useState(chat.title);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); input.current?.select(); }, []);
  function submit(e: FormEvent) {
    e.preventDefault();
    void onDone(title);
  }
  return (
    <form className="op-chat-rename" onSubmit={submit}>
      <input
        ref={input}
        className="op-field"
        aria-label="Chat name"
        aria-invalid={problem !== ''}
        value={title}
        maxLength={TITLE_MAX * 2}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } }}
      />
      {problem !== '' && <span className="op-chat-problem" role="alert">{problem}</span>}
    </form>
  );
}
