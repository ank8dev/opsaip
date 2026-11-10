// Entry point: `npm run server` from the repository root.
import { resolve } from 'node:path';
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

// config.token is passed on and never logged; the log lines below print
// only the address and the database path.
const server = createApp({ store: createSqliteTaskStore(db), token: config.token });
const { host, port } = config;
const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

server.on('error', (error) => {
  // Most often EADDRINUSE (port taken) or EADDRNOTAVAIL (bad OPSAIP_HOST).
  console.error(`opsaip: cannot listen on ${url}: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`opsaip: server listening on ${url}, database ${dbPath}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => {
      db.close();
      process.exit(0);
    });
  });
}
