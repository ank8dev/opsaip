// Entry point: `npm run server` from the repository root.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { readServerVersion } from './about';
import { createApp } from './app';
import { LOOPBACK_HOSTS } from './auth/conductor/conductorConfig';
import { createRepoRegistry } from './auth/conductor/repoRegistry';
import { createRepoStore } from './auth/conductor/repoStore';
import { createRunManager, type RunManager } from './auth/conductor/runManager';
import { ConfigError, loadConfig, type Config } from './config';
import { createChatStore } from './chatStore';
import { openDatabase } from './db';
import { createSqliteTaskStore } from './sqliteTaskStore';
import { createUpdateCheck, updateCheckEnabled } from './updateCheck';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`opsaip: ${error.message}`);
  process.exit(1);
}

const dbPath = resolve(config.dbPath);
let db: DatabaseSync;
try {
  db = openDatabase(dbPath);
} catch (error) {
  console.error(`opsaip: cannot open the database ${dbPath}: ${(error as Error).message}`);
  process.exit(1);
}

// config.token and the LLM key (inside config.ask) are passed on and never
// logged; the log lines below print only the address, the database path,
// the web app folder and the Ask provider and model names.
const webDir = resolve(config.webDir);
const store = createSqliteTaskStore(db);
// Conductor mode: only on a server that listens on this machine. It is "on"
// once there is a repository (OPSAIP_CONDUCTOR_DIR, or one added in Settings).
// Repository paths are never logged (they are the user's own).
const conductor: RunManager | undefined = LOOPBACK_HOSTS.includes(config.host)
  ? createRunManager({
      store,
      repos: createRepoRegistry({ store: createRepoStore(db), defaultDir: config.conductorDir }),
    })
  : undefined;
const updateCheck = createUpdateCheck({
  current: readServerVersion(),
  enabled: updateCheckEnabled(process.env),
});
const server = createApp({ store, token: config.token, webDir, ask: config.ask, conductor, chats: createChatStore(db), updateCheck });
const { host, port } = config;
const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

server.on('error', (error) => {
  // Most often EADDRINUSE (port taken) or EADDRNOTAVAIL (bad OPSAIP_HOST).
  console.error(`opsaip: cannot listen on ${url}: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`opsaip: server listening on ${url}, database ${dbPath}`);
  if (existsSync(join(webDir, 'index.html'))) {
    console.log(`opsaip: web app at ${url}/ (from ${webDir})`);
  } else {
    console.log(`opsaip: no web app build in ${webDir}; run "npm run build" to serve it at ${url}/`);
  }
  if (config.ask === undefined) {
    console.log('opsaip: Ask is off (set OPSAIP_LLM_PROVIDER and OPSAIP_LLM_KEY to turn it on)');
  } else {
    console.log(`opsaip: Ask is on (${config.ask.name}, model ${config.ask.model})`);
  }
  const repoCount = conductor?.repos.list().length ?? 0;
  if (repoCount === 0) {
    console.log('opsaip: Conductor mode is off (add a repository in Settings > Repositories, or set OPSAIP_CONDUCTOR_DIR)');
  } else {
    console.log(`opsaip: Conductor mode is on (experimental, agent claude-code, ${repoCount} ${repoCount === 1 ? 'repository' : 'repositories'})`);
  }
  if (updateCheck.status().enabled) {
    console.log('opsaip: update check is on (once a day; set OPSAIP_UPDATE_CHECK=off to turn it off)');
  } else {
    console.log('opsaip: update check is off (OPSAIP_UPDATE_CHECK)');
  }
  updateCheck.start();
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    // An active run is stopped first (its pending permission request denied,
    // then SIGTERM, then SIGKILL), so no agent outlives the server and the
    // run's task ends as failed instead of staying "running".
    void (conductor?.stopActive() ?? Promise.resolve()).finally(() => {
      server.close(() => {
        db.close();
        process.exit(0);
      });
    });
  });
}
