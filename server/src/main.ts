// Entry point: `npm run server` from the repository root.
import { createTaskStore } from '@opsaip/core';
import { createApp } from './app';
import { ConfigError, loadConfig, type Config } from './config';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`opsaip: ${error.message}`);
  process.exit(1);
}

// v0: tasks live in memory and are lost when the process stops.
const server = createApp({ store: createTaskStore() });
const { host, port } = config;
const url = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;

server.on('error', (error) => {
  // Most often EADDRINUSE (port taken) or EADDRNOTAVAIL (bad OPSAIP_HOST).
  console.error(`opsaip: cannot listen on ${url}: ${error.message}`);
  process.exit(1);
});

server.listen(port, host, () => {
  console.log(`opsaip: server listening on ${url}`);
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
