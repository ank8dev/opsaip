import { useEffect, useRef, useState, type FormEvent, type Ref } from 'react';
import { motion } from 'motion/react';
import { folderPicker } from '../../data/desktop';
import { problemText } from '../../data/chat/problems';
import { defaultFirst, reposChanged, type RepoEntry } from '../../data/chat/repos';
import { useUi } from '../../state/ui';
import { useWorkspace } from '../../state/workspace';
import { listItem } from '../../styles/motion';
import { Card, SettingRow, SettingsSection } from './parts';
import type { ApiResult } from '../../data/chat/serverCall';

/** The list as the page knows it. `off`: this server cannot run Conductor mode at all (503). */
export type List = { status: 'loading' } | { status: 'ready'; repos: RepoEntry[] } | { status: 'off' } | { status: 'failed'; text: string };

/** Give up on an add or a remove after this long (the server checks a path in well under a second). */
const REQUEST_MS = 30_000;

export const REPOS_OFF_NOTE =
  'This server does not listen on its own machine only, so Conductor mode is not available and repositories cannot be added. See OPSAIP_HOST in the README.';

/** "the path is not a folder" -> "The path is not a folder." The server's text, shown as text. */
export function sentence(reason: string): string {
  const text = reason.trim();
  if (text === '') return '';
  const capital = text[0].toUpperCase() + text.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
}

/** What the page says when adding was refused: the server's own reason when it gave one. */
export function addFailureText(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (result.reason !== undefined) return `Not added. ${sentence(result.reason)}`;
  if (result.problem === 'conductor-off') return `Not added. ${REPOS_OFF_NOTE}`;
  return `Not added. ${problemText(result.problem)}`;
}

/** What the page says when removing was refused: a run being active is said in the server's words. */
export function removeFailureText(result: Extract<ApiResult<unknown>, { ok: false }>): string {
  if (result.reason !== undefined) return `Not removed. ${sentence(result.reason)}`;
  if (result.problem === 'repo-gone') return 'Not removed. That repository was already gone from the list.';
  if (result.problem === 'conductor-off') return `Not removed. ${REPOS_OFF_NOTE}`;
  return `Not removed. ${problemText(result.problem)}`;
}

/**
 * Settings → Repositories: the folders Claude Code can work in (Conductor mode). Live only: the
 * list is the server's. Adding checks the path on the server and shows its refusal as it is;
 * Remove only forgets a repository (the server never touches files) and is refused while a run
 * is active in it. In the desktop app, Choose folder fills the field from the native picker.
 *
 * Motion: rows enter with `listItem` from styles/motion.ts.
 */
export function RepositoriesSettings() {
  const { readOnly, api } = useWorkspace();
  const ui = useUi();
  const [list, setList] = useState<List>({ status: 'loading' });
  const [path, setPath] = useState('');
  /** 'add', or the id being removed. One request at a time. */
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<{ on: string; text: string } | null>(null);
  const [done, setDone] = useState('');
  const pathInput = useRef<HTMLInputElement>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const alive = useRef(true);
  const pick = folderPicker();

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  // Read the list each time Settings opens (it stays mounted while closed).
  useEffect(() => {
    if (!readOnly || !ui.settingsOpen) return;
    const c = new AbortController();
    void api.repos(c.signal).then((result) => {
      if (c.signal.aborted) return;
      if (result.ok) setList({ status: 'ready', repos: defaultFirst(result.value) });
      else if (result.problem === 'conductor-off') setList({ status: 'off' });
      else setList((prev) => (prev.status === 'ready' ? prev : { status: 'failed', text: problemText(result.problem) }));
    });
    return () => c.abort();
  }, [readOnly, ui.settingsOpen, api]);

  if (!readOnly) return null;

  async function add(e: FormEvent) {
    e.preventDefault();
    const value = path.trim();
    if (value === '' || busy !== null) return;
    setBusy('add');
    setProblem(null);
    setDone('');
    const result = await api.addRepo(value, AbortSignal.timeout(REQUEST_MS));
    if (!alive.current) return;
    setBusy(null);
    if (!result.ok) return setProblem({ on: 'add', text: addFailureText(result) });
    setList((prev) => ({ status: 'ready', repos: defaultFirst([...(prev.status === 'ready' ? prev.repos : []), result.value]) }));
    setPath('');
    setDone(`Added ${result.value.name}.`);
    reposChanged();
    pathInput.current?.focus();
  }

  async function remove(repo: RepoEntry) {
    if (busy !== null) return;
    setBusy(repo.id);
    setProblem(null);
    setDone('');
    const result = await api.removeRepo(repo.id, AbortSignal.timeout(REQUEST_MS));
    if (!alive.current) return;
    setBusy(null);
    if (!result.ok) {
      setProblem({ on: repo.id, text: removeFailureText(result) });
      // Already gone on the server: the list was out of date, so drop it here too.
      if (result.problem === 'repo-gone') setList((prev) => (prev.status === 'ready' ? { status: 'ready', repos: prev.repos.filter((r) => r.id !== repo.id) } : prev));
      return;
    }
    setList((prev) => (prev.status === 'ready' ? { status: 'ready', repos: prev.repos.filter((r) => r.id !== repo.id) } : prev));
    setDone(`Removed ${repo.name} from the list. Its files were not touched.`);
    reposChanged();
    status.current?.focus();
  }

  async function choose() {
    if (pick === undefined || busy !== null) return;
    setProblem(null);
    try {
      const chosen = await pick();
      if (!alive.current || chosen === null) return;
      setPath(chosen);
      pathInput.current?.focus();
    } catch {
      if (alive.current) setProblem({ on: 'add', text: 'The folder picker could not be opened. Paste the path instead.' });
    }
  }

  return (
    <RepositoriesView
      list={list} path={path} busy={busy} problem={problem} done={done} canChoose={pick !== undefined}
      pathInput={pathInput} status={status}
      onPath={(value) => { setPath(value); setProblem(null); }}
      onAdd={(e) => void add(e)} onRemove={(repo) => void remove(repo)} onChoose={() => void choose()}
    />
  );
}

