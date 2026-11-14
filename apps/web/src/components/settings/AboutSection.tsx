import { APP_VERSION, updateText } from '../../data/about';
import { useAppInfo } from '../../state/appInfo';
import { useWorkspace } from '../../state/workspace';
import { Card, SettingRow, SettingsSection } from './parts';

/** Settings → About: the app, server, Claude Code and Node versions, and whether a newer release is out. */
export function AboutSettings() {
  const { readOnly } = useWorkspace();
  const { about, update } = useAppInfo();
  const unknown = readOnly ? 'Unknown' : 'Not connected';
  return (
    <SettingsSection id="set-about" title="About" lead="Versions of what is running.">
      <Card>
        <SettingRow title="App" description="This web app."><span className="op-about-v">{APP_VERSION}</span></SettingRow>
        <SettingRow title="Server" description="Your Opsaip server."><span className="op-about-v">{about?.serverVersion ?? unknown}</span></SettingRow>
        <SettingRow title="Claude Code" description="The CLI the server found for Agent mode.">
          <span className="op-about-v">{about === null ? unknown : (about.claude ?? 'Not found')}</span>
        </SettingRow>
        <SettingRow title="Node.js" description="Runs your server."><span className="op-about-v">{about?.node ?? unknown}</span></SettingRow>
        <SettingRow
          title="Updates"
          description="The server checks GitHub Releases once a day. Nothing is downloaded or installed for you: the app is not signed."
        >
          <span className="op-about-v">
            {updateText(update)}
            {update?.newer && update.url !== null && (
              <> <a href={update.url} target="_blank" rel="noopener noreferrer">View release</a></>
            )}
          </span>
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}
