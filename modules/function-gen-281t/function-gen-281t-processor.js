// function-gen-281t-processor.js — the Quad Function Generator DSP.
//
// Four independent rise/fall function generators in one process() loop. Each:
//
//   phase   idle -> attack -> decay. A trigger starts ATTACK; the output rises on
//           an exponential (RC-style) curve from its current level toward 1 over
//           the attack time, then DECAY falls back toward 0 over the decay time —
//           the concave analog shape, fast at first and easing into each end.
//   fire    three ways: a rising edge on the TRIG input, the manual TRIG button
//           (a 'trig' message), or self-cycling.
//   cycle   self-cycle when the CYCLE switch is on OR the CYCLE gate input is
//           high: at end of decay the generator immediately re-attacks, turning
//           the transient into a repeating LFO.
//   times   ATTACK/DECAY are seconds straight from the knob AudioParam (the host
//           applies the exponential taper); the per-input CV shifts the time
//           exponentially (±CV_OCT octaves per unit).
//   outputs the FUNCTION output (the envelope) and a short PULSE at end of decay.
//
// Quadrature (PLACEHOLDER — see descriptor header): each pair's output is a
// crossfade between its two functions set by the pair's time knob, and enabling
// a pair hands a trigger from the first generator to the second at its peak
// (A rises, then B rises), for a rough 90° relationship. Revise once the manual
// is available.
//
// ZERO ALLOCATION in process(): all state is preallocated; the loop only
// reads/writes samples.

'use strict';

const NCH = 4;
const LTR = ['A', 'B', 'C', 'D'];
const CI = { A: 0, B: 1, C: 2, D: 3 };

const PULSE_S = 0.004;        // end-of-decay pulse width (4 ms)
const CV_OCT = 2;             // CV time modulation depth (octaves per unit CV)
const T_MIN = 0.0005, T_MAX = 20;
const clampTime = (x) => (x < T_MIN ? T_MIN : x > T_MAX ? T_MAX : x);
const CHASE_K = 4.6;                       // exp chase reaches ~99% of the target in the knob time
const RISE_DONE = 0.99, FALL_DONE = 0.01;  // segment-transition thresholds

// polyBLAMP — the integral of the 259t's 2-point polyBLEP; band-limits a slope
// (first-derivative) discontinuity by correcting the two samples that straddle
// the corner. `frac` is the corner's sub-sample position in the [prev, curr)
// interval; scale each by the slope change (amplitude per sample).
const blampPrev = (frac) => { const a = 1 - frac; return (a * a * a) / 3; };
const blampCurr = (frac) => (frac * frac * frac) / 3;

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
    this.aa = opt.antialias !== false;       // band-limit the corners (default on)
    this.value = new Float32Array(NCH);      // current output level 0..1
    this.phase = new Int8Array(NCH);         // 0 idle, 1 attack, 2 decay
    this.prevTrig = new Float32Array(NCH);
    this.pulseRem = new Int32Array(NCH);     // samples remaining of the end pulse
    this.trigFlag = new Uint8Array(NCH);     // a manual-button press, consumed next sample
    // Per-channel mode: 'transient' | 'sustained' | 'cyclic'. For now only the
    // cyclic distinction is realized (it repeats); transient/sustained both act
    // as the one-shot attack/decay until the full mode DSP lands.
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

    // Per-channel block-rate chase coefficients. Attack/decay time = knob seconds
    // shifted exponentially by the CV input (sampled at the block start — envelope
    // times don't need per-sample CV, and this keeps the exp() out of the loop).
    const kA = this._kA || (this._kA = new Float32Array(NCH));
    const kD = this._kD || (this._kD = new Float32Array(NCH));
    for (let ch = 0; ch < NCH; ch++) {
      const L = LTR[ch];
      const aCv = inputs[8 + ch], dCv = inputs[12 + ch];
      const aT = clampTime(parameters[`attack${L}`][0] * Math.pow(2, (aCv && aCv.length ? aCv[0][0] : 0) * CV_OCT));
      const dT = clampTime(parameters[`decay${L}`][0] * Math.pow(2, (dCv && dCv.length ? dCv[0][0] : 0) * CV_OCT));
      kA[ch] = 1 - Math.exp(-CHASE_K / (aT * sr));
      kD[ch] = 1 - Math.exp(-CHASE_K / (dT * sr));
    }

    for (let i = 0; i < n; i++) {
      for (let ch = 0; ch < NCH; ch++) {
        // --- fire sources: external trig rising edge, or a manual-button press ---
        const trigIn = inputs[ch];
        const t = (trigIn && trigIn.length) ? trigIn[0][i] : 0;
        if ((t > 0.5 && this.prevTrig[ch] <= 0.5) || this.trigFlag[ch]) this.phase[ch] = 1;
        this.prevTrig[ch] = t;
        this.trigFlag[ch] = 0;

        // cycle in cyclic mode OR while the cycle gate input is high
        const cycIn = inputs[4 + ch];
        const cyc = this.mode[ch] === 'cyclic' || (cycIn && cycIn.length ? cycIn[0][i] > 0.5 : false);

        let v = this.value[ch];
        let ph = this.phase[ch];
        let corr = 0;                         // BLAMP correction for the current sample
        if (ph === 1) {                       // attack: exponential rise toward 1
          const vNext = v + (1 - v) * kA[ch];
          if (vNext >= RISE_DONE) {           // corner: attack -> decay
            const frac = (RISE_DONE - v) / ((vNext - v) || 1);
            const dm = (-RISE_DONE * kD[ch]) - ((1 - RISE_DONE) * kA[ch]);   // decay slope - attack slope
            if (this.aa) { if (i > 0) outputs[ch][0][i - 1] += dm * blampPrev(frac); corr = dm * blampCurr(frac); }
            v = RISE_DONE; ph = 2;
            // quadrature hand-off: enabling a pair fires its second generator at
            // the first's peak (A->B, C->D).
            if (ch === 0 && this.quadEn[0]) this.phase[1] = 1;
            else if (ch === 2 && this.quadEn[1]) this.phase[3] = 1;
          } else v = vNext;
        } else if (ph === 2) {                // decay: exponential fall toward 0
          const vNext = v - v * kD[ch];
          if (vNext <= FALL_DONE) {           // corner: decay -> restart (cycle) or idle
            const frac = (v - FALL_DONE) / ((v - vNext) || 1);
            const nextPh = cyc ? 1 : 0;
            const dm = (nextPh === 1 ? kA[ch] : 0) + (FALL_DONE * kD[ch]);   // restart slope - decay slope
            if (this.aa) { if (i > 0) outputs[ch][0][i - 1] += dm * blampPrev(frac); corr = dm * blampCurr(frac); }
            v = 0; ph = nextPh; this.pulseRem[ch] = pulseLen;
          } else v = vNext;
        } else if (cyc) {                     // idle but cycling -> start
          ph = 1;
        }
        this.value[ch] = v;
        this.phase[ch] = ph;

        outputs[ch][0][i] = v + corr;                            // function output (+ BLAMP)
        outputs[4 + ch][0][i] = this.pulseRem[ch] > 0 ? 1 : 0;   // pulse output
        if (this.pulseRem[ch] > 0) this.pulseRem[ch]--;
      }

      // Quadrature outputs: crossfade each pair by its time knob (placeholder).
      outputs[8][0][i] = this.value[0] * (1 - qAB) + this.value[1] * qAB;
      outputs[9][0][i] = this.value[2] * (1 - qCD) + this.value[3] * qCD;
    }
    return true;
  }
}

registerProcessor('wcoast.quadFn281t', QuadFn281t);
