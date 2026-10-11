import { useState } from 'react';
import type { ToolName } from '../../types';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { Choices } from '../common/Choices';
import { Picker, opts } from '../common/Picker';
import { Switch } from '../common/Switch';
import { Card, LocalPicker, PreviewButton, SettingRow, SettingsSection } from './parts';
import { SlackStatus } from './PeopleSections';

const DIRECTIONS = opts([['two', 'Two-way'], ['out', 'Opsaip → tool only'], ['in', 'Read only'], ['off', 'Off']]);

export function SyncSettings() {
  const { ws } = useWorkspace();
  const { statusOwner, setStatusOwner } = useUi();
  return (
    <SettingsSection
      id="set-sync"
      title="Sync"
      lead="Opsaip keeps each task in step across Linear, GitHub and Notion. Every field has one tool that owns it; the others follow. Plain code does the routine syncing; Opsaip AI only proposes the status mapping and suggests links."
    >
      <h3 className="op-set-sub">Source of truth</h3>
      <Card>
        <SettingRow title="Status" description="For code tasks, real pull requests are the most honest signal, so status can’t drift from the code.">
          <Picker
            ariaLabel="Status comes from"
            value={statusOwner}
            onChange={(v) => setStatusOwner(v as ToolName)}
            options={opts([['GitHub', 'GitHub'], ['Linear', 'Linear'], ['Notion', 'Notion']])}
          />
        </SettingRow>
        <SettingRow title="Priority and sprint" description="Planning stays where the team plans.">
          <LocalPicker ariaLabel="Priority and sprint come from" options={opts([['Linear', 'Linear'], ['Opsaip', 'Opsaip']])} defaultValue="Linear" />
        </SettingRow>
        <SettingRow title="Description and notes" description="Long text lives in docs; the others get a link.">
          <LocalPicker ariaLabel="Description comes from" options={opts([['Notion', 'Notion'], ['Linear', 'Linear']])} defaultValue="Notion" />
        </SettingRow>
        <SettingRow title="Assignee" description="Opsaip assigns people and agents, then writes it everywhere.">
          <LocalPicker ariaLabel="Assignee comes from" options={opts([['Opsaip', 'Opsaip'], ['Linear', 'Linear']])} defaultValue="Opsaip" />
        </SettingRow>
      </Card>

      <h3 className="op-set-sub">Status mapping</h3>
      <p className="op-set-small">
        Each tool names its states differently. Proposed by Opsaip AI from your Linear workflow and Notion Status options — check it before sync goes live.
      </p>
      <Card>
        <div className="op-table-wrap">
          <table className="op-matrix op-map">
            <thead>
              <tr><th scope="col">Opsaip</th><th scope="col">Linear</th><th scope="col">GitHub</th><th scope="col">Notion</th></tr>
            </thead>
            <tbody>
              {ws.statusMap.map((m) => (
                <tr key={m.status}><td>{m.status}</td><td>{m.linear}</td><td>{m.github}</td><td>{m.notion}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card>
        <SettingRow title="Propose the mapping again" description="Run this after you change states in Linear or Status options in Notion.">
          <PreviewButton label="Propose again" preview="Preview — the mapping was not changed." />
        </SettingRow>
      </Card>

      <h3 className="op-set-sub">Per tool</h3>
      <Card>
        <SettingRow title="Linear" description="Opsaip reads changes and writes status back.">
          <LocalPicker ariaLabel="Linear sync" options={DIRECTIONS} defaultValue="two" />
        </SettingRow>
        <SettingRow title="GitHub" description="Read only: a pull request’s state comes from the real PR, Opsaip never fakes it.">
          <LocalPicker ariaLabel="GitHub sync" options={DIRECTIONS} defaultValue="in" />
        </SettingRow>
        <SettingRow title="Notion" description="Opsaip reads changes and writes status back.">
          <LocalPicker ariaLabel="Notion sync" options={DIRECTIONS} defaultValue="two" />
        </SettingRow>
      </Card>

      <h3 className="op-set-sub">When tools disagree</h3>
      <Card>
        <SettingRow title="Conflicts" description="Ask while you build trust in the mapping; later the source of truth can win on its own.">
          <LocalPicker ariaLabel="Conflicts" options={opts([['ask', 'Ask me every time'], ['owner', 'Source of truth wins automatically']])} defaultValue="ask" />
        </SettingRow>
        <SettingRow title="Suggest links with AI" description="When a PR, issue or page looks like it belongs to a task (same branch, id or title), Opsaip suggests linking it. You confirm.">
          <Switch label="Suggest links with AI" defaultOn />
        </SettingRow>
        <SettingRow title="Catch-up check" description="Webhooks bring changes right away; this check finds any that got lost.">
          <LocalPicker ariaLabel="Catch-up check" options={opts([['5', 'Every 5 minutes'], ['15', 'Every 15 minutes'], ['60', 'Every hour']])} defaultValue="15" />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}

export function RepositorySettings() {
  const { ws } = useWorkspace();
  const repo = ws.repo;
  const [pattern, setPattern] = useState('{type}/{slug}-{task}');
  const example = pattern.replace(/\{type\}/g, 'fix').replace(/\{slug\}/g, 'login-bug').replace(/\{task\}/g, 't2');
  return (
    <SettingsSection
      id="set-repo"
      title="Repository"
      lead="The Git repository the team works in. GitHub enforces the rules; Opsaip shows them and names agent branches after tasks."
    >
      <Card>
        <SettingRow title={repo?.name ?? '—'} description={repo?.url ?? '—'}>
          <PreviewButton label="Change" preview="Preview — the repository stays the same." />
        </SettingRow>
        <SettingRow title="Branch names for agents" description="Every agent branch carries its task id, so branches and pull requests link back to their task.">
          <input
            className="op-field op-mono"
            type="text"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label="Branch name pattern"
          />
          <span className="op-set-ex" aria-live="polite">{example && `e.g. ${example}`}</span>
        </SettingRow>
        <SettingRow title="Agents may push branches" description="Needed for any code task.">
          <Switch label="Agents may push branches" defaultOn />
        </SettingRow>
        <SettingRow title="Agents may open pull requests" description="The usual way an agent hands work back.">
          <Switch label="Agents may open pull requests" defaultOn />
        </SettingRow>
        <SettingRow
          title="Agents may merge"
          description={
            repo
              ? `Set by GitHub: ${repo.default_branch} requires ${repo.protection}. Opsaip shows this rule; GitHub enforces it.`
              : 'Set by GitHub branch protection.'
          }
        >
          <Switch label="Agents may merge" disabled />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}

export function SlackSettings() {
  return (
    <SettingsSection id="set-slack" title="Slack" lead="The only messaging channel. Message and Announce send through it.">
      <Card>
        <SettingRow title="Workspace" description="The Slack workspace Opsaip is installed in.">
          <SlackStatus />
          <PreviewButton label="Reconnect" preview="Preview — nothing changed." />
        </SettingRow>
        <SettingRow block title="Send as" description="Whose name is on messages Opsaip sends.">
          <Choices
            label="Send as"
            defaultValue="me"
            choices={[
              { value: 'me', title: 'You', badge: 'Recommended', description: 'Goes out under your own Slack account (user token). Teammates see it as from you.' },
              { value: 'bot', title: 'Opsaip bot', description: 'Comes from the Opsaip app. Clearly automated, less personal.' },
            ]}
          />
        </SettingRow>
        <SettingRow title="Announcement channel" description="Where Announce posts. Opsaip has to be added to this channel in Slack.">
          <input className="op-field" type="text" defaultValue="#team" autoComplete="off" aria-label="Announcement channel" />
        </SettingRow>
        <SettingRow title="Confirm before sending" description="Shows the exact message and waits for your OK. Keep it on while Opsaip writes for you.">
          <Switch label="Confirm before sending" defaultOn />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}
