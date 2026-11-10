// Tiny glob matcher shared by the CI scripts. No dependencies.
// Supported: leading ! (exclude), *  (no slash), **  (anything), **/ (zero or more directories), ?

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        if (glob[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else if (c === "?") {
      re += "[^/]";
    } else {
      re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    }
  }
  return new RegExp(`^${re}$`, "i");
}

export function parseGlobList(text) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const negate = line.startsWith("!");
      const glob = negate ? line.slice(1) : line;
      return { glob, negate, re: globToRegExp(glob) };
    });
}

// Returns [{ path, glob }] for every matched path.
// Rules apply in order and the LAST rule that matches a path wins, like
// .gitignore: a "!glob" line un-matches paths matched by an earlier line.
export function findMatches(paths, globs) {
  const hits = [];
  for (const path of paths) {
    let hit = null;
    for (const rule of globs) {
      if (rule.re.test(path)) hit = rule.negate ? null : rule;
    }
    if (hit) hits.push({ path, glob: hit.glob });
  }
  return hits;
}
