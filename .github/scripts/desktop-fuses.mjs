// Usage: node desktop-fuses.mjs <path/to/Opsaip.app> [...more apps]
// Fails unless the Electron fuses in each packaged app are what
// apps/desktop/electron-builder.yml asks for. Reads the real binary, so it
// catches a config that was ignored, not only a config that is wrong.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { getCurrentFuseWire, FuseV1Options } = require("@electron/fuses");

const ENABLE = 49;
const DISABLE = 48;
const EXPECTED = {
  RunAsNode: DISABLE,
  EnableCookieEncryption: ENABLE,
  EnableNodeOptionsEnvironmentVariable: DISABLE,
  EnableNodeCliInspectArguments: DISABLE,
  EnableEmbeddedAsarIntegrityValidation: ENABLE,
  OnlyLoadAppFromAsar: ENABLE,
  GrantFileProtocolExtraPrivileges: DISABLE,
};
const label = (state) => (state === ENABLE ? "on" : state === DISABLE ? "off" : `state ${state}`);

let failed = false;
for (const app of process.argv.slice(2)) {
  const wire = await getCurrentFuseWire(app);
  for (const [name, want] of Object.entries(EXPECTED)) {
    const got = wire[FuseV1Options[name]];
    const ok = got === want;
    if (!ok) failed = true;
    console.log(`${ok ? "ok  " : "FAIL"} ${app}: ${name} is ${label(got)}${ok ? "" : `, want ${label(want)}`}`);
  }
}
if (process.argv.length < 3) {
  console.error("usage: node desktop-fuses.mjs <path/to/App.app>...");
  failed = true;
}
process.exit(failed ? 1 : 0);
