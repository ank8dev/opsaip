import { useState } from 'react';
import type { TrayLevel } from '../../data/selectors';
import { useUi, type MotionChoice, type ThemeChoice } from '../../state/ui';
import { Picker, opts } from '../common/Picker';
import { Card, LocalPicker, PreviewButton, SettingRow, SettingsSection, usePreview } from './parts';

const EVENTS: [string, string, boolean, boolean][] = [
  ['Needs you', 'An agent waits for an answer', true, true],
  ['Failed', 'A task stopped with an error', true, true],
  ['Done', 'A task you created finished', true, false],
  ['Agent offline', 'No heartbeat from an agent', true, false],
  ['Daily summary', 'What moved since yesterday', false, true],
];

export function NotificationSettings() {
  const { trayLevel, setTrayLevel } = useUi();
  return (
    <SettingsSection id="set-notify" title="Notifications" lead="What reaches you, and where.">
      <Card>
        <div className="op-table-wrap">
          <table className="op-matrix">
            <thead>
              <tr><th scope="col">Event</th><th scope="col">In Opsaip</th><th scope="col">Slack DM</th></tr>
            </thead>
            <tbody>
              {EVENTS.map(([name, hint, app, slack]) => (
                <tr key={name}>
                  <td>{name}<span>{hint}</span></td>
                  <td><input type="checkbox" aria-label={`${name} in Opsaip`} defaultChecked={app} /></td>
                  <td><input type="checkbox" aria-label={`${name} in Slack`} defaultChecked={slack} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <SettingRow title="Under the composer" description="Only decisions at this level show up next to the input. Everything else stays in the sidebar.">
          <Picker
            ariaLabel="Show under the composer"
            value={trayLevel}
            onChange={(v) => setTrayLevel(v as TrayLevel)}
            options={opts([['urgent', 'Urgent only'], ['high', 'Urgent and High'], ['all', 'Everything that needs me']])}
          />
        </SettingRow>
        <SettingRow title="Quiet hours" description="During quiet hours only Needs you and Failed reach Slack; the rest waits in Opsaip.">
          <LocalPicker ariaLabel="Quiet hours" options={opts([['work', 'Outside my work hours'], ['never', 'Never']])} defaultValue="work" />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}

export function AppearanceSettings() {
  const ui = useUi();
  return (
    <SettingsSection id="set-look" title="Appearance" lead="How Opsaip looks on this device.">
      <Card>
        <SettingRow title="Theme" description="System follows your device.">
          <Picker
            ariaLabel="Theme"
            value={ui.themeChoice}
            onChange={(v) => ui.setThemeChoice(v as ThemeChoice)}
            options={opts([['system', 'System'], ['light', 'Light'], ['dark', 'Dark']])}
          />
        </SettingRow>
        <SettingRow title="Motion" description="Turns off slides and fades if they bother you.">
          <Picker
            ariaLabel="Motion"
            value={ui.motionChoice}
            onChange={(v) => ui.setMotionChoice(v as MotionChoice)}
            options={opts([['system', 'Follow system'], ['reduce', 'Reduce']])}
          />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}

export function DataSettings() {
  const preview = usePreview();
  const [armed, setArmed] = useState(false);
  return (
    <SettingsSection
      id="set-data"
      title="Data & privacy"
      lead="Opsaip stores tasks, statuses, branch names and who did what. Code stays in your repository; chat transcripts only if agents send them."
    >
      <Card>
        <SettingRow title="Keep transcripts for" description="Older transcripts are deleted; tasks and their history stay.">
          <LocalPicker ariaLabel="Keep transcripts for" options={opts([['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['forever', 'Forever']])} defaultValue="30" />
        </SettingRow>
        <SettingRow title="Export workspace data" description="Tasks, people and settings as one JSON file.">
          <PreviewButton label="Export" preview="Preview — nothing was exported." />
        </SettingRow>
        <SettingRow title="Delete workspace" description="Removes tasks, history and connections for everyone. Owner only; can’t be undone.">
          {/* Two clicks: the first arms the button for 4 seconds */}
          <button
            type="button"
            className="op-sbtn op-sbtn-danger"
            onClick={() => {
              if (armed) {
                setArmed(false);
                preview('Preview — nothing was deleted.');
              } else {
                setArmed(true);
                window.setTimeout(() => setArmed(false), 4000);
              }
            }}
          >
            {armed ? 'Click again to delete' : 'Delete workspace'}
          </button>
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}
