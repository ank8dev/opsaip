// Entry point: `npm run server` from the repository root.
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { createApp } from './app';
import { ConfigError, loadConfig, type Config } from './config';
import { openDatabase } from './db';
import { createSqliteTaskStore } from './sqliteTaskStore';

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
const server = createApp({ store: createSqliteTaskStore(db), token: config.token, webDir, ask: config.ask });
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
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
