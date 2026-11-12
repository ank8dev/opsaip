import { useState, type FormEvent } from 'react';
import { describeSource } from '../../data/connectionView';
import { useWorkspace } from '../../state/workspace';
import { useNow } from '../../lib/useNow';
import { Card, SettingRow, SettingsSection } from './parts';

/**
 * The connection to the Opsaip server. Unlike the preview settings, this one
 * is real: the token is saved for this tab and the app starts polling.
 *
 * The token input has no `name`, and the form never submits natively, so the
 * token cannot end up in a URL even if the submit handler failed.
 */
export function ServerSettings() {
  const { source, connect, disconnect } = useWorkspace();
  const now = useNow(5_000);
  const view = describeSource(source, now.getTime());
  const connected = source.status !== 'demo';
  const [token, setToken] = useState('');
  const [problem, setProblem] = useState<string | undefined>();

  function submit(e: FormEvent) {
    e.preventDefault();
    const p = connect(token);
    setProblem(p);
    if (p === undefined) setToken(''); // do not keep the token in the field
  }

  return (
    <SettingsSection id="set-server" title="Server" lead="Your Opsaip server. Unlike the previews below, this setting is real.">
      <Card>
        <SettingRow
          title={
            <span className="op-conn-state" data-tone={view.tone}>
              <span className="op-conn-dot" aria-hidden="true" />
              {view.label}
            </span>
          }
          description={view.detail}
        >
          {connected && (
            <button type="button" className="op-sbtn" onClick={disconnect}>Disconnect</button>
          )}
        </SettingRow>
        {!connected && (
          <form className="op-conn-form" onSubmit={submit} noValidate>
            <SettingRow
              block
              title="Access token"
              description="The server’s OPSAIP_TOKEN. It stays in this browser tab until you close the tab or disconnect, and is sent only to this server, in a request header."
            >
              <div className="op-conn-fields">
                <input
                  className="op-field"
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  aria-label="Access token"
                  aria-invalid={problem !== undefined}
                  aria-describedby={problem ? 'op-conn-problem' : undefined}
                  value={token}
                  onChange={(e) => { setToken(e.target.value); setProblem(undefined); }}
                />
                <button type="submit" className="op-sbtn op-sbtn-primary" disabled={!token.trim()}>Connect</button>
              </div>
              {problem && <p className="op-conn-problem" id="op-conn-problem" role="alert">{problem}</p>}
            </SettingRow>
          </form>
        )}
      </Card>
    </SettingsSection>
  );
}
