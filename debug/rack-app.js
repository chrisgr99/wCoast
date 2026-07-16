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
import { serialize, restore, validate } from '../host/patch-io.js';
import { createStorage } from '../host/storage.js';
import { buildCatalogue, createMirror } from '../host/mirror.js';
import { createAudioTrace } from '../host/audio-trace.js';
import { createTour, tourSeen } from '../host/tour.js';
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
  let dirty = false, patchName = null, mirror = null, booted = false;
  rack = new Rack(document.getElementById('rack'), {
    host, moduleTypes: MODULE_TYPES, rowCount: 2, dark: darkMode, onChange: () => onEdit(),
  });
  rack.relayout();

  // The output mixer is now a pinned rack module — a terminal singleton placed
  // once at the bottom row (draggable, not deletable) that stays the stable
  // "mixer" patch endpoint. Muted until On (via masterMute, set below).
  const mixRec = await rack.addModule(mixerDescriptor.id, rack.rowCount - 1, 0, { pinned: true, key: 'mixer' });
  mixer = { instanceId: mixRec.instanceId, instance: mixRec.instance };
  trace = createAudioTrace({ ctx: audioCtx, rack, mixer: mixer.instance });

  // Unsaved-changes tracking (state declared above the rack). Any knob, switch,
  // cable, or mixer change dirties the patch; loading or saving cleans it. The
  // title shows a dot while dirty, mirrored to the main process to guard close.
  function updateTitle() { document.title = `Wcoast — ${patchName || 'untitled'}${dirty ? ' •' : ''}`; }
  function setPatchName(n) { patchName = n; updateTitle(); if (mirror) mirror.project(); }
  function markDirty() { if (dirty) return; dirty = true; updateTitle(); window.wcoast?.patch?.setDirty?.(true); }
  function markClean() { dirty = false; updateTitle(); window.wcoast?.patch?.setDirty?.(false); if (mirror) mirror.project(); }
  // Any patch edit: mark dirty and re-project the mirror.
  function onEdit() { markDirty(); autosaveSession(); if (mirror) mirror.project(); }

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
    rack.clear(); storage.forget(); setPatchName(null); markClean();
  }
  async function openPatch() {
    if (!okToDiscard()) return;
    let f;
    try { f = await storage.open(); } catch (e) { log(`open failed: ${e.message}`); return; }
    if (!f) return;
    try { await restore(JSON.parse(f.text), rack, mixerIO); setPatchName(f.name); markClean(); }
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
  async function reopenPatch() {
    if (!okToDiscard()) return;
    let f;
    try { f = await storage.reopenLast(); } catch (e) { log(`reopen failed: ${e.message}`); return; }
    if (!f) return;
    try { await restore(JSON.parse(f.text), rack, mixerIO); setPatchName(f.name); markClean(); }
    catch (e) { log(`restore failed: ${e.message}`); window.alert(`Could not open patch: ${e.message}`); }
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
    try { await restore(obj, rack, mixerIO); } catch (e) { return { ok: false, error: `apply failed: ${e.message}` }; }
    markDirty();
    return { ok: true };
  }

  // The panel pie's app-menu wedge opens the File menu, reusing the rack's pop-up menu.
  // Hierarchical menu: the top level shows File / Edit / View; hovering (or clicking) a
  // heading opens its submenu, Electron-style.
  const openAppMenu = (x, y) => {
    const file = [
      { label: 'New', action: () => newPatch() },
      { label: 'Open…', action: () => openPatch() },
      { label: 'Save', action: () => savePatch() },
      { label: 'Save As…', action: () => saveAsPatch() },
    ];
    if (storage.hasLast && storage.hasLast()) file.push({ label: `Reopen ${storage.lastName()}`, action: () => reopenPatch() });
    const edit = [
      { label: 'Undo', disabled: !rack.canUndo(), action: () => rack.undo() },
      { label: 'Redo', disabled: !rack.canRedo(), action: () => rack.redo() },
      { label: 'Clear connections & controls…', action: () => rack.confirmDeleteAllCables() },
    ];
    // View (Dark/Light mode is self-describing: the label names the mode it switches to).
    const view = [
      { label: rack.isDark() ? 'Light mode' : 'Dark mode', action: () => {
        const d = !rack.isDark();
        rack.setDarkMode(d);   // re-skins every module, the pinned mixer included
        if (tour) tour.applyTheme();   // ...and the tutorial card, which is dressed as a faceplate
        try { localStorage.setItem('wcoast.dark', d ? '1' : '0'); } catch (_e) { /* no storage */ }
      } },
      { label: 'Rows in rack', submenu: [2, 3, 4].map((n) => ({
        label: String(n), checkFn: () => rack.rowCount === n, action: () => rack.setRowCount(n),
      })) },
      { label: 'Fit to window', action: () => rack.resetZoom() },
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
      { label: 'Help', submenu: rack.helpMenuItems() },
    ]);
  };
  rack.onAppMenu = openAppMenu;              // panel-pie app-menu wedge
  // The always-visible hamburger: the same main menu, for anyone who hasn't met right-click yet
  // (or dismissed the tour before it said so). Opens under the button, like a menu bar would.
  document.getElementById('burger').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openAppMenu(Math.max(4, r.right - 190), r.bottom + 4);   // hang it INWARD from a top-right button
  });

  // The interactive tutorial: modeless cards the reader drives with Next/Back. Opens on a first
  // run (unless "Don't show on startup" is set), and always available from Help ▸ Interactive tutorial.
  // The copy lives in host/tutorial.md — one file that is both the tutorial and a readable document.
  // A failure here must not take the app down with it: no tutorial is survivable, a dead boot isn't.
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

  // Standard file shortcuts (we dropped the native File menu): Cmd/Ctrl-S save,
  // Shift adds Save As; Cmd/Ctrl-O open; Cmd/Ctrl-N new.
  window.addEventListener('keydown', (e) => {
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
        await restore(obj, rack, mixerIO); syncMaster(); resumed = true;
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
