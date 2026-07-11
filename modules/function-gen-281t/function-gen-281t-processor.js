// function-gen-281t-processor.js — the Quad Function Generator DSP.
//
// Four function generators in one process() loop. Each runs on a normalized cycle
// PHASE (0..1) through an attack-then-decay shape: phase 0..aFrac is the attack
// (rise 0->1), aFrac..1 is the decay (fall 1->0), where aFrac = attack/(attack+
// decay). The shape is exponential (RC-style, concave). A normalized phase is what
// lets the quadrature follower run at master-phase + 0.25 (added later).
//
//   MODE (three-position switch):
//     transient — a trigger edge runs one attack/decay, then idle.
//     sustained — a gate rises through the attack and HOLDS at the top while held,
//                 then decays when the gate falls (attack/sustain/release).
//     cyclic    — the phase free-runs and wraps: a repeating LFO. A trigger resets.
//   The CYCLE gate input forces cyclic behavior in any mode while it is high.
//
//   times   ATTACK/DECAY are seconds from the knob AudioParams; each input CV
//           shifts its time exponentially (±CV_OCT octaves per unit CV).
//   outputs the FUNCTION output (the envelope) and a short PULSE at end of cycle.
//
// Quadrature: when a pair is enabled, the follower (B, D) is slaved to its master
// (A, C) at master-phase + 0.25 — 90 degrees behind — but shaped by its own
// attack/decay, so the pair's individual outputs run phase-related. The master
// owns triggering; a trigger into A resets the pair. The paired quad output is a
// mix of the two functions (knob = how much B/D); it's silent when disabled.
//
// ZERO ALLOCATION in process(): all state is preallocated; the loop only
// reads/writes samples.

'use strict';

const NCH = 4;
const LTR = ['A', 'B', 'C', 'D'];
const CI = { A: 0, B: 1, C: 2, D: 3 };

const PULSE_S = 0.004;        // end-of-cycle pulse width (4 ms)
// A trigger/gate reads HIGH above GATE_HI and re-arms below GATE_LO — a little hysteresis so a
// rising input fires once per crossing, not on chatter. GATE_HI is deliberately low so ordinary
// bipolar AUDIO/CV (an oscillator's square swings well under a hot 0..1 gate) can clock it, not
// just a full-scale gate. Used for the trigger edge, the sustained hold, and the cycle gate.
const GATE_HI = 0.05;
const GATE_LO = 0.0;
const CV_OCT = 2;             // CV time modulation depth (octaves per unit CV)
const T_MIN = 0.0005, T_MAX = 20;
const clampTime = (x) => (x < T_MIN ? T_MIN : x > T_MAX ? T_MAX : x);

// Exponential (RC-style) attack/decay as a function of a 0..1 sub-phase.
const SHAPE_K = 3.2;
const SHAPE_E = Math.exp(-SHAPE_K);
const shapeUp = (x) => (1 - Math.exp(-SHAPE_K * x)) / (1 - SHAPE_E);       // 0 -> 1, concave
const shapeDn = (x) => (Math.exp(-SHAPE_K * x) - SHAPE_E) / (1 - SHAPE_E); // 1 -> 0, convex
function valueAt(phase, aFrac) {
  return phase < aFrac ? shapeUp(phase / aFrac) : shapeDn((phase - aFrac) / (1 - aFrac));
}

