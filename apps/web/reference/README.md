# Opsaip home dashboard

> **Reference only.** This is the original HTML prototype the React app in
> `apps/web/src` was ported from. It is kept to compare the port against and is
> not built or served. Its sample data now lives in `apps/web/src/mocks/`.

The home screen prototype of Opsaip, exported from the claude.ai dashboard
"Opsaip home" on 10 Oct 2026.

## Open it

Double-click `index.html`. It runs in any browser with no server and no
install. Fonts (Instrument Sans, DM Mono) load from Google Fonts when you are
online; offline it falls back to system fonts.

## What is in this folder

```
dashboard/
├── index.html      Standalone page: the dashboard + sample data + dash-shim, in one file
├── dash-shim.js    The shim on its own (same code as inside index.html)
├── data/           Sample data, one JSON file per dataset
└── source/
    ├── page.html      The page exactly as the claude.ai dashboard stores it
    └── datasets.json  Title, description and file of each dataset
```

## Sample data

Everything is fictional: an AI voice-agent startup called **Tessera**
(11 people, 22 tasks, 18 agent connections, 6 tool servers). Nothing here
comes from a real team or tool.

| Dataset | What it holds |
|---|---|
| `team` | People: role, time zone, work hours, current focus |
| `activity` | Tasks: status, priority, impact, owner, agent (Claude Code / Codex) |
| `transcripts` | Agent chats, one message per row |
| `mcp` | Agents reporting into the Opsaip MCP server + tool servers Opsaip calls |
| `repo`, `repo_access`, `branches` | The Git repository, roles, open branches |
| `members` | Opsaip workspace roles |
| `channels` | Slack connection |
| `links`, `status_map` | Sync: linked Linear / GitHub / Notion items, status mapping |

## How it works

The page was written for the claude.ai dashboard runtime, which gives it a
`dash` object (`dash.data(id)`, `dash.onData(fn)`, `dash.calc(...)`).
`dash-shim.js` is a small stand-in for that runtime: it reads
`window.OPSAIP_DATA` and runs the page's calculations locally.

**To plug in real data later:** fetch rows from the Opsaip backend in the same
shape as `data/*.json`, then call `dash.reload(newData)`. The page itself
does not need to change.

## What does not work here

- Actions are previews: Approve, Send, Slack messages and sync fixes change
  the page only and are lost on reload.
- Settings are not saved.
- The live dashboard on claude.ai keeps evolving; this folder is a snapshot.
  Export again to update it.
