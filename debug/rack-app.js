// rack-app.js — the rack front end (bootstrap).
//
// Wires the module registry, the audio host, the Rack, and the output Mixer
// together. The top toolbar holds the start/stop toggle plus the mixer: its
// channel jacks (A–D audio, plus two pan-CV inputs), a master gain slider, and
// a button to open the mixer's control panel. The mixer IS the output — a
// module only makes sound once its output is patched into a mixer channel; the
// master gain feeds your two outputs. Every per-parameter module control lives
// on the module faceplates.

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
import osc2Descriptor from '../modules/complex-oscillator-259t-v2/descriptor.js';
import { create as osc2Create } from '../modules/complex-oscillator-259t-v2/factory.js';
import lpg2Descriptor from '../modules/lpg-292-v2/descriptor.js';
import { create as lpg2Create } from '../modules/lpg-292-v2/factory.js';
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
registry.register({ descriptor: osc2Descriptor, create: osc2Create });
registry.register({ descriptor: lpg2Descriptor, create: lpg2Create });

const MODULE_TYPES = [{
  descriptorId: oscDescriptor.id,
  name: '259t Complex Oscillator',
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
  descriptorId: osc2Descriptor.id,
  name: 'Complex Oscillator v2',
  hp: 34,
  panelUrl: 'modules/complex-oscillator-259t-v2/panel.svg',
  descriptor: osc2Descriptor,
}, {
  descriptorId: lpg2Descriptor.id,
  name: 'Quad Low Pass Gate v2',
  hp: 28,
  panelUrl: 'modules/lpg-292-v2/panel.svg',
  descriptor: lpg2Descriptor,
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
  let darkMode = false;
  try { darkMode = localStorage.getItem('wcoast.dark') === '1'; } catch (_e) { /* no storage */ }
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
    { params: [{ id: 'master', curve: 'linear', min: 0, max: 1, default: 0.7 }], ports: [] });
  const masterKnob = masterControls.get('master');
  const syncToolbarMaster = () => { masterValue = Number(mixRec.values.get('master')); showValue(masterKnob, masterValue); };
  attachControlInteraction(masterKnob, {
    get: () => masterValue,
    set: (v) => { masterValue = Math.max(0, Math.min(1, v)); showValue(masterKnob, masterValue); rack.applyParam(mixRec, 'master', masterValue); },
  });
  // Net-explore toggle (Escape also exits; the rack keeps the button's state in sync).
  document.getElementById('netmode').addEventListener('click', () => rack.toggleNetMode());
  // "Add scope" arm: next drag off a port drops a probe there; disarms after one.
  document.getElementById('scopebtn').addEventListener('click', () => rack.toggleScopeArm());
  syncToolbarMaster();

  onoff.addEventListener('click', async () => {
    if (!started) { await audioCtx.resume(); started = true; onoff.classList.add('on'); }
    else { started = false; onoff.classList.remove('on'); }
    rack.applyParam(mixRec, 'masterMute', started ? 'on' : 'off');
    updateTrace();
  });
  rack.applyParam(mixRec, 'masterMute', 'on');   // master enabled by default (audio still gated by the suspended context until On)

  // --- VU meters -------------------------------------------------------------
  // One rAF loop reads the mixer instance's per-channel + master RMS and lights
  // the pre-drawn LED rings (fill the ring when lit, clear it when not), plus the
  // toolbar's horizontal master meter.
  const vuColumns = [...mixRec.panel.svg.querySelectorAll('[data-wcoast-role="vu"],[data-wcoast-role="vuMaster"]')].map((g) => ({
    chan: g.getAttribute('data-wcoast-chan'),
    segs: [...g.querySelectorAll('[data-wcoast-seg]')].sort(
      (a, b) => (+a.getAttribute('data-wcoast-seg')) - (+b.getAttribute('data-wcoast-seg'))),
  }));
  const vuColour = (i, n) => { const f = i / (n - 1); return f > 0.85 ? '#ff5a4a' : f > 0.6 ? '#f4c430' : '#3ad16b'; };
  const vuScale = (rms) => Math.min(1, rms * 3.2);   // RMS ~0..0.3 → full scale

  const masterVuEl = document.getElementById('master-vu');
  const TB_SEGS = 16;
  const tbSegs = [];
  if (masterVuEl) for (let i = 0; i < TB_SEGS; i++) { const s = document.createElement('span'); masterVuEl.appendChild(s); tbSegs.push(s); }

  function paintVU() {
    const lv = mixer.instance.levels();
    for (const col of vuColumns) {
      const n = col.segs.length;
      const lit = Math.round(vuScale(col.chan === 'M' ? lv.master : (lv.channels[col.chan] || 0)) * n);
      for (let i = 0; i < n; i++) col.segs[i].setAttribute('fill', i < lit ? vuColour(i, n) : 'none');
    }
    const mLit = Math.round(vuScale(lv.master) * TB_SEGS);
    for (let i = 0; i < tbSegs.length; i++) tbSegs[i].style.background = i < mLit ? vuColour(i, TB_SEGS) : '';
    requestAnimationFrame(paintVU);
  }
  requestAnimationFrame(paintVU);

  // The mixer as a save/load endpoint: its settings are the pinned record's
  // values (it stays the fixed "mixer" key, just now a rack module).
  const mixerIO = {
    key: 'mixer',
    getParams: () => Object.fromEntries(mixRec.values),
    setParams: (vals) => { for (const [id, v] of Object.entries(vals)) rack.applyParam(mixRec, id, v); },
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

  // The toolbar hamburger opens the File menu, reusing the rack's pop-up menu.
  document.getElementById('hamburger').addEventListener('click', (e) => {
    const items = [
      { header: true, label: 'File' },
      { label: 'New', action: () => newPatch() },
      { label: 'Open…', action: () => openPatch() },
      { label: 'Save', action: () => savePatch() },
      { label: 'Save As…', action: () => saveAsPatch() },
      { header: true, label: 'View' },
      { label: 'Dark mode', checkFn: () => rack.isDark(), action: () => {
        const d = !rack.isDark();
        rack.setDarkMode(d);   // re-skins every module, the pinned mixer included
        try { localStorage.setItem('wcoast.dark', d ? '1' : '0'); } catch (_e) { /* no storage */ }
      } },
    ];
    // Browser only: offer to reopen the last file (its handle survives in IndexedDB).
    if (storage.hasLast && storage.hasLast()) {
      items.push({ label: `Reopen ${storage.lastName()}`, action: () => reopenPatch() });
    }
    if (mirror.available()) {
      items.push({ header: true, label: 'AI Mirror' });
      items.push({ label: mirror.isEnabled() ? 'Turn mirror off' : 'Turn mirror on', action: async () => { await mirror.setEnabled(!mirror.isEnabled()); updateTrace(); } });
      items.push({ label: 'Reveal mirror folder', action: () => mirror.reveal() });
    }
    const r = e.currentTarget.getBoundingClientRect();
    rack.openMenu(r.left, r.bottom + 4, items);
  });

  // Standard file shortcuts (we dropped the native File menu): Cmd/Ctrl-S save,
  // Shift adds Save As; Cmd/Ctrl-O open; Cmd/Ctrl-N new.
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); if (e.shiftKey) saveAsPatch(); else savePatch(); }
    else if (k === 'o' && !e.shiftKey) { e.preventDefault(); openPatch(); }
    else if (k === 'n' && !e.shiftKey) { e.preventDefault(); newPatch(); }
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
    await rack.addModule(oscDescriptor.id, 0, 0);
    await rack.addModule(lpgDescriptor.id, 1, 0);
  }
  booted = true;   // from here on, real edits autosave the session
  markClean();     // the resumed/starting patch is the clean baseline, not unsaved work
  await mirror.init();   // read enabled state + push the first mirror snapshot

  // Re-fit once after the toolbar has claimed its final height. In Electron the
  // ready-to-show gate means this is already correct; a bare browser settles its
  // flex layout a beat later, so the boot-time fit can be measured too tall.
  requestAnimationFrame(() => rack.relayout());
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.wcoast && window.wcoast.isElectron) {
    log(`Electron — Chromium ${window.wcoast.versions.chrome}, Node ${window.wcoast.versions.node}.`);
  }
  boot().catch((e) => log(`BOOT ERROR: ${e.message}`));
});
