import { ago, clockFor } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { useNow } from '../../lib/useNow';
import { Face } from '../common/Face';
import { McpDot, StatusDot } from '../common/StatusDot';
import { Fact } from '../common/MiniTask';
import { Group, Row, SectionLabel, useSearchHit, type SectionMode } from './parts';

/** The shared Git repository: who may do what in it, and open branches tied to tasks. */
export function RepoSection({ mode }: { mode: SectionMode }) {
  const { ws, people, findTask } = useWorkspace();
  const { query, openTask } = useUi();
  const now = useNow();
  const hit = useSearchHit();
  const repo = ws.repo;

  const access = ws.repoAccess
    .filter((a) => people[a.person])
    .map((a) => ({ a, p: people[a.person], ok: hit(people[a.person].name, a.role, a.agent_rights) }));
  const branches = ws.branches
    .filter((b) => b.state === 'Open')
    .map((b) => {
      const t = b.task ? findTask(b.task) : null;
      return { b, t, p: people[b.person], ok: hit(b.branch, b.pr, people[b.person]?.name, t?.task) };
    });
  const shownAccess = access.filter((x) => x.ok).length;
  const shownBranches = branches.filter((x) => x.ok).length;
  if (mode === 'all' && !shownAccess && !shownBranches) return null;

  const lastPushBy = repo ? people[repo.last_push_by] : undefined;

  return (
    <div className="op-sv" role="region" aria-label="Repo">
      <SectionLabel mode={mode}>Repo</SectionLabel>
      {!query && (
        <section className="op-repo" aria-label="Repository">
          <span className="op-repo-name">{repo?.name ?? '—'}</span>
          <span className="op-repo-url">{repo?.url ?? '—'}</span>
          <Fact k="Main branch" v={repo?.default_branch} mono />
          <Fact k="Rule" v={repo?.protection} />
          <Fact k="Visibility" v={repo?.visibility} />
          <Fact k="Last push" v={repo ? [ago(repo.last_push, now.getTime()), lastPushBy?.name].filter(Boolean).join(' · ') : ''} />
        </section>
      )}

      <Group label="Access" count={access.length} hidden={!!query && !shownAccess}>
        {access.map(({ a, p, ok }, idx) => (
          <Row key={a.person} index={idx} hidden={!ok}>
            <div className="op-person">
              <Face person={p} on={clockFor(p, now).working} />
              <span className="op-person-name">{p.name}</span>
              <span className="op-role">{a.role}</span>
              <span className="op-person-sub">Agents: {a.agent_rights}</span>
            </div>
          </Row>
        ))}
      </Group>

      <Group label="Open branches" count={branches.length} hidden={!!query && !shownBranches}>
        {branches.map(({ b, t, p, ok }, idx) => {
          const body = (
            <>
              {t ? <StatusDot status={t.status} batonKey={t.id} /> : <McpDot status="Offline" />}
              <span className="op-person-name op-branch-name">{b.branch}</span>
              <span className="op-person-time">{b.pr || ago(b.updated, now.getTime())}</span>
              <span className="op-person-sub">
                {[p?.name, t?.task, ago(b.updated, now.getTime())].filter(Boolean).join(' · ')}
              </span>
            </>
          );
          return (
            <Row key={b.branch} index={idx} hidden={!ok}>
              {t ? (
                <button type="button" className="op-person" onClick={() => openTask(t.id)}>{body}</button>
              ) : (
                <div className="op-person">{body}</div>
              )}
            </Row>
          );
        })}
        {!branches.length && !query && <li className="op-empty">No open branches</li>}
      </Group>
    </div>
  );
}
