// Test helper (not a test): a fake `claude` for the Conductor tests. It speaks
// the same protocol as `claude -p --input-format stream-json --output-format
// stream-json --verbose`, and it asks for permissions the real way: it starts
// the MCP server from the --mcp-config file Opsaip wrote (the real
// permissionMcp.mjs, over the real socket) and calls its approve tool.
// It never contacts any model and needs no credentials.
//
// The init event carries a session_id; --resume <id> is accepted and echoed in it.
//
//   node fakeClaude.mjs --scenario <name> [--record <file>] <claude flags...>
//
// --record appends one JSON line per notable thing to <file> (argv, env
// checks, prompt, decisions, signals), for the tests to assert on.
import { spawn } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';

const args = process.argv.slice(2);
let scenario = 'success';
let recordFile;
while (args[0] === '--scenario' || args[0] === '--record') {
  const [flag, value] = args.splice(0, 2);
  if (flag === '--scenario') scenario = value;
  else recordFile = value;
}
const record = (entry) => {
  if (recordFile !== undefined) appendFileSync(recordFile, `${JSON.stringify(entry)}\n`);
};
const out = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const say = (text) => out({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] }, parent_tool_use_id: null });
const result = (text) => out({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 1 });

record({ event: 'argv', argv: args });
record({
  event: 'env',
  opsaipVars: Object.keys(process.env).filter((name) => name.toUpperCase().startsWith('OPSAIP_')),
  mcpToolTimeout: process.env.MCP_TOOL_TIMEOUT,
  idleTimeout: process.env.CLAUDE_CODE_MCP_TOOL_IDLE_TIMEOUT,
  cwd: process.cwd(),
});

const flag = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
for (const required of ['-p', '--verbose', '--strict-mcp-config']) {
  if (!args.includes(required)) fatal(`missing ${required}`);
}
if (flag('--input-format') !== 'stream-json' || flag('--output-format') !== 'stream-json') fatal('not stream-json');
// The session id a fresh run reports. A resumed run (--resume <id>) reports that id back.
const FAKE_SESSION_ID = 'fake-session-0001';
const promptTool = flag('--permission-prompt-tool');

// --- signals -----------------------------------------------------------------
let waitingForDecision = false;
process.on('SIGTERM', () => {
  record({ event: 'sigterm', waitingForDecision });
  if (scenario !== 'ignore-sigterm') process.exit(143);
});

// --- MCP client for the permission server ------------------------------------
const config = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8'));
const serverName = Object.keys(config.mcpServers)[0];
const server = config.mcpServers[serverName];
const mcp = spawn(server.command, server.args, {
  env: { ...process.env, ...server.env },
  stdio: ['pipe', 'pipe', 'ignore'],
});
const calls = new Map();
let nextRpc = 1;
lines(mcp.stdout, (line) => {
  const message = JSON.parse(line);
  calls.get(message.id)?.(message);
  calls.delete(message.id);
});
const rpc = (method, params) =>
  new Promise((resolve) => {
    const id = nextRpc++;
    calls.set(id, resolve);
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });

async function askPermission(toolName, input) {
  waitingForDecision = true;
  const response = await rpc('tools/call', {
    name: promptTool.split('__')[2],
    arguments: { tool_name: toolName, input, tool_use_id: `toolu_${nextRpc}` },
  });
  waitingForDecision = false;
  const decision = JSON.parse(response.result.content[0].text);
  record({ event: 'decision', toolName, decision });
  return decision;
}

// --- stdin: stream-json user messages ------------------------------------------
const userMessages = [];
let wakeUser;
let stdinEnded = false;
let wakeEnd;
lines(process.stdin, (line) => {
  const message = JSON.parse(line);
  if (message.type !== 'user') return;
  userMessages.push(message.message.content);
  wakeUser?.();
});
process.stdin.on('end', () => {
  stdinEnded = true;
  wakeUser?.();
  wakeEnd?.();
});
const nextUserMessage = async () => {
  while (userMessages.length === 0) {
    if (stdinEnded) return undefined;
    await new Promise((resolve) => (wakeUser = resolve));
  }
  return userMessages.shift();
};
const untilStdinEnds = () => (stdinEnded ? Promise.resolve() : new Promise((resolve) => (wakeEnd = resolve)));
const forever = () => new Promise(() => setInterval(() => {}, 60_000));

