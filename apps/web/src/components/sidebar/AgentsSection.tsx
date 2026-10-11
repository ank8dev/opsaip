import type { AnyTask, TaskStatus } from '../../types';
import { isLocal } from '../../types';
import { byImportance } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { Face } from '../common/Face';
import { StatusDot } from '../common/StatusDot';
import { Group, Row, SectionLabel, useSearchHit, type SectionMode } from './parts';

const GROUPS: { status: TaskStatus; label: string }[] = [
  { status: 'Needs you', label: 'Needs you' },
  { status: 'Working', label: 'Working' },
  { status: 'Failed', label: 'Failed' },
  { status: 'Queued', label: 'Queued' },
  { status: 'Done', label: 'Done' },
];

/** Every agent task, grouped by status. Tasks you started come first. */
export function AgentsSection({ mode }: { mode: SectionMode }) {
  const { tasks, localTasks, people, syncFlag } = useWorkspace();
  const { openTaskId, openTask } = useUi();
  const hit = useSearchHit();

  const groups = [
    { key: 'local', label: 'Started by you', items: localTasks as AnyTask[], counted: false },
    ...GROUPS.map((g) => ({
      key: g.status,
      label: g.label,
      items: tasks.filter((t) => t.status === g.status).sort(byImportance) as AnyTask[],
      counted: true,
    })),
  ];

  const matches = (t: AnyTask) => hit(t.task, t.detail, t.tool, isLocal(t) ? 'you' : people[t.owner]?.name);
  if (mode === 'all' && !groups.some((g) => g.items.some(matches))) return null;

  let i = 0;
  return (
    <div className="op-sv" role="region" aria-label="Agents">
      <SectionLabel mode={mode}>Agents</SectionLabel>
      {groups.map((g) => {
        if (!g.items.length) return null;
        const shown = g.items.filter(matches).length;
        return (
          <Group key={g.key} label={g.label} count={g.counted ? g.items.length : undefined} fail={g.key === 'Failed'} hidden={!shown}>
            {g.items.map((t) => {
              const owner = isLocal(t) ? undefined : people[t.owner];
              return (
                <Row key={t.id} index={i++} hidden={!matches(t)}>
                  <button
                    type="button"
                    className="op-arow"
                    data-current={t.id === openTaskId || undefined}
                    onClick={() => openTask(t.id)}
                  >
                    <StatusDot status={t.status} batonKey={t.id} />
                    <span className="op-arow-title">{t.task}</span>
                    {owner ? <Face person={owner} small /> : <Face label="Y" small />}
                    <span className="op-arow-sub">
                      {[t.tool, t.detail].filter(Boolean).join(' · ')}
                      {!isLocal(t) && syncFlag(t.id) === 'conflict' && (
                        <> · <span className="op-flag">Out of sync</span></>
                      )}
                    </span>
                  </button>
                </Row>
              );
            })}
          </Group>
        );
      })}
    </div>
  );
}
