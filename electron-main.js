// Electron main process entry point for Wcoast.
//
// Wcoast is a West Coast (Buchla-style) modular synthesizer built on
// Web Audio, packaged as a native macOS app via Electron. This file is
// the spike-stage main process: it creates the BrowserWindow that hosts
// the renderer (index.html) and does nothing else yet. Persistence, the
// GXW message bridge, and native menus all come later.
//
// The Electron container does NOT change the audio engine — the renderer
// still runs Chromium's Web Audio, with the same AudioWorklet real-time
// constraints it would have in a browser tab. Electron is chosen for the
// convenience of a dedicated window (no tab-mixing) and because the
// eventual GXW bridge is far simpler between two Electron apps than
// between a browser tab and anything.
//
// Cross-origin isolation. The one Electron-specific thing done here that
// matters for the DSP roadmap: we set Cross-Origin-Opener-Policy and
// Cross-Origin-Embedder-Policy headers on the served renderer so that
// crossOriginIsolated is true. That unlocks SharedArrayBuffer, which the
// WASM-threaded-DSP route (compiling oscillator/folder DSP from Rust or C
// and running it in the worklet) depends on. We are NOT committing to that
// route now — the first worklet is hand-written JS — but arranging the
// headers up front costs nothing and keeps the door open. In a plain
// browser deployment these headers are a hosting hassle; in Electron we
// control how the page reaches the renderer, so it's trivial.

const { app, BrowserWindow, protocol, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { initMirror } = require('./electron-mirror');

// Patch save/load lives in the app's own hamburger menu, not the native menu.
// The main process owns the native dialogs and the file writes; the renderer
// reaches them over the preload bridge (window.wcoast.patch).
const PATCH_FILTER = [{ name: 'Wcoast Patch', extensions: ['wcoast'] }];

// Patches live in a WCOAST folder in the user's Documents by default; create it
// on demand and use it as the dialogs' starting location.
async function patchesDir() {
  const dir = path.join(app.getPath('documents'), 'WCOAST');
  await fs.promises.mkdir(dir, { recursive: true });
  return dir;
}

let hasUnsavedChanges = false;   // mirrored from the renderer, to guard window close
let appQuitting = false;         // ⌘Q / app-quit in progress — bypass the unsaved-changes guard
app.on('before-quit', () => { appQuitting = true; });

function registerPatchIpc() {
  ipcMain.on('patch:dirty', (_e, v) => { hasUnsavedChanges = !!v; });
  // Open a docs/help link in the user's default browser. Restricted to http(s)
  // so the renderer can't ask the OS to open arbitrary schemes.
  ipcMain.handle('open-external', async (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) await shell.openExternal(url);
  });
  ipcMain.handle('patch:open', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: PATCH_FILTER, defaultPath: await patchesDir() });
    if (r.canceled || !r.filePaths[0]) return null;
    const filePath = r.filePaths[0];
    return { path: filePath, text: await fs.promises.readFile(filePath, 'utf8') };
  });
  ipcMain.handle('patch:save', async (_e, arg) => {
    let filePath = arg && arg.path;
    if (!filePath) {
      const r = await dialog.showSaveDialog(mainWindow, { filters: PATCH_FILTER, defaultPath: path.join(await patchesDir(), 'patch.wcoast') });
      if (r.canceled || !r.filePath) return null;
      filePath = r.filePath;
    }
    await fs.promises.writeFile(filePath, arg.text, 'utf8');
    return { path: filePath };
  });
  ipcMain.handle('patch:saveAs', async (_e, arg) => {
    const defaultPath = (arg && arg.path) ? arg.path : path.join(await patchesDir(), 'patch.wcoast');
    const r = await dialog.showSaveDialog(mainWindow, { filters: PATCH_FILTER, defaultPath });
    if (r.canceled || !r.filePath) return null;
    await fs.promises.writeFile(r.filePath, arg.text, 'utf8');
    return { path: r.filePath };
  });
}

