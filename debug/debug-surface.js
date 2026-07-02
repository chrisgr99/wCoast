// debug-surface.js — temporary control surface for hearing a module.
//
// This is NOT the rack and NOT the real panel (DESIGN §5). It is a throwaway
// bench, generated ENTIRELY from the descriptor via the registry, whose job is
// to prove the milestone-3 chain end to end: the host reads a descriptor,
// loads the module's worklet, instantiates it through its factory, and the
// resulting instance makes band-limited sound whose knobs and switches all
// respond. Building the controls from `registry` enumeration (rather than
// hand-listing them) is deliberate — it exercises the same descriptor-as-
// source-of-truth path the real panel/grid/menus will use.
//
// Honesty about deferred DSP: every param in the descriptor gets a control,
// but the ones whose DSP isn't built yet (the wavefolder's timbre/order/
// symmetry, the phase-lock amount, the CV attenuators that only bite once a
// cord is patched) are shown DISABLED with the reason. So the surface doubles
// as a status readout of how much of the module is actually realized.

'use strict';

import { ModuleRegistry } from '../host/registry.js';
import { SynthHost } from '../host/host.js';
import descriptor from '../modules/complex-oscillator-259t/descriptor.js';
import { create } from '../modules/complex-oscillator-259t/factory.js';

// ---- tiny logging helper (same spirit as the spike) ----
function log(msg) {
  const el = document.getElementById('log');
  if (!el) return;
  const line = document.createElement('div');
  line.textContent = msg;
  el.appendChild(line);
  el.scrollTop = el.scrollHeight;
}

// ---- exp/linear mapping for sliders ----
// Frequency (curve "exp") gets a perceptually even slider: position 0..1 maps
// geometrically across [min,max]. Linear params map straight through.
function posToValue(meta, pos) {
  if (meta.curve === 'exp') {
    const lo = Math.max(meta.min, 1e-6);
    return lo * Math.pow(meta.max / lo, pos);
  }
  return meta.min + (meta.max - meta.min) * pos;
}
function valueToPos(meta, value) {
  if (meta.curve === 'exp') {
    const lo = Math.max(meta.min, 1e-6);
    return Math.log(value / lo) / Math.log(meta.max / lo);
  }
  return (value - meta.min) / (meta.max - meta.min);
}
function fmtValue(meta, value) {
  const unit = meta.unit ? ` ${meta.unit}` : '';
  if (meta.curve === 'exp') return `${value.toFixed(1)}${unit}`;
  const span = meta.max - meta.min;
  const digits = span <= 2 ? 2 : span <= 20 ? 1 : 0;
  return `${value.toFixed(digits)}${unit}`;
}

// Params that ARE realized in DSP but only make sound once an external cord is
// patched into their input (there is no connection UI yet, so on this bench
// they're inert though live). Flagged with a subtle note so turning them and
// hearing nothing isn't confusing. Everything else on the 259t is audible here.
const INPUT_DEPENDENT = new Set([
  'modFmAmount', 'prinFmAmount',   // scale the external FM-in jacks
  'modCvAmount', 'prinCvAmount',   // attenuvert the external pitch-CV jacks
  'timbreCvAmount', 'modIndexCvAmount', // attenuvert the Timbre/Mod-Index CV jacks
  'phaseLockAmount',               // level of the phase-lock input
]);

// If a param the instance doesn't realize ever appears, say why (should be
// empty now that the module is complete but for ART).
function deferredReason() {
  return 'not yet realized';
}

// Append a subtle italic note beside a control (once).
function annotate(control, text) {
  const cell = control.closest('.ctrl-cell');
  if (!cell || cell.querySelector('.deferred')) return;
  const note = document.createElement('span');
  note.className = 'deferred';
  note.textContent = `— ${text}`;
  cell.appendChild(note);
}

// ---- app state ----
const registry = new ModuleRegistry();
registry.register({ descriptor, create });

let audioCtx = null;
let host = null;
let instance = null;
let master = null;          // GainNode: instance output -> master -> destination
let monitoredPort = null;   // currently connected output port id
let started = false;

// Build one row (label + control) in the controls grid. Returns the control
// element so the caller can enable/sync it once an instance exists.
function addParamRow(grid, meta) {
  const labelCell = document.createElement('div');
  labelCell.className = 'label-cell';
  labelCell.textContent = meta.name;

  const ctrlCell = document.createElement('div');
  ctrlCell.className = 'ctrl-cell';

  let control;
  if (meta.curve === 'stepped') {
    control = document.createElement('select');
    for (const step of meta.steps) {
      const opt = document.createElement('option');
      opt.value = step.value;
      opt.textContent = step.name;
      if (step.value === meta.default) opt.selected = true;
      control.appendChild(opt);
    }
    control.addEventListener('change', () => {
      if (instance) instance.setParam(meta.id, control.value);
    });
    ctrlCell.appendChild(control);
  } else {
    control = document.createElement('input');
    control.type = 'range';
    control.min = '0';
    control.max = '1';
    control.step = '0.001';
    control.value = String(valueToPos(meta, meta.default));
    const readout = document.createElement('span');
    readout.className = 'readout';
    readout.textContent = fmtValue(meta, meta.default);
    control.addEventListener('input', () => {
      const v = posToValue(meta, Number(control.value));
      readout.textContent = fmtValue(meta, v);
      if (instance) instance.setParam(meta.id, v);
    });
    ctrlCell.appendChild(control);
    ctrlCell.appendChild(readout);
  }

  control.disabled = true; // enabled on Start, only if the instance supports it
  grid.appendChild(labelCell);
  grid.appendChild(ctrlCell);
  return control;
}