export interface ViewProps {
  list: List;
  path: string;
  /** 'add', or the id being removed. */
  busy: string | null;
  problem: { on: string; text: string } | null;
  /** What was just done, for screen readers and for you. */
  done: string;
  /** The native folder picker exists (the desktop app). */
  canChoose: boolean;
  pathInput?: Ref<HTMLInputElement>;
  status?: Ref<HTMLParagraphElement>;
  onPath: (value: string) => void;
  onAdd: (e: FormEvent) => void;
  onRemove: (repo: RepoEntry) => void;
  onChoose: () => void;
}

/** The section as it is drawn. No state of its own: the container above holds it. */
export function RepositoriesView({ list, path, busy, problem, done, canChoose, pathInput, status, onPath, onAdd, onRemove, onChoose }: ViewProps) {
  const t = useUi().motion;
  const repos = list.status === 'ready' ? list.repos : [];
  return (
    <SettingsSection
      id="set-repos"
      title="Repositories"
      lead="The git repositories on the server’s machine that Claude Code can work in. Opsaip only remembers them: it never deletes your files, branches or worktrees."
    >
      <Card label="Repositories">
        {list.status === 'loading' && <SettingRow title="Reading the list…">{null}</SettingRow>}
        {list.status === 'off' && <SettingRow title="Not available" description={REPOS_OFF_NOTE}>{null}</SettingRow>}
        {list.status === 'failed' && <SettingRow title="Could not read the list" description={list.text}>{null}</SettingRow>}
        {list.status === 'ready' && repos.length === 0 && (
          <SettingRow title="No repositories yet" description="Add one below. Conductor mode turns on as soon as there is one.">{null}</SettingRow>
        )}
        {repos.map((repo, i) => (
          <motion.div key={repo.id} className="op-repo-item" {...listItem(t, i)}>
            <SettingRow
              title={repo.name}
              description={
                <>
                  <span className="op-repo-path">{repo.path}</span>
                  {repo.isDefault && ' · Set by OPSAIP_CONDUCTOR_DIR on the server: unset it there and restart to drop it.'}
                  {problem?.on === repo.id && <span className="op-repo-problem" role="alert">{problem.text}</span>}
                </>
              }
            >
              {repo.isDefault ? (
                <span className="op-about-v">Default</span>
              ) : (
                <button type="button" className="op-sbtn" disabled={busy !== null} onClick={() => onRemove(repo)}>
                  {busy === repo.id ? 'Removing…' : 'Remove'}
                </button>
              )}
            </SettingRow>
          </motion.div>
        ))}
        {list.status !== 'off' && (
          <SettingRow
            block
            title="Add a repository"
            description="Paste the absolute path of the repository’s top folder. The server checks it and says why if it cannot be used."
          >
            <form className="op-conn-form op-repo-form" onSubmit={onAdd} noValidate>
              <div className="op-conn-fields">
                <input
                  ref={pathInput}
                  className="op-field op-mono"
                  type="text"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck={false}
                  aria-label="Repository path"
                  aria-invalid={problem?.on === 'add'}
                  aria-describedby={problem?.on === 'add' ? 'op-repo-add-problem' : undefined}
                  value={path}
                  onChange={(e) => onPath(e.target.value)}
                />
                {canChoose && (
                  <button type="button" className="op-sbtn" disabled={busy !== null} onClick={onChoose}>Choose folder</button>
                )}
                <button type="submit" className="op-sbtn op-sbtn-primary" disabled={path.trim() === '' || busy !== null}>
                  {busy === 'add' ? 'Adding…' : 'Add'}
                </button>
              </div>
              {problem?.on === 'add' && <p className="op-conn-problem" id="op-repo-add-problem" role="alert">{problem.text}</p>}
            </form>
          </SettingRow>
        )}
      </Card>
      <p ref={status} tabIndex={-1} className="op-set-d op-repo-status" role="status">{done}</p>
    </SettingsSection>
  );
}
