// rack-app.js — the rack front end (bootstrap).
//
// Wires the module registry, the audio host, the Rack, and the output Mixer
// together. The mixer is a pinned rack module (bottom row) — its channel jacks
// and master fader live on its own faceplate. The mixer IS the output — a module
// only makes sound once its output is patched into a mixer channel; the master
// gain feeds your two outputs. Global controls (app menu, start/stop,
// show-network) are reached from the panel pie and the app menu. Every
// per-parameter module control lives on the module faceplates.

import { ModuleRegistry } from '../host/registry.js';
import { SynthHost } from '../host/host.js';
import { Rack } from '../host/rack.js';
import oscDescriptor from '../modules/complex-oscillator-259t/descriptor.js';
import { create as oscCreate } from '../modules/complex-oscillator-259t/factory.js';
import mixerDescriptor from '../modules/mixer/descriptor.js';
import { create as mixerCreate } from '../modules/mixer/factory.js';
import lpgDescriptor from '../modules/lpg-292/descriptor.js';
import { create as lpgCreate } from '../modules/lpg-292/factory.js';
import fnDescriptor from '../modules/function-gen-281t/descriptor.js';
import { create as fnCreate } from '../modules/function-gen-281t/factory.js';
import galleryDescriptor from '../modules/gallery/descriptor.js';
import { create as galleryCreate } from '../modules/gallery/factory.js';
import { serialize, restore, validate, APP_NAME, APP_VERSION } from '../host/patch-io.js';
import { createStorage } from '../host/storage.js';
import { buildCatalogue, createMirror } from '../host/mirror.js';
import { createAudioTrace } from '../host/audio-trace.js';
import { createTour, tourSeen } from '../host/tour.js';
import { createPatchNotes } from '../host/patch-notes.js';
import { createComposer } from '../host/feedback.js';
import { createAbout } from '../host/about.js';
import { loadTutorial } from '../host/tutorial-md.js';

function log(msg) { console.log('[wcoast]', msg); }

const registry = new ModuleRegistry();
registry.register({ descriptor: oscDescriptor, create: oscCreate });
registry.register({ descriptor: mixerDescriptor, create: mixerCreate });
registry.register({ descriptor: lpgDescriptor, create: lpgCreate });
registry.register({ descriptor: fnDescriptor, create: fnCreate });
registry.register({ descriptor: galleryDescriptor, create: galleryCreate });

const MODULE_TYPES = [{
  descriptorId: oscDescriptor.id,
  name: 'Complex Oscillator',
  hp: oscDescriptor.hp || 34,
  panelUrl: 'modules/complex-oscillator-259t/panel.svg',
  descriptor: oscDescriptor,
}, {
  descriptorId: lpgDescriptor.id,
  name: 'Quad Low Pass Gate',
  hp: 32,
  panelUrl: 'modules/lpg-292/panel.svg',
  descriptor: lpgDescriptor,
}, {
  descriptorId: fnDescriptor.id,
  name: 'Quad Function Generator',
  hp: 30,
  panelUrl: 'modules/function-gen-281t/panel.svg',
  descriptor: fnDescriptor,
}, {
  descriptorId: galleryDescriptor.id,
  name: 'Control Gallery',
  hp: 53,
  panelUrl: 'modules/gallery/panel.svg',
  descriptor: galleryDescriptor,
}, {
  // The mixer is a pinned singleton placed at boot, so it's hidden from the
  // "Add module" menu (no second mixer). Still a normal module type otherwise.
  descriptorId: mixerDescriptor.id,
  name: 'Mixer',
  hp: 32,
  panelUrl: 'modules/mixer/panel.svg',
  descriptor: mixerDescriptor,
  hidden: true,
}];

let audioCtx = null;
let host = null;
let rack = null;
let mixer = null;        // { instanceId, instance }
let trace = null;        // audio-trace projection (created after the mixer)
let started = false;

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  host = new SynthHost(audioCtx, registry);
  log(`Audio ready — ${audioCtx.sampleRate} Hz, crossOriginIsolated = ${self.crossOriginIsolated}.`);
}