class QuadFn281t extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const p = [];
    for (let i = 0; i < NCH; i++) {
      const L = LTR[i];
      p.push({ name: `attack${L}`, defaultValue: 0.05, minValue: T_MIN, maxValue: T_MAX, automationRate: 'k-rate' });
      p.push({ name: `decay${L}`, defaultValue: 0.2, minValue: T_MIN, maxValue: T_MAX, automationRate: 'k-rate' });
    }
    p.push({ name: 'quadTimeAB', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' });
    p.push({ name: 'quadTimeCD', defaultValue: 0.5, minValue: 0, maxValue: 1, automationRate: 'k-rate' });
    return p;
  }

  constructor(options) {
    super();
    const opt = (options && options.processorOptions) || {};
    this.aa = opt.antialias !== false;       // reserved; the exponential shape barely aliases
    this.phase = new Float32Array(NCH);      // cycle phase 0..1
    this.active = new Uint8Array(NCH);        // envelope running (one-shot modes)
    this.armed = new Uint8Array(NCH).fill(1);   // trigger hysteresis: ready to fire on the next rising crossing
    this.pulseRem = new Int32Array(NCH);      // samples remaining of the end-of-cycle pulse
    this.trigFlag = new Uint8Array(NCH);      // a manual-button press, consumed next sample
    // Per-channel mode: 'transient' | 'sustained' | 'cyclic'.
    this.mode = ['transient', 'transient', 'transient', 'transient'];
    this.quadEn = [false, false];            // [A-B, C-D]

    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'switch') {
        if (m.id === 'quadEnAB') this.quadEn[0] = m.value === 'on';
        else if (m.id === 'quadEnCD') this.quadEn[1] = m.value === 'on';
      } else if (m.type === 'mode') {
        const ch = CI[m.id.slice(-1)]; if (ch !== undefined) this.mode[ch] = m.value;
      } else if (m.type === 'trig') {
        if (m.ch >= 0 && m.ch < NCH) this.trigFlag[m.ch] = 1;
      }
    };
  }

  process(inputs, outputs, parameters) {
    const sr = sampleRate;
    const n = outputs[0][0].length;
    const pulseLen = Math.max(1, (PULSE_S * sr) | 0);
    const qAB = parameters.quadTimeAB[0], qCD = parameters.quadTimeCD[0];

    // Block-rate per channel: attack fraction and phase increment. Time = knob
    // seconds shifted by the CV input (sampled at the block start).
    const aFrac = this._aFrac || (this._aFrac = new Float32Array(NCH));
    const dphi = this._dphi || (this._dphi = new Float32Array(NCH));
    for (let ch = 0; ch < NCH; ch++) {
      const L = LTR[ch];
      const aCv = inputs[8 + ch], dCv = inputs[12 + ch];
      const aT = clampTime(parameters[`attack${L}`][0] * Math.pow(2, (aCv && aCv.length ? aCv[0][0] : 0) * CV_OCT));
      const dT = clampTime(parameters[`decay${L}`][0] * Math.pow(2, (dCv && dCv.length ? dCv[0][0] : 0) * CV_OCT));
      const T = aT + dT;
      aFrac[ch] = Math.min(0.98, Math.max(0.02, aT / T));
      dphi[ch] = 1 / (T * sr);
    }

    const val = this._val || (this._val = new Float32Array(NCH));

    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < NCH; ch++) {
        if ((ch & 1) && this.quadEn[ch >> 1]) {
          // Quadrature follower (B, D): slaved to its master (A, C) a quarter
          // cycle behind — B's phase = A's phase + 0.25 — shaped by B's own aFrac.
          // The master owns triggering/mode; a trigger into A resets the pair.
          const m = ch - 1;
          const oldPh = this.phase[ch];
          let ph = this.phase[m] + 0.25; if (ph >= 1) ph -= 1;
          this.phase[ch] = ph;
          this.active[ch] = this.active[m];
          if (this.active[m] && ph < oldPh && oldPh > 0.5) this.pulseRem[ch] = pulseLen;   // follower wrap
          val[ch] = this.active[m] ? valueAt(ph, aFrac[ch]) : 0;
        } else {
          const trigIn = inputs[ch];
          const tl = (trigIn && trigIn.length) ? trigIn[0][i] : 0;
          // Hysteresis edge: fire when an ARMED input rises past GATE_HI; re-arm below GATE_LO.
          let edge = this.trigFlag[ch] === 1;
          if (this.armed[ch]) { if (tl > GATE_HI) { edge = true; this.armed[ch] = 0; } }
          else if (tl < GATE_LO) { this.armed[ch] = 1; }
          this.trigFlag[ch] = 0;
          const cycIn = inputs[4 + ch];
          const cycGate = cycIn && cycIn.length ? cycIn[0][i] > GATE_HI : false;
          const mode = this.mode[ch];
          const forceCyc = mode === 'cyclic' || cycGate;

          let ph = this.phase[ch], act = this.active[ch], pulse = false;
          if (forceCyc) {                       // free-running LFO; trigger resets
            if (!act) { act = 1; ph = 0; }
            if (edge) ph = 0;
            ph += dphi[ch];
            if (ph >= 1) { ph -= 1; pulse = true; }
          } else if (mode === 'sustained') {    // rise, hold while gated, then fall
            if (edge) { act = 1; ph = 0; }
            if (act) {
              ph += dphi[ch];
              if (tl > GATE_HI && ph > aFrac[ch]) ph = aFrac[ch];   // hold at the peak while gated
              if (ph >= 1) { act = 0; ph = 0; pulse = true; }
            }
          } else {                              // transient: one-shot attack/decay
            if (edge) { act = 1; ph = 0; }
            if (act) {
              ph += dphi[ch];
              if (ph >= 1) { act = 0; ph = 0; pulse = true; }
            }
          }
          this.phase[ch] = ph; this.active[ch] = act;
          val[ch] = (forceCyc || act) ? valueAt(ph, aFrac[ch]) : 0;
          if (pulse) this.pulseRem[ch] = pulseLen;
        }

        outputs[ch][0][i] = val[ch];                             // function output
        outputs[4 + ch][0][i] = this.pulseRem[ch] > 0 ? 1 : 0;   // pulse output
        if (this.pulseRem[ch] > 0) this.pulseRem[ch]--;
      }

      // Quadrature outputs: a mix of the pair when enabled, silent when off.
      outputs[8][0][i] = this.quadEn[0] ? val[0] * (1 - qAB) + val[1] * qAB : 0;
      outputs[9][0][i] = this.quadEn[1] ? val[2] * (1 - qCD) + val[3] * qCD : 0;
    }
    return true;
  }
}

registerProcessor('wcoast.quadFn281t', QuadFn281t);
