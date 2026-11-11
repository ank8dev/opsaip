# Connect your agents to Opsaip

This guide adds the Opsaip MCP server to **Claude Code** and **Codex**. After it, the agent
gets two tools, `start_task` and `update_status`, and every task it works on appears in
`GET /v1/tasks` with its title, status, agent name and, while it waits for you, its question.

Checked with Claude Code 2.1.322 and Codex CLI 0.167.1.

## Before you start

1. **Node.js 20.19 or newer** on the machine where the agent runs (`node --version`).
2. **This repository, with dependencies installed:** run `npm install` once in its root folder.
3. **The Opsaip server running,** and its access token. See [Run the server](../README.md#run-the-server).
4. **Two values:**
   - the server address, for example `http://127.0.0.1:4100`;
   - the absolute path to the MCP server script, for example
     `/home/me/opsaip/packages/mcp/bin/opsaip-mcp.mjs`. Use an absolute path: the agent starts
     the script from your project folder, not from this repository.

Below, replace `/ABSOLUTE/PATH/TO/opsaip` with the folder where you cloned this repository.

### Where to keep the token

The MCP server reads the token from `OPSAIP_TOKEN`. The safest place for it is your shell
profile (`~/.bashrc`, `~/.zshrc`), not the agent's config file:

```bash
export OPSAIP_TOKEN="<the same token the server uses>"
```

Open a new terminal afterwards, or run the line once in the current one. The steps below keep
the token out of the agents' config files. Each section also shows the shorter way that writes
the token into the config file, in plain text.

## Claude Code

### 1. Add the server

```bash
claude mcp add opsaip --scope user \
  --env OPSAIP_URL=http://127.0.0.1:4100 \
  -- node /ABSOLUTE/PATH/TO/opsaip/packages/mcp/bin/opsaip-mcp.mjs
```

- `--scope user` makes Opsaip available in all your projects. Without it, the scope is
  `local`: only the current project, only for you.
- The token is not in this command. Claude Code passes its own environment to the MCP servers
  it starts, so the `OPSAIP_TOKEN` exported in your shell reaches the server. Start `claude` from
  a terminal where `OPSAIP_TOKEN` is set.
- Shorter, but the token is stored in plain text in `~/.claude.json`: add
  `--env OPSAIP_TOKEN=<token>` to the command above.
- Do not use `--scope project` with the token: that scope writes `.mcp.json` into your
  repository, which is usually committed.

### 2. Check it

```bash
claude mcp list
```

Expected: a line for `opsaip` that ends with `Connected`. Claude Code starts the server for this
check, so it also catches a missing token.

If it says `Failed to connect`, see [If something does not work](#if-something-does-not-work).

Tasks from Claude Code show `"agent": "claude-code"`.

## Codex

### 1. Add the server

```bash
codex mcp add opsaip \
  --env OPSAIP_URL=http://127.0.0.1:4100 \
  -- node /ABSOLUTE/PATH/TO/opsaip/packages/mcp/bin/opsaip-mcp.mjs
```

### 2. Let the token through

**Codex does not pass your shell environment to MCP servers.** Without the next step, the Opsaip
MCP server does not see `OPSAIP_TOKEN` and stops at start with `OPSAIP_TOKEN is not set`.

Open `~/.codex/config.toml` and add the `env_vars` line to the `[mcp_servers.opsaip]` section that
`codex mcp add` created:

```toml
[mcp_servers.opsaip]
command = "node"
args = ["/ABSOLUTE/PATH/TO/opsaip/packages/mcp/bin/opsaip-mcp.mjs"]
env_vars = ["OPSAIP_TOKEN"]   # forward OPSAIP_TOKEN from your shell

[mcp_servers.opsaip.env]
OPSAIP_URL = "http://127.0.0.1:4100"
```

Shorter, but the token is stored in plain text in `~/.codex/config.toml`: instead of `env_vars`,
add `--env OPSAIP_TOKEN=<token>` to the `codex mcp add` command.

### 3. Check it

```bash
codex mcp list
```

Expected: a row `opsaip` with status `enabled`. This command only reads the config; it does not
start the server. Codex starts it when a session begins.

Tasks from Codex show `"agent": "codex-mcp-client"`.

## Tell the agent when to report

The tools are available now, but the agent also needs to know when to call them. Paste this
block into the instructions file at the root of your project: `CLAUDE.md` for Claude Code,
`AGENTS.md` for Codex. If you use both agents, paste it into both files.

```markdown
## Opsaip task reporting

Report your work to Opsaip with the `opsaip` MCP tools.

- When you start a new task from the user (anything more than a quick question), call
  `start_task` once with a short title. Keep the returned taskId.
- Before you ask the user a question and wait for the answer, call `update_status` with status
  `waiting_on_human` and the question in `note`.
- When the user answers and you continue, call `update_status` with status `running`.
- When the task is finished, call `update_status` with status `done`.
- If you cannot finish it, call `update_status` with status `failed` and the reason in `note`.
- Follow-up steps of the same task use the same taskId. After `done`, new work is a new task:
  call `start_task` again.
- If an Opsaip tool returns an error, tell the user once and continue the work. Reporting must
  never block the task.
```

## Check the whole path

Ask the agent to do something small, then read the tasks:

```bash
curl -H "authorization: Bearer $OPSAIP_TOKEN" http://127.0.0.1:4100/v1/tasks
```

Expected (the id and time will differ):

```json
{"tasks":[{"id":"52f91401-73ea-4c56-992b-1bfc9a739141","status":"done","updatedAt":"2026-11-11T20:53:56.345Z","title":"Connect guide check","agent":"claude-code"}]}
```

## If something does not work

To see why the MCP server does not start, run it by hand with the same values. It prints the
reason and stops; if it prints `ready`, it works (press Ctrl+C to stop it):

```bash
OPSAIP_URL=http://127.0.0.1:4100 node /ABSOLUTE/PATH/TO/opsaip/packages/mcp/bin/opsaip-mcp.mjs
```

| Message                                                            | What to do                                                                                     |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `OPSAIP_TOKEN is not set`                                          | Export `OPSAIP_TOKEN` in the terminal you start the agent from. Codex: add `env_vars` (above).  |
| `OPSAIP_TOKEN must be visible ASCII characters only`               | The token has a space or line break, often from copying. Copy it again.                        |
| `OPSAIP_URL is not set` / `must start with http:// or https://`    | Set `OPSAIP_URL` to the full address, with `http://`.                                          |
| `cannot reach the Opsaip server at ... (ECONNREFUSED): is it running?` | Start the server (`npm run server`), or fix the address or port in `OPSAIP_URL`.           |
| `the Opsaip server rejected the access token`                      | `OPSAIP_TOKEN` is not the token the server was started with.                                   |
| `transition not allowed: done -> running`                          | That task is finished. New work needs `start_task`.                                            |
| `stale report`                                                     | A report with an older time than the last one. Check that the agent machine's clock is right.  |

The MCP server never prints the token and never returns it to the agent.

## Security notes

- Anyone with the token can read and change all tasks. Keep it out of repositories and chats.
- With `http://`, the token travels unencrypted. That is fine for `127.0.0.1`; for a server on
  another machine, put it behind `https://`.
- The `--env OPSAIP_TOKEN=...` shortcuts store the token in plain text in `~/.claude.json` or
  `~/.codex/config.toml`. Prefer the shell environment shown above.
