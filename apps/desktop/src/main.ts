// Opsaip for macOS: a window around the apps/web build. No UI of its own.
// The rules (what may load, open, be forwarded) live in pure, tested modules;
// this file only connects them to Electron.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  Menu,
  nativeTheme,
  protocol,
  session,
  shell,
  type Session,
} from 'electron';
import { forwardApiRequest, keepSentHeaders } from './apiProxy.js';
import { APP_SCHEME, START_URL, fileHeaders, isApiPath, resolveAppFile } from './appFiles.js';
import { parseConfig, type DesktopConfig } from './config.js';
import {
  externalUrl,
  isAllowedApiRequest,
  isAllowedPermission,
  isAllowedWindowRequest,
  isInAppNavigation,
} from './policy.js';

// Settings live in ~/Library/Application Support/Opsaip, whatever the package name.
app.setPath('userData', path.join(app.getPath('appData'), 'Opsaip'));

// Must run before "ready". standard + secure: a real origin and a secure
// context (localStorage, clipboard). supportFetchAPI: the page fetches /v1.
// corsEnabled: Vite's module scripts load in CORS mode.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true },
  },
]);

const devTools = !app.isPackaged;

/** The apps/web build: copied into the app when packaged, ../web/dist in development. */
function webRoot(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'web')
    : path.resolve(app.getAppPath(), '..', 'web', 'dist');
}

async function loadConfig(): Promise<DesktopConfig> {
  try {
    return parseConfig(await readFile(path.join(app.getPath('userData'), 'config.json'), 'utf8'));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return parseConfig(null);
    return { serverBase: null, problem: 'config.json could not be read' };
  }
}

function lockDownWindowSession(ses: Session): void {
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedWindowRequest(details.url, { devTools }) });
  });
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(isAllowedPermission(permission)));
  ses.setPermissionCheckHandler((_wc, permission) => isAllowedPermission(permission));
}

/** A separate, in-memory session for the forwarded API calls: no cookies on disk, server origin only. */
function createApiSession(serverBase: string | null): Session {
  const ses = session.fromPartition('opsaip-api');
  ses.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isAllowedApiRequest(details.url, serverBase) });
  });
  // Drop what Chromium adds on its own (User-Agent, Accept-Language, Sec-Fetch-*).
  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: keepSentHeaders(details.requestHeaders) });
  });
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  return ses;
}

function serveApp(root: string, serverBase: string | null, apiSession: Session): void {
  protocol.handle(APP_SCHEME, async (request) => {
    if (isApiPath(new URL(request.url).pathname)) {
      return forwardApiRequest(request, serverBase, (url, init) => apiSession.fetch(url, init));
    }
    const file = resolveAppFile(root, request.url);
    if (file === null) return new Response('Not found', { status: 404 });
    try {
      return new Response(await readFile(file), { headers: fileHeaders(file) });
    } catch {
      return new Response('Not found', { status: 404 });
    }
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 720,
    minHeight: 480,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 18 },
    // The web app's --op-bg, so there is no white flash before it paints.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0B0B0B' : '#FAFAFA',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      devTools,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  void win.loadURL(START_URL);
}

// Every web contents (the window, DevTools): stay in the app, send links out.
app.on('web-contents-created', (_event, contents) => {
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    const external = externalUrl(url);
    if (external !== null) void shell.openExternal(external);
    return { action: 'deny' };
  });
  const keepInApp = (event: Electron.Event, url: string) => {
    if (isInAppNavigation(url)) return;
    event.preventDefault();
    const external = externalUrl(url);
    if (external !== null) void shell.openExternal(external);
  };
  contents.on('will-navigate', keepInApp);
  contents.on('will-redirect', keepInApp);
});

app.whenReady().then(async () => {
  const config = await loadConfig();
  if (config.problem !== undefined) {
    // A native message, not app UI: the app still opens, with no network.
    void dialog.showMessageBox({
      type: 'warning',
      message: 'Opsaip settings were not loaded',
      detail: `${config.problem}\n\nThe app works offline until this is fixed.`,
    });
  }

  lockDownWindowSession(session.defaultSession);
  serveApp(webRoot(), config.serverBase, createApiSession(config.serverBase));

  // Standard macOS menus. Edit is required for Cmd+C / Cmd+V to work.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]),
  );

  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
