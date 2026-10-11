import { ago, byStatus, mcpSummary, tasksForConnection } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { useNow } from '../../lib/useNow';
import { McpDot } from '../common/StatusDot';
import { Fact, MiniTask } from '../common/MiniTask';
import { ExpandRow, Group, SectionLabel, useSearchHit, type SectionMode } from './parts';

const DIRECTIONS = [
  {
    dir: 'in' as const,
    label: 'Agents reporting in',
    note: 'Claude Code and Codex connect to the Opsaip MCP server and report each task and its status.',
    empty: 'No agents connected yet',
  },
  {
    dir: 'out' as const,
    label: 'Tools Opsaip uses',
    note: "MCP servers Opsaip calls to act in your team's tools.",
    empty: 'No tool servers connected yet',
  },
];

/** MCP links in both directions: agents reporting in, tool servers Opsaip calls. */
export function McpSection({ mode }: { mode: SectionMode }) {
  const { ws, tasks, people } = useWorkspace();
  const { query } = useUi();
  const now = useNow();
  const hit = useSearchHit();

  const lists = DIRECTIONS.map((d) => {
    const conns = ws.mcp.filter((c) => c.direction === d.dir);
    const matches = conns.map((c) => hit(c.name, c.status, c.tools, c.endpoint, c.note, people[c.owner]?.name));
    return { ...d, conns, matches, shown: matches.filter(Boolean).length };
  });
  if (mode === 'all' && !lists.some((l) => l.shown)) return null;

  return (
    <div className="op-sv" role="region" aria-label="MCP">
      <SectionLabel mode={mode}>MCP</SectionLabel>
      {lists.map(({ dir, label, note, empty, conns, matches, shown }) => {
        const sum = mcpSummary(ws.mcp, dir);
        return (
          <Group key={dir} label={label} count={sum.connected} note={note} hidden={!!query && !shown}>
            {conns.map((c, idx) => {
              const owner = people[c.owner];
              const live = c.status === 'Connected';
              const related = tasksForConnection(c, tasks).sort(byStatus);
              return (
                <ExpandRow
                  key={c.id}
                  index={idx}
                  hidden={!matches[idx]}
                  summaryClass={live ? '' : 'op-off'}
                  summary={
                    <>
                      <McpDot status={c.status} />
                      <span className="op-person-name">{c.name}</span>
                      <span className="op-person-time">{ago(c.last_seen, now.getTime())}</span>
                      <span className="op-person-sub">
                        {dir === 'in' && owner && `${owner.name} · `}
                        <span className="op-n">{related.length}</span> {related.length === 1 ? 'task' : 'tasks'}
                        {!live && (
                          <> · <span className={c.status === 'Offline' ? '' : 'op-mcp-bad'}>{c.status}</span></>
                        )}
                      </span>
                    </>
                  }
                  details={
                    <>
                      <Fact k="Status" v={c.status + (c.note && !live ? ` · ${c.note}` : '')} />
                      {dir === 'in' ? (
                        <>
                          <Fact k="Person" v={owner?.name} />
                          <Fact k="Where" v={c.note} />
                        </>
                      ) : (
                        <Fact k="Server" v={c.endpoint} mono />
                      )}
                      <Fact k="Auth" v={[c.transport, c.auth].filter(Boolean).join(' · ')} />
                      <Fact k={dir === 'in' ? 'Calls' : 'Tools'} v={c.tools} mono />
                      {related.map((t) => <MiniTask key={t.id} task={t} />)}
                    </>
                  }
                />
              );
            })}
            {!conns.length && !query && <li className="op-empty">{empty}</li>}
          </Group>
        );
      })}
    </div>
  );
}
