// electron-mirror.js — the main-process side of the AI patch mirror.
//
// The patch mirror projects the running app's state to a folder of plain files
// on disk so an AI assistant (Claude, via a filesystem MCP) can read the current
// patch, the module catalogue, and the app state, and reason about them. See
// design/ai-mirror.md.
//
// Following GeoSonel's proven design (GXW electron-mirror.js): the renderer holds
// the in-memory state and computes the file contents; THIS main-process module
// owns the folder, the atomic temp-and-rename writes, and the lifecycle. The
// folder lives at Documents/WCOAST/mirror, beside the user's saved patches, so a
// filesystem MCP already granted the WCOAST folder can reach it without extra
// configuration. (The enabled setting stays in app data, not the mirror folder.)
//
// Phase 1 is the WRITE side only: patch.json, catalogue.json, active.json, and a
// copied AGENTS.md grounding doc. The fs.watch round-trip (AI edits flowing back
// into the app) lands in phase 2.
//
// Opt-in via Settings, persisted in userData/settings.json; DEFAULT ON.

const { app, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const MIRROR_DIR_NAME = 'mirror';
const DEFAULT_ENABLED = true;
const TMP = '.tmp';

const mirrorDir = () => path.join(app.getPath('documents'), 'WCOAST', MIRROR_DIR_NAME);
const settingsPath = () => path.join(app.getPath('userData'), 'settings.json');

async function readSettings() {
  try { return JSON.parse(await fsp.readFile(settingsPath(), 'utf8')); } catch (_e) { return {}; }
}
async function writeSettings(patch) {
  const merged = { ...(await readSettings()), ...patch };
  await fsp.mkdir(path.dirname(settingsPath()), { recursive: true });
  await fsp.writeFile(settingsPath(), JSON.stringify(merged, null, 2), 'utf8');
}
async function isEnabled() {
  const s = await readSettings();
  return typeof s.mirrorEnabled === 'boolean' ? s.mirrorEnabled : DEFAULT_ENABLED;
}

// Atomic write: <name>.tmp then rename to <name>, so a watcher never sees a torn
// file (and the phase-2 self-write mute can key off the completed rename).
async function writeAtomic(name, text) {
  const tmp = path.join(mirrorDir(), name + TMP);
  await fsp.writeFile(tmp, text, 'utf8');
  await fsp.rename(tmp, path.join(mirrorDir(), name));
}

async function ensureFolder() { await fsp.mkdir(mirrorDir(), { recursive: true }); }

async function forEachEntry(fn) {
  let entries = [];
  try { entries = await fsp.readdir(mirrorDir()); } catch (_e) { return; }
  for (const f of entries) await fn(f);
}
const cleanLeftoverTmp = () => forEachEntry((f) => f.endsWith(TMP)
  ? fsp.unlink(path.join(mirrorDir(), f)).catch(() => {}) : null);
const emptyFolder = () => forEachEntry((f) => fsp.unlink(path.join(mirrorDir(), f)).catch(() => {}));

// Copy the static docs from the repo into the mirror: the AI grounding doc and a
// human-facing "do not edit" README (the folder is visible in Documents).
async function copyStaticDocs() {
  for (const name of ['AGENTS.md', 'README.md']) {
    try {
      const text = await fsp.readFile(path.join(__dirname, 'mirror-docs', name), 'utf8');
      await writeAtomic(name, text);
    } catch (e) { console.warn(`Wcoast mirror: ${name} copy failed:`, e.message); }
  }
}

async function enable() {
  await writeSettings({ mirrorEnabled: true });
  await ensureFolder();
  await cleanLeftoverTmp();
  await copyStaticDocs();
}
async function disable() {
  await writeSettings({ mirrorEnabled: false });
  await emptyFolder();
}

// On quit, flip isLive in active.json (synchronously — the app is ending) so a
// reader knows the state is stale.
function markNotLiveSync() {
  try {
    const p = path.join(mirrorDir(), 'active.json');
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    obj.isLive = false;
    fs.writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
  } catch (_e) { /* folder may be disabled/absent */ }
}

function initMirror() {
  ipcMain.handle('mirror:status', async () => ({ enabled: await isEnabled(), dir: mirrorDir() }));
  ipcMain.handle('mirror:setEnabled', async (_e, v) => {
    if (v) await enable(); else await disable();
    return { enabled: !!v, dir: mirrorDir() };
  });
  ipcMain.on('mirror:write', async (_e, files) => {
    if (!(await isEnabled()) || !files) return;
    await ensureFolder();
    for (const name of Object.keys(files)) {
      try { await writeAtomic(name, files[name]); } catch (e) { console.warn('Wcoast mirror write failed:', name, e.message); }
    }
  });
  ipcMain.handle('mirror:reveal', async () => { await ensureFolder(); await shell.openPath(mirrorDir()); return mirrorDir(); });

  // Prepare the folder at startup when enabled (default on): create it, clear any
  // leftover .tmp from a crash, and refresh the grounding doc.
  (async () => {
    if (await isEnabled()) { await ensureFolder(); await cleanLeftoverTmp(); await copyStaticDocs(); }
  })().catch((e) => console.warn('Wcoast mirror init:', e.message));

  app.on('before-quit', markNotLiveSync);
}

module.exports = { initMirror };
