# Opsaip

## Status

In development. The interface runs on a sample team (Tessera). The agent server is next.

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
  brand/          logo sources, SVG/PNG exports, Opsaip Display font, brand tokens
```

### Planned

- **`apps/desktop/`** — a desktop app: an Electron shell around the same `apps/web` build
  (like Claude desktop around claude.ai). No UI code of its own.
- **`server/`** — the self-hosted Opsaip server: the MCP endpoint agents report to, sync with
  Linear / GitHub / Notion, Slack messaging, and the API the web app reads instead of mocks.

## Run the web app

Needs Node.js 20.19 or newer.

```bash
npm install          # once, from the repository root
npm run dev          # http://localhost:5173
npm run build        # production build in apps/web/dist/
npm run preview      # serve that build locally
```

Pass Vite options after `--`, e.g. `npm run dev -- --port 4000`.

## Design

- Monochrome graphite neutrals with **lime as the only accent**; red only for errors.
- Type: **Instrument Sans** for the interface, **DM Mono** for code, IDs and logs (bundled, no CDN).
- Motion "Fluid": long, glassy, blurred on entry — 260 / 480 / 720 ms. Reduced motion is respected.
- All of it lives in [`apps/web/src/styles/tokens.css`](apps/web/src/styles/tokens.css).
- **The Conductor** — the single baton in the interface. It lives just right of the sidebar and
  travels the dashboard to the task it is conducting: beating while an agent works, held still
  while a task waits for you.

## Data

`apps/web/src/data/source.ts` is the single place data comes from. Today it returns the mocks in
`apps/web/src/mocks/`; when the server exists, it will fetch the same shapes from its API
(types in `apps/web/src/types.ts`).

## License

[GNU AGPL v3](LICENSE). You can use, self-host, change and share Opsaip freely. If you run a
modified version as a service for others, you must publish your changes under the same license.