// Minimal application menu: keep the app menu (Quit/About) and Edit (so
// dictation and copy/paste survive), but no File menu — file actions live only
// in the in-window hamburger.
function applyMinimalMenu() {
  const template = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

// --- Crash safety net (borrowed from the GXW main process) ---
//
// Node aborts the process on an unhandled promise rejection or uncaught
// exception, which in Electron means the whole app vanishes. For a
// single-user creative tool, staying up with one failed operation beats
// terminating mid-session. These handlers turn a fault into a logged,
// survivable event and append the stack to <userData>/crash.log so an
// intermittent fault is diagnosable after the fact.
function logMainProcessFault(kind, err) {
  const stack = (err && err.stack) ? err.stack
    : (err && err.message) ? err.message : String(err);
  const line = `[${new Date().toISOString()}] ${kind}: ${stack}\n`;
  console.error(`Wcoast main-process ${kind} (non-fatal):`, err);
  try {
    const logPath = path.join(app.getPath('userData'), 'crash.log');
    fs.appendFileSync(logPath, line);
  } catch (_e) {
    // userData may be unavailable very early; the console line stands.
  }
}
process.on('unhandledRejection', (reason) => {
  logMainProcessFault('unhandledRejection', reason);
});
process.on('uncaughtException', (err) => {
  logMainProcessFault('uncaughtException', err);
});

app.setName('Wcoast');

let mainWindow;

// Serve the renderer over a custom app:// scheme rather than file://.
//
// AudioWorklet.addModule needs a real URL origin, and crossOriginIsolated
// requires COOP/COEP response headers — neither of which behaves cleanly
// under file://. A tiny in-process scheme handler serves files from the
// app directory and attaches the isolation headers to every response, so
// the renderer runs in a proper isolated origin. This is the piece that
// keeps the SharedArrayBuffer/WASM route available later.
const APP_SCHEME = 'app';
const APP_ORIGIN = `${APP_SCHEME}://wcoast`;

// Privileges must be registered before app.whenReady. secure + standard
// makes the origin behave like https for Web Audio and isolation purposes;
// supportFetchAPI lets the renderer fetch worklet modules and assets.
protocol.registerSchemesAsPrivileged([
  {
    scheme: APP_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
]);

const MIME_BY_EXT = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function registerAppProtocol() {
  protocol.handle(APP_SCHEME, async (request) => {
    // Map app://wcoast/<path> to a file under __dirname. An empty path
    // serves index.html. The URL is normalised and confined to the app
    // directory so a crafted path can't escape it.
    const url = new URL(request.url);
    let relPath = decodeURIComponent(url.pathname);
    if (relPath === '' || relPath === '/') relPath = '/index.html';

    const absPath = path.normalize(path.join(__dirname, relPath));
    if (!absPath.startsWith(__dirname)) {
      return new Response('Forbidden', { status: 403 });
    }

    let data;
    try {
      data = await fs.promises.readFile(absPath);
    } catch (_e) {
      return new Response('Not found', { status: 404 });
    }

    const ext = path.extname(absPath).toLowerCase();
    const mime = MIME_BY_EXT[ext] ?? 'application/octet-stream';
    return new Response(data, {
      status: 200,
      headers: {
        'Content-Type': mime,
        ...ISOLATION_HEADERS,
      },
    });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    title: 'Wcoast',
    show: false,
    backgroundColor: '#14110d',
    webPreferences: {
      preload: path.join(__dirname, 'electron-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadURL(`${APP_ORIGIN}/index.html`);

  // Guard the close if the renderer has unsaved changes.
  mainWindow.on('close', (e) => {
    // ⌘Q (app quit) forces the exit without prompting — the unsaved-changes guard
    // only protects an accidental click of the window's own close button.
    if (appQuitting || !hasUnsavedChanges) return;
    const choice = dialog.showMessageBoxSync(mainWindow, {
      type: 'warning',
      buttons: ['Cancel', 'Discard & Close'],
      defaultId: 1,
      cancelId: 0,
      message: 'You have unsaved changes.',
      detail: 'Close the window without saving your patch?',
    });
    if (choice === 0) e.preventDefault();   // Cancel: keep the window open
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    logMainProcessFault(
      'render-process-gone',
      new Error(`reason=${details.reason} exitCode=${details.exitCode}`),
    );
  });
}

function applyDockIcon() {
  if (process.platform !== 'darwin') return;
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  if (fs.existsSync(iconPath)) {
    app.dock.setIcon(iconPath);
  }
}

app.whenReady().then(() => {
  registerAppProtocol();
  registerPatchIpc();
  initMirror(() => mainWindow);
  applyMinimalMenu();
  applyDockIcon();
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
