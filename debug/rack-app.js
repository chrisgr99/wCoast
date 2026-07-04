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
import { serialize, restore } from '../host/patch-io.js';
import { createStorage } from '../host/storage.js';

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
    host, moduleTypes: MODULE_TYPES, rowCount: 2, onChange: () => {},
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
  const panel = new MixerPanel({
    instance: mixer.instance,
    descriptor: mixerDescriptor,
    onMaster: (v) => setMasterValue(v, 'panel'),
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

  // Save/load: the environment-chosen storage adapter drives the shared core.
  const storage = createStorage();
  const setTitle = (name) => { document.title = name ? `Wcoast — ${name}` : 'Wcoast — rack'; };
  const patchText = () => JSON.stringify(serialize(rack, mixerIO), null, 2);

  async function newPatch() { rack.clear(); storage.forget(); setTitle(null); }
  async function openPatch() {
    let f;
    try { f = await storage.open(); } catch (e) { log(`open failed: ${e.message}`); return; }
    if (!f) return;
    try { await restore(JSON.parse(f.text), rack, mixerIO); setTitle(f.name); }
    catch (e) { log(`restore failed: ${e.message}`); window.alert(`Could not open patch: ${e.message}`); }
  }
  async function savePatch() {
    try { const name = await storage.save(patchText()); if (name) setTitle(name); }
    catch (e) { log(`save failed: ${e.message}`); window.alert(`Could not save: ${e.message}`); }
  }
  async function saveAsPatch() {
    try { const name = await storage.saveAs(patchText()); if (name) setTitle(name); }
    catch (e) { log(`save failed: ${e.message}`); window.alert(`Could not save: ${e.message}`); }
  }

  async function reopenPatch() {
    let f;
    try { f = await storage.reopenLast(); } catch (e) { log(`reopen failed: ${e.message}`); return; }
    if (!f) return;
    try { await restore(JSON.parse(f.text), rack, mixerIO); setTitle(f.name); }
    catch (e) { log(`restore failed: ${e.message}`); window.alert(`Could not open patch: ${e.message}`); }
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
    const r = e.currentTarget.getBoundingClientRect();
    rack.openMenu(r.left, r.bottom + 4, items);
  });

  // Start with one of each so there's something to patch.
  await rack.addModule(oscDescriptor.id, 0, 0);
  await rack.addModule(lpgDescriptor.id, 1, 0);

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
