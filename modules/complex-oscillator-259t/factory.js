// factory.js — Complex Oscillator (259t) audio factory.
//
// The descriptor (descriptor.js) says WHAT the module is; this factory says
// how to BUILD it in Web Audio. `create(ctx, services)` constructs the DSP
// (here a single AudioWorkletNode running complex-osc-processor.js) and
// returns a small realized-instance contract the host wires against:
//
//   getOutput(portId)  -> { node, index } | null   (an audio-graph output)
//   getInput(portId)   -> { node, index } | null   (a pure-signal audio input)
//   getParam(paramId)  -> AudioParam | null         (for CV patching/automation)
//   setParam(id, v, t) -> apply a knob/switch value (numeric glides; enum posts)
//   supports(id)       -> is this param actually realized in DSP yet?
//   dispose()          -> tear down
//   node                                            (the worklet node itself)
//
// The host never reaches inside the instance; it only asks for nodes/params by
// descriptor id and connects them. That is what lets the host stay generic and
// third-party modules behave like built-ins (DESIGN §4).
//
// The processor's fixed input/output index order is DERIVED here from the
// descriptor (registry.outputPorts / signalInputPorts), and asserted against
// the order the processor actually assumes. If someone reorders the ports in
// the descriptor without updating the processor, instantiation fails loudly
// rather than silently mis-wiring a saw output to a sine jack.

'use strict';

const PROCESSOR_NAME = 'complex-osc-259t';

// The exact output/input port order the processor's process() hardcodes. Kept
// as a check, not a source of truth — the descriptor is the source of truth,
// and this asserts the descriptor still agrees with the DSP.
const EXPECTED_OUTPUTS = [
  'modTriOut', 'modSigOut', 'modCvOut',
  'prinSineOut', 'prinSquareOut', 'prinFinalOut',
];
// Worklet audio inputs, in descriptor order. These are the pure signal inputs
// (FM, phase lock) PLUS the exponential 1V/oct pitch/CV inputs — the latter
// must be summed in the exponent inside the worklet, so they are node inputs,
// not linear AudioParam targets. (The folder CV inputs, being linear, go to
// the timbre/order/symmetry AudioParams instead and are NOT worklet inputs.)
const EXPECTED_WORKLET_INPUTS = [
  'modPitchIn', 'modCvIn', 'modFmIn',
  'prinPitchIn', 'prinCvIn', 'prinFmIn',
  'phaseLockIn',
];

// Every numeric param is realized in DSP now (the module is complete but for
// ART). This set matches the worklet's parameterDescriptors; setParam() on a
// stepped param routes to REALIZED_SWITCHES instead. `supports()` reports the
// union so the bench can enable every control.
const REALIZED_PARAMS = new Set([
  'prinFreq', 'prinFine', 'prinFmAmount', 'prinCvAmount',
  'modFreq', 'modFine', 'modFmAmount', 'modCvAmount', 'modIndex',
  'timbre', 'order', 'symmetry', 'phaseLockAmount',
]);

// Stepped params handled by message (their DSP exists, unlike the folder).
const REALIZED_SWITCHES = new Set([
  'modRange', 'modWave', 'pitchMod', 'amplMod', 'timbreMod',
]);

function assertOrder(label, got, expected) {
  const g = got.map((p) => p.id);
  if (g.length !== expected.length || g.some((id, i) => id !== expected[i])) {
    throw new Error(
      `259t factory: descriptor ${label} order [${g.join(', ')}] does not match ` +
      `the processor's assumed order [${expected.join(', ')}]. Update whichever ` +
      `drifted — the descriptor is the source of truth, so fix the processor to ` +
      `follow it (or restore the descriptor order).`,
    );
  }
}

