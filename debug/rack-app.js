// rack-app.js — the rack front end (bootstrap).
//
// Wires the module registry, the audio host, the Rack, and the output Mixer
// together. The mixer is a pinned rack module (bottom row) — its channel jacks
// and master fader live on its own faceplate, NOT on the toolbar. The mixer IS
// the output — a module only makes sound once its output is patched into a mixer
// channel; the master gain feeds your two outputs. Global controls (app menu,
// start/stop, show-network) are reached from the panel pie and the app menu; the
// top toolbar is retired (hidden from the layout so the modules fill the window),
// its remaining wiring left in place for now. Every per-parameter module control
// lives on the module faceplates.

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
import { parsePanel, attachControlInteraction, showValue } from '../host/panel-loader.js';
import { serialize, restore, validate } from '../host/patch-io.js';
import { createStorage } from '../host/storage.js';
import { buildCatalogue, createMirror } from '../host/mirror.js';
import { createAudioTrace } from '../host/audio-trace.js';

function log(msg) { console.log('[wcoast]', msg); }

// The toolbar master knob: the house blue-ring knob (dark theme) as a self-
// contained SVG, tagged data-wcoast-param="master" so the panel loader binds it
// and gives it the scroll-flywheel — the same control the module panels use.
function masterKnobSvg() {
  const ink = '#b8b8bc', ringStroke = '#6fa8d6', capStroke = '#b8b8bc';
  const cap0 = '#3a3d43', cap1 = '#4c5058', cap2 = '#5a5f67', cap3 = '#6b7079';
  const cx = 8, cy = 8, r = 5, cap = +(r * 0.72).toFixed(2), N = 7, angMin = -150, angMax = 150;
  const a0 = angMin * Math.PI / 180, a1 = angMax * Math.PI / 180;
  let ticks = '';
  for (let k = 0; k < N; k++) {
    const a = a0 + (k / (N - 1)) * (a1 - a0);
    const x1 = (cx + Math.sin(a) * (r + 0.3)).toFixed(2), y1 = (cy - Math.cos(a) * (r + 0.3)).toFixed(2);
    const x2 = (cx + Math.sin(a) * (r + 1.0)).toFixed(2), y2 = (cy - Math.cos(a) * (r + 1.0)).toFixed(2);
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${ink}" stroke-width="0.3"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 1 14 14">
    <defs>
      <filter id="mkShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0.47" dy="0.59" stdDeviation="0.47" flood-color="#000" flood-opacity=".28"/></filter>
      <radialGradient id="mkCap"><stop offset="0" stop-color="${cap0}"/><stop offset="0.4" stop-color="${cap1}"/><stop offset="0.62" stop-color="${cap2}"/><stop offset="1" stop-color="${cap3}"/></radialGradient>
      <radialGradient id="mkRing"><stop offset="0" stop-color="#1688cc"/><stop offset="0.55" stop-color="#006da8"/><stop offset="1" stop-color="#003d62"/></radialGradient>
    </defs>
    <g data-wcoast-param="master" data-wcoast-cx="${cx}" data-wcoast-cy="${cy}" data-wcoast-angle-min="${angMin}" data-wcoast-angle-max="${angMax}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#mkRing)" stroke="${ringStroke}" stroke-width="0.355" filter="url(#mkShadow)"/>${ticks}
      <circle cx="${cx}" cy="${cy}" r="${cap}" fill="url(#mkCap)" stroke="${capStroke}" stroke-width="0.2366"/>
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${(cy - cap).toFixed(2)}" stroke="${ink}" stroke-width="0.55" data-wcoast-role="indicator"/>
    </g>
  </svg>`;
}

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
    onNetMode: (on) => document.getElementById('netmode').classList.toggle('on', on),
    onScopeArm: (on) => document.getElementById('scopebtn').classList.toggle('on', on),
  });
  rack.relayout();

  // The output mixer is now a pinned rack module — a terminal singleton placed
  // once at the bottom row (draggable, not deletable) that stays the stable
  // "mixer" patch endpoint. Muted until On (via masterMute, set below).
  const mixRec = await rack.addModule(mixerDescriptor.id, rack.rowCount - 1, 0, { pinned: true, key: 'mixer' });
  mixer = { instanceId: mixRec.instanceId, instance: mixRec.instance };
  trace = createAudioTrace({ ctx: audioCtx, rack, mixer: mixer.instance });

  // Controls.
  const onoff = document.getElementById('onoff');

  // Unsaved-changes tracking (state declared above the rack). Any knob, switch,
  // cable, or mixer change dirties the patch; loading or saving cleans it. The
  // title shows a dot while dirty, mirrored to the main process to guard close.
  function updateTitle() { document.title = `Wcoast — ${patchName || 'untitled'}${dirty ? ' •' : ''}`; }
  function setPatchName(n) { patchName = n; updateTitle(); if (mirror) mirror.project(); }
  function markDirty() { if (dirty) return; dirty = true; updateTitle(); window.wcoast?.patch?.setDirty?.(true); }
  function markClean() { dirty = false; updateTitle(); window.wcoast?.patch?.setDirty?.(false); if (mirror) mirror.project(); }
  // Any patch edit: mark dirty and re-project the mirror.
  function onEdit() { markDirty(); autosaveSession(); if (mirror) mirror.project(); }

  // Master level: a house-style KNOB (a one-knob panel run through the panel loader,
  // so it gets the exact look and the scroll-flywheel) mirrors the mixer module's
  // master param — both drive the panel fader and the audio. The On/Off toggle
  // gates the output through the master MUTE, so it silences without changing level.
  let masterValue = Number(mixRec.values.get('master'));
  const knobHost = document.getElementById('master-knob');
  knobHost.innerHTML = masterKnobSvg();
  const { controls: masterControls } = parsePanel(knobHost.querySelector('svg'),
    { params: [{ id: 'master', curve: 'gainDb', min: 0, max: 1, default: 0.7 }], ports: [] });
  const masterKnob = masterControls.get('master');
  const syncToolbarMaster = () => { masterValue = Number(mixRec.values.get('master')); showValue(masterKnob, masterValue); };
  attachControlInteraction(masterKnob, {
    get: () => masterValue,
    set: (v) => { masterValue = Math.max(0, Math.min(1, v)); showValue(masterKnob, masterValue); rack.applyParam(mixRec, 'master', masterValue); },
  });
  // Net-explore toggle (Escape also exits; the rack keeps the button's state in sync).
  document.getElementById('netmode').addEventListener('click', () => rack.toggleNetMode());
  if (!rack.isNetMode()) rack.toggleNetMode();   // show network on by default
  // "Add scope" arm: next drag off a port drops a probe there; disarms after one.
  document.getElementById('scopebtn').addEventListener('click', () => rack.toggleScopeArm());
  syncToolbarMaster();

  // Overall sound is ONE state (`started`), shared by the toolbar On/Off button, the
  // panel-pie sound wedge, and the mixer's master-enable lamp — all move together
  // through setSound. The output is gated by the master MUTE (silences without changing
  // level); the audio context resumes on the first enable. The LED/lamp being lit means
  // sound is on.
  const setSound = (on) => {
    started = on;
    onoff.classList.toggle('on', on);
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
  onoff.addEventListener('click', () => setSound(!started));
  rack.setSound = setSound;                     // latch overall sound on/off
  rack.soundPeek = soundPeek;                   // momentary audition (sound-wedge hover)
  rack.setTransport = setSound;                 // compat alias
  rack.onTransport = () => setSound(!started);  // compat alias
  rack.isPlaying = () => started;
  rack.applyParam(mixRec, 'masterMute', started ? 'on' : 'off');   // lamp matches the (off) start state

  // After a bulk control reset (clear-patch command, and its undo/redo) the rack has
  // moved the mixer's own params, but the toolbar master knob is a separate mirror and
  // the master mute must track the On/Off button — reconcile both here.
  rack.onControlsReset = () => {
    syncToolbarMaster();
    rack.applyParam(mixRec, 'masterMute', started ? 'on' : 'off');
  };

  // --- VU meters -------------------------------------------------------------
  // One rAF loop reads the mixer instance's per-channel + master RMS and lights
  // the pre-drawn LED rings (fill the ring when lit, clear it when not), plus the
  // toolbar's horizontal master meter.
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

  const masterVuEl = document.getElementById('master-vu');
  const TB_SEGS = 16;
  const tbSegs = [];
  if (masterVuEl) for (let i = 0; i < TB_SEGS; i++) { const s = document.createElement('span'); masterVuEl.appendChild(s); tbSegs.push(s); }

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
    const mLit = Math.round(vuScale(lv.master) * TB_SEGS);
    for (let i = 0; i < tbSegs.length; i++) tbSegs[i].style.background = i < mLit ? vuColour(i, TB_SEGS) : '';
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

  // The toolbar hamburger — and the panel pie's app-menu wedge — open the File menu,
  // reusing the rack's pop-up menu.
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
        try { localStorage.setItem('wcoast.dark', d ? '1' : '0'); } catch (_e) { /* no storage */ }
      } },
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
  document.getElementById('hamburger').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    openAppMenu(r.left, r.bottom + 4);
  });
  rack.onAppMenu = openAppMenu;              // panel-pie app-menu wedge

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
      if (v.ok && obj.modules && obj.modules.length) { await restore(obj, rack, mixerIO); syncToolbarMaster(); resumed = true; }
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

  // Re-fit once after the toolbar has claimed its final height. In Electron the
  // ready-to-show gate means this is already correct; a bare browser settles its
  // flex layout a beat later, so the boot-time fit can be measured too tall.
  requestAnimationFrame(() => rack.relayout());

  maybeShowIntro();
}

const README_URL = 'https://github.com/chrisgr99/wCoast/blob/main/README.md';

// First run only: a small card pointing newcomers at the panel menu's Help, the jack
// menu, and cabling. "Dismiss" closes for now (it returns next launch); "Don't show
// this again" remembers the choice in local storage. The README link opens the browser.
function maybeShowIntro() {
  let seen = false;
  try { seen = localStorage.getItem('wcoast.introSeen') === '1'; } catch (_e) { /* no storage */ }
  if (seen) return;
  const overlay = document.createElement('div'); overlay.className = 'confirm-overlay';
  const box = document.createElement('div'); box.className = 'confirm-box';
  const msg = document.createElement('div'); msg.className = 'confirm-msg';
  msg.innerHTML = 'Welcome to wCoast.<br><br>Right-click any panel to open its menu, then choose “Help” for the quick guide, README, and getting-started notes.<br><br>Click a jack to start dragging a cable and make a connection, or right-click a jack for its Scope, Listen, and Upstream options.<br><br><b>Important: Please turn off any browser extension that changes how pages look — such as Dark Reader or other dark-mode or colour-adjusting add-ons — for this site. wCoast has its own light and dark modes, and those extensions distort its panels.</b>';
  const linkRow = document.createElement('div'); linkRow.style.marginTop = '10px';
  const link = document.createElement('a');
  link.textContent = 'Read the README'; link.href = README_URL; link.style.color = 'var(--accent)';
  link.addEventListener('click', (e) => { e.preventDefault(); if (rack) rack._openExternal(README_URL); });
  linkRow.appendChild(link); msg.appendChild(linkRow);
  const btns = document.createElement('div'); btns.className = 'confirm-btns';
  const dismiss = document.createElement('button'); dismiss.className = 'confirm-btn'; dismiss.textContent = 'Dismiss';
  const never = document.createElement('button'); never.className = 'confirm-btn'; never.textContent = "Don't show this again";
  btns.appendChild(dismiss); btns.appendChild(never);
  box.appendChild(msg); box.appendChild(btns); overlay.appendChild(box); document.body.appendChild(overlay);
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
  dismiss.addEventListener('click', close);
  never.addEventListener('click', () => { try { localStorage.setItem('wcoast.introSeen', '1'); } catch (_e) { /* no storage */ } close(); });
  overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey, true);
  dismiss.focus();
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.wcoast && window.wcoast.isElectron) {
    log(`Electron — Chromium ${window.wcoast.versions.chrome}, Node ${window.wcoast.versions.node}.`);
  }
  boot().catch((e) => log(`BOOT ERROR: ${e.message}`));
});
