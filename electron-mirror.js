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

let watcher = null;          // fs.watch on the mirror folder (round-trip)
let watchTimer = null;       // debounce for watch events
let reconciling = false;     // a reconcile is in flight (prevents overlap/double-send)
let pending = false;         // a folder event arrived during a reconcile — run once more
let lastPatchText = null;    // last patch.json content WE wrote (self-write mute)
let projected = false;       // the renderer has projected at least once this run
let getWindow = () => null;  // returns the BrowserWindow (set by initMirror)

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

// ---- round-trip watcher: detect an AI's external write to patch.json ----
// macOS fs.watch is unreliable about the filename it reports, so we reconcile by
// CONTENT: on any folder event, re-read patch.json; if it differs from what we
// last wrote, it is an external edit — hand it to the renderer to validate,
// confirm, and apply. Our own projection writes are muted via lastPatchText.
function startWatch() {
  stopWatch();
  try {
    watcher = fs.watch(mirrorDir(), () => {
      if (watchTimer) return;
      watchTimer = setTimeout(reconcile, 150);
    });
  } catch (e) { console.warn('Wcoast mirror watch failed:', e.message); }
}
function stopWatch() {
  if (watcher) { try { watcher.close(); } catch (_e) { /* gone */ } watcher = null; }
  if (watchTimer) { clearTimeout(watchTimer); watchTimer = null; }
}
async function reconcile() {
  watchTimer = null;
  // Never overlap: a second reconcile reading patch.json before the first records
  // it would double-send the same edit (likely when App Nap delays the async read
  // on a backgrounded window). Coalesce instead.
  if (reconciling) { pending = true; return; }
  reconciling = true;
  try {
    const text = await fsp.readFile(path.join(mirrorDir(), 'patch.json'), 'utf8');
    if (text !== lastPatchText) {          // not our own echo
      lastPatchText = text;                // record BEFORE sending so we don't reprocess
      // An external edit only counts once the app has established its own baseline
      // by projecting. Before that, every folder event is startup noise — last
      // session's patch.json still on disk, plus stray FSEvents from the folder
      // prep — so absorb it silently (lastPatchText updated above), never surface
      // it as an AI edit. This keeps a plain rerun quiet even when a watch event
      // beats the first projection into the microtask gap after its rename.
      if (projected) {
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('mirror:external', { text });
      }
    }
  } catch (_e) { /* transient (mid-rename, etc.) */ }
  reconciling = false;
  if (pending) { pending = false; reconcile(); }
}

// Seed the self-write baseline from the patch.json already on disk BEFORE arming
// the watch. Otherwise lastPatchText is null while last session's patch.json still
// sits in the folder, so the first folder event — including a late FSEvent from
// the startup writes — reconciles that stale file as an external AI edit and pops
// the accept/reject prompt (on every rerun, or the moment the mirror is toggled
// on). The renderer's own projection overwrites patch.json and re-seeds this; a
// genuine edit while the app is running still differs and still prompts.
async function seedBaseline() {
  try { lastPatchText = await fsp.readFile(path.join(mirrorDir(), 'patch.json'), 'utf8'); } catch (_e) { /* no prior file */ }
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

function initMirror(windowGetter) {
  getWindow = windowGetter || (() => null);

  ipcMain.handle('mirror:status', async () => ({ enabled: await isEnabled(), dir: mirrorDir() }));
  ipcMain.handle('mirror:setEnabled', async (_e, v) => {
    if (v) { await enable(); await seedBaseline(); startWatch(); } else { await disable(); stopWatch(); }
    return { enabled: !!v, dir: mirrorDir() };
  });
  ipcMain.on('mirror:write', async (_e, files) => {
    if (!(await isEnabled()) || !files) return;
    await ensureFolder();
    for (const name of Object.keys(files)) {
      try {
        await writeAtomic(name, files[name]);
        // Mute our own echo, and mark that the app has now projected — from here
        // on a differing patch.json is a genuine external edit worth surfacing.
        if (name === 'patch.json') { lastPatchText = files[name]; projected = true; }
      } catch (e) { console.warn('Wcoast mirror write failed:', name, e.message); }
    }
  });
  // The renderer reports the outcome of applying an external patch.json edit.
  ipcMain.on('mirror:result', async (_e, result) => {
    const out = result && result.ok
      ? { status: 'success', timestamp: new Date().toISOString(), applied: ['patch.json'] }
      : { status: 'rejected', timestamp: new Date().toISOString(), filename: 'patch.json', error: (result && result.error) || 'unknown' };
    try { await writeAtomic('last-apply-result.json', JSON.stringify(out, null, 2)); } catch (e) { console.warn('Wcoast mirror result write:', e.message); }
  });
  ipcMain.handle('mirror:reveal', async () => { await ensureFolder(); await shell.openPath(mirrorDir()); return mirrorDir(); });

  // Prepare the folder at startup when enabled (default on): create it, clear any
  // leftover .tmp from a crash, refresh the docs, and start watching for edits.
  (async () => {
    if (!(await isEnabled())) return;
    await ensureFolder();
    await cleanLeftoverTmp();
    await copyStaticDocs();
    await seedBaseline();
    startWatch();
  })().catch((e) => console.warn('Wcoast mirror init:', e.message));

  app.on('before-quit', () => { stopWatch(); markNotLiveSync(); });
}

module.exports = { initMirror };
