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
import { MixerPanel } from '../host/mixer-panel.js';
import { serialize, restore, validate } from '../host/patch-io.js';
import { createStorage } from '../host/storage.js';
import { buildCatalogue, createMirror } from '../host/mirror.js';

function log(msg) { console.log('[wcoast]', msg); }

const registry = new ModuleRegistry();
registry.register({ descriptor: oscDescriptor, create: oscCreate });
registry.register({ descriptor: mixerDescriptor, create: mixerCreate });
registry.register({ descriptor: lpgDescriptor, create: lpgCreate });

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
}];

let audioCtx = null;
let host = null;
let rack = null;
let mixer = null;        // { instanceId, instance }
let started = false;

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  host = new SynthHost(audioCtx, registry);
  log(`Audio ready — ${audioCtx.sampleRate} Hz, crossOriginIsolated = ${self.crossOriginIsolated}.`);
}

// A small jack element for the toolbar (data-wcoast-port so the rack can treat
// it as a patch target). Inputs get a black ring; audio orange, control blue.
function buildJack(portId, label, domain) {
  const el = document.createElement('div');
  el.className = 'toolbar-jack';
  const color = domain === 'audio' ? 'var(--audio)' : 'var(--control)';
  el.innerHTML = `<svg viewBox="0 0 24 24" data-wcoast-port="${portId}">`
    + `<circle cx="12" cy="12" r="10" fill="${color}" stroke="#000" stroke-width="1.3"/>`
    + `<circle cx="12" cy="12" r="4.4" fill="#000" stroke="#000" stroke-width="1"/></svg>`
    + `<span class="lbl">${label}</span>`;
  return el;
}