// --- the session ---------------------------------------------------------------
const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'fake-claude', version: '0' } });
mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
const tools = await rpc('tools/list', {});
const toolNames = tools.result.tools.map((tool) => `mcp__${serverName}__${tool.name}`);
record({ event: 'mcp', protocolVersion: init.result.protocolVersion, toolNames });
if (!toolNames.includes(promptTool)) fatal('permission prompt tool not found');
out({ type: 'system', subtype: 'init', session_id: flag('--resume') ?? FAKE_SESSION_ID, cwd: process.cwd(), tools: toolNames, mcp_servers: [{ name: serverName, status: 'connected' }], permissionMode: flag('--permission-mode') });

const prompt = await nextUserMessage();
record({ event: 'prompt', text: prompt });

switch (scenario) {
  case 'success':
    say('Looking at the code');
    result('All done');
    break;
  case 'permission': {
    say('I need to run the tests');
    const decision = await askPermission('Bash', { command: 'npm test' });
    result(`decision: ${decision.behavior}${decision.message ? ` (${decision.message})` : ''}`);
    break;
  }
  case 'two-permissions': {
    const [first, second] = await Promise.all([
      askPermission('Bash', { command: 'npm test' }),
      askPermission('WebFetch', { url: 'https://example.com/' }),
    ]);
    result(`decisions: ${first.behavior}, ${second.behavior}`);
    break;
  }
  case 'followup': {
    say('Send me a follow-up');
    const text = await nextUserMessage();
    record({ event: 'followup', text });
    result(`follow-up: ${text}`);
    break;
  }
  case 'hang':
  case 'ignore-sigterm':
    say('Working');
    await forever();
    break;
  case 'permission-hang':
    await askPermission('Bash', { command: 'rm -rf build' });
    await forever();
    break;
  case 'crash':
    say('About to crash');
    process.exit(3);
    break;
  case 'malformed':
    process.stdout.write('not json\n[1,2]\nnull\n"text"\n{"type":"mystery"}\n{"type":"assistant","message":null}\n');
    process.stdout.write('{"type":"assistant","message":{"content":[{"type":"text","text":"from a subagent"}]},"parent_tool_use_id":"toolu_x"}\n');
    process.stdout.write(`{"type":"assistant","junk":"${'x'.repeat(200_000)}"}\n`);
    process.stdout.write('{"type":"assist'); // a line split across writes
    await new Promise((resolve) => setTimeout(resolve, 20));
    process.stdout.write('ant","message":{"content":[{"type":"text","text":"still fine"}]}}\n\n\n');
    result('survived');
    break;
  case 'error-result':
    out({ type: 'result', subtype: 'error_during_execution', is_error: true, errors: ['boom'] });
    break;
  case 'exit-without-result':
    say('Leaving early');
    process.exit(0);
    break;
  case 'linger':
    result('done, but not exiting');
    await untilStdinEnds();
    await forever();
    break;
  default:
    fatal(`unknown scenario ${scenario}`);
}

await untilStdinEnds();
record({ event: 'stdin-closed' });
mcp.stdin.end();
process.exit(0);

function lines(stream, onLine) {
  let buffer = '';
  stream.setEncoding('utf8');
  stream.on('data', (chunk) => {
    buffer += chunk;
    let end;
    while ((end = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (line.trim() !== '') onLine(line);
    }
  });
}

function fatal(message) {
  record({ event: 'fatal', message });
  process.stderr.write(`fake claude: ${message}\n`);
  process.exit(2);
}
