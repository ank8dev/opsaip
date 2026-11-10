// Run with: node --test .github/scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findMatches, parseGlobList } from "./globs.mjs";

const globs = parseGlobList(
  readFileSync(new URL("../SECURITY_PATHS", import.meta.url), "utf8"),
);
const hit = (p) => findMatches([p], globs).length === 1;

test("protected paths are matched", () => {
  for (const p of [
    ".github/workflows/ci.yml",
    "apps/web/src/auth/login.ts",
    "auth/x.ts",
    "packages/core/src/permissions/roles.ts",
    "apps/web/src/lib/apiToken.ts",
    "server/Secret.ts",
    ".env",
    ".env.example",
    "apps/web/.env.local",
    "Dockerfile",
    "server/Dockerfile.dev",
    "docker-compose.yml",
    "docker-compose.override.yml",
    "package.json",
    "apps/mobile/package-lock.json",
    "packages/core/package.json",
  ]) {
    assert.ok(hit(p), `should match: ${p}`);
  }
});

test("ordinary paths are not matched", () => {
  for (const p of [
    "apps/web/src/components/home/Home.tsx",
    "packages/core/src/applyReport.ts",
    "docs/AUTOMATION.md",
    "README.md",
    "apps/web/src/author.ts",
    "apps/web/src/github/x.ts",
    "apps/web/src/styles/tokens.css",
    "apps/mobile/src/theme/tokens.ts",
  ]) {
    assert.ok(!hit(p), `should not match: ${p}`);
  }
});

test("exclusions only cover design tokens, and the last rule wins", () => {
  assert.ok(hit("apps/web/src/lib/tokens.ts"));
  assert.ok(hit("apps/web/src/auth/token.ts"));
  assert.ok(hit("apps/web/src/styles/secret.css"));
  // negation placed first does not exclude anything
  const g = parseGlobList("!a/x\na/**");
  assert.equal(findMatches(["a/x"], g).length, 1);
});