async function boot() {
  ensureAudio();
  let darkMode = true;   // first run defaults to DARK; a saved choice (below) overrides
  try { const s = localStorage.getItem('wcoast.dark'); if (s !== null) darkMode = s === '1'; } catch (_e) { /* no storage */ }
  // Unsaved-changes state, declared BEFORE the rack: its onChange fires during
  // relayout and the mixer addModule below, calling onEdit -> markDirty, which
  // reads `dirty` — so `dirty` must already be initialized (no temporal dead zone).
  // `menuStateTimer` is here for exactly the same reason: onEdit/markClean also push the native
  // menu's state, and pushMenuState is hoisted while a `let` beside it would not be.
  let dirty = false, patchName = null, mirror = null, booted = false, menuStateTimer = null, notes = null, examples = [];
  rack = new Rack(document.getElementById('rack'), {
    host, moduleTypes: MODULE_TYPES, rowCount: 2, dark: darkMode, onChange: () => onEdit(),
  });
  rack.relayout();

  // Stamp the exact source revision into saved patches (serialize reads rack.buildInfo), so a bug
  // report carrying a patch traces to a checkout. Electron-from-source only; the browser build has
  // no repository and leaves this undefined, which patch-io omits.
  if (window.wcoast && window.wcoast.build) {
    try { rack.buildInfo = await window.wcoast.build(); } catch (_e) { /* leave unstamped */ }
  }

  // The output mixer is now a pinned rack module — a terminal singleton placed
  // once at the bottom row (draggable, not deletable) that stays the stable
  // "mixer" patch endpoint. Muted until On (via masterMute, set below).
  const mixRec = await rack.addModule(mixerDescriptor.id, rack.rowCount - 1, 0, { pinned: true, key: 'mixer' });
  mixer = { instanceId: mixRec.instanceId, instance: mixRec.instance };
  trace = createAudioTrace({ ctx: audioCtx, rack, mixer: mixer.instance });

  // Unsaved-changes tracking (state declared above the rack). Any knob, switch,
  // cable, or mixer change dirties the patch; loading or saving cleans it. The
  // title shows a dot while dirty, mirrored to the main process to guard close.
  function updateTitle() { document.title = `DreamRack — ${patchName || 'untitled'}${dirty ? ' •' : ''}`; }
  function setPatchName(n) { patchName = n; updateTitle(); if (mirror) mirror.project(); }
  function markDirty() { if (dirty) return; dirty = true; updateTitle(); window.wcoast?.patch?.setDirty?.(true); }
  function markClean() { dirty = false; updateTitle(); window.wcoast?.patch?.setDirty?.(false); if (mirror) mirror.project(); pushMenuState(); }
  // Any patch edit: mark dirty and re-project the mirror.
  function onEdit() { markDirty(); autosaveSession(); if (mirror) mirror.project(); pushMenuState(); }
  // After loading any patch (open/recent/reopen/session-resume/AI-apply): refresh the notes card, and let
  // a note that asked to greet the user pop open.
  function afterLoad() { if (!notes) return; notes.refresh(); if (rack.patchNotesOpen) notes.open(); }

  // Master level lives on the mixer module's own faceplate; this is just the last read of
  // it, kept for the AI mirror's `master` field. Re-read it whenever the fader may have
  // moved without us (a bulk reset, a patch restore).
  let masterValue = Number(mixRec.values.get('master'));
  const syncMaster = () => { masterValue = Number(mixRec.values.get('master')); };

  // Overall sound is ONE state (`started`), shared by the panel-pie sound wedge and the
  // mixer's master-enable lamp — both move together through setSound. The output is gated by the master MUTE (silences without changing
  // level); the audio context resumes on the first enable. The LED/lamp being lit means
  // sound is on.
  const setSound = (on) => {
    started = on;
    if (on) audioCtx.resume();
    rack.applyParam(mixRec, 'masterMute', on ? 'on' : 'off');
    updateTrace();
  };
  // Momentary gate for the pie's sound wedge: set the master mute to exactly `on` while
  // previewing, WITHOUT touching `started`. The wedge previews the TOGGLE (the opposite
  // of the latched state) on hover and restores the latched state on leave, so hovering
  // auditions what a click would do — play if it's off, silence if it's on.
  const soundPeek = (on) => {
    if (on) audioCtx.resume();
    rack.applyParam(mixRec, 'masterMute', on ? 'on' : 'off');
  };
  rack.setSound = setSound;                     // latch overall sound on/off
  rack.soundPeek = soundPeek;                   // momentary audition (sound-wedge hover)
  rack.setTransport = setSound;                 // compat alias
  rack.onTransport = () => setSound(!started);  // compat alias
  rack.isPlaying = () => started;
  rack.applyParam(mixRec, 'masterMute', started ? 'on' : 'off');   // lamp matches the (off) start state

  // After a bulk control reset (clear-patch command, and its undo/redo) the rack has moved
  // the mixer's own params, so re-read the master level, and the master mute must track the
  // latched sound state — reconcile both here.
  rack.onControlsReset = () => {
    syncMaster();
    rack.applyParam(mixRec, 'masterMute', started ? 'on' : 'off');
  };

  // --- VU meters -------------------------------------------------------------
  // One rAF loop reads the mixer instance's per-channel + master RMS and lights
  // the pre-drawn LED rings (fill the ring when lit, clear it when not).
  const vuColumns = [...mixRec.panel.svg.querySelectorAll('[data-wcoast-role="vu"],[data-wcoast-role="vuMaster"],[data-wcoast-role="vuMonitor"]')].map((g) => ({
    chan: g.getAttribute('data-wcoast-chan'),
    segs: [...g.querySelectorAll('[data-wcoast-seg]')].sort(
      (a, b) => (+a.getAttribute('data-wcoast-seg')) - (+b.getAttribute('data-wcoast-seg'))),
  }));
  const vuColour = (i, n) => { const f = i / (n - 1); return f > 0.85 ? '#ff5a4a' : f > 0.6 ? '#f4c430' : '#3ad16b'; };
  // dB meter: map RMS to dBFS and spread a fixed range across the segments, so the meter
  // tracks perceived loudness (a linear meter crowds everything at the top).
  const VU_FLOOR_DB = -48;
  const vuScale = (rms) => { if (rms <= 0) return 0; const db = 20 * Math.log10(rms); return Math.max(0, Math.min(1, (db - VU_FLOOR_DB) / -VU_FLOOR_DB)); };

  // Master PEAK reader (not RMS): peak is what makes a signal "too loud", so an ear
  // monitor auto-levels against the loudest PEAK the main output has actually reached.
  const masterAn = mixer.instance.analysers && mixer.instance.analysers.master;
  const peakBuf = new Float32Array(masterAn && masterAn.l ? masterAn.l.fftSize : 1024);
  const peakOf = (an) => { if (!an) return 0; an.getFloatTimeDomainData(peakBuf); let p = 0; for (let i = 0; i < peakBuf.length; i++) { const a = Math.abs(peakBuf[i]); if (a > p) p = a; } return p; };
  function paintVU() {
    const lv = mixer.instance.levels();
    if (started && masterAn) { const mp = Math.max(peakOf(masterAn.l), peakOf(masterAn.r)); if (mp > (rack._sessionMaxMaster || 0)) rack._sessionMaxMaster = mp; }
    for (const col of vuColumns) {
      const n = col.segs.length;
      const level = col.chan === 'M' ? lv.master : col.chan === 'MON' ? rack.monVuLevel() : (lv.channels[col.chan] || 0);
      const lit = Math.round(vuScale(level) * n);
      for (let i = 0; i < n; i++) col.segs[i].setAttribute('fill', i < lit ? vuColour(i, n) : 'none');
    }
    requestAnimationFrame(paintVU);
  }
  requestAnimationFrame(paintVU);

  // The mixer as a save/load endpoint: its settings are the pinned record's
  // values (it stays the fixed "mixer" key, just now a rack module).
  // masterMute is transport state (unified with the On/Off + the pie sound wedge), NOT
  // a persistent mixer setting — sound always boots OFF (no autoplay), so it's excluded
  // from save/restore. Otherwise a session saved with sound on would restore the master
  // lamp lit while the transport stays off, so the mixer would look enabled but silent.
  // outSource (main/monitor radio) is likewise session state, re-derived from the restored monitors
  // (enabling a monitor selects Monitor), so it's excluded too — a loaded patch boots on Master.
  const mixerIO = {
    key: 'mixer',
    getParams: () => { const o = Object.fromEntries(mixRec.values); delete o.masterMute; delete o.outSource; return o; },
    setParams: (vals) => { for (const [id, v] of Object.entries(vals)) { if (id === 'masterMute' || id === 'outSource') continue; rack.applyParam(mixRec, id, v); } },
  };

  // AI patch mirror: project the live patch, the module catalogue, and app state
  // to a folder on disk (Electron only; a no-op in a browser).
  mirror = createMirror({
    getPatch: () => serialize(rack, mixerIO),
    getActive: () => ({
      protocolVersion: 1,
      isLive: true,
      patch: { name: patchName, dirty },
      state: { sound: started ? 'on' : 'off', master: masterValue },
      sync: { lastSyncAt: new Date().toISOString() },
      files: { roundTrip: ['patch.json'], observationOnly: ['active.json', 'catalogue.json', 'last-apply-result.json', 'selection.json', 'runtime.json', 'audio-trace.json', 'AGENTS.md', 'README.md'] },
    }),
    catalogue: buildCatalogue([oscDescriptor, lpgDescriptor], mixerDescriptor),
    applyEdit,
  });

  // Audio-trace + runtime projection: while sound plays AND the mirror is on,
  // measure the live signal at every wired output, each mixer channel, and the
  // master, and write audio-trace.json (plus a small runtime.json). Started and
  // stopped by the On/Off toggle and the mirror enable toggle.
  function pushTrace(t) {
    const master = t.endpoints.find((e) => e.id === 'mixer.master');
    const runtime = {
      protocolVersion: 1, sound: t.sound, master: masterValue,
      vu: master ? { peak_dbfs: master.peak_dbfs, rms_dbfs: master.rms_dbfs } : null,
      at: t.capturedAt,
    };
    mirror.pushFiles({ 'audio-trace.json': t, 'runtime.json': runtime });
  }
  function updateTrace() {
    if (!trace) return;
    const want = started && mirror.isEnabled();
    if (want && !trace.running()) trace.start(pushTrace);
    else if (!want && trace.running()) trace.stop({ writeOff: mirror.isEnabled() });
  }

  // Sticky deixis: project the module the pointer last entered to selection.json,
  // so "make this one louder" resolves. Debounced; never cleared on pointer-leave.
  let selTimer = null;
  rack.onSelect = (rec) => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      if (!mirror.isEnabled()) return;
      mirror.pushFiles({ 'selection.json': rec ? { id: rec.key, type: rec.descriptorId, name: rec.name } : null });
    }, 200);
  };

  // Save/load: the environment-chosen storage adapter drives the shared core.
  const storage = createStorage();
  const patchText = () => JSON.stringify(serialize(rack, mixerIO), null, 2);
  // A compact patch JSON for embedding in a GitHub bug report / shared post: the bulky frozen-scope trace
  // blobs are stripped (a bug reproduces from the topology + settings, not the captured pixels).
  const trimmedPatchText = () => {
    const obj = serialize(rack, mixerIO);
    for (const p of (obj.probes || [])) { if (p && p.frozen) { p.frozen = false; delete p.wave; delete p.hist; delete p.histIdx; delete p.fastVotes; delete p.forceMode; } }
    return JSON.stringify(obj, null, 2);
  };
  // Session autosave: persist the live patch to localStorage on every edit
  // (debounced) so a relaunch resumes exactly where you left off. Separate from
  // named File saves — this just remembers the last working state.
  const SESSION_KEY = 'wcoast.session';
  let sessTimer = null;
  // Guarded by `booted`: the many addModule edits DURING boot must not overwrite the
  // session with a half-built (e.g. mixer-only) rack — only genuine post-boot edits save.
  function autosaveSession() { if (!booted) return; clearTimeout(sessTimer); sessTimer = setTimeout(() => { try { localStorage.setItem(SESSION_KEY, patchText()); } catch (_e) { /* no storage */ } }, 400); }
  function flushSession() { if (!booted) return; clearTimeout(sessTimer); try { localStorage.setItem(SESSION_KEY, patchText()); } catch (_e) { /* no storage */ } }
  // Guard the destructive actions (New / Open / Reopen) when there's unsaved work.
  const okToDiscard = () => !dirty || window.confirm('You have unsaved changes. Discard them?');

  async function newPatch() {
    if (!okToDiscard()) return;
    rack.clear(); storage.forget(); setPatchName(null); markClean(); afterLoad();
  }
  async function openPatch() {
    if (!okToDiscard()) return;
    let f;
    try { f = await storage.open(); } catch (e) { log(`open failed: ${e.message}`); return; }
    if (!f) return;
    try { await restore(JSON.parse(f.text), rack, mixerIO); setPatchName(f.name); markClean(); afterLoad(); }
    catch (e) { log(`restore failed: ${e.message}`); window.alert(`Could not open patch: ${e.message}`); }
  }
  async function savePatch() {
    try { const name = await storage.save(patchText()); if (name) { setPatchName(name); markClean(); } }
    catch (e) { log(`save failed: ${e.message}`); window.alert(`Could not save: ${e.message}`); }
  }
  async function saveAsPatch() {
    try { const name = await storage.saveAs(patchText()); if (name) { setPatchName(name); markClean(); } }
    catch (e) { log(`save failed: ${e.message}`); window.alert(`Could not save: ${e.message}`); }
  }
  // Open one of the recent saves. Same guard as Open — it discards the current work.
  async function openRecent(id) {
    if (!okToDiscard()) return;
    let f;
    try { f = await storage.openRecent(id); } catch (e) { log(`open failed: ${e.message}`); return; }
    if (!f) { window.alert('That patch could not be opened — it may have been moved or renamed.'); return; }
    try { await restore(JSON.parse(f.text), rack, mixerIO); setPatchName(f.name); markClean(); afterLoad(); }
    catch (e) { log(`restore failed: ${e.message}`); window.alert(`Could not open patch: ${e.message}`); }
  }

  // The recent list is read when the menu OPENS, not cached at boot: the folder is the truth, and
  // it changes underneath us every time a patch is saved — here or in the Finder.
  let recentFiles = [];
  const refreshRecent = async () => { try { recentFiles = await storage.recent(); } catch (_e) { recentFiles = []; } };

  async function reopenPatch() {
    if (!okToDiscard()) return;
    let f;
    try { f = await storage.reopenLast(); } catch (e) { log(`reopen failed: ${e.message}`); return; }
    if (!f) return;
    try { await restore(JSON.parse(f.text), rack, mixerIO); setPatchName(f.name); markClean(); afterLoad(); }
    catch (e) { log(`restore failed: ${e.message}`); window.alert(`Could not open patch: ${e.message}`); }
  }

  // Bundled example patches (examples/index.json), loaded once. Opening one loads it as a STARTING POINT:
  // storage.forget() means a following Save behaves like Save As, since it isn't a file of the user's own.
  const loadExamples = async () => { try { const r = await fetch('examples/index.json'); if (r.ok) examples = await r.json(); } catch (_e) { examples = []; } pushMenuState(); };
  async function openExample(file, name) {
    if (!okToDiscard()) return;
    let obj;
    try { const r = await fetch('examples/' + file); if (!r.ok) throw new Error('not found'); obj = await r.json(); }
    catch (e) { log(`example load failed: ${e.message}`); window.alert('Could not load that example.'); return; }
    try { await restore(obj, rack, mixerIO); storage.forget(); setPatchName(name); markClean(); afterLoad(); }
    catch (e) { log(`restore failed: ${e.message}`); window.alert(`Could not open example: ${e.message}`); }
  }
  // Edit ▸ Create patch from clipboard — load a patch someone shared (e.g. copied from a GitHub post).
  async function createFromClipboard() {
    if (!okToDiscard()) return;
    let text;
    try { text = await navigator.clipboard.readText(); }
    catch (e) { log(`clipboard read failed: ${e.message}`); window.alert('Could not read the clipboard.'); return; }
    text = (text || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/, '').trim();   // tolerate a pasted code fence
    let obj;
    try { obj = JSON.parse(text); } catch (_e) { window.alert('The clipboard doesn’t contain a patch (it isn’t readable as JSON).'); return; }
    const v = validate(obj, registry);
    if (!v.ok) { window.alert(`That isn’t a valid Wcoast patch: ${v.error}`); return; }
    try { await restore(obj, rack, mixerIO); storage.forget(); setPatchName('from clipboard'); markClean(); afterLoad(); }
    catch (e) { window.alert(`Could not open the patch: ${e.message}`); }
  }

  // Apply an AI-proposed patch (an external write to the mirror's patch.json):
  // validate it against the descriptors, confirm with the user, then restore it.
  async function applyEdit(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { return { ok: false, error: `invalid JSON: ${e.message}` }; }
    const v = validate(obj, registry);
    if (!v.ok) return v;
    const cur = serialize(rack, mixerIO);
    const summary = `${cur.modules.length} → ${obj.modules.length} modules, ${cur.wiring.length} → ${obj.wiring.length} cables`;
    if (!window.confirm(`Apply the AI-proposed patch?\n\n${summary}`)) return { ok: false, error: 'cancelled by the user' };
    try { await restore(obj, rack, mixerIO); afterLoad(); } catch (e) { return { ok: false, error: `apply failed: ${e.message}` }; }
    markDirty();
    return { ok: true };
  }

  // The commands the two menus share. Both the in-window menu and the native one call THESE, so
  // there is one implementation of each and they can't drift apart.
  const toggleDark = () => {
    const d = !rack.isDark();
    rack.setDarkMode(d);   // re-skins every module, the pinned mixer included
    if (tour) tour.applyTheme();   // ...and the tutorial card, which is dressed as a faceplate
    if (notes) notes.applyTheme();
    if (composer) composer.applyTheme();
    if (about) about.applyTheme();
    try { localStorage.setItem('wcoast.dark', d ? '1' : '0'); } catch (_e) { /* no storage */ }
    pushMenuState();
  };
  const setRows = (n) => { rack.setRowCount(n); pushMenuState(); };

  // Keep the native menu's state honest: what's undoable, which mode, which patches. Debounced,
  // because this fires on every edit and the main process rebuilds the menu bar from it.
  function pushMenuState() {
    const m = window.wcoast && window.wcoast.menu;
    if (!m) return;                       // browser: there is no native menu
    clearTimeout(menuStateTimer);
    menuStateTimer = setTimeout(async () => {
      menuStateTimer = null;
      let recent = [];
      try { recent = await storage.recent(); } catch (_e) { /* none */ }
      m.setState({ dark: rack.isDark(), rows: rack.rowCount, canUndo: rack.canUndo(), canRedo: rack.canRedo(), recent, examples });
    }, 200);
  }

  // The native menu names an action; the renderer runs the same function the in-window menu does.
  if (window.wcoast && window.wcoast.menu) {
    const actions = {
      new: () => newPatch(), open: () => openPatch(), save: () => savePatch(), saveAs: () => saveAsPatch(),
      openRecent: (id) => openRecent(id),
      undo: () => { rack.undo(); pushMenuState(); },
      redo: () => { rack.redo(); pushMenuState(); },
      clearAll: () => rack.confirmDeleteAllCables(),
      toggleDark: () => toggleDark(),
      setRows: (n) => setRows(n),
      fitToWindow: () => rack.resetZoom(),
      // Run the same items the in-window Help menu offers, rather than restating their URLs here.
      readme: () => { const it = rack.helpMenuItems().find((i) => i.label === 'README'); if (it) it.action(); },
      tutorial: () => { if (rack.onTutorial) rack.onTutorial(); },
      patchNotes: () => { if (notes) notes.toggle(); },
      openExample: (e) => openExample(e.file, e.name),
      createFromClipboard: () => createFromClipboard(),
      feedback: () => composer.feedback(),
      reportBug: () => composer.reportBug(),
      sharePatch: () => composer.sharePatch(),
      about: () => about.toggle(),
    };
    window.wcoast.menu.onAction(({ action, arg }) => { const fn = actions[action]; if (fn) fn(arg); });
  }

  // The panel pie's app-menu wedge opens the File menu, reusing the rack's pop-up menu.
  // Hierarchical menu: the top level shows File / Edit / View; hovering (or clicking) a
  // heading opens its submenu, Electron-style.
  const openAppMenu = (x, y, rec, rowIndex) => {
    const file = [
      { label: 'New', action: () => newPatch() },
      { label: 'Open…', action: () => openPatch() },
      { label: 'Save', action: () => savePatch() },
      { label: 'Save As…', action: () => saveAsPatch() },
      { label: 'Patch notes', action: () => notes.toggle() },
    ];
    if (examples.length) file.push({ label: 'Examples', submenu: examples.map((e) => ({ label: e.name, action: () => openExample(e.file, e.name) })) });
    if (storage.hasLast && storage.hasLast()) file.push({ label: `Reopen ${storage.lastName()}`, action: () => reopenPatch() });
    // Newest first, in a submenu of its own — a header over a flat run of filenames just reads as
    // more File commands. The file you already have open is listed like any other: clicking it
    // re-reads it from disk, which is how you revert to the last save.
    if (recentFiles.length) {
      file.push({ label: 'Recent', submenu: recentFiles.map((f) => ({ label: f.name, action: () => openRecent(f.id) })) });
    }
    const edit = [
      { label: 'Undo', disabled: !rack.canUndo(), action: () => rack.undo() },
      { label: 'Redo', disabled: !rack.canRedo(), action: () => rack.redo() },
      { label: 'Create patch from clipboard', action: () => createFromClipboard() },
      { label: 'Clear connections & controls…', action: () => rack.confirmDeleteAllCables() },
    ];
    // View (Dark/Light mode is self-describing: the label names the mode it switches to).
    const view = [
      { label: rack.isDark() ? 'Light mode' : 'Dark mode', action: () => toggleDark() },
      { label: 'Fit to window', action: () => rack.resetZoom() },
    ];
    // Rack: rack-shaping actions gathered in one place. "Delete this module" acts on the module that was
    // right-clicked (rec); it's disabled when the background was clicked, or the module is pinned (mixer).
    const rackMenu = [
      { label: 'Rows in rack', submenu: [1, 2, 3, 4, 5].map((n) => ({
        label: String(n), checkFn: () => rack.rowCount === n, action: () => setRows(n),
      })) },
      { label: 'Add module', submenu: MODULE_TYPES.filter((t) => !t.hidden).map((t) => ({
        label: t.name, action: () => rack.addModuleFromMenu(t.descriptorId, rowIndex),
      })) },
      { label: 'Delete this module', disabled: !(rec && !rec.pinned),
        action: rec && !rec.pinned ? () => rack.deleteModuleFromMenu(rec) : undefined },
    ];
    rack.openMenu(x, y, [
      // Engine sits at the very top. Its push-button glyph shows PRESSED while sound runs, so
      // the label stays just "Engine". Dwelling the item momentarily enables sound (like the
      // Listen peek) and restores the latched state on leave — a no-op when already running.
      { label: 'Engine', icon: rack.engineButtonIcon(started),
        onDwell: () => rack.soundPeek(true),
        onLeave: () => rack.soundPeek(rack.isPlaying()),
        action: () => setSound(!started) },
      { label: 'File', submenu: file },
      { label: 'Edit', submenu: edit },
      { label: 'View', submenu: view },
      { label: 'Rack', submenu: rackMenu },
      { label: 'Help', submenu: rack.helpMenuItems() },
    ]);
  };
  // Read the folder, THEN open. It's a local readdir of a handful of files, so the wait is
  // imperceptible — and opening first and re-opening once it lands makes the menu flicker.
  rack.onAppMenu = (x, y, rec, rowIndex) => { refreshRecent().then(() => openAppMenu(x, y, rec, rowIndex)); };
  // The always-visible hamburger: the same main menu, for anyone who hasn't met right-click yet
  // (or dismissed the tour before it said so). Opens under the button, like a menu bar would.
  document.getElementById('burger').addEventListener('click', async (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    await refreshRecent();
    openAppMenu(r.left, r.bottom + 4);   // drop it DOWNWARD from a top-left button, like a menu bar
  });

  // The interactive tutorial: modeless cards the reader drives with Next/Back. Opens on a first
  // run (unless "Don't show on startup" is set), and always available from Help ▸ Interactive tutorial.
  // The copy lives in host/tutorial.md — one file that is both the tutorial and a readable document.
  // A failure here must not take the app down with it: no tutorial is survivable, a dead boot isn't.
  notes = createPatchNotes({
    getNotes: () => rack.patchNotes,
    setNotes: (v) => { rack.patchNotes = v; },
    getOpen: () => rack.patchNotesOpen,
    setOpen: (v) => { rack.patchNotesOpen = v; },
    isDark: () => rack.isDark(),
    onChange: () => onEdit(),
  });
  rack.onPatchNotes = () => notes.toggle();
  const composer = createComposer({
    repo: 'chrisgr99/wCoast',
    isDark: () => rack.isDark(),
    getPatchJSON: () => trimmedPatchText(),
    openExternal: (url) => rack._openExternal(url),
    appName: APP_NAME,
    appVersion: APP_VERSION,
    getBuild: () => rack.buildInfo,
  });
  rack.onFeedback = () => composer.feedback();
  rack.onReportBug = () => composer.reportBug();
  rack.onSharePatch = () => composer.sharePatch();
  const about = createAbout({
    appName: APP_NAME,
    appVersion: APP_VERSION,
    author: 'Chris Graham',
    getBuild: () => rack.buildInfo,
    isDark: () => rack.isDark(),
    openExternal: (url) => rack._openExternal(url),
    repoUrl: 'https://github.com/chrisgr99/wCoast',
    onTutorial: () => { if (rack.onTutorial) rack.onTutorial(); },
  });
  rack.onAbout = () => about.toggle();
  loadExamples();   // populate the Examples menu (async; refreshes the native menu when ready)

  let tour = null;
  try {
    const steps = await loadTutorial();
    tour = createTour({ steps, onExternal: (url) => rack._openExternal(url), isDark: () => rack.isDark() });
    rack.onTutorial = () => tour.open(0);
    if (!tourSeen()) tour.open(0);
  } catch (e) {
    log('tutorial unavailable: ' + e.message);
  }

  // F1 — the conventional Help key. Opens the Help menu centred in the window, so it's reachable
  // without knowing about right-click or finding the hamburger.
  // NOTE on macOS: F1 is a system brightness key unless "Use F1, F2, etc. as standard function keys"
  // is on in System Settings ▸ Keyboard — otherwise the app never sees it and you need Fn-F1.
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'F1') return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    e.preventDefault();
    rack.openMenu(window.innerWidth / 2, window.innerHeight / 2, rack.helpMenuItems(), { centred: true });
  });

  // Spacebar toggles the engine on/off — a hands-on-keyboard alternative to the sound wedge and the
  // mixer's master lamp. Ignored while typing in a field, and when a button has focus (Space would
  // "click" it and double-toggle). No modifier, so Cmd/Ctrl-Space and friends pass straight through.
  window.addEventListener('keydown', (e) => {
    if (e.key !== ' ' && e.code !== 'Space') return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'BUTTON' || t.isContentEditable)) return;
    e.preventDefault();
    setSound(!started);
  });

  // Standard shortcuts, for the BROWSER only: in Electron the native menu carries the same
  // accelerators and would fire alongside these.
  window.addEventListener('keydown', (e) => {
    if (window.wcoast && window.wcoast.isElectron) return;
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); if (e.shiftKey) saveAsPatch(); else savePatch(); }
    else if (k === 'o' && !e.shiftKey) { e.preventDefault(); openPatch(); }
    else if (k === 'n' && !e.shiftKey) { e.preventDefault(); newPatch(); }
    else if (k === 'z' && !e.shiftKey) { e.preventDefault(); rack.undo(); }   // undo cable/module topology changes
    else if (k === 'z' && e.shiftKey) { e.preventDefault(); rack.redo(); }    // redo (Cmd/Ctrl-Shift-Z)
  });

  // Warn before a browser tab/window discards unsaved work. In Electron the
  // window close is guarded in the main process (via the mirrored dirty state),
  // so beforeunload here is browser-only to avoid a double prompt.
  if (!(window.wcoast && window.wcoast.isElectron)) {
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
  }
  // Persist the session on unload (both environments) so a relaunch resumes it.
  window.addEventListener('pagehide', flushSession);

  // Resume the last session if one was saved; otherwise start with one of each so
  // there's something to patch.
  let resumed = false;
  try {
    const saved = localStorage.getItem(SESSION_KEY);
    if (saved) {
      const obj = JSON.parse(saved);
      const v = validate(obj, registry);
      // Require at least one module — a module-less session is boot-transient junk,
      // not a patch worth resuming; fall through to the default instead.
      if (v.ok && obj.modules && obj.modules.length) {
        await restore(obj, rack, mixerIO); syncMaster(); afterLoad(); resumed = true;
        // Re-adopt the file this session was editing, so File > Save writes back to it (not a fresh prompt).
        try { const n = await storage.adoptLast(); if (n) patchName = n; } catch (_e) { /* fileless resume */ }
      }
      else if (!v.ok) log(`session ignored: ${v.error}`);
    }
  } catch (e) { log(`session restore failed: ${e.message}`); }
  if (!resumed) {
    // Row 0: Complex Oscillator + Quad Function Generator. Row 1: Mixer (pinned, added
    // above) + Quad Low Pass Gate. Same-row modules pack left-to-right (see _resolveRow).
    await rack.addModule(oscDescriptor.id, 0, 0);
    await rack.addModule(fnDescriptor.id, 0, 0);
    await rack.addModule(lpgDescriptor.id, 1, 0);
  }
  booted = true;   // from here on, real edits autosave the session
  markClean();     // the resumed/starting patch is the clean baseline, not unsaved work
  await mirror.init();   // read enabled state + push the first mirror snapshot
  // The AI mirror is Electron-only and always on: no toggle UI, no folder-reveal — just
  // ensure it's enabled so the running patch is always mirrored.
  if (mirror.available() && !mirror.isEnabled()) { try { await mirror.setEnabled(true); } catch (_e) { /* ignore */ } updateTrace(); }

  // Re-fit once the layout has settled. In Electron the ready-to-show gate means this is
  // already correct; a bare browser settles its flex layout a beat later, so the boot-time
  // fit can be measured too tall.
  requestAnimationFrame(() => rack.relayout());
  pushMenuState();   // seed the native menu now the rack, storage and tutorial all exist

}


// First run only: a small card pointing newcomers at the panel menu's Help, the jack
// menu, and cabling. "Dismiss" closes for now (it returns next launch); "Don't show
// this again" remembers the choice in local storage. The README link opens the browser.
window.addEventListener('DOMContentLoaded', () => {
  if (window.wcoast && window.wcoast.isElectron) {
    log(`Electron — Chromium ${window.wcoast.versions.chrome}, Node ${window.wcoast.versions.node}.`);
  }
  boot().catch((e) => log(`BOOT ERROR: ${e.message}`));
});
