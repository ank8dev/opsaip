import { useAppInfo } from '../../state/appInfo';

/** A quiet note in the sidebar when a newer release exists. A link to the release only: nothing is downloaded or installed. */
export function UpdateNote() {
  const { update } = useAppInfo();
  if (update === null || !update.newer || update.url === null || update.latest === null) return null;
  return (
    <p className="op-update">
      <a href={update.url} target="_blank" rel="noopener noreferrer">Update available · {update.latest}</a>
    </p>
  );
}
