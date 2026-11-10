// Usage: node security-gate.mjs <SECURITY_PATHS file> <files.json>
// files.json: output of `gh api --paginate .../pulls/N/files` (JSON array(s)).
// Exit 0: no protected path touched. Exit 1: at least one is.
// Reads only data. Never runs or imports anything from the PR.
import { readFileSync } from "node:fs";
import { findMatches, parseGlobList } from "./globs.mjs";

const MAX_FILES = 3000; // GitHub's API stops listing here; treat as unsafe.

const [, , pathsFile, filesJson] = process.argv;
const globs = parseGlobList(readFileSync(pathsFile, "utf8"));
if (globs.length === 0) {
  console.error("SECURITY_PATHS is empty or unreadable; refusing to pass.");
  process.exit(1);
}

// `gh api --paginate` prints one JSON array per page; join them.
const text = readFileSync(filesJson, "utf8").trim();
const files = text
  ? JSON.parse(`[${text.replace(/\]\s*\[/g, "],[")}]`).flat()
  : [];

if (files.length >= MAX_FILES) {
  console.error(`PR lists ${files.length}+ files; too large to verify.`);
  process.exit(1);
}

const paths = files.flatMap((f) =>
  f.previous_filename ? [f.filename, f.previous_filename] : [f.filename],
);
const hits = findMatches(paths, globs);

if (hits.length === 0) {
  console.log(`OK: ${files.length} file(s), none in SECURITY_PATHS.`);
  process.exit(0);
}
console.error("Protected paths changed:");
for (const { path, glob } of hits) console.error(`  ${path}   (matches ${glob})`);
process.exit(1);