async function boot() {
  ensureAudio();
  rack = new Rack(document.getElementById('rack'), {
    host, moduleTypes: MODULE_TYPES, rowCount: 2, onChange: () => onEdit(),
  });
  rack.relayout();

  // The output mixer (not placed in the rack; its jacks live in the toolbar).
  const m = await host.instantiate(mixerDescriptor.id);
  mixer = m;
  mixer.instance.setParam('master', 0);   // silent until On

  // Build the toolbar jacks: A–D audio, then the two pan-CV inputs.
  const jacksEl = document.getElementById('mixer-jacks');
  const jackMap = new Map();
  const audioGrp = document.createElement('div'); audioGrp.className = 'grp';
  for (const L of mixerDescriptor.channels) {
    const j = buildJack(`chan${L}`, L, 'audio');
    audioGrp.appendChild(j);
    jackMap.set(`chan${L}`, j.querySelector('[data-wcoast-port]'));
  }
  jacksEl.appendChild(audioGrp);
  const panGrp = document.createElement('div'); panGrp.className = 'grp';
  for (const L of mixerDescriptor.vcPan) {
    const j = buildJack(`panCv${L}`, `⊗${L}`, 'control');
    panGrp.appendChild(j);
    jackMap.set(`panCv${L}`, j.querySelector('[data-wcoast-port]'));
  }
  jacksEl.appendChild(panGrp);

  rack.setMixer({
    key: 'mixer',
    descriptorId: mixerDescriptor.id,
    instance: mixer.instance,
    jacks: jackMap,
    linesSvg: document.getElementById('toolbar-lines'),
    toolbarEl: document.getElementById('toolbar'),
  });

  // Controls.
  const onoff = document.getElementById('onoff');
  const masterSlider = document.getElementById('master');
  const masterLabel = document.getElementById('masterLabel');

  // The mixer's floating control panel, toggled by the Mixer button.
  // Unsaved-changes tracking. Any knob, switch, cable, or mixer change dirties
  // the patch; loading or saving cleans it. The title shows a dot while dirty,
  // and (in Electron) the dirty state is mirrored to the main process so it can
  // guard the window close.
  let dirty = false;
  let patchName = null;
  let mirror = null;   // AI patch mirror (created below; null here and in a browser)
  function updateTitle() { document.title = `Wcoast — ${patchName || 'untitled'}${dirty ? ' •' : ''}`; }
  function setPatchName(n) { patchName = n; updateTitle(); if (mirror) mirror.project(); }
  function markDirty() { if (dirty) return; dirty = true; updateTitle(); window.wcoast?.patch?.setDirty?.(true); }
  function markClean() { dirty = false; updateTitle(); window.wcoast?.patch?.setDirty?.(false); if (mirror) mirror.project(); }
  // Any patch edit: mark dirty and re-project the mirror.
  function onEdit() { markDirty(); if (mirror) mirror.project(); }

  const panel = new MixerPanel({
    instance: mixer.instance,
    descriptor: mixerDescriptor,
    onMaster: (v) => setMasterValue(v, 'panel'),
    onChange: () => onEdit(),
  });
  panel.setHeight((rack.moduleHeightPx() / 2 * 0.9));   // match a 259t faceplate's height
  document.getElementById('mixer-open').addEventListener('click', () => {
    panel.setHeight((rack.moduleHeightPx() / 2 * 0.9));
    panel.toggle();
  });
  window.addEventListener('resize', () => panel.setHeight((rack.moduleHeightPx() / 2 * 0.9)));

  // One master level, shared by the toolbar slider and the panel fader; the
  // on/off toggle gates it to 0 when off.
  let masterValue = Number(masterSlider.value);
  const applyMaster = () => mixer.instance.setParam('master', started ? masterValue : 0);
  function setMasterValue(v, source) {
    masterValue = Math.max(0, Math.min(1, v));
    masterLabel.textContent = masterValue.toFixed(2);
    if (source !== 'toolbar') masterSlider.value = String(masterValue);
    if (source !== 'panel') panel.setMaster(masterValue);
    applyMaster();
    if (source !== 'init') onEdit();
  }

  onoff.addEventListener('click', async () => {
    if (!started) { await audioCtx.resume(); started = true; onoff.classList.add('on'); }
    else { started = false; onoff.classList.remove('on'); }
    applyMaster();
  });
  masterSlider.addEventListener('input', () => setMasterValue(Number(masterSlider.value), 'toolbar'));
  setMasterValue(masterValue, 'init');

  // The toolbar mixer as a save/load endpoint: it is a fixed endpoint (not a
  // rack module), so its settings are read/written through this adapter.
  const mixerIO = {
    key: 'mixer',   // the fixed mixer endpoint key (see rack.setMixer)
    getParams: () => ({ ...panel.getValues(), master: masterValue }),
    setParams: (vals) => { for (const [id, v] of Object.entries(vals)) panel.setValue(id, v); },
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
      files: { roundTrip: ['patch.json'], observationOnly: ['active.json', 'catalogue.json', 'last-apply-result.json', 'AGENTS.md', 'README.md'] },
    }),
    catalogue: buildCatalogue([oscDescriptor, lpgDescriptor], mixerDescriptor),
    applyEdit,
  });

  // Save/load: the environment-chosen storage adapter drives the shared core.
  const storage = createStorage();
  const patchText = () => JSON.stringify(serialize(rack, mixerIO), null, 2);
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
    ];
    // Browser only: offer to reopen the last file (its handle survives in IndexedDB).
    if (storage.hasLast && storage.hasLast()) {
      items.push({ label: `Reopen ${storage.lastName()}`, action: () => reopenPatch() });
    }
    if (mirror.available()) {
      items.push({ header: true, label: 'AI Mirror' });
      items.push({ label: mirror.isEnabled() ? 'Turn mirror off' : 'Turn mirror on', action: () => mirror.setEnabled(!mirror.isEnabled()) });
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

  // Start with one of each so there's something to patch.
  await rack.addModule(oscDescriptor.id, 0, 0);
  await rack.addModule(lpgDescriptor.id, 1, 0);
  markClean();   // the starting patch is the clean baseline, not unsaved work
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
