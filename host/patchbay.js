// patchbay.js — the netlist and its audio wiring.
//
// A patch is a list of EDGES; this is the source of truth (DESIGN.md §3). Each
// edge connects one module output to one module input, and the patchbay both
// records it and realizes it in the Web Audio graph. Every visual surface (the
// rack's on-panel cords today, a grid later) is just a rendering of edges().
//
// Realizing an edge depends on the destination port's kind, which the factory
// contract already encodes for us:
//   - A node input (getInput non-null): a pure signal in (FM, phase lock) or an
//     exponential 1V/oct CV in — the worklet sums these itself, so we simply
//     wire source-output -> node-input. Depth, for the CV ins, is the worklet's
//     job (its own attenuverter param).
//   - A linear CV in (getInput null): drives the target param's AudioParam. If
//     the port declares a `via` attenuator, the cord runs through a GainNode
//     whose gain tracks that panel knob — the input's depth control; otherwise
//     it drives the param at unity.
//
// A cable carries no depth of its own yet (DESIGN: deferred) — depth lives on
// the input. The GainNode seam is exactly where a future per-cable amount would
// multiply in, so adding it later touches only this file.

'use strict';

export const ALLOW = 'allow';
export const WARN = 'warn';
export const DENY = 'deny';

// The one place the domain policy lives (DESIGN §2). Nothing is denied today:
// same-domain and audio->control (FM) are allowed; anything touching trigger,
// or otherwise odd, warns but still connects.
export function canConnect(srcDomain, dstDomain) {
  if (srcDomain === dstDomain) return ALLOW;
  if (srcDomain === 'audio' && dstDomain === 'control') return ALLOW;   // audio-rate modulation (FM)
  return WARN;                                                          // trigger mismatches / oddities
}

// Cable style is chosen by the DESTINATION domain, with audio winning first
// (DESIGN §3), so FM and FM-feedback cords read as audio automatically.
export function styleOf(srcDomain, dstDomain) {
  if (srcDomain === 'audio') return 'audio';
  if (dstDomain === 'trigger') return 'trigger';
  return 'control';
}

function finiteOr(v, fallback) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

export class Patchbay {
  constructor(ctx, registry) {
    this.ctx = ctx;
    this.registry = registry;
    this.edges = new Map();     // edgeId -> edge
    this._seq = 0;
  }

  list() { return [...this.edges.values()]; }

  // src/dst: { key, instance, descriptorId, portId }. src must be an output and
  // dst an input; the caller resolves orientation before calling. initialDepth
  // seeds the via-attenuator gain (the destination knob's current value).
  connect(src, dst, initialDepth) {
    const srcPort = this.registry.portById(src.descriptorId, src.portId);
    const dstPort = this.registry.portById(dst.descriptorId, dst.portId);
    if (!srcPort || srcPort.dir !== 'out') return { ok: false, reason: 'source is not an output' };
    if (!dstPort || dstPort.dir !== 'in') return { ok: false, reason: 'destination is not an input' };

    const verdict = canConnect(srcPort.domain, dstPort.domain);
    if (verdict === DENY) return { ok: false, reason: 'not allowed', verdict };

    // An input takes at most one cable — reject a second (outputs still fan out).
    if (this.inputOccupied(dst.key, dst.portId)) return { ok: false, reason: 'input already connected' };

    const out = src.instance.getOutput(src.portId);
    if (!out) return { ok: false, reason: `output "${src.portId}" not realized` };

    const edge = {
      id: 'e' + (this._seq++),
      src: { ...src }, dst: { ...dst },
      srcDomain: srcPort.domain, dstDomain: dstPort.domain,
      style: styleOf(srcPort.domain, dstPort.domain),
      viaParamId: dstPort.via || null,
      out, nodeIn: null, gainNode: null, target: null,
      verdict,
    };

    const nodeIn = dst.instance.getInput(dst.portId);
    if (nodeIn) {
      // Pure signal / exponential CV input: wire straight into the worklet.
      out.node.connect(nodeIn.node, out.index, nodeIn.index);
      edge.nodeIn = nodeIn;
    } else if (dstPort.target) {
      // Linear CV input: source -> [via gain] -> target AudioParam.
      const param = dst.instance.getParam(dstPort.target);
      if (!param) return { ok: false, reason: `target param "${dstPort.target}" not realized` };
      edge.target = param;
      if (dstPort.via) {
        const g = this.ctx.createGain();
        g.gain.value = finiteOr(initialDepth, 1);
        out.node.connect(g, out.index, 0);
        g.connect(param);
        edge.gainNode = g;
      } else {
        out.node.connect(param, out.index);
      }
    } else {
      return { ok: false, reason: `input "${dst.portId}" has neither node input nor target` };
    }

    this.edges.set(edge.id, edge);
    return { ok: true, edge, verdict };
  }

  // Update every live cord whose depth this destination knob controls.
  setDepth(dstKey, viaParamId, value, atTime) {
    if (!viaParamId) return;
    const t = atTime === undefined ? this.ctx.currentTime : atTime;
    for (const e of this.edges.values()) {
      if (e.gainNode && e.dst.key === dstKey && e.viaParamId === viaParamId) {
        e.gainNode.gain.setTargetAtTime(finiteOr(value, 1), t, 0.01);
      }
    }
  }

  disconnect(edge) {
    if (!edge || !this.edges.has(edge.id)) return;
    try {
      if (edge.nodeIn) edge.out.node.disconnect(edge.nodeIn.node, edge.out.index, edge.nodeIn.index);
      else if (edge.gainNode) { edge.out.node.disconnect(edge.gainNode, edge.out.index, 0); edge.gainNode.disconnect(); }
      else if (edge.target) edge.out.node.disconnect(edge.target, edge.out.index);
    } catch (_e) { /* already gone */ }
    this.edges.delete(edge.id);
  }

  // Remove every edge touching a module (used when it is deleted).
  disconnectModule(key) {
    for (const e of this.list()) if (e.src.key === key || e.dst.key === key) this.disconnect(e);
  }

  // Edges with an endpoint on this jack (for the disconnect menu).
  edgesAtJack(key, portId) {
    return this.list().filter((e) => (e.src.key === key && e.src.portId === portId)
      || (e.dst.key === key && e.dst.portId === portId));
  }

  // Does this input jack already carry a cable? (exceptEdge is ignored — for a
  // move, the cable's own edge shouldn't count against it.)
  inputOccupied(dstKey, dstPortId, exceptEdge) {
    return this.list().some((e) => e !== exceptEdge && e.dst.key === dstKey && e.dst.portId === dstPortId);
  }
}
