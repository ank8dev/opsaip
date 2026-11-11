// Entry point of the stdio MCP server (see bin/opsaip-mcp.mjs).
// stdout carries the MCP protocol, so everything else goes to stderr.
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ConfigError, loadConfig, type Config } from './config';
import { createReportClient } from './reportClient';
import { createOpsaipMcpServer } from './tools';

let config: Config;
try {
  config = loadConfig(process.env);
} catch (error) {
  if (!(error instanceof ConfigError)) throw error;
  console.error(`opsaip-mcp: ${error.message}`);
  process.exit(1);
}

// config.token goes into the client and is never printed; this line names
// only the URL, which has no credentials in it (loadConfig refuses them).
const server = createOpsaipMcpServer(createReportClient(config));
await server.connect(new StdioServerTransport());
console.error(`opsaip-mcp: ready, reporting to ${config.reportsUrl.href}`);
