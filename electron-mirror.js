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
// Two channels, deliberately separate. The app PROJECTS its live state OUT to
// patch.json / active.json / catalogue.json / selection.json / … (read-only for
// the AI). The AI hands a patch back IN by writing one file the app itself never
// authors — inbox.json. Because nothing the app does ever touches inbox.json, a
// readable, parseable inbox.json IS unambiguously a handoff: no content-diffing a
// file against our own projection writes, no self-write mute, no "have we
// projected yet" gate. The old scheme (AI edits patch.json in place, app guesses
// which writes are its own) was fragile — any slip latched into a false prompt on
// every later folder event. This can't. See design/ai-mirror.md.
//
// Opt-in via Settings, persisted in userData/settings.json; DEFAULT ON.

const { app, ipcMain, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const MIRROR_DIR_NAME = 'mirror';
const INBOX = 'inbox.json';  // the ONE file the AI writes to hand a patch back; the app never authors it
const DEFAULT_ENABLED = true;
const TMP = '.tmp';

let watcher = null;          // fs.watch on the mirror folder (watches for inbox.json)
let watchTimer = null;       // debounce for watch events
let reconciling = false;     // a reconcile is in flight (prevents overlap/double-consume)
let pending = false;         // a folder event arrived during a reconcile — run once more
let writeChain = Promise.resolve();   // serialises mirror:write so same-file projections land in order
let getWindow = () => null;  // returns the BrowserWindow (set by initMirror)

const mirrorDir = () => path.join(app.getPath('documents'), 'DreamRack', MIRROR_DIR_NAME);
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

// Atomic write: a UNIQUE <name>.<n>.tmp then rename to <name>, so a reader (the AI) never sees a
// torn file. The scratch name must be unique per write: with a shared one, two writes of the same
// file collide on it — the second overwrites the first's scratch, the first renames it (so the
// file ends up holding the SECOND's text) and the second's rename dies on ENOENT into a swallowed
// catch. Callers are serialised too (see mirror:write); this is the belt to that pair of braces.
let tmpSeq = 0;
async function writeAtomic(name, text) {
  const tmp = path.join(mirrorDir(), `${name}.${process.pid}.${++tmpSeq}${TMP}`);
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
// Drop any leftover inbox.json before we arm the watch — a handoff only counts for the LIVE
// session the user is driving, so a stale one written while the app was closed must not prompt.
const clearInbox = () => fsp.unlink(path.join(mirrorDir(), INBOX)).catch(() => {});

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
  await clearInbox();
  await copyStaticDocs();
}
async function disable() {
  await writeSettings({ mirrorEnabled: false });
  await emptyFolder();
}

// ---- round-trip watcher: consume an AI's handoff via inbox.json ----
// The AI proposes a patch by writing inbox.json — a file the app never authors —
// so any readable, parseable inbox.json IS the handoff. We watch the folder (a
// single-file watch breaks across the AI's atomic temp-then-rename, which swaps
// the inode) but ignore every event macOS names as something other than the
// inbox; when it names nothing (macOS often doesn't), reconcile falls through and
// simply finds no inbox.json. All the projection + selection/runtime churn is on
// files this never looks at, so it stays silent.
function startWatch() {
  stopWatch();
  try {
    watcher = fs.watch(mirrorDir(), (_evt, name) => {
      if (name && name !== INBOX) return;   // named, and not the inbox → ignore (projection/selection churn)
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
  // Never overlap: our own consuming delete plus a duplicate FSEvent can fire two
  // reconciles; coalesce so one handoff is read (and deleted) exactly once.
  if (reconciling) { pending = true; return; }
  reconciling = true;
  try {
    const p = path.join(mirrorDir(), INBOX);
    let text = null;
    try { text = await fsp.readFile(p, 'utf8'); } catch (_e) { /* absent = nothing waiting */ }
    if (text != null) {
      let complete = true;
      try { JSON.parse(text); } catch (_e) { complete = false; }   // torn mid-write → wait for the completing event
      if (complete) {
        // Consume it: delete BEFORE handing off, so it fires exactly once and any duplicate
        // event that follows finds nothing. (Our own delete names the inbox, so it wakes the
        // watch — harmlessly: the next read is ENOENT.) The renderer validates, confirms with
        // the user, applies, and writes last-apply-result.json.
        await fsp.unlink(p).catch(() => {});
        const win = getWindow();
        if (win && !win.isDestroyed()) win.webContents.send('mirror:external', { text });
      }
    }
  } finally {
    reconciling = false;
    if (pending) { pending = false; reconcile(); }
  }
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
    if (v) { await enable(); startWatch(); } else { await disable(); stopWatch(); }
    return { enabled: !!v, dir: mirrorDir() };
  });
  // Serialised so same-file projection writes land in order (ipcMain.on does not await an async
  // handler, so two writes arriving close together would otherwise interleave at their awaits and
  // rename in the wrong order — patch.json could end up holding the OLDER projection). A promise
  // chain keeps them sequential. (The old self-write mute this also protected is gone: the app
  // never writes inbox.json, so nothing here can be mistaken for a handoff.)
  ipcMain.on('mirror:write', (_e, files) => {
    writeChain = writeChain.then(async () => {
      if (!(await isEnabled()) || !files) return;
      await ensureFolder();
      for (const name of Object.keys(files)) {
        if (name === INBOX) continue;   // the inbox is inbound-only; never let a projection clobber a pending handoff
        try { await writeAtomic(name, files[name]); }
        catch (e) { console.warn('Wcoast mirror write failed:', name, e.message); }
      }
    }).catch((e) => console.warn('Wcoast mirror write chain:', e.message));
  });
  // The renderer reports the outcome of applying an inbox.json handoff.
  ipcMain.on('mirror:result', async (_e, result) => {
    const out = result && result.ok
      ? { status: 'success', timestamp: new Date().toISOString(), applied: ['inbox.json'] }
      : { status: 'rejected', timestamp: new Date().toISOString(), filename: 'inbox.json', error: (result && result.error) || 'unknown' };
    try { await writeAtomic('last-apply-result.json', JSON.stringify(out, null, 2)); } catch (e) { console.warn('Wcoast mirror result write:', e.message); }
  });
  ipcMain.handle('mirror:reveal', async () => { await ensureFolder(); await shell.openPath(mirrorDir()); return mirrorDir(); });

  // Prepare the folder at startup when enabled (default on): create it, clear any
  // leftover .tmp from a crash and any stale inbox.json, refresh the docs, and
  // start watching for a handoff.
  (async () => {
    if (!(await isEnabled())) return;
    await ensureFolder();
    await cleanLeftoverTmp();
    await clearInbox();
    await copyStaticDocs();
    startWatch();
  })().catch((e) => console.warn('Wcoast mirror init:', e.message));

  app.on('before-quit', () => { stopWatch(); markNotLiveSync(); });
}

module.exports = { initMirror };
