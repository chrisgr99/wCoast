// rack-app.js — the rack front end (bootstrap).
//
// Wires the module registry, the audio host, the Rack, and the output Mixer
// together. The top toolbar holds the start/stop toggle plus the mixer: its
// channel jacks (A–F audio, plus two pan-CV inputs), a master gain slider, and
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

function log(msg) { console.log('[wcoast]', msg); }

const registry = new ModuleRegistry();
registry.register({ descriptor: oscDescriptor, create: oscCreate });
registry.register({ descriptor: mixerDescriptor, create: mixerCreate });

const MODULE_TYPES = [{
  descriptorId: oscDescriptor.id,
  name: '259t Complex Oscillator',
  hp: oscDescriptor.hp || 34,
  panelUrl: 'modules/complex-oscillator-259t/panel.svg',
  descriptor: oscDescriptor,
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

  // Build the toolbar jacks: A–F audio, then the two pan-CV inputs.
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
  const applyMaster = () => mixer.instance.setParam('master', started ? Number(masterSlider.value) : 0);

  onoff.addEventListener('click', async () => {
    if (!started) { await audioCtx.resume(); started = true; onoff.classList.add('on'); }
    else { started = false; onoff.classList.remove('on'); }
    applyMaster();
  });
  masterSlider.addEventListener('input', () => {
    masterLabel.textContent = Number(masterSlider.value).toFixed(2);
    applyMaster();
  });
  document.getElementById('mixer-open').addEventListener('click', () => {
    log('Mixer panel: coming in the next phase.');
  });

  // Start with one module so there's something to patch.
  await rack.addModule(oscDescriptor.id, 0, 0);
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.wcoast && window.wcoast.isElectron) {
    log(`Electron — Chromium ${window.wcoast.versions.chrome}, Node ${window.wcoast.versions.node}.`);
  }
  boot().catch((e) => log(`BOOT ERROR: ${e.message}`));
});