// Render every section's params as rows. Returns a map paramId -> control.
function buildControls() {
  const container = document.getElementById('controls');
  container.textContent = '';
  const controls = new Map();
  const paramsBySection = new Map();
  for (const p of registry.params(descriptor.id)) {
    if (!paramsBySection.has(p.section)) paramsBySection.set(p.section, []);
    paramsBySection.get(p.section).push(p);
  }
  for (const section of descriptor.sections) {
    const list = paramsBySection.get(section.id);
    if (!list || list.length === 0) continue;
    const h = document.createElement('h2');
    h.textContent = section.name;
    container.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'grid';
    for (const meta of list) controls.set(meta.id, addParamRow(grid, meta));
    container.appendChild(grid);
  }
  return controls;
}

// Populate the output-monitor <select> from the descriptor's output ports.
function buildOutputSelector() {
  const sel = document.getElementById('monitor');
  sel.textContent = '';
  for (const p of registry.outputPorts(descriptor.id)) {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.name} (${p.domain})`;
    if (p.id === 'prinFinalOut') opt.selected = true;
    sel.appendChild(opt);
  }
}

// Connect a given output port of the instance to the master gain, replacing
// whatever was connected before.
function monitorOutput(portId) {
  if (!instance || !master) return;
  if (monitoredPort) {
    const prev = instance.getOutput(monitoredPort);
    if (prev) { try { prev.node.disconnect(master, prev.index, 0); } catch (_e) { /* ok */ } }
  }
  const out = instance.getOutput(portId);
  if (!out) { log(`No output port "${portId}".`); return; }
  out.node.connect(master, out.index, 0);
  monitoredPort = portId;
  log(`Monitoring "${portId}".`);
}

async function start() {
  if (started) return;
  if (audioCtx === null) {
    audioCtx = new AudioContext();
    log(`AudioContext created — ${audioCtx.sampleRate} Hz, state "${audioCtx.state}".`);
    log(`crossOriginIsolated = ${self.crossOriginIsolated}.`);
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  master = audioCtx.createGain();
  master.gain.value = 0;
  master.connect(audioCtx.destination);

  host = new SynthHost(audioCtx, registry);
  const res = await host.instantiate(descriptor.id);
  instance = res.instance;
  log(`Instantiated ${descriptor.name} as "${res.instanceId}".`);

  // Enable the controls the instance realizes and sync current values. Add a
  // subtle note to the input-dependent knobs (realized but silent until a cord
  // is patched), and to anything not realized (should be none now but ART).
  for (const meta of registry.params(descriptor.id)) {
    const control = controls.get(meta.id);
    if (!control) continue;
    if (instance.supports(meta.id)) {
      control.disabled = false;
      if (meta.curve === 'stepped') {
        instance.setParam(meta.id, control.value);
      } else {
        instance.setParam(meta.id, posToValue(meta, Number(control.value)));
      }
      if (INPUT_DEPENDENT.has(meta.id)) {
        annotate(control, 'needs a patched cord to hear');
      }
    } else {
      annotate(control, deferredReason(meta.id));
    }
  }

  monitorOutput(document.getElementById('monitor').value);
  const g0 = Number(document.getElementById('masterGain').value);
  master.gain.setTargetAtTime(g0, audioCtx.currentTime, 0.02);
  started = true;
  document.getElementById('start').disabled = true;
  document.getElementById('stop').disabled = false;
  log('Sound on. Move Principal Frequency to play. Turn up Timbre (with the ' +
      'monitor on Final) to hear the wavefolder; add Order and Symmetry for ' +
      'more harmonics. For the complex-osc character, Pitch Mod (FM) On with ' +
      'Mod Index up. Knobs marked "needs a patched cord" wait on the ' +
      'connection UI.');
}

function stop() {
  if (!started || !audioCtx || !master) return;
  master.gain.setTargetAtTime(0, audioCtx.currentTime, 0.02);
  started = false;
  document.getElementById('start').disabled = false;
  document.getElementById('stop').disabled = true;
  log('Muted (instance still live). Start to resume.');
}

let controls = new Map();

window.addEventListener('DOMContentLoaded', () => {
  if (window.wcoast && window.wcoast.isElectron) {
    log(`Electron — Chromium ${window.wcoast.versions.chrome}, Node ${window.wcoast.versions.node}.`);
  } else {
    log('Preload bridge not found — running outside Electron?');
  }
  controls = buildControls();
  buildOutputSelector();

  document.getElementById('start').addEventListener('click', () => { start().catch((e) => log(`ERROR: ${e.message}`)); });
  document.getElementById('stop').addEventListener('click', stop);
  document.getElementById('stop').disabled = true;

  const masterSlider = document.getElementById('masterGain');
  const masterLabel = document.getElementById('masterGainLabel');
  masterSlider.addEventListener('input', () => {
    const g = Number(masterSlider.value);
    masterLabel.textContent = g.toFixed(2);
    // `master` is the module-level GainNode, live once Start has run.
    if (started && audioCtx && master) {
      master.gain.setTargetAtTime(g, audioCtx.currentTime, 0.02);
    }
  });

  document.getElementById('monitor').addEventListener('change', (e) => {
    monitorOutput(e.target.value);
  });

  log(`Loaded descriptor "${descriptor.id}" — ${registry.params(descriptor.id).length} params, ` +
      `${registry.ports(descriptor.id).length} ports. Click Start to make sound.`);
});
