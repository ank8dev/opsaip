// Run with: node --test .github/scripts
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

const script = (name) => new URL(`./${name}`, import.meta.url).pathname;
const run = (name, args, input = "") =>
  spawnSync(process.execPath, [script(name), ...args], { input, encoding: "utf8" });

test("require-tests: apps/desktop source needs a test change", () => {
  assert.equal(run("require-tests.mjs", [], "apps/desktop/src/policy.ts\n").status, 1);
  assert.equal(
    run("require-tests.mjs", [], "apps/desktop/src/policy.ts\napps/desktop/src/policy.test.ts\n").status,
    0,
  );
  // Config and docs are not source.
  assert.equal(run("require-tests.mjs", [], "apps/desktop/electron-builder.yml\nREADME.md\n").status, 0);
});

// A fake "Opsaip.app" whose Electron Framework holds only the fuse wire.
function fakeApp(states) {
  const app = join(mkdtempSync(join(tmpdir(), "fuses-")), "Opsaip.app");
  const dir = join(app, "Contents", "Frameworks", "Electron Framework.framework");
  mkdirSync(dir, { recursive: true });
  const sentinel = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX");
  writeFileSync(join(dir, "Electron Framework"), Buffer.concat([sentinel, Buffer.from([1, states.length, ...states])]));
  return app;
}
const ON = 49;
const OFF = 48;
// Wire order: RunAsNode, CookieEncryption, NodeOptions, NodeCliInspect,
// AsarIntegrity, OnlyLoadAppFromAsar, V8Snapshot (not checked), FileProtocolExtraPrivileges.
const HARDENED = [OFF, ON, OFF, OFF, ON, ON, OFF, OFF];

test("desktop-fuses: passes a hardened app", () => {
  const r = run("desktop-fuses.mjs", [fakeApp(HARDENED)]);
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test("desktop-fuses: fails when any checked fuse is wrong", () => {
  for (const i of [0, 1, 2, 3, 4, 5, 7]) {
    const states = [...HARDENED];
    states[i] = states[i] === ON ? OFF : ON;
    const r = run("desktop-fuses.mjs", [fakeApp(states)]);
    assert.equal(r.status, 1, `fuse ${i} flipped should fail`);
    assert.match(r.stdout, /FAIL/);
  }
});

test("desktop-fuses: fails with no app", () => {
  assert.equal(run("desktop-fuses.mjs", []).status, 1);
});
