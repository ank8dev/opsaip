// Usage: git diff --name-only --no-renames A...B | node require-tests.mjs
// Fails when a source file in a tested area changed but no test file did.
import { readFileSync } from "node:fs";
import { findMatches, globToRegExp } from "./globs.mjs";

// Areas that must come with tests. UI components and apps/mobile are exempt.
const TESTED_AREAS = ["packages/**", "apps/web/src/data/**", "server/**"].map(
  (glob) => ({ glob, re: globToRegExp(glob) }),
);
const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const TEST_FILE = /(\.(test|spec)\.[a-z]+$)|(^|\/)__tests__\//i;

const paths = readFileSync(0, "utf8").split("\n").filter(Boolean);
const isTest = (p) => TEST_FILE.test(p);

const needTests = findMatches(
  paths.filter((p) => SOURCE_EXT.test(p) && !isTest(p)),
  TESTED_AREAS,
);
const testsChanged = paths.filter(isTest);

if (needTests.length === 0) {
  console.log("OK: no source change in a tested area.");
  process.exit(0);
}
if (testsChanged.length > 0) {
  console.log(`OK: source changed, and ${testsChanged.length} test file(s) changed.`);
  process.exit(0);
}
console.error("Source changed in a tested area, but no test file changed:");
for (const { path } of needTests) console.error(`  ${path}`);
console.error("Add or update a test (*.test.ts, *.spec.ts or __tests__/).");
process.exit(1);
