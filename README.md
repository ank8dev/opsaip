# Opsaip

## Status

In development. The web app shows your server's tasks (sample data exists only for development). The agent server has a first
HTTP API (v0, see [Run the server](#run-the-server)).

**Opsaip is an open source, self-hosted conductor for developer teams and their AI agents.**

It sits between your team's tools (GitHub, Linear, Notion, Slack, reached through MCP servers)
and the AI agents your teammates run (Claude Code, Codex). Agents report every task and its
status to Opsaip; Opsaip keeps those statuses in sync across your tools, and the team works
from one place: see what every agent is doing, answer the ones waiting for a person, start
new work, and message teammates.

> Status: early. The web app needs a running server: without one it shows a Connect screen.
> Some screens are still previews — nothing is saved or sent there.

## Repository layout

```
opsaip/
  apps/
    desktop/      macOS app: an Electron shell around the apps/web build, no UI of its own
    web/          React web app (Vite + TypeScript) — the Opsaip interface
      src/
        styles/       design tokens (tokens.css) and base styles
        components/   sidebar, home (composer, tray, task card), chat, settings
        state/        workspace data and interface state (React context)
        data/         pure helpers + the one place data is loaded from
        mocks/        sample data, same shape the server will return
      reference/    the original HTML prototype the app was ported from
  packages/
    core/         @opsaip/core — pure, UI-free logic shared by web and the server
                  (agent task statuses, applyReport, in-memory task store),
                  with Vitest tests
    mcp/          @opsaip/mcp — a stdio MCP server with start_task and update_status, so
                  Claude Code, Codex and other MCP clients report their work to the server
  server/         @opsaip/server — the self-hosted server, v0: an HTTP API that agents
                  report task statuses to (node:http, node:sqlite, @opsaip/core), with Vitest tests
  brand/          logo sources, SVG/PNG exports, Opsaip Display font, brand tokens
```

### Planned

- **`apps/desktop/`, next steps** — a signed and notarized build, and a proper macOS icon.
- **`server/`, next steps** — sync with
  Linear / GitHub / Notion, Slack messaging, and the API the web app reads instead of mocks.

## Run the web app

Needs Node.js 22.13 or newer.

```bash
npm install          # once, from the repository root
npm run dev          # http://localhost:5173
npm run build        # production build in apps/web/dist/
npm run preview      # serve that build locally
npm test             # run the tests of every workspace
```

Pass Vite options after `--`, e.g. `npm run dev -- --port 4000`.

## Install the desktop app (macOS, alpha)

The alpha is not signed with an Apple Developer ID, so macOS asks you to confirm it once.

1. **Get the `.dmg`.** On GitHub: **Actions → desktop**, open the latest green run, and download
   **opsaip-desktop-dmg** under *Artifacts* (needs a GitHub account; kept 30 days). No recent run?
   Click **Run workflow** on `main`. Or build it on a Mac yourself: `npm run desktop:dist` puts both
   files in `apps/desktop/release/`.
2. **Pick your file.** Apple menu → **About This Mac**. "Chip: Apple M…" →
   `Opsaip-<version>-arm64.dmg`. "Processor: Intel" → `Opsaip-<version>-x64.dmg`.
3. **Install.** Open the `.dmg` and drag **Opsaip** into **Applications**.
4. **Open it the first time:**
   - **macOS 15 Sequoia or later:** double-click Opsaip; macOS says it cannot verify it — click
     **Done**. Open **System Settings → Privacy & Security**, scroll to *Security*, click
     **Open Anyway** next to "Opsaip was blocked…", and confirm with your password.
   - **macOS 14 Sonoma or earlier:** in Applications, right-click (or Control-click) **Opsaip** →
     **Open** → **Open**.

   After that, Opsaip opens normally. Right-click → Open no longer works from macOS 15 on; Apple
   removed it.

If macOS says the app **"is damaged and can't be opened"**, download it again first. If it still
says so, remove the download flag from this one app in Terminal, then open it:

```bash
xattr -dr com.apple.quarantine /Applications/Opsaip.app
```

Do this only for a `.dmg` from this repository's own workflow runs, and never turn off Gatekeeper
for the whole Mac.

The app is ad-hoc signed (Apple Silicon runs nothing unsigned) but not notarized, so macOS cannot
tell who made it.

To use it with your Opsaip server, add `config.json` as described below, then paste the access
token on the Connect screen and press **Connect**. As in a browser
tab, the token is kept only while the window is open.

## Run the desktop app (development)

The desktop app (`apps/desktop`) is a macOS window around the `apps/web` build, loaded from
disk. It needs a Mac and `npm install` in the repository once.

```bash
npm run desktop      # builds apps/web, then opens it in the desktop app
```

To reach an Opsaip server, create `~/Library/Application Support/Opsaip/config.json`:

```json
{ "serverUrl": "https://opsaip.example.com" }
```

`serverUrl` must use `https://`, except for a server on the same Mac (`http://localhost:4100`,
`http://127.0.0.1:4100`). No `user:password@`, query or fragment; a path is kept as a prefix.
Without the file the app works offline; with a bad file it says what is wrong and works offline.

How it stays locked down:

- The page is served at `app://opsaip/` from the bundled web build, never from the network.
  Its Content-Security-Policy allows only its own files and its own origin.
- The page calls the API on its own origin (`/v1/...`). The app forwards `app://opsaip/v1/*`
  to `serverUrl` with only the `Authorization` and `Content-Type` headers, returns the status,
  body and `Content-Type`, and refuses redirects. That server is the only network address the
  app reaches. Nothing under `/v1` is served from disk.
- The forwarded request carries nothing else: the app also removes the headers Chromium adds on
  its own (`User-Agent`, `Accept-Language`, `Sec-Fetch-*`). Only transport headers remain
  (`Host`, `Connection`, `Content-Length`, `Accept-Encoding`).
- Node.js is off in the page (`contextIsolation`, `sandbox`, no `nodeIntegration`, no preload).
  The only web permission granted is writing to the clipboard.
- Links that leave the app (`https:`, `http:`, `mailto:`) open in the default browser or mail
  app; anything else is dropped.

## Run the server

Needs Node.js 22.13 or newer. The server needs an access token and will not start without one,
on any host, localhost included.

```bash
export OPSAIP_TOKEN="$(openssl rand -hex 32)"   # once per shell; keep it secret
npm run server                                 # http://127.0.0.1:4100
```

| Variable      | Default            | Meaning                                                                                  |
| ------------- | ------------------ | ---------------------------------------------------------------------------------------- |
| `OPSAIP_HOST` | `127.0.0.1`        | Address to listen on. Empty counts as unset.                                             |
| `OPSAIP_PORT` | `4100`             | Port, 1–65535. A bad value stops the server at startup.                                  |
| `OPSAIP_DB`   | `./data/opsaip.db` | SQLite file, created if missing. Relative to the working directory: `server/` when started with `npm run server`, so `server/data/opsaip.db` (git-ignored). |
| `OPSAIP_TOKEN` | none, required    | Access token: at least 32 visible ASCII characters, no spaces. The server never logs it. |
| `OPSAIP_WEB_DIR` | `apps/web/dist` of this repository | The web app build the server serves at `/`. If it is missing, the server still starts and says how to build it. |
| `OPSAIP_LLM_PROVIDER` | none (Ask off) | AI provider for `POST /v1/ask`: `gemini`. Set together with `OPSAIP_LLM_KEY`, see [Ask](#ask-optional). |
| `OPSAIP_LLM_KEY` | none (Ask off) | The provider's API key. Never logged, never returned, never sent to the browser. |
| `OPSAIP_LLM_MODEL` | `gemini-3.5-flash-lite` | Model id. Only with the two variables above. |
| `OPSAIP_CONDUCTOR_DIR` | none (off) | Absolute path to a git repository on this machine: turns on [Conductor mode](#conductor-mode-experimental). A bad value stops the server at startup. |

Endpoints (v0). Every request must send `Authorization: Bearer <token>`, except `GET /healthz`
and the web app files (`/`, `/index.html`, `/favicon.svg`, `/assets/<file>`); a missing or wrong
token gets 401. The list of public paths lives in `server/src/auth/requestGuard.ts`. Errors are
JSON: `{ "error": "<reason>" }`.

| Request             | Response                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/reports`  | Body: a status report as JSON. 200 `{ "task" }`; 400 invalid input; 409 rejected by the task store; 413 over 16 KB; 415 not `application/json` |
| `POST /v1/tasks`    | Body: `{ "title": "...", "agent": "..." }` (`agent` optional). Creates a queued task from you. 201 `{ "task" }`; 400 invalid input; 409 id already taken; 413 over 16 KB; 415 not `application/json` |
| `GET /v1/tasks`     | 200 `{ "tasks": [...] }`, in the order they were created                                                                            |
| `POST /v1/ask`      | Body: `{ "question": "..." }`. 200 `{ "answer" }`; 400 bad question; 413; 415; 429 too many questions; 502 provider failed; 503 Ask not configured; 504 provider timed out. See [Ask](#ask-optional). |
| `GET /v1/conductor` | 200 `{ "enabled", "agent": "claude-code", "reason"?, "repo"?, "active"? }`. `reason` (only when off) says how to turn Conductor mode on. `repo` (only when on) is the folder name of `OPSAIP_CONDUCTOR_DIR`, never its full path; `active` says whether a run is active. |
| `POST /v1/runs`     | Body: `{ "title": "...", "prompt": "..." }`. Starts a [Conductor](#conductor-mode-experimental) run. 201 `{ "run" }`; 400 invalid input; 409 a run is already active; 413; 415; 500 the worktree or task could not be created; 503 Conductor mode is off |
| `GET /v1/runs/:id`  | 200 `{ "run" }`; 404 unknown run; 503 off                                                                                           |
| `GET /v1/runs/:id/transcript` | 200 `{ "transcript": { "entries": [{ "id", "role": "you"\|"agent", "kind": "prompt"\|"followup"\|"message", "text", "at" }], "finished", "canResume", "truncated" } }`; 404 unknown run; 503 off. In memory only: at most 200 entries and 200 000 characters per run (oldest dropped first), 8000 characters per entry. `finished`: the run accepts no more follow-ups (until resumed). `canResume`: it has finished, its agent has exited and its session id is known, so a follow-up resumes it. The session id is kept in memory only and never shown. |
| `POST /v1/runs/:id/permission` | Body: `{ "allow": true, "permissionId": "..." }`. Answers the run's pending permission request. 200 `{ "run" }`; 400; 404; 409 no pending request with that id, or the run has ended; 413; 415; 503 |
| `POST /v1/runs/:id/message` | Body: `{ "text": "..." }`. A follow-up while the run is active; to a finished run whose Claude Code has exited it resumes the same session in the same worktree (`claude -p --resume <session id>`). 200 `{ "run" }`; 400; 404; 409 not active and not resumable (no session id, still shutting down), or another run is active; 413; 415; 503 |
| `POST /v1/runs/:id/cancel` | No body. Stops the run. 200 `{ "run" }`; 404; 409 the run has already ended; 503                                       |
| `GET /healthz`      | 200 `ok`                                                                                                                           |
| `GET /`             | The web app (from `OPSAIP_WEB_DIR`), with a strict Content-Security-Policy. 404 when it is not built.                             |

A status report (the body of `POST /v1/reports`):

| Field    | Required | Rule                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------ |
| `taskId` | yes      | String, 1–200 characters, not only whitespace.                                             |
| `status` | yes      | `queued`, `running`, `waiting_on_human`, `done` or `failed`.                               |
| `at`     | yes      | ISO 8601 timestamp with an offset, like `2026-11-10T16:00:00Z`.                            |
| `title`  | no       | String, 1–200 characters. Only with `status: "queued"`; sets the task's title.             |
| `agent`  | no       | String, 1–100 characters, e.g. `claude-code`. Replaces the task's agent.                   |
| `note`   | no       | String, 1–500 characters, e.g. the question while `waiting_on_human`. Belongs to the new status: a report without a note clears it. |

`GET /v1/tasks` returns `title`, `agent`, `note` and `source` only when they are set. Resending
the exact same report (same `status` and `at`) changes nothing, even if its `note` differs.

A task you create (the body of `POST /v1/tasks`):

| Field   | Required | Rule                                                                                         |
| ------- | -------- | -------------------------------------------------------------------------------------------- |
| `title` | yes      | String, 1–200 characters, not only whitespace. Leading and trailing whitespace is trimmed.   |
| `agent` | no       | String, 1–100 characters, e.g. `claude-code`. Who should work on it.                         |

The server picks the rest: a random `id`, `status: "queued"`, `updatedAt` (now, UTC) and
`source: "you"`. Any other field in the body is ignored. `source` is set only here: agents'
reports can never set, change or clear it, and a task an agent creates has none.

```bash
curl -H "authorization: Bearer $OPSAIP_TOKEN" -H 'content-type: application/json' \
  -d '{"taskId":"demo","status":"queued","at":"2026-11-10T16:00:00Z","title":"Try Opsaip"}' \
  http://127.0.0.1:4100/v1/reports
```

Create a task yourself:

```bash
curl -H "authorization: Bearer $OPSAIP_TOKEN" -H 'content-type: application/json' \
  -d '{"title":"Fix the login bug","agent":"claude-code"}' \
  http://127.0.0.1:4100/v1/tasks
# 201 {"task":{"id":"…","status":"queued","updatedAt":"…","title":"Fix the login bug","agent":"claude-code","source":"you"}}
```

The database schema version is kept in SQLite's `user_version`. A database from an older
server is upgraded on start, in one transaction; one from a newer server is refused.

Tasks are stored in SQLite through Node's built-in `node:sqlite`, so they survive a restart.
On Node 22 every start prints `ExperimentalWarning: SQLite is an experimental feature`. This is
expected in the alpha: `node:sqlite` is still marked experimental in Node 22.

## Ask (optional)

`POST /v1/ask` answers a question about your agents and tasks with an AI model, using your own
API key. The model sees only what the server knows about the tasks and is told to answer only
from that data, to say plainly when it does not know, and never to invent tasks, people or
numbers. Models can still make mistakes: check important answers against the tasks.

> **Your task data leaves your server.** Each question sends the question and the tasks'
> title, status, agent, note and last update time to the provider you choose (Google, for
> `gemini`). On the **free tier of the Gemini API, Google may use what you send, and the
> answers, to improve its products and models, and human reviewers may read it**. Google says
> paid (billing-enabled) use is not used that way. Read the
> [Gemini API terms](https://ai.google.dev/gemini-api/terms) before you turn Ask on, and do not
> use it on a free tier for tasks whose titles or notes are confidential.

Ask is off until you set it up. Without it, `POST /v1/ask` answers 503 and says how to set it up.

**Get a Gemini API key**

1. Sign in with a Google account at [Google AI Studio](https://aistudio.google.com/apikey).
2. Create an API key.
   New keys start on the free tier, with its daily limits.
3. Treat the key like a password: do not commit it, do not paste it into the web app.

**Turn Ask on** (both variables, then restart the server):

```bash
export OPSAIP_LLM_PROVIDER=gemini
export OPSAIP_LLM_KEY="<your Gemini API key>"
# optional: export OPSAIP_LLM_MODEL=gemini-3.5-flash-lite
npm run server        # prints "Ask is on (gemini, model gemini-3.5-flash-lite)"
```

Only one of the two set, an unknown provider or a malformed key stops the server at startup
with a message that says what to fix (and never shows the key).

```bash
curl -H "authorization: Bearer $OPSAIP_TOKEN" -H 'content-type: application/json' \
  -d '{"question":"Which tasks are waiting for me?"}' \
  http://127.0.0.1:4100/v1/ask
```

Limits:

- A question is at most 1000 characters.
- At most 30 000 characters of task data are sent, most recently updated tasks first; the model
  is told when some tasks were left out.
- The provider has 20 seconds to answer (504 after that). An answer is at most 4000 characters.
- At most 10 questions per minute for the whole server (429 with `Retry-After` after that). The
  count resets when the server restarts.

The server logs one line per question with the status code, counts and duration, never the
question, the answer or the key. The answer is plain text written by a model from data agents
sent: a client must show it as text, never as HTML.

## Conductor mode (experimental)

Conductor mode lets Opsaip start a coding agent on your own Mac, on one of your git repositories,
and bring its permission requests to you in Opsaip. The agent is **Claude Code**, the `claude`
command you already use. It is off by default.

> **It runs on your subscription, on your machine.** Opsaip starts your own, unmodified `claude`
> command, which uses the login you already have on this Mac. Opsaip never asks for, reads, stores
> or passes on Claude (or any other) credentials, and nothing goes through an Opsaip service: the
> agent talks to Anthropic exactly as when you run `claude` in a terminal, and the usage counts
> against your own plan.

**Requirements**

- The Opsaip server on the same Mac, listening on `127.0.0.1`, `::1` or `localhost` (the default).
- [Claude Code](https://code.claude.com/docs) installed, `claude` on the `PATH` of the server, and
  logged in: run `claude` once in a terminal and log in with your own subscription. Tested with
  Claude Code **2.1.325**.
- `git`, and a repository with at least one commit.

**Turn it on** (then restart the server):

```bash
export OPSAIP_CONDUCTOR_DIR=/Users/me/code/my-app   # the top folder of a git repository
npm run server        # prints "Conductor mode is on (experimental, agent claude-code)"
```

The server does not start, and says why, if the path is not absolute, does not exist, is not a
folder, is a subfolder of a repository instead of its top folder (`git rev-parse --show-toplevel`),
is not a repository, has no commit yet, or if `OPSAIP_HOST` is not a loopback address. Messages
never print the path. Unset the variable to turn Conductor mode off.

**What a run does**

1. `POST /v1/runs` with a title and a prompt. One run at a time (409 while one is active).
2. Opsaip makes a new branch and worktree from the repository's current `HEAD` (uncommitted
   changes are not included): `git worktree add -b opsaip/run-<id> ~/.opsaip/worktrees/<id> HEAD`.
   `~/.opsaip/worktrees` and the run's folder are created with mode `0700`.
3. It creates a task (source "you", agent `claude-code`), and starts, in that worktree:

   ```bash
   claude -p --input-format stream-json --output-format stream-json --verbose \
     --permission-mode acceptEdits \
     --mcp-config /tmp/opsaip-XXXXXX/mcp.json --strict-mcp-config \
     --permission-prompt-tool mcp__opsaip__approve
   ```

   The prompt goes to the agent's input, never on the command line. Without a shell, and without
   the server's `OPSAIP_*` variables (your access token and Ask key stay with the server).
4. The task follows the run: `running` → `waiting_on_human` (the note says what the agent asks to
   do) while you decide → `running` → `done`. It ends `failed` on an error, a crash (the note gives
   the exit code), when you stop it ("Stopped by you"), or when a permission request gets no answer
   within 30 minutes (Opsaip denies it and stops the run).
5. When Claude Code finishes its answer, the run is over: Opsaip closes its input. A follow-up
   (`POST /v1/runs/:id/message`) goes to the agent while the run is still working. After the run,
   once Claude Code has exited, a follow-up resumes the same Claude Code session in the same
   worktree (needs the session id, kept in memory only: lost when the server restarts). A failed
   run goes back in line on its task; a done task is final, so the run moves to a new task with
   the same title. If Claude Code
   has not exited 10 seconds later (for example it waits for background work it started), Opsaip
   stops it: SIGTERM, then SIGKILL to its whole process group 5 seconds after.

`GET /v1/runs/:id` returns `{ "run": { "id", "taskId", "status", "branch", "worktree", "permission"?,
"lastMessage"? } }`: `permission` is `{ "id", "tool", "summary" }` while a request waits (answer
it with that `id`); `lastMessage` is the agent's latest text, then its final answer, cut at 2000
characters. `summary` (300 characters at most) and `lastMessage` come from the agent: show them as
text, never as HTML. A prompt or follow-up is at most 12 000 characters, and the whole request at
most 16 KB (text with many non-ASCII characters reaches 16 KB first). Finished runs are kept in
memory for `GET` (the last 20) and forgotten when the server restarts; their tasks stay.

**What the agent may do without asking you**

Opsaip uses Claude Code's `acceptEdits` permission mode. In Claude Code's words
([permission modes](https://code.claude.com/docs/en/permission-modes#auto-approve-file-edits-with-acceptedits-mode)):
Claude creates and edits files in its working directory (the run's worktree) without asking, and
also runs these filesystem commands there without asking: `mkdir`, `touch`, `rm`, `rmdir`, `mv`,
`cp` and `sed`. Reading files in the worktree, and Claude Code's built-in
[read-only commands](https://code.claude.com/docs/en/permissions#read-only-commands) (`ls`, `cat`,
`grep`, `find`, read-only `git`, …), never ask, and the read-only commands may also read files
outside the worktree unless you turn on `permissions.blockReadsOutsideWorkingDirectories` in your
Claude Code settings. WebFetch on Claude Code's built-in list of documentation sites does not ask
either.

Everything else comes to Opsaip as a permission request that waits for you: any other shell
command (`npm install`, `npm test`, `git commit`, `curl`, …), web access, edits outside the
worktree or to [protected paths](https://code.claude.com/docs/en/permission-modes#protected-paths),
and MCP tools. Opsaip never uses `--dangerously-skip-permissions` or `bypassPermissions`.

Your own Claude Code settings still apply: allow rules in `~/.claude/settings.json` or in the
repository's `.claude/settings.json` approve what they match without asking, deny rules still deny,
and your hooks run. Your MCP servers do not load in a run (`--strict-mcp-config`): only Opsaip's
permission server does, so the Opsaip reporting server from [docs/CONNECT.md](docs/CONNECT.md)
does not report the run a second time.

**How the permission requests reach Opsaip**

Claude Code calls an MCP tool for each request (`--permission-prompt-tool`). That tool is
`server/src/auth/conductor/permissionMcp.mjs`, a small MCP server that Claude Code starts and that
asks the Opsaip server over a Unix socket in a private `/tmp/opsaip-XXXXXX` folder (mode `0700`,
with a random secret per run, deleted when the run ends). It can only ask: the answer always
comes from you, through the API. If anything goes wrong on that path, the answer is "deny".

**Worktrees are kept: review and clean up**

Opsaip never deletes a run's worktree or branch: the agent's changes are there for you to review.

```bash
cd /Users/me/code/my-app
git worktree list                                   # every run: ~/.opsaip/worktrees/<id>
git -C ~/.opsaip/worktrees/<id> status              # what the agent changed
git diff HEAD...opsaip/run-<id>                     # its commits, if it made any
git worktree remove ~/.opsaip/worktrees/<id>        # add --force to drop uncommitted changes
git branch -D opsaip/run-<id>                       # delete the branch too
git worktree prune                                  # forget worktrees whose folder you deleted
```

**Known limits**

- Experimental. One agent (Claude Code), one repository, one run at a time.
- The permission request flag `--permission-prompt-tool` is documented in the
  [CLI reference](https://code.claude.com/docs/en/cli-reference) but not listed by `claude --help`.
  It was checked with Claude Code 2.1.325 and its docs; a newer Claude Code may change it.
- Opsaip's tests use a fake agent that speaks the same protocol; no test runs a real Claude session.
- A run ends with Claude Code's first final answer: no multi-turn chat yet. To continue, start a
  new run, or open the worktree and run `claude --continue` yourself.
- An unanswered permission request is denied after 30 minutes and the run fails.
- If the server stops during a run, the run is stopped and its task marked failed. Runs are not
  resumed after a restart.
- When Claude Code asks a clarifying question (its `AskUserQuestion` tool), it reaches Opsaip as a
  permission request for that tool, with the question as the summary. Opsaip cannot pass your
  choice back yet: deny it, and answer with a follow-up message while the run is active. This
  case was checked against the docs only, not with a real session.

## Run the MCP server

Agents report through MCP: `packages/mcp` is a stdio MCP server that the agent's MCP client
starts. **To add it to Claude Code or Codex, follow [docs/CONNECT.md](docs/CONNECT.md).** Run `npm install` in the repository once. It needs the Opsaip server running and these
variables:

| Variable       | Meaning                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------- |
| `OPSAIP_URL`   | The Opsaip server, e.g. `http://127.0.0.1:4100`. No `user:password@` part.              |
| `OPSAIP_TOKEN` | The server's access token. Never logged or returned to the agent.                        |

The command for the MCP client (an absolute path, so it works from any folder):

```bash
node /path/to/opsaip/packages/mcp/bin/opsaip-mcp.mjs
```

| Tool                                 | What it does                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------- |
| `start_task(title)`                  | Creates a task id, reports `queued` (with the title) then `running`, returns the id.   |
| `update_status(taskId, status, note?)` | Reports the new status; `note` is e.g. the question while `waiting_on_human`.       |

Each report's `agent` is the name the MCP client gives when it connects. A server
that is down, a wrong token or a rejected report comes back to the agent as a tool error that
says what went wrong.

## Design

- Monochrome graphite neutrals with **lime as the only accent**; red only for errors.
- Type: **Instrument Sans** for the interface, **DM Mono** for code, IDs and logs (bundled, no CDN).
- Motion "Fluid": long, glassy, blurred on entry — 260 / 480 / 720 ms. Reduced motion is respected.
- All of it lives in [`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css).
- **Chat with Opsy** — the main screen is a chat. Opsy, the glass ball, answers with a brief, a task list or a proposed change, and its face matches the message.

## Data

`apps/web/src/data/source.ts` is the single place data comes from:

- **Connect screen** — no server connection saved: the app asks for the access token (the server
  address is the page's own origin) and links here. A production build has **no sample data**.
- **Demo** — only in `npm run dev` and in tests (`import.meta.env.DEV`): the sample team in
  `apps/web/src/mocks/`. A test builds the app and checks the sample team is not in the bundle.
- **Server** — an access token saved in this browser tab: the app polls `GET /v1/tasks` every 5 s
  and shows only those tasks. Team, MCP and Repo are empty until the server has them. In the chat's
  composer, **Ask** asks Opsy about them, **Task** creates one (`POST /v1/tasks`, shown as yours:
  `source: "you"`), and **Agent** starts a Claude Code run when
  [Conductor mode](#conductor-mode-experimental) is on (`GET /v1/conductor` says whether it is):
  the run card follows it (`GET /v1/runs/:id` every 2 s while it is active and the page is
  visible), permission requests show as a **Needs you** card with Allow and Deny, and while a run
  is active the Agent box sends follow-ups and the card has a Stop button. The id of the run being
  followed is kept in `sessionStorage` (`opsaip.activeRun`), so a reload brings its card back.
  Message and Announce stay read-only. Text from the agent is always shown as plain text.

The app always calls relative paths (`/v1/...`), never a host. `npm run dev` and `npm run preview`
forward `/v1` to the server at `OPSAIP_URL` (default `http://127.0.0.1:4100`). The token is kept in
`sessionStorage` (one tab, gone when it closes) and sent only in the `Authorization` header.

To see your server's tasks in the web app:

1. `npm run build`, then start the server (see [Run the server](#run-the-server)). It serves the
   app at `http://127.0.0.1:4100/`. While working on the app, use `npm run dev` instead: it forwards
   `/v1` to the server (add `OPSAIP_URL=...` if the server is not on `127.0.0.1:4100`).
2. Open the app, paste the token on the Connect screen and press **Connect**. The badge shows
   **Live**, **Connecting** or **Offline**; **Disconnect** (Settings → Server) goes back to the
   Connect screen.

## License

[GNU AGPL v3](LICENSE). You can use, self-host, change and share Opsaip freely. If you run a
modified version as a service for others, you must publish your changes under the same license.
