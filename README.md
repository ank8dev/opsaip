# Opsaip

## Status

In development. The interface runs on a sample team (Tessera). The agent server has a first
HTTP API (v0, see [Run the server](#run-the-server)).

**Opsaip is an open source, self-hosted conductor for developer teams and their AI agents.**

It sits between your team's tools (GitHub, Linear, Notion, Slack, reached through MCP servers)
and the AI agents your teammates run (Claude Code, Codex). Agents report every task and its
status to Opsaip; Opsaip keeps those statuses in sync across your tools, and the team works
from one place: see what every agent is doing, answer the ones waiting for a person, start
new work, and message teammates.

> Status: early. The web app runs on sample data (a fictional team called Tessera).
> Actions are previews — nothing is saved or sent yet.

## Repository layout

```
opsaip/
  apps/
    web/          React web app (Vite + TypeScript) — the Opsaip interface
      src/
        styles/       design tokens (tokens.css) and base styles
        components/   sidebar, home (composer, tray, task card), conductor, settings
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

- **`apps/desktop/`** — a desktop app: an Electron shell around the same `apps/web` build
  (like Claude desktop around claude.ai). No UI code of its own.
- **`server/`, next steps** — sync with
  Linear / GitHub / Notion, Slack messaging, and the API the web app reads instead of mocks.

## Run the web app

Needs Node.js 20.19 or newer.

```bash
npm install          # once, from the repository root
npm run dev          # http://localhost:5173
npm run build        # production build in apps/web/dist/
npm run preview      # serve that build locally
npm test             # run the tests of every workspace
```

Pass Vite options after `--`, e.g. `npm run dev -- --port 4000`.

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

Endpoints (v0). Every request except `GET /healthz` must send `Authorization: Bearer <token>`;
a missing or wrong token gets 401. Errors are JSON: `{ "error": "<reason>" }`.

| Request             | Response                                                                                                                           |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/reports`  | Body: a status report as JSON. 200 `{ "task" }`; 400 invalid input; 409 rejected by the task store; 413 over 16 KB; 415 not `application/json` |
| `GET /v1/tasks`     | 200 `{ "tasks": [...] }`, in the order they were created                                                                            |
| `GET /healthz`      | 200 `ok`                                                                                                                           |

A status report (the body of `POST /v1/reports`):

| Field    | Required | Rule                                                                                       |
| -------- | -------- | ------------------------------------------------------------------------------------------ |
| `taskId` | yes      | String, 1–200 characters, not only whitespace.                                             |
| `status` | yes      | `queued`, `running`, `waiting_on_human`, `done` or `failed`.                               |
| `at`     | yes      | ISO 8601 timestamp with an offset, like `2026-11-10T16:00:00Z`.                            |
| `title`  | no       | String, 1–200 characters. Only with `status: "queued"`; sets the task's title.             |
| `agent`  | no       | String, 1–100 characters, e.g. `claude-code`. Replaces the task's agent.                   |
| `note`   | no       | String, 1–500 characters, e.g. the question while `waiting_on_human`. Belongs to the new status: a report without a note clears it. |

`GET /v1/tasks` returns `title`, `agent` and `note` only when they are set. Resending the exact
same report (same `status` and `at`) changes nothing, even if its `note` differs.

```bash
curl -H "authorization: Bearer $OPSAIP_TOKEN" -H 'content-type: application/json' \
  -d '{"taskId":"demo","status":"queued","at":"2026-11-10T16:00:00Z","title":"Try Opsaip"}' \
  http://127.0.0.1:4100/v1/reports
```

The database schema version is kept in SQLite's `user_version`. A database from an older
server is upgraded on start, in one transaction; one from a newer server is refused.

Tasks are stored in SQLite through Node's built-in `node:sqlite`, so they survive a restart.
On Node 22 every start prints `ExperimentalWarning: SQLite is an experimental feature`. This is
expected in the alpha: `node:sqlite` is still marked experimental in Node 22.

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
- **The Conductor** — the single baton in the interface. It lives just right of the sidebar and
  travels the dashboard to the task it is conducting: beating while an agent works, held still
  while a task waits for you.

## Data

`apps/web/src/data/source.ts` is the single place data comes from:

- **Demo** — no server connection saved: the sample team in `apps/web/src/mocks/`.
- **Server** — an access token saved in this browser tab: the app polls `GET /v1/tasks` every 5 s
  and shows only those tasks, read-only. Team, MCP and Repo are empty until the server has them.

The app always calls relative paths (`/v1/...`), never a host. `npm run dev` and `npm run preview`
forward `/v1` to the server at `OPSAIP_URL` (default `http://127.0.0.1:4100`). The token is kept in
`sessionStorage` (one tab, gone when it closes) and sent only in the `Authorization` header.

To see your server's tasks in the web app:

1. Start the server (see [Run the server](#run-the-server)).
2. In another shell: `npm run dev` (add `OPSAIP_URL=...` if the server is not on `127.0.0.1:4100`).
3. Open the app, click **Demo** in the top-right corner, paste the token under **Server** and press
   **Connect**. The badge shows **Live**, **Connecting** or **Offline**; **Disconnect** goes back to Demo.

## License

[GNU AGPL v3](LICENSE). You can use, self-host, change and share Opsaip freely. If you run a
modified version as a service for others, you must publish your changes under the same license.
