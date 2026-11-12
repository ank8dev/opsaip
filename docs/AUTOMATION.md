# Automation: how a PR gets merged

Agents open PRs. Most PRs merge on their own. PRs that touch sensitive paths wait for the founder.

## The flow

1. An agent opens a PR from a branch in this repo. The description must have a `## Self-review` section (the PR template has it).
2. Two things start at once:
   - **ci** (required). Jobs: `checks`, `tests-required`, `self-review`.
   - **security-gate** (not required). Job: `gate`.
3. When security-gate passes, **auto-merge** turns on GitHub auto-merge (squash).
4. GitHub merges the PR when every required check is green. Nothing else merges it.
5. When security-gate fails, auto-merge is not enabled and the PR gets the label `needs-founder`. The founder reads the PR and merges it by hand once ci is green.

## What each part checks

| Part | Rule |
| --- | --- |
| `checks` | `npm ci`, typecheck, tests (`apps/web`, `packages/core`), web build. |
| `tests-required` | If a `ts/tsx/js/jsx/mjs/cjs` file changes under `packages/**`, `apps/web/src/data/**`, `apps/desktop/**` or `server/**`, at least one test file (`*.test.*`, `*.spec.*`, `__tests__/`) must change too. UI components and `apps/mobile` are exempt. |
| `self-review` | The PR description has a non-empty `## Self-review` section: what was checked, known risks, what tests do not cover. |
| `gate` | The PR must not touch any path in [`.github/SECURITY_PATHS`](../.github/SECURITY_PATHS). Renames count (old path too). |
| `desktop` (not required) | Runs on PRs that touch the desktop app, the web app, the server or dependencies, and on demand (Actions → desktop → Run workflow). On macOS: builds the two `.dmg` files, checks architecture, ad-hoc signature and Electron fuses, runs the Apple Silicon app against a real server, and uploads the `.dmg` files as artifacts. |
| `auto-merge` | Only for PRs from this repo (not forks), not drafts, and only if the gate result is for the current head commit. |

## Why it is safe

- Only the ci jobs are required. A security PR is never stuck on the gate: it stays open for you, and you merge it when ci is green.
- `security-gate` and `auto-merge` run from the default branch (`pull_request_target`, `workflow_run`). A PR cannot edit them to pass. The gate never checks out or runs PR code; it only reads the list of changed file names.
- Any change to `.github/**` is itself protected, so a PR that edits the automation needs the founder.
- Repo-level workflow permissions are read-only. Each job asks for the write access it needs, in its own YAML.
- Actions used by the gate and auto-merge are pinned to full commit SHAs.

## Changing the rules

- Protected paths: edit `.github/SECURITY_PATHS` (a founder PR, because it is under `.github/`). A line starting with `!` excludes paths; the last matching line wins.
- Test-required areas: edit `TESTED_AREAS` in `.github/scripts/require-tests.mjs`.

## Known limits

- `**/*token*` matches any file with "token" in its name. Only two design-token files are excluded (`**/styles/tokens.css`, `**/theme/tokens.ts`). Any other token-named file goes to the founder; add a `!` line to `SECURITY_PATHS` to exclude more.
- The gate and auto-merge workflows only start working after this setup is merged into the default branch.
- GitHub only enables auto-merge if the branch has required checks (see the manual setup steps in the PR).
