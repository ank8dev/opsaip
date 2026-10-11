import type { Task } from '../../types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { SyncDot } from '../common/StatusDot';

/** A task's Linear issue, GitHub PR and Notion page, and whether they agree. */
export function LinkedItems({ task }: { task: Task }) {
  const { linksFor, linkNote, resolveConflict, linkSuggestion, dismissSuggestion } = useWorkspace();
  const { statusOwner } = useUi();
  const links = linksFor(task.id);
  const conflict = links.find((l) => l.sync === 'Conflict');

  return (
    <div className="op-links" aria-label="Linked items">
      <div className="op-links-h">
        <span>Linked</span>
        <span>Status comes from {statusOwner}</span>
      </div>

      {!links.length && <div className="op-links-empty">Not linked to Linear, GitHub or Notion yet</div>}

      {links.map((l) => (
        <div
          key={l.id}
          className={`op-link${l.sync === 'Conflict' ? ' op-link-bad' : ''}${l.sync === 'Suggested' ? ' op-link-sug' : ''}`}
        >
          <span className="op-tag">{l.tool}</span>
          <span className="op-link-mid">
            <span className="op-link-ref">{l.ref}{l.title && ` · ${l.title}`}</span>
            <span className="op-link-state">{l.state} → {l.status}</span>
          </span>
          <span className="op-link-sync"><SyncDot sync={l.sync} /><span>{l.sync}</span></span>
          {l.sync === 'Suggested' && (
            <div className="op-link-more">
              <div>Suggested by Opsaip AI · {l.note}</div>
              <div className="op-link-acts">
                <button type="button" className="op-sbtn" onClick={() => linkSuggestion(task.id, l)}>Link</button>
                <button type="button" className="op-sbtn" onClick={() => dismissSuggestion(task.id, l)}>Dismiss</button>
              </div>
            </div>
          )}
        </div>
      ))}

      {conflict && (
        <div className="op-link-fix">
          <p className="op-link-why">{conflict.note}</p>
          <div className="op-link-acts">
            {links
              .filter((l) => l.sync !== 'Suggested')
              .sort((a, b) => Number(b.tool === statusOwner) - Number(a.tool === statusOwner))
              .map((l) => (
                <button
                  key={l.id}
                  type="button"
                  className={`op-sbtn${l.tool === statusOwner ? ' op-sbtn-primary' : ''}`}
                  onClick={() => resolveConflict(task.id, l)}
                >
                  Use {l.tool} · {l.status}
                </button>
              ))}
          </div>
        </div>
      )}

      <p className="op-links-note" aria-live="polite">{linkNote(task.id)}</p>
    </div>
  );
}
