// factory.js — Quad Low Pass Gate (292) audio factory.
//
// Builds the DSP (one AudioWorkletNode running lpg-292-processor.js) and returns
// the realized-instance contract the host wires against (same shape as every
// module — see the 259t factory for the contract prose).
//
// The processor's fixed input/output index order is derived from the descriptor
// and asserted here, so reordering ports in the descriptor without updating the
// processor fails loudly instead of mis-wiring a gate.

'use strict';

const PROCESSOR_NAME = 'lpg-292';

// The exact order the processor's process() assumes. Descriptor is the source of
// truth; these assert it still agrees with the DSP.
const EXPECTED_WORKLET_INPUTS = [
  'inA', 'inB', 'inC', 'inD',
  'cvA', 'cvB', 'cvC', 'cvD',
  'trigA', 'trigB', 'trigC', 'trigD',
];
const EXPECTED_OUTPUTS = [
  'outA', 'outB', 'outC', 'outD', 'mixOdd', 'mixEven', 'clkOut',
];

const CI = { A: 0, B: 1, C: 2, D: 3 };
const isCh = (id, prefix) => id.startsWith(prefix) && CI[id.slice(-1)] !== undefined;

function assertOrder(label, got, expected) {
  const g = got.map((p) => p.id);
  if (g.length !== expected.length || g.some((id, i) => id !== expected[i])) {
    throw new Error(
      `292 factory: descriptor ${label} order [${g.join(', ')}] does not match the ` +
      `processor's assumed order [${expected.join(', ')}]. The descriptor is the ` +
      `source of truth — fix the processor to follow it (or restore the order).`,
    );
  }
}

export function create(ctx, services) {
  const { descriptor, registry } = services;
  const DIVISORS = descriptor.divisors || [1, 2, 3, 4, 6, 8];

  const outPorts = registry.outputPorts(descriptor.id);
  assertOrder('output-port', outPorts, EXPECTED_OUTPUTS);
  // Every dir-in port on this module is a pure worklet signal input (audio, CV,
  // or trigger — none carry a `target`), so they are exactly the worklet inputs.
  const inPorts = registry.ports(descriptor.id).filter((p) => p.dir === 'in');
  assertOrder('worklet-input', inPorts, EXPECTED_WORKLET_INPUTS);

  const paramMeta = new Map(descriptor.params.map((p) => [p.id, p]));

  // Seed the numeric AudioParams (level/decay/rate) with descriptor defaults.
  const parameterData = {};
  for (const p of descriptor.params) {
    if (p.curve !== 'stepped' && !/^div[A-D]$/.test(p.id) && typeof p.default === 'number') {
      parameterData[p.id] = p.default;
    }
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

  // Quantise a divider knob (0..1) to one of the DIVISORS detents.
  function divOf(value) {
    const i = Math.max(0, Math.min(DIVISORS.length - 1, Math.floor(value * DIVISORS.length)));
    return DIVISORS[i];
  }

  function setParam(paramId, value, atTime) {
    const meta = paramMeta.get(paramId);
    if (!meta) throw new Error(`292: no param "${paramId}".`);

    // Global clock run.
    if (paramId === 'run') { node.port.postMessage({ type: 'switch', id: 'run', value }); return; }
    // Per-channel latching switches: lowpass / vca / clock-enable.
    if (isCh(paramId, 'lp') || isCh(paramId, 'vca') || isCh(paramId, 'clkOn')) {
      node.port.postMessage({ type: 'switch', id: paramId, value });
      return;
    }
    // Momentary strike: fire only on the press (value 'on'); the release ('off')
    // just clears the lamp and must NOT fire a second strike.
    if (isCh(paramId, 'strike')) {
      if (value === 'on') node.port.postMessage({ type: 'strike', ch: CI[paramId.slice(-1)] });
      return;
    }
    // Divider knob -> quantised integer division.
    if (isCh(paramId, 'div')) {
      node.port.postMessage({ type: 'div', ch: CI[paramId.slice(-1)], div: divOf(value) });
      return;
    }
    // Numeric AudioParams: level / decay / rate. Glide to target.
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