// `services` carries what the factory needs from the host without coupling it
// to the host object: { descriptor, registry, sampleRate }. registry is used
// only for its enumeration helpers; passing it (rather than re-filtering here)
// keeps the port-order logic in exactly one place.
export function create(ctx, services) {
  const { descriptor, registry } = services;

  const outPorts = registry.outputPorts(descriptor.id);
  assertOrder('output-port', outPorts, EXPECTED_OUTPUTS);

  // Worklet audio inputs = pure signal inputs (no target) PLUS exponential CV
  // inputs (target param has curve "exp", i.e. 1V/oct pitch). Linear CV inputs
  // (target curve "linear", e.g. the folder's timbre/order/symmetry) are NOT
  // worklet inputs — they drive AudioParams via getParam(target). This rule is
  // generic (it reads the target param's curve), not a hardcoded id list.
  const curveOfTarget = (port) => {
    if (port.target === undefined) return null;
    const p = registry.paramById(descriptor.id, port.target);
    return p ? p.curve : null;
  };
  const inPorts = registry.ports(descriptor.id).filter(
    (p) => p.dir === 'in' && (p.target === undefined || curveOfTarget(p) === 'exp'),
  );
  assertOrder('worklet-input', inPorts, EXPECTED_WORKLET_INPUTS);

  // Seed the AudioParams with the descriptor defaults so a freshly created
  // instance sounds like the panel's default knob positions.
  const parameterData = {};
  for (const p of descriptor.params) {
    if (REALIZED_PARAMS.has(p.id) && typeof p.default === 'number') {
      parameterData[p.id] = p.default;
    }
  }

  // Internal DSP config from the descriptor (not a faceplate control): the
  // wavefolder's oversampling factor. Defaults to 4 if the descriptor is silent.
  const oversample = (descriptor.dsp && descriptor.dsp.oversample) || 4;

  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: inPorts.length,
    numberOfOutputs: outPorts.length,
    outputChannelCount: outPorts.map(() => 1),
    parameterData,
    processorOptions: { oversample },
  });

  // Port id -> graph index, straight from descriptor order.
  const outIndex = new Map(outPorts.map((p, i) => [p.id, i]));
  const inIndex = new Map(inPorts.map((p, i) => [p.id, i]));

  // Push the initial switch positions to the processor so its state matches
  // the descriptor defaults (the processor also defaults to these, but sending
  // them makes the instance's starting state explicit and reload-safe).
  for (const p of descriptor.params) {
    if (p.curve === 'stepped' && REALIZED_SWITCHES.has(p.id) && p.default !== undefined) {
      node.port.postMessage({ type: 'switch', id: p.id, value: p.default });
    }
  }

  const paramMeta = new Map(descriptor.params.map((p) => [p.id, p]));

  function getOutput(portId) {
    const idx = outIndex.get(portId);
    return idx === undefined ? null : { node, index: idx };
  }
  function getInput(portId) {
    const idx = inIndex.get(portId);
    return idx === undefined ? null : { node, index: idx };
  }
  function getParam(paramId) {
    return node.parameters.get(paramId) || null;
  }
  function supports(paramId) {
    return REALIZED_PARAMS.has(paramId) || REALIZED_SWITCHES.has(paramId);
  }

  // Apply a value the way this param wants it. Numeric params glide to target
  // (destination-side smoothing, the same mechanism the GXW bridge uses) over
  // the descriptor's glideMs; stepped params post a switch message. Addressing
  // an unrealized param is a no-op, not an error — every param is addressable.
  function setParam(paramId, value, atTime) {
    const meta = paramMeta.get(paramId);
    if (!meta) throw new Error(`259t: no param "${paramId}".`);
    if (meta.curve === 'stepped') {
      if (REALIZED_SWITCHES.has(paramId)) {
        node.port.postMessage({ type: 'switch', id: paramId, value });
      }
      return;
    }
    const ap = node.parameters.get(paramId);
    if (!ap) return; // declared-but-deferred numeric (folder/attenuator/phase-lock)
    const t = (atTime === undefined) ? ctx.currentTime : atTime;
    const glideMs = typeof meta.glideMs === 'number' ? meta.glideMs : 0;
    if (glideMs > 0) {
      // setTargetAtTime's time constant reaches ~63% per tau; use glideMs as
      // the tau so the feel matches the descriptor's declared glide.
      ap.setTargetAtTime(value, t, glideMs / 1000);
    } else {
      ap.setValueAtTime(value, t);
    }
  }

  function dispose() {
    try { node.disconnect(); } catch (_e) { /* already disconnected */ }
    try { node.port.postMessage({ type: 'dispose' }); } catch (_e) { /* gone */ }
  }

  return { node, getOutput, getInput, getParam, setParam, supports, dispose };
}
