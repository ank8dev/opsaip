import { useState } from 'react';
import { useWorkspace } from '../../state/workspace';
import { useUi } from '../../state/ui';
import { McpDot } from '../common/StatusDot';
import { Choices } from '../common/Choices';
import { Picker, opts } from '../common/Picker';
import { Switch } from '../common/Switch';
import { Card, CopyCode, LocalPicker, PreviewButton, SettingRow, SettingsSection } from './parts';

const MCP_URL = 'https://opsaip.example/mcp';
const CONNECT: Record<string, string> = {
  claude: `claude mcp add --transport http opsaip ${MCP_URL}`,
  codex: `# ~/.codex/config.toml\n[mcp_servers.opsaip]\nurl = "${MCP_URL}"`,
};

export function AgentSettings() {
  const { setSection } = useUi();
  const [client, setClient] = useState('claude');
  return (
    <SettingsSection
      id="set-agents"
      title="Agents"
      lead="Claude Code and Codex connect to the Opsaip MCP server and report what they do. Opsaip never logs into anyone’s account."
    >
      <Card>
        <SettingRow block title="Opsaip MCP server" description="The address every agent connects to.">
          <CopyCode code={MCP_URL} />
        </SettingRow>
        <SettingRow block title="Connect an agent" description="Each teammate runs this once and signs in. The sign-in token tells Opsaip whose agent is reporting.">
          <Picker ariaLabel="Agent" value={client} onChange={setClient} options={opts([['claude', 'Claude Code'], ['codex', 'Codex']])} />
          <button type="button" className="op-sbtn" onClick={() => setSection('mcp')}>
            See connected agents
          </button>
          <CopyCode code={CONNECT[client]} />
        </SettingRow>
      </Card>
      <Card>
        <SettingRow block title="How agents get tasks" description="An MCP server can only answer, it can’t start an agent. So something has to start the work.">
          <Choices
            label="How agents get tasks"
            defaultValue="pull"
            choices={[
              { value: 'pull', title: 'Pull', badge: 'Recommended', description: 'The agent asks Opsaip for its next task. Nothing to install; a task waits until someone opens a session.' },
              { value: 'runner', title: 'Runner', description: 'A small Opsaip app on a machine or server starts agents headless (claude -p, codex exec). Work starts at once; needs an install.' },
              { value: 'github', title: 'GitHub Actions', description: 'A task becomes an issue, an agent runs in CI and opens a pull request. No laptop needed; code tasks only.' },
            ]}
          />
        </SettingRow>
      </Card>
      <Card>
        <SettingRow title="Report with hooks" description="Claude Code hooks report start, progress and finish on every event, so nothing depends on the model remembering. Codex reports through AGENTS.md.">
          <Switch label="Report with hooks" defaultOn />
        </SettingRow>
        <SettingRow title="Mark an agent offline after" description="With no heartbeat for this long, the agent shows as Offline and its running tasks as Stalled.">
          <LocalPicker ariaLabel="Offline after" options={opts([['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes'], ['30', '30 minutes']])} defaultValue="10" />
        </SettingRow>
        <SettingRow title="Chat transcripts" description="What an agent sends from its chat. Full transcripts fill the chat view but can contain code and secrets.">
          <LocalPicker ariaLabel="Chat transcripts" options={opts([['off', 'Off'], ['summary', 'Summary only'], ['full', 'Full transcript']])} defaultValue="summary" />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}

export function ApprovalSettings() {
  const approvals: [string, string, boolean][] = [
    ['Deploy to production', 'Anything users will see.', true],
    ['Merge a pull request', 'Even where GitHub would allow it.', true],
    ['Run a database migration', 'Changes to data are the hardest to undo.', true],
    ['Delete outside the task', 'Branches or files the task didn’t create.', true],
    ['Add a dependency', 'A new package in the project.', false],
  ];
  return (
    <SettingsSection
      id="set-approvals"
      title="Approvals"
      lead="Before these actions an agent calls ask_human: the task stops and shows up under Needs you until someone answers."
    >
      <Card>
        {approvals.map(([title, description, on]) => (
          <SettingRow key={title} title={title} description={description}>
            <Switch label={`Approve: ${title}`} defaultOn={on} />
          </SettingRow>
        ))}
      </Card>
      <Card>
        <SettingRow title="Who can approve" description="The person who answers the agent’s question.">
          <LocalPicker ariaLabel="Who can approve" options={opts([['creator', 'Whoever created the task'], ['owner', 'The agent’s owner'], ['admin', 'Any admin']])} defaultValue="creator" />
        </SettingRow>
        <SettingRow title="If nobody answers" description="An agent waiting for approval does nothing, so a forgotten question blocks the task.">
          <LocalPicker ariaLabel="If nobody answers" options={opts([['1h', 'Remind after 1 hour'], ['4h', 'Remind after 4 hours'], ['cancel', 'Cancel after 24 hours']])} defaultValue="1h" />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}

export function ToolServerSettings() {
  const { ws } = useWorkspace();
  const servers = ws.mcp.filter((c) => c.direction === 'out');
  return (
    <SettingsSection
      id="set-tools"
      title="Tool servers"
      lead="MCP servers Opsaip itself calls to act in your tools. Start with read only and give write access once you trust the flow."
    >
      <ul className="op-set-card" aria-label="Tool servers">
        {servers.map((c) => (
          <li key={c.id} className="op-set-item">
            <McpDot status={c.status} />
            <span className="op-set-item-txt">
              <span className="op-set-item-name">{c.name}</span>
              <span className="op-set-item-sub">{c.status === 'Connected' ? c.endpoint : c.status + (c.note ? ` · ${c.note}` : '')}</span>
            </span>
            {c.status !== 'Connected' && <PreviewButton label="Reconnect" preview={`Preview — ${c.name} would open its sign-in page.`} />}
            <LocalPicker ariaLabel={`Access for ${c.name}`} options={opts([['write', 'Read and write'], ['read', 'Read only']])} defaultValue="write" />
          </li>
        ))}
        {!servers.length && <li className="op-set-item">No tool servers yet</li>}
      </ul>
      <Card>
        <SettingRow title="Add a tool server" description="Any service with an MCP server: Sentry, Stripe, Figma and so on.">
          <PreviewButton label="Add server" preview="Preview — no server was added." />
        </SettingRow>
      </Card>
    </SettingsSection>
  );
}
