import { useMemo } from 'react';
import { clockFor } from '../../data/selectors';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { Face } from '../common/Face';
import { McpDot } from '../common/StatusDot';
import { opts, type PickerOption } from '../common/Picker';
import { Card, HOURS, LocalPicker, PreviewButton, SettingRow, SettingsSection } from './parts';

/** Slack connection as a dot and words: "Connected · you · tessera workspace". */
export function SlackStatus() {
  const { ws } = useWorkspace();
  const slack = ws.channels.find((c) => c.channel === 'Slack');
  if (!slack) return <span className="op-status">—</span>;
  return (
    <span className="op-status">
      <McpDot status={slack.status} />
      {slack.status === 'Connected' ? `Connected · ${slack.account}` : slack.status}
    </span>
  );
}

function timeZones(): PickerOption[] {
  let here = 'UTC';
  try { here = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'; } catch { /* keep UTC */ }
  let zones: string[] = [];
  try { zones = Intl.supportedValuesOf('timeZone'); } catch { /* old browser */ }
  if (!zones.length) zones = [here];
  return [
    { value: 'auto', label: `Automatic · ${here.replace(/_/g, ' ')}` },
    ...zones.map((z) => ({ value: z, label: z.replace(/_/g, ' ') })),
  ];
}

export function ProfileSettings() {
  const ui = useUi();
  const zones = useMemo(timeZones, []);
  return (
    <SettingsSection id="set-profile" title="Profile" lead="How teammates see you, and when Opsaip may interrupt you.">
      <Card>
        <SettingRow title="Name" description="Shown on tasks you create and on messages Opsaip sends for you.">
          <input className="op-field" type="text" autoComplete="off" aria-label="Name" value={ui.userName} onChange={(e) => ui.setUserName(e.target.value)} />
        </SettingRow>
        <SettingRow title="Time zone" description="Sets your local time in Team, your work hours and your quiet hours.">
          <LocalPicker ariaLabel="Time zone" options={zones} defaultValue="auto" />
        </SettingRow>
        <SettingRow title="Work hours" description="Teammates see when you are at work. Outside these hours Opsaip holds anything that is not urgent.">
          <LocalPicker ariaLabel="Start of work" options={HOURS} defaultValue="10" />
          <span>to</span>
          <LocalPicker ariaLabel="End of work" options={HOURS} defaultValue="19" />
        </SettingRow>
        <SettingRow title="Slack account" description="Messages and announcements you send from Opsaip go out under this account.">
          <SlackStatus />
          <PreviewButton label="Disconnect" preview="Preview — Slack stays connected." />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}

export function WorkspaceSettings() {
  const { ws, people } = useWorkspace();
  const { userName } = useUi();
  const now = new Date();
  const name = userName.trim() || 'You';
  return (
    <SettingsSection
      id="set-workspace"
      title="Workspace"
      lead="Who is in the team and what they may do in Opsaip. Owner: billing and deleting the workspace. Admin: connections, roles and settings. Member: tasks, messages and their own agents. Viewer: can look, can’t change."
    >
      <Card>
        <SettingRow title="Workspace name" description="Shown in the sidebar and in Slack messages from Opsaip.">
          <input className="op-field" type="text" defaultValue="Tessera" autoComplete="off" aria-label="Workspace name" />
        </SettingRow>
      </Card>
      <ul className="op-set-card" aria-label="Members">
        <li className="op-set-item">
          <Face label={name.charAt(0).toUpperCase()} on />
          <span className="op-set-item-txt">
            <span className="op-set-item-name">{name}</span>
            <span className="op-set-item-sub">That’s you</span>
          </span>
          <span className="op-set-role">Owner</span>
        </li>
        {ws.members.map((m) => {
          const p = people[m.person];
          if (!p) return null;
          return (
            <li key={m.person} className="op-set-item">
              <Face person={p} on={clockFor(p, now).working} />
              <span className="op-set-item-txt">
                <span className="op-set-item-name">{p.name}</span>
                <span className="op-set-item-sub">{p.role}</span>
              </span>
              <LocalPicker ariaLabel={`Role for ${p.name}`} options={opts([['Admin', 'Admin'], ['Member', 'Member'], ['Viewer', 'Viewer']])} defaultValue={m.role} />
            </li>
          );
        })}
      </ul>
      <Card>
        <SettingRow title="Invite a teammate" description="They join as a Member; an admin can change the role later.">
          <PreviewButton label="Invite" preview="Preview — no invite was sent." />
        </SettingRow>
        <SettingRow title="Assign tasks to others" description="Who can put a task on a teammate’s list.">
          <LocalPicker ariaLabel="Who can assign tasks" options={opts([['members', 'Members and up'], ['admins', 'Admins only']])} defaultValue="members" />
        </SettingRow>
        <SettingRow title="Queue work for someone’s agent" description="Agents run on their owner’s machine and account, so by default the owner approves first.">
          <LocalPicker
            ariaLabel="Queue work for other agents"
            options={opts([['ask', 'Ask the owner first'], ['admins', 'Admins, no asking'], ['never', 'Never']])}
            defaultValue="ask"
          />
        </SettingRow>
        <SettingRow title="Announce to the whole team" description="Who can post with Announce.">
          <LocalPicker ariaLabel="Who can announce" options={opts([['admins', 'Admins only'], ['members', 'Members and up']])} defaultValue="admins" />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}
