// rack-app.js — the rack front end (bootstrap).
//
// Wires the module registry, the audio host, and the Rack together. The top
// toolbar holds only the essentials for now — a start/stop toggle and a master
// level; more tools will be added there later. Every per-parameter control
// lives on the module faceplates.
//
// The AudioContext is created up front (suspended is fine) so modules can be
// placed and instantiated before any sound; the On button resumes it. Sound is
// deliberately minimal for now — audio auto-routes from the first module's Final
// output (no picker yet) — with output selection deferred to a later phase.

import { ModuleRegistry } from '../host/registry.js';
import { SynthHost } from '../host/host.js';
import { Rack } from '../host/rack.js';
import descriptor from '../modules/complex-oscillator-259t/descriptor.js';
import { create } from '../modules/complex-oscillator-259t/factory.js';

function log(msg) { console.log('[wcoast]', msg); }

const registry = new ModuleRegistry();
registry.register({ descriptor, create });

const MODULE_TYPES = [{
  descriptorId: descriptor.id,
  name: '259t Complex Oscillator',
  hp: descriptor.hp || 34,
  panelUrl: 'modules/complex-oscillator-259t/panel.svg',
  descriptor,
}];

let audioCtx = null;
let master = null;
let host = null;
let rack = null;
let started = false;
let monitor = { key: null, portId: null, node: null, index: 0 };

function ensureAudio() {
  if (audioCtx) return;
  audioCtx = new AudioContext();
  master = audioCtx.createGain();
  master.gain.value = 0;
  master.connect(audioCtx.destination);
  host = new SynthHost(audioCtx, registry);
  log(`Audio ready — ${audioCtx.sampleRate} Hz, crossOriginIsolated = ${self.crossOriginIsolated}.`);
}

function disconnectMonitor() {
  if (monitor.node) { try { monitor.node.disconnect(master, monitor.index, 0); } catch (_e) { /* gone */ } }
  monitor.node = null;
}

function routeMonitor(key, portId) {
  disconnectMonitor();
  const rec = rack.moduleRecords().find((r) => r.key === key);
  if (!rec) { monitor = { key: null, portId: null, node: null, index: 0 }; return; }
  const out = rec.instance.getOutput(portId);
  if (!out) return;
  out.node.connect(master, out.index, 0);
  monitor = { key, portId, node: out.node, index: out.index };
}

// Route audio to the master whenever modules change: keep the current monitor
// if its module survives, else default to the first module's Final output.
// (No picker in the UI yet — output selection comes later.)
function rebuildMonitor() {
  const recs = rack.moduleRecords();
  if (monitor.key && monitor.portId && recs.some((r) => r.key === monitor.key)) {
    routeMonitor(monitor.key, monitor.portId);
  } else if (recs.length) {
    routeMonitor(recs[0].key, 'prinFinalOut');
  } else {
    disconnectMonitor();
    monitor = { key: null, portId: null, node: null, index: 0 };
  }
}

async function boot() {
  ensureAudio();
  rack = new Rack(document.getElementById('rack'), {
    host,
    moduleTypes: MODULE_TYPES,
    rowCount: 2,
    onChange: rebuildMonitor,
  });
  rack.relayout();

  // Global controls (top toolbar): start/stop + master level.
  const onoff = document.getElementById('onoff');
  const masterSlider = document.getElementById('master');
  const masterLabel = document.getElementById('masterLabel');

  onoff.addEventListener('click', async () => {
    if (!started) {
      await audioCtx.resume();
      master.gain.setTargetAtTime(Number(masterSlider.value), audioCtx.currentTime, 0.02);
      started = true;
      onoff.classList.add('on');       // show the stop icon
    } else {
      master.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
      started = false;
      onoff.classList.remove('on');    // show the play icon
    }
  });
  masterSlider.addEventListener('input', () => {
    masterLabel.textContent = Number(masterSlider.value).toFixed(2);
    if (started) master.gain.setTargetAtTime(Number(masterSlider.value), audioCtx.currentTime, 0.02);
  });

  // Start with one module so there's something in the rack.
  await rack.addModule(descriptor.id, 0, 0);
  rebuildMonitor();
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.wcoast && window.wcoast.isElectron) {
    log(`Electron — Chromium ${window.wcoast.versions.chrome}, Node ${window.wcoast.versions.node}.`);
  }
  boot().catch((e) => log(`BOOT ERROR: ${e.message}`));
});
