import { describeSource } from '../../data/connectionView';
import { useWorkspace } from '../../state/workspace';
import { useNow } from '../../lib/useNow';
import { Card, SettingRow, SettingsSection } from './parts';
import { TokenForm } from './TokenForm';

/**
 * The connection to the Opsaip server. Unlike the preview settings, this one
 * is real: the token is saved for this tab and the app starts polling.
 *
 * The token input has no `name`, and the form never submits natively, so the
 * token cannot end up in a URL even if the submit handler failed.
 */
export function ServerSettings() {
  const { source, disconnect } = useWorkspace();
  const now = useNow(5_000);
  const view = describeSource(source, now.getTime());
  const connected = source.status !== 'demo' && source.status !== 'disconnected';
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
          <SettingRow
            block
            title="Access token"
            description="The server’s OPSAIP_TOKEN. It stays in this browser tab until you close the tab or disconnect, and is sent only to this server."
          >
            <TokenForm />
          </SettingRow>
        )}
      </Card>
    </SettingsSection>
  );
}
