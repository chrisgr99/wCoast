// rack-app.js — the rack front end (bootstrap).
//
// Wires the module registry, the audio host, and the Rack together, and hosts
// the small floating window of transport/global controls (audio on/off, master
// level, an output monitor, the row count, and a log). Every per-parameter
// control now lives on the module faceplates, so there are no sliders here.
//
// The AudioContext is created up front (suspended is fine) so modules can be
// placed and instantiated before any sound; the On button resumes it. Sound is
// deliberately minimal for now — you monitor one chosen module output — with
// the general multi-module audio question deferred to the next phase.

import { ModuleRegistry } from '../host/registry.js';
import { SynthHost } from '../host/host.js';
import { Rack } from '../host/rack.js';
import descriptor from '../modules/complex-oscillator-259t/descriptor.js';
import { create } from '../modules/complex-oscillator-259t/factory.js';

function log(msg) {
  const el = document.getElementById('log');
  if (!el) return;
  const d = document.createElement('div');
  d.textContent = msg;
  el.appendChild(d);
  el.scrollTop = el.scrollHeight;
}

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

// Rebuild the monitor picker whenever modules change; keep the current choice
// if it still exists, else default to the first module's Final output.
function rebuildMonitor() {
  const sel = document.getElementById('monitor');
  if (!sel) return;
  const prev = `${monitor.key}|${monitor.portId}`;
  sel.textContent = '';
  const recs = rack.moduleRecords();
  for (const rec of recs) {
    const d = registry.descriptor(rec.descriptorId);
    for (const p of d.ports) {
      if (p.dir !== 'out') continue;
      const opt = document.createElement('option');
      opt.value = `${rec.key}|${p.id}`;
      opt.textContent = `${rec.key} · ${p.name}`;
      sel.appendChild(opt);
    }
  }
  let target = null;
  for (const o of sel.options) if (o.value === prev) { target = prev; break; }
  if (!target && recs.length) target = `${recs[0].key}|prinFinalOut`;
  if (target) { sel.value = target; const [k, pid] = target.split('|'); routeMonitor(k, pid); }
  else { disconnectMonitor(); monitor = { key: null, portId: null, node: null, index: 0 }; }
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

  // Transport / global controls (floating window).
  const onoff = document.getElementById('onoff');
  const masterSlider = document.getElementById('master');
  const masterLabel = document.getElementById('masterLabel');
  const rowsInput = document.getElementById('rows');
  const monitorSel = document.getElementById('monitor');
  const toggle = document.getElementById('controls-toggle');
  const controls = document.getElementById('controls');

  onoff.addEventListener('click', async () => {
    if (!started) {
      await audioCtx.resume();
      master.gain.setTargetAtTime(Number(masterSlider.value), audioCtx.currentTime, 0.02);
      started = true;
      onoff.textContent = 'Sound: On';
    } else {
      master.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
      started = false;
      onoff.textContent = 'Sound: Off';
    }
  });
  masterSlider.addEventListener('input', () => {
    masterLabel.textContent = Number(masterSlider.value).toFixed(2);
    if (started) master.gain.setTargetAtTime(Number(masterSlider.value), audioCtx.currentTime, 0.02);
  });
  rowsInput.addEventListener('change', () => {
    rack.setRowCount(Number(rowsInput.value));
    rack.relayout();
  });
  monitorSel.addEventListener('change', () => {
    const [k, pid] = monitorSel.value.split('|');
    routeMonitor(k, pid);
    log(`Monitoring ${monitorSel.value}.`);
  });
  toggle.addEventListener('click', () => {
    controls.classList.toggle('hidden');
  });

  // Start with one module so there's something in the rack.
  await rack.addModule(descriptor.id, 0, 0);
  rebuildMonitor();
  log('Rack ready. Right-click empty space to add a module; right-click a ' +
      'module to delete it; drag a module by its background to move it; scroll ' +
      'a knob, click a switch. Drag from one jack to another to patch a cable; ' +
      'right-click a jack to disconnect. Pinch (or ctrl+scroll) to zoom; ' +
      'double-click a faceplate (or press "/") to zoom it full-height, and ' +
      'single-click a zoomed module to restore. Sound: On to hear the monitor.');
}

window.addEventListener('DOMContentLoaded', () => {
  if (window.wcoast && window.wcoast.isElectron) {
    log(`Electron — Chromium ${window.wcoast.versions.chrome}, Node ${window.wcoast.versions.node}.`);
  }
  boot().catch((e) => log(`BOOT ERROR: ${e.message}`));
});
