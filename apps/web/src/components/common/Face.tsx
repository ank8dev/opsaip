import type { Person } from '../../types';

interface FaceProps {
  person?: Person;
  /** Shown instead of initials, e.g. "Y" for you. */
  label?: string;
  /** Inside work hours: the presence dot fills. */
  on?: boolean;
  small?: boolean;
}

/** A person: initials in a circle, with a presence dot. */
export function Face({ person, label, on = false, small = false }: FaceProps) {
  return (
    <span className={`op-face${small ? ' op-face-small' : ''}`} data-on={on} title={person?.name}>
      {label ?? person?.initials}
    </span>
  );
}
