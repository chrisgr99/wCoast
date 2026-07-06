// factory.js — Quad Function Generator (281t) audio factory.
//
// Builds the DSP (one AudioWorkletNode running the 281t processor) and returns
// the realized-instance contract the host wires against (same shape as every
// module). The processor's fixed input/output index order is derived from the
// descriptor and asserted here, so reordering ports without updating the DSP
// fails loudly instead of mis-wiring a generator.

'use strict';

const PROCESSOR_NAME = 'wcoast.quadFn281t';

// The exact order the processor's process() assumes (descriptor is the source of
// truth; these assert it still agrees with the DSP).
const EXPECTED_WORKLET_INPUTS = [
  'trigA', 'trigB', 'trigC', 'trigD',
  'cycleInA', 'cycleInB', 'cycleInC', 'cycleInD',
  'attackCvA', 'attackCvB', 'attackCvC', 'attackCvD',
  'decayCvA', 'decayCvB', 'decayCvC', 'decayCvD',
];
const EXPECTED_OUTPUTS = [
  'fnA', 'fnB', 'fnC', 'fnD',
  'pulseA', 'pulseB', 'pulseC', 'pulseD',
  'quadOutAB', 'quadOutCD',
];

const CI = { A: 0, B: 1, C: 2, D: 3 };
const isCh = (id, prefix) => id.startsWith(prefix) && CI[id.slice(-1)] !== undefined;

function assertOrder(label, got, expected) {
  const g = got.map((p) => p.id);
  if (g.length !== expected.length || g.some((id, i) => id !== expected[i])) {
    throw new Error(
      `281t factory: descriptor ${label} order [${g.join(', ')}] does not match the ` +
      `processor's assumed order [${expected.join(', ')}]. The descriptor is the ` +
      `source of truth — fix the processor to follow it (or restore the order).`,
    );
  }
}

export function create(ctx, services) {
  const { descriptor, registry } = services;

  const outPorts = registry.outputPorts(descriptor.id);
  assertOrder('output-port', outPorts, EXPECTED_OUTPUTS);
  // Every dir-in port is a pure worklet signal input (trigger or CV, none carry
  // a `target`), so they are exactly the worklet inputs.
  const inPorts = registry.ports(descriptor.id).filter((p) => p.dir === 'in');
  assertOrder('worklet-input', inPorts, EXPECTED_WORKLET_INPUTS);

  const paramMeta = new Map(descriptor.params.map((p) => [p.id, p]));

  // Seed numeric AudioParams (attack/decay times, quad time) with descriptor
  // defaults; stepped params (cycle, quad-enable, trig button) are messages.
  const parameterData = {};
  for (const p of descriptor.params) {
    if (p.curve !== 'stepped' && typeof p.default === 'number') parameterData[p.id] = p.default;
  }

  const node = new AudioWorkletNode(ctx, PROCESSOR_NAME, {
    numberOfInputs: inPorts.length,
    numberOfOutputs: outPorts.length,
    outputChannelCount: outPorts.map(() => 1),
    parameterData,
  });

  const outIndex = new Map(outPorts.map((p, i) => [p.id, i]));
  const inIndex = new Map(inPorts.map((p, i) => [p.id, i]));

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
    return paramMeta.has(paramId);
  }

  function setParam(paramId, value, atTime) {
    const meta = paramMeta.get(paramId);
    if (!meta) throw new Error(`281t: no param "${paramId}".`);

    // Per-pair quadrature enables and per-channel mode selectors: latching state.
    if (paramId === 'quadEnAB' || paramId === 'quadEnCD') { node.port.postMessage({ type: 'switch', id: paramId, value }); return; }
    if (isCh(paramId, 'mode')) { node.port.postMessage({ type: 'mode', id: paramId, value }); return; }
    // Momentary trig button: fire only on the press ('on'); the release just
    // clears the lamp and must NOT fire again.
    if (isCh(paramId, 'trigBtn')) {
      if (value === 'on') node.port.postMessage({ type: 'trig', ch: CI[paramId.slice(-1)] });
      return;
    }
    // Numeric AudioParams: attack / decay / quad time. Glide to target.
    const ap = node.parameters.get(paramId);
    if (!ap) return;
    const t = (atTime === undefined) ? ctx.currentTime : atTime;
    const glideMs = typeof meta.glideMs === 'number' ? meta.glideMs : 0;
    if (glideMs > 0) ap.setTargetAtTime(value, t, glideMs / 1000);
    else ap.setValueAtTime(value, t);
  }

  function dispose() {
    try { node.disconnect(); } catch (_e) { /* already gone */ }
  }

  return { node, getOutput, getInput, getParam, setParam, supports, dispose };
}
