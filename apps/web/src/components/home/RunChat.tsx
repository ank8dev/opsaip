import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { problemText, type Problem } from '../../data/chat/problems';
import { promptProblem, type Run } from '../../data/chat/conductor';
import type { ApiResult } from '../../data/chat/serverCall';
import {
  CLEARS_NOTE, FINISHED_NOTE, RESUMABLE_NOTE, canSendFollowUp, type Transcript,
} from '../../data/chat/transcript';
import { useUi } from '../../state/ui';
import { useWorkspace } from '../../state/workspace';
import { listItem } from '../../styles/motion';
import { FileChip } from './AttachmentChips';

/** Poll every 2 s while the run is active; a few more times after it ends, for `canResume`. */
const POLL_MS = 2000;
const POLLS_AFTER_END = 3;

/**
 * The chat of a run Opsaip launched: your prompt, your follow-ups and the
 * agent's messages in order, and an input. While the run is active the input
 * sends a follow-up; after it ends the input still works if the server can
 * resume the session, and is disabled with the reason if not. The history is
 * in memory only (here and on the server). All text is shown as text.
 *
 * Motion: new lines enter with `listItem` from styles/motion.ts.
 */
export function RunChat({
  runId, title, send,
}: {
  runId: string;
  /** The task's title, for the run card if this resumes the run. */
  title: string;
  send: (runId: string, title: string, text: string) => Promise<ApiResult<Run> | undefined>;
}) {
  const { api } = useWorkspace();
  const t = useUi().motion;
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendProblem, setSendProblem] = useState('');
  const refresh = useRef<() => void>(() => {});
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight: AbortController | null = null;
    let after = 0;

    async function tick(): Promise<void> {
      timer = undefined;
      if (stopped) return;
      const c = new AbortController();
      inFlight = c;
      const timeout = setTimeout(() => c.abort(), 10_000);
      const result = await api.transcript(runId, c.signal);
      clearTimeout(timeout);
      inFlight = null;
      if (stopped) return;
      if (result.ok) {
        setTranscript(result.value);
        setProblem(null);
        after = result.value.finished ? after + 1 : 0;
        if (result.value.finished && (result.value.canResume || after >= POLLS_AFTER_END)) return; // settled
      } else {
        setProblem(result.problem);
        if (result.problem === 'not-found' || result.problem === 'unauthorized' || result.problem === 'conductor-off') return;
      }
      if (!document.hidden) timer = setTimeout(() => void tick(), POLL_MS);
    }
    const run = () => {
      if (timer !== undefined) clearTimeout(timer);
      after = 0;
      if (inFlight === null) void tick();
      else timer = setTimeout(() => void tick(), POLL_MS);
    };
    refresh.current = run;
    const onVisibility = () => { if (!document.hidden && inFlight === null && timer === undefined) void tick(); };
    document.addEventListener('visibilitychange', onVisibility);
    void tick();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', onVisibility);
      if (timer !== undefined) clearTimeout(timer);
      inFlight?.abort();
    };
  }, [api, runId]);

  const count = transcript?.entries.length ?? 0;
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: t.reduced ? 'auto' : 'smooth' }); }, [count, t.reduced]);

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const body = text.trim();
      const why = promptProblem(body);
      if (why !== undefined) { setSendProblem(`Can't send: ${why}`); return; }
      setSending(true);
      setSendProblem('');
      const result = await send(runId, title, body);
      setSending(false);
      if (result === undefined) return;
      if (result.ok) { setText(''); refresh.current(); }
      else setSendProblem(problemText(result.problem, result.reason));
    },
    [text, send, runId, title],
  );

  const canSend = transcript !== null && canSendFollowUp(transcript);
  const note = transcript === null ? '' : !transcript.finished ? '' : transcript.canResume ? RESUMABLE_NOTE : FINISHED_NOTE;

  return (
    <div className="op-runchat">
      {problem !== null && transcript === null && <p className="op-runchat-note" role="status">{problemText(problem)}</p>}
      <div className="op-chat" role="log" aria-label="Conversation with the agent">
        {transcript?.entries.map((e) => (
          <motion.div key={e.id} className={`op-msg ${e.role === 'you' ? 'op-msg-user' : 'op-msg-ai'}`} {...listItem(t, 0)}>
            <span className="op-msg-who">{e.role === 'you' ? 'You' : 'Agent'}{e.kind === 'followup' && <span className="op-msg-via"> · follow-up</span>}</span>
            <span className="op-msg-body op-pre">{e.text}</span>
            {e.attachments && (
              <span className="op-msg-files" aria-label="Attached files">
                {e.attachments.map((f, i) => <FileChip key={i} name={f.name} kind={f.kind} size={f.size} />)}
              </span>
            )}
          </motion.div>
        ))}
        {transcript !== null && transcript.truncated && <p className="op-runchat-note">Older messages were dropped to keep the chat small.</p>}
        <div ref={end} />
      </div>
      <form className="op-runchat-form" onSubmit={(e) => void submit(e)}>
        <textarea
          className="op-field op-runchat-input"
          aria-label="Message to the agent"
          rows={2}
          value={text}
          disabled={!canSend || sending}
          placeholder={canSend ? 'Message the agent…' : 'Run finished.'}
          onChange={(e) => { setText(e.target.value); setSendProblem(''); }}
        />
        <button type="submit" className="op-sbtn op-sbtn-primary" disabled={!canSend || sending || text.trim() === ''}>
          {sending ? 'Sending…' : 'Send'}
        </button>
      </form>
      {note !== '' && <p className="op-runchat-note" role="status">{note}</p>}
      {sendProblem !== '' && <p className="op-runchat-note op-runchat-err" role="alert">{sendProblem}</p>}
      <p className="op-runchat-note">{CLEARS_NOTE}</p>
    </div>
  );
}
