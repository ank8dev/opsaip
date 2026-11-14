import { useState, type FormEvent } from 'react';
import { useWorkspace } from '../../state/workspace';

/**
 * The access-token field and the Connect button. Used by the Connect screen
 * and by Settings → Server (Demo in dev).
 *
 * The token input has no `name`, and the form never submits natively, so the
 * token cannot end up in a URL even if the submit handler failed.
 */
export function TokenForm({ label = 'Access token' }: { label?: string }) {
  const { connect } = useWorkspace();
  const [token, setToken] = useState('');
  const [problem, setProblem] = useState<string | undefined>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = connect(token);
    setProblem(p);
    if (p === undefined) setToken(''); // do not keep the token in the field
  }

  return (
    <form className="op-conn-form" onSubmit={submit} noValidate>
      <div className="op-conn-fields">
        <input
          className="op-field"
          type="password"
          autoComplete="off"
          spellCheck={false}
          aria-label={label}
          aria-invalid={problem !== undefined}
          aria-describedby={problem ? 'op-conn-problem' : undefined}
          value={token}
          onChange={(e) => { setToken(e.target.value); setProblem(undefined); }}
        />
        <button type="submit" className="op-sbtn op-sbtn-primary" disabled={!token.trim()}>Connect</button>
      </div>
      {problem && <p className="op-conn-problem" id="op-conn-problem" role="alert">{problem}</p>}
    </form>
  );
}
