// lpg-292-processor.js — the Quad Low Pass Gate DSP.
//
// Four independent vactrol gates plus a shared internal clock, in one process()
// loop. Each gate:
//
//   vactrol  v -> chases a target (the CV input, clamped 0..1) with a fast
//                 attack and a SLOW, level-dependent release. A strike snaps v
//                 to 1; it then releases toward the CV level, and the release
//                 slows as v falls (the opto tail) — this is the pluck/bloom
//                 that makes a low pass gate sound struck rather than switched.
//   filter   two one-pole lowpasses (12 dB/oct) whose cutoff tracks v.
//   VCA      a gain that tracks v.
//   MODE     LP uses v for the cutoff (else the filter is wide open); VCA uses v
//            for the gain (else unity). Both on = the combined bloom; both off =
//            a clean pass-through.
//   LEVEL    scales the channel output.
//
// A gate is struck three ways: the panel STRIKE button (a 'strike' message), a
// rising edge on its trigger input, or the internal clock when the channel's ON
// is set and the running tick count hits its DIVIDE value. Outputs are the four
// gates, the odd (A+C) and even (B+D) sums, and a clock pulse.
//
// ZERO ALLOCATION in process(): all per-channel state is preallocated typed
// arrays; the loop only reads/writes samples.

'use strict';

const NCH = 4;
const ODD = [true, false, true, false];   // A,C odd; B,D even

// Control-value -> physical mappings.
const CUT_LO = 40, CUT_SPAN = 350;         // cutoff 40 Hz .. 14 kHz (40 * 350)
const RATE_LO = 0.15, RATE_SPAN = 133;     // clock 0.15 .. ~20 Hz
const DEC_LO = 0.02, DEC_SPAN = 90;        // release tau 20 ms .. 1.8 s
const ATTACK_TAU = 0.0025;                 // vactrol attack (fast, fixed)
const CLK_PULSE_S = 0.004;                 // clock-out / strike pulse width

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

class Lpg292 extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    const p = [];
    for (let i = 0; i < NCH; i++) {
      const L = 'ABCD'[i];
      p.push({ name: `level${L}`, defaultValue: 0.8, minValue: 0, maxValue: 1, automationRate: 'k-rate' });
      p.push({ name: `decay${L}`, defaultValue: 0.4, minValue: 0, maxValue: 1, automationRate: 'k-rate' });
    }
    p.push({ name: 'rate', defaultValue: 0.35, minValue: 0, maxValue: 1, automationRate: 'k-rate' });
    return p;
  }

  constructor() {
    super();
    this.v = new Float32Array(NCH);
    this.s1 = new Float32Array(NCH);
    this.s2 = new Float32Array(NCH);
    this.prevTrig = new Float32Array(NCH);
    this.lp = [true, true, true, true];
    this.vca = [true, true, true, true];
    this.clkOn = [false, false, false, false];
    this.div = new Int32Array([1, 1, 1, 1]);
    this.run = false;
    this.clockPhase = 0;
    this.tickCount = 0;
    this.clkPulse = 0;            // samples remaining of the current clock pulse

    const CI = { A: 0, B: 1, C: 2, D: 3 };
    this.port.onmessage = (e) => {
      const m = e.data || {};
      if (m.type === 'switch') {
        if (m.id === 'run') { this.run = m.value === 'on'; return; }
        const ch = CI[m.id.slice(-1)];
        if (ch === undefined) return;
        if (m.id.startsWith('lp')) this.lp[ch] = m.value === 'on';
        else if (m.id.startsWith('vca')) this.vca[ch] = m.value === 'on';
        else if (m.id.startsWith('clkOn')) this.clkOn[ch] = m.value === 'on';
      } else if (m.type === 'strike') {
        if (m.ch >= 0 && m.ch < NCH) this.v[m.ch] = 1;
      } else if (m.type === 'div') {
        if (m.ch >= 0 && m.ch < NCH) this.div[m.ch] = Math.max(1, m.div | 0);
      }
    };
  }

  process(inputs, outputs, parameters) {
    const sr = sampleRate;
    const n = outputs[0][0].length;
    const attackCoef = 1 - Math.exp(-1 / (ATTACK_TAU * sr));
    const pulseLen = Math.max(1, (CLK_PULSE_S * sr) | 0);

    // Precompute per-channel constants for this block.
    const releaseCoef = this._rc || (this._rc = new Float32Array(NCH));
    const level = this._lv || (this._lv = new Float32Array(NCH));
    for (let ch = 0; ch < NCH; ch++) {
      const L = 'ABCD'[ch];
      const d = parameters[`decay${L}`][0];
      const tau = DEC_LO * Math.pow(DEC_SPAN, clamp01(d));
      releaseCoef[ch] = 1 - Math.exp(-1 / (tau * sr));
      level[ch] = parameters[`level${L}`][0];
    }
    const rateHz = RATE_LO * Math.pow(RATE_SPAN, clamp01(parameters.rate[0]));
    const clkInc = rateHz / sr;

    const oddOut = outputs[4][0], evenOut = outputs[5][0], clkOut = outputs[6][0];

    for (let i = 0; i < n; i++) {
      // --- internal clock: advance phase, fire ticks ---
      if (this.run) {
        this.clockPhase += clkInc;
        if (this.clockPhase >= 1) {
          this.clockPhase -= 1;
          this.tickCount++;
          this.clkPulse = pulseLen;
          for (let ch = 0; ch < NCH; ch++) {
            if (this.clkOn[ch] && (this.tickCount % this.div[ch]) === 0) this.v[ch] = 1;
          }
        }
      }
      clkOut[i] = this.clkPulse > 0 ? 1 : 0;
      if (this.clkPulse > 0) this.clkPulse--;

      let odd = 0, even = 0;
      for (let ch = 0; ch < NCH; ch++) {
        // strike on rising trigger edge
        const trigIn = inputs[8 + ch];
        const t = (trigIn && trigIn.length) ? trigIn[0][i] : 0;
        if (t > 0.5 && this.prevTrig[ch] <= 0.5) this.v[ch] = 1;
        this.prevTrig[ch] = t;

        // vactrol chases the CV level: fast up, slow (level-dependent) down
        const cvIn = inputs[4 + ch];
        const target = clamp01((cvIn && cvIn.length) ? cvIn[0][i] : 0);
        let v = this.v[ch];
        if (target > v) {
          v += (target - v) * attackCoef;
        } else {
          v += (target - v) * releaseCoef[ch] * (0.25 + 0.75 * v);
        }
        this.v[ch] = v;

        // mode: LP uses v for cutoff, VCA uses v for gain
        const filterAmt = this.lp[ch] ? v : 1;
        const gainAmt = this.vca[ch] ? v : 1;

        const audIn = inputs[ch];
        const x = (audIn && audIn.length) ? audIn[0][i] : 0;
        let fc = CUT_LO * Math.pow(CUT_SPAN, filterAmt);
        if (fc > sr * 0.45) fc = sr * 0.45;
        const a = 1 - Math.exp(-2 * Math.PI * fc / sr);
        const s1 = this.s1[ch] + a * (x - this.s1[ch]);
        const s2 = this.s2[ch] + a * (s1 - this.s2[ch]);
        this.s1[ch] = s1; this.s2[ch] = s2;

        const y = s2 * gainAmt * level[ch];
        outputs[ch][0][i] = y;
        if (ODD[ch]) odd += y; else even += y;
      }
      oddOut[i] = odd;
      evenOut[i] = even;
    }
    return true;
  }
}

registerProcessor('lpg-292', Lpg292);
