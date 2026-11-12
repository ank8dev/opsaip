// Smoke test of the packaged desktop app, run by .github/workflows/desktop.yml.
//
// Expects: the Opsaip server on 127.0.0.1 with a task titled $SMOKE_TASK_TITLE,
// config.json pointing the app at it, and the app started with
// --remote-debugging-port=$CDP_PORT. Talks to the window over the Chrome
// DevTools Protocol (Node's built-in fetch and WebSocket; no dependencies).
//
// Checks the parts unit tests cannot: the page loads over app:// under its CSP
// with no errors, storage works, /v1 is forwarded with the token and nothing
// else reaches the network, and the web UI shows the server's task.
import { writeFileSync } from "node:fs";

const port = process.env.CDP_PORT ?? "9222";
const token = process.env.OPSAIP_TOKEN;
const title = process.env.SMOKE_TASK_TITLE;
const screenshot = process.env.SMOKE_SCREENSHOT;
if (!token || !title) throw new Error("OPSAIP_TOKEN and SMOKE_TASK_TITLE are required");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findWindow() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === "page" && t.url.startsWith("app://opsaip/"));
      if (page) return page;
    } catch {
      // not listening yet
    }
    await sleep(500);
  }
  throw new Error("no app://opsaip window within 60 s");
}

const target = await findWindow();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = () => reject(new Error("could not connect to the window"));
});

let nextId = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id !== undefined) {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
  } else {
    events.push(msg);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });

async function evaluate(expression) {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) {
    throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  }
  return r.result.value;
}

async function reloadAndWait() {
  const from = events.length;
  await send("Page.reload", { ignoreCache: true });
  const deadline = Date.now() + 30_000;
  while (!events.slice(from).some((e) => e.method === "Page.loadEventFired")) {
    if (Date.now() > deadline) throw new Error("page did not load within 30 s");
    await sleep(100);
  }
  await sleep(2000); // let scripts run and fonts settle
  return from;
}

function errorsSince(from) {
  const out = [];
  for (const e of events.slice(from)) {
    if (e.method === "Runtime.exceptionThrown") {
      out.push(`exception: ${e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text}`);
    } else if (e.method === "Runtime.consoleAPICalled" && ["error", "assert"].includes(e.params.type)) {
      out.push(`console.${e.params.type}: ${e.params.args.map((a) => a.value ?? a.description).join(" ")}`);
    } else if (e.method === "Log.entryAdded" && e.params.entry.level === "error") {
      out.push(`${e.params.entry.source}: ${e.params.entry.text}`);
    }
  }
  return out;
}

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

await send("Runtime.enable");
await send("Log.enable");
await send("Page.enable");

// 1. A clean load in Demo mode: no CSP violations, no exceptions.
const loadErrors = errorsSince(await reloadAndWait());
check("page loads with no errors or CSP violations", loadErrors.length === 0, loadErrors.join(" | "));
check("served from app://opsaip", (await evaluate("location.href")) === "app://opsaip/index.html");
check("module scripts ran (React rendered)", (await evaluate("document.getElementById('root').children.length")) > 0);
check(
  "localStorage works",
  await evaluate("localStorage.setItem('smoke', '1'); const v = localStorage.getItem('smoke'); localStorage.removeItem('smoke'); v === '1'"),
);
const csp = await evaluate("fetch('/index.html').then((r) => r.headers.get('content-security-policy'))");
check("CSP header on pages", typeof csp === "string" && csp.includes("default-src 'none'") && csp.includes("connect-src 'self'"));

// 2. /v1 is forwarded to the server, with the token and only with it.
const withToken = await evaluate(
  `fetch('/v1/tasks', { headers: { authorization: 'Bearer ${token}' } }).then(async (r) => ({ status: r.status, body: await r.text() }))`,
);
check("GET /v1/tasks with the token: 200 and the task", withToken.status === 200 && withToken.body.includes(title), `status ${withToken.status}`);
const noToken = await evaluate("fetch('/v1/tasks').then((r) => r.status)");
check("GET /v1/tasks without the token: 401 from the server", noToken === 401, `status ${noToken}`);
const upper = await evaluate("fetch('/V1/tasks').then((r) => r.status)");
check("/V1 is neither forwarded nor read from disk", upper === 404, `status ${upper}`);
const outside = await evaluate("fetch('https://example.com/').then(() => 'reached', () => 'blocked')");
check("the page cannot reach other hosts", outside === "blocked");

// 3. The web UI, connected with the token, shows the server's task.
await evaluate(`sessionStorage.setItem('opsaip.token', '${token}')`);
const uiFrom = await reloadAndWait();
// The sidebar's Agents section lists every agent task, whatever its priority
// (the home tray hides tasks that "can wait"). Open it, then look for the title.
const findTitle = `(() => {
  const agents = [...document.querySelectorAll('button.op-nav-item')].find((b) => b.textContent.includes('Agents'));
  agents?.click();
  return [...document.querySelectorAll('.op-arow-title')].some((el) => el.textContent === ${JSON.stringify(title)});
})()`;
let shown = false;
for (let i = 0; i < 20 && !shown; i++) {
  shown = await evaluate(findTitle);
  if (!shown) await sleep(1000);
}
check("the UI shows the server's task", shown);
const uiErrors = errorsSince(uiFrom);
check("no errors while connected", uiErrors.length === 0, uiErrors.join(" | "));

if (screenshot) {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(screenshot, Buffer.from(data, "base64"));
}
ws.close();

if (failures.length > 0) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
console.log("desktop smoke test passed");
