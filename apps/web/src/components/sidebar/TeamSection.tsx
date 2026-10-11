import { byStatus, clockFor, pad2, runningAgents } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { useNow } from '../../lib/useNow';
import { Face } from '../common/Face';
import { Fact, MiniTask } from '../common/MiniTask';
import { ExpandRow, Group, SectionLabel, useSearchHit, type SectionMode } from './parts';
import { WorkHours } from './WorkHours';

/** Teammates at work and off hours. A row opens to show what they are changing. */
export function TeamSection({ mode }: { mode: SectionMode }) {
  const { ws, tasks } = useWorkspace();
  const { query } = useUi();
  const now = useNow();
  const hit = useSearchHit();

  const people = ws.team.map((p) => ({ p, clock: clockFor(p, now), ok: hit(p.name, p.role, p.focus, p.changing) }));
  const onCount = people.filter((x) => x.ok && x.clock.working).length;
  const offCount = people.filter((x) => x.ok && !x.clock.working).length;
  if (mode === 'all' && !onCount && !offCount) return null;

  const rows = (working: boolean) =>
    people
      .filter((x) => x.clock.working === working)
      .map(({ p, clock, ok }, idx) => {
        const n = runningAgents(p.id, tasks);
        return (
          <ExpandRow
            key={p.id}
            index={idx}
            hidden={!ok}
            summaryClass={working ? '' : 'op-off'}
            summary={
              <>
                <Face person={p} on={working} />
                <span className="op-person-name">{p.name}</span>
                <span className="op-person-time">{clock.text}</span>
                <span className="op-person-sub">
                  <span className="op-n">{n}</span> {n === 1 ? 'agent' : 'agents'} · {p.focus}
                </span>
              </>
            }
            details={
              <>
                <Fact k="Role" v={p.role} />
                <Fact k="Now" v={p.focus} />
                <Fact k="Changing" v={p.changing} mono />
                <Fact k="Hours" v={`${pad2(p.start)}:00–${pad2(p.end)}:00 local`} mono />
                {tasks
                  .filter((t) => t.owner === p.id)
                  .sort(byStatus)
                  .map((t) => <MiniTask key={t.id} task={t} />)}
              </>
            }
          />
        );
      });

  return (
    <div className="op-sv" role="region" aria-label="Team">
      <SectionLabel mode={mode}>Team</SectionLabel>
      <Group label="At work" hidden={!onCount}>{rows(true)}</Group>
      <Group label="Off hours" hidden={!offCount}>{rows(false)}</Group>
      {!query && <WorkHours now={now} />}
    </div>
  );
}
