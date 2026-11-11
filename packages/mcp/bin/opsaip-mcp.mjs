#!/usr/bin/env node
// Start the Opsaip MCP server: node /path/to/opsaip/packages/mcp/bin/opsaip-mcp.mjs
// tsx is resolved from this file's location, not from the working directory,
// so the command works from any folder (an MCP client starts it in your project).
import { register } from 'tsx/esm/api';

register();
await import('../src/main.ts');
