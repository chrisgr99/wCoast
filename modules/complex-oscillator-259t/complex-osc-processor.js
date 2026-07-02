// complex-osc-processor.js — the Complex Oscillator (259t) DSP, whole module.
//
// One AudioWorkletProcessor realizes the ENTIRE 259t (one-module-one-worklet):
// the modulation oscillator, the principal oscillator, their middle-section
// interaction (pitch/FM, amplitude, timbre mod), the Timbre/Harmonics
// wavefolder, phase lock, and the 1V/oct pitch + CV inputs. Everything the
// module does is in this file; nothing but ART is left out.
//
// The two oscillators live together (not in two processors) because they
// interact sample-by-sample (through-zero FM between them, phase lock), and a
// single process() loop with both phase accumulators is the only way to get
// that exact and allocation-free.
//
// BAND-LIMITED FROM THE START (DESIGN §6):
//   - Saw and square are PolyBLEP-corrected; sine and triangle are effectively
//     free.
//   - FM is folded into the PHASE INCREMENT, exact through zero (negative
//     instantaneous frequency runs the phase backwards).
//   - The WAVEFOLDER is a nonlinear operation that manufactures a lot of high
//     harmonics, so it runs OVERSAMPLED: the fold input is regenerated at OS×
//     the base rate inside a contained inner loop, each sub-sample is folded,
//     and the stream is decimated back to base rate with a windowed-sinc FIR.
//     The oversampled region is confined to the fold block; everything else
//     stays at base rate. OS is a parameter (processorOptions.oversample), not
//     a constant.
//
// ZERO ALLOCATION (DESIGN §6): process() allocates nothing — no object/array
// literals, no per-block/per-sample closures. The decimator's coefficient
// table and ring buffer are preallocated in the constructor; the PolyBLEP and
// fold helpers are module-scope functions. sampleRate is read once.

// --- Module-scope band-limiting + folding helpers (defined once) ---

function polyBlep(t, dt) {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
}

function blepSaw(phase, dt) {
  return (2 * phase - 1) - polyBlep(phase, dt);
}

function blepSquare(phase, dt) {
  const naive = phase < 0.5 ? 1 : -1;
  let half = phase + 0.5;
  if (half >= 1) half -= 1;
  return naive + polyBlep(phase, dt) - polyBlep(half, dt);
}

function triangle(phase) {
  let t = phase * 2;
  if (t > 1) t = 2 - t;
  return t * 2 - 1;
}

// Reflective triangle wavefolder: maps ANY real v into [-1,1] by mirroring at
// the ±1 rails, and is the identity on [-1,1]. Driving |v| past 1 makes it
// fold back and forth, each fold adding harmonics — the West Coast timbre
// move. Angular (comparator-like) rather than a smooth sine fold, which is
// closer to the 259's brighter character; oversampling tames the aliasing the
// hard corners would otherwise produce.
function foldTriangle(v) {
  let x = (v + 1) * 0.25;   // identity band [-1,1] -> [0,0.5]
  x = x - Math.floor(x);    // wrap to [0,1)
  return x < 0.5 ? (4 * x - 1) : (3 - 4 * x);
}

const TWO_PI = 6.283185307179586;
const LN2 = 0.6931471805599453;

// Switch codes (stepped params arrive as messages; stored as ints).
const RANGE_HIGH = 0, RANGE_LOW = 1;
const WAVE_TRI = 0, WAVE_SQUARE = 1, WAVE_SAW = 2;

// Folder feel constants (empirical; tunable). TIMBRE_DRIVE is how hard Timbre
// at 1.0 drives the fold input; SYMMETRY_RANGE is the DC offset Symmetry at
// ±1 injects (offset breaks the fold's symmetry -> even harmonics).
const TIMBRE_DRIVE = 7;
const SYMMETRY_RANGE = 1;

class ComplexOsc259t extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      // Frequencies a-rate (can be FM'd by audio-rate CV once patched).
      { name: 'prinFreq', defaultValue: 110, minValue: 0, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'modFreq', defaultValue: 220, minValue: 0, maxValue: 20000, automationRate: 'a-rate' },
      // Folder params a-rate so their CV inputs can modulate at audio rate.
      { name: 'timbre', defaultValue: 0.2, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      { name: 'order', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      { name: 'symmetry', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'a-rate' },
      // The rest k-rate (knob-set, smoothed by the host).
      { name: 'prinFine', defaultValue: 0, minValue: -3.5, maxValue: 3.5, automationRate: 'k-rate' },
      { name: 'prinFmAmount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'prinCvAmount', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'modFine', defaultValue: 0, minValue: -3.5, maxValue: 3.5, automationRate: 'k-rate' },
      { name: 'modFmAmount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'modCvAmount', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'modIndex', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
      { name: 'phaseLockAmount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor(options) {
    super();

    this._modPhase = 0;
    this._prinPhase = 0;
    this._invSampleRate = 1 / sampleRate;

    this._modRange = RANGE_HIGH;
    this._modWave = WAVE_TRI;
    this._pitchMod = 0;
    this._amplMod = 0;
    this._timbreMod = 0;

    this._trim = 0.4;
    this._lowRangeFactor = 1 / 128;

    // Previous phase-lock input sample, for rising-edge (zero-cross) detection.
    this._plPrev = 0;

    // --- Oversampled wavefolder decimator ---
    // OS = oversampling factor for the fold block only. Read from
    // processorOptions (a parameter, per DESIGN §6), clamped to a sane range.
    const opt = (options && options.processorOptions) || {};
    let os = Math.round(opt.oversample);
    if (!(os >= 1)) os = 4;
    if (os > 16) os = 16;
    this._os = os;

    // Windowed-sinc (Hamming) lowpass, cutoff at the base Nyquist expressed in
    // the OS-rate normalized frequency (0.5/OS), pulled in slightly for a
    // transition band. Length is OS * TAPS_PER_PHASE so the decimation-by-OS
    // has a well-formed polyphase response. Coefficients precomputed once.
    const TAPS_PER_PHASE = 8;
    const L = os === 1 ? 1 : os * TAPS_PER_PHASE;
    this._decLen = L;
    this._decCoeffs = new Float32Array(L);
    this._decBuf = new Float32Array(L);
    this._decPos = 0;
    if (os === 1) {
      this._decCoeffs[0] = 1; // no oversampling -> passthrough decimator
    } else {
      const fc = 0.5 / os * 0.9;      // normalized to OS-rate
      const mid = (L - 1) / 2;
      let sum = 0;
      for (let k = 0; k < L; k++) {
        const n = k - mid;
        // sinc(2*fc*n)
        const s = n === 0 ? 2 * fc : Math.sin(TWO_PI * fc * n) / (Math.PI * n);
        const w = 0.54 - 0.46 * Math.cos(TWO_PI * k / (L - 1)); // Hamming
        const c = s * w;
        this._decCoeffs[k] = c;
        sum += c;
      }
      // Normalize to unity DC gain.
      for (let k = 0; k < L; k++) this._decCoeffs[k] /= sum;
    }

    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg == null || msg.type !== 'switch') return;
      switch (msg.id) {
        case 'modRange':
          this._modRange = (msg.value === 'low') ? RANGE_LOW : RANGE_HIGH;
          break;
        case 'modWave':
          this._modWave = (msg.value === 'square') ? WAVE_SQUARE
            : (msg.value === 'sawtooth') ? WAVE_SAW : WAVE_TRI;
          break;
        case 'pitchMod':
          this._pitchMod = (msg.value === 'on') ? 1 : 0;
          break;
        case 'amplMod':
          this._amplMod = (msg.value === 'on') ? 1 : 0;
          break;
        case 'timbreMod':
          this._timbreMod = (msg.value === 'on') ? 1 : 0;
          break;
        default:
          break;
      }
    };
  }

  // Worklet audio INPUTS (descriptor order; asserted by the factory):
  //   0 modPitchIn  1 modCvIn   2 modFmIn
  //   3 prinPitchIn 4 prinCvIn  5 prinFmIn
  //   6 phaseLockIn
  // The pitch/CV inputs are exponential (1V/oct) so they must be summed in the
  // exponent here, not on a linear AudioParam — which is why they are worklet
  // signal inputs rather than param targets. (The folder CV inputs ARE linear,
  // so those go to the timbre/order/symmetry AudioParams instead.)
  // Worklet audio OUTPUTS:
  //   0 modTriOut   1 modSigOut  2 modCvOut
  //   3 prinSineOut 4 prinSquareOut 5 prinFinalOut (folded)
  process(inputs, outputs, parameters) {
    const outModTri = outputs[0] && outputs[0][0];
    const outModSig = outputs[1] && outputs[1][0];
    const outModCv = outputs[2] && outputs[2][0];
    const outPrinSine = outputs[3] && outputs[3][0];
    const outPrinSquare = outputs[4] && outputs[4][0];
    const outPrinFinal = outputs[5] && outputs[5][0];

    const modPitchCh = inputs[0] && inputs[0][0];
    const modCvCh = inputs[1] && inputs[1][0];
    const modFmCh = inputs[2] && inputs[2][0];
    const prinPitchCh = inputs[3] && inputs[3][0];
    const prinCvCh = inputs[4] && inputs[4][0];
    const prinFmCh = inputs[5] && inputs[5][0];
    const phaseLockCh = inputs[6] && inputs[6][0];

    const pPrinFreq = parameters.prinFreq;
    const pModFreq = parameters.modFreq;
    const pTimbre = parameters.timbre;
    const pOrder = parameters.order;
    const pSymmetry = parameters.symmetry;
    const prinFreqStride = pPrinFreq.length > 1 ? 1 : 0;
    const modFreqStride = pModFreq.length > 1 ? 1 : 0;
    const timbreStride = pTimbre.length > 1 ? 1 : 0;
    const orderStride = pOrder.length > 1 ? 1 : 0;
    const symStride = pSymmetry.length > 1 ? 1 : 0;

    const prinFine = parameters.prinFine[0];
    const prinFmAmount = parameters.prinFmAmount[0];
    const prinCvAmount = parameters.prinCvAmount[0];
    const modFine = parameters.modFine[0];
    const modFmAmount = parameters.modFmAmount[0];
    const modCvAmount = parameters.modCvAmount[0];
    const modIndex = parameters.modIndex[0];
    const plAmt = parameters.phaseLockAmount[0];

    const invSr = this._invSampleRate;
    const trim = this._trim;
    const rangeFactor = this._modRange === RANGE_LOW ? this._lowRangeFactor : 1;
    const modFineFactor = Math.pow(2, modFine / 12);
    const prinFineFactor = Math.pow(2, prinFine / 12);
    const modWave = this._modWave;
    const pitchMod = this._pitchMod;
    const amplMod = this._amplMod;
    const timbreMod = this._timbreMod;

    const os = this._os;
    const invOs = 1 / os;
    const L = this._decLen;
    const coeffs = this._decCoeffs;
    const buf = this._decBuf;
    let decPos = this._decPos;

    let modPhase = this._modPhase;
    let prinPhase = this._prinPhase;
    let plPrev = this._plPrev;

    const frameCount =
      (outPrinFinal && outPrinFinal.length) ||
      (outModSig && outModSig.length) ||
      (outModTri && outModTri.length) || 128;

    // Whether the fold path needs computing at all this block (only if the
    // Final output is connected). Saves the OS loop when nobody's listening.
    const doFold = !!outPrinFinal;

    for (let i = 0; i < frameCount; i++) {
      // ---- Phase lock: rising zero-cross on the input pulls modPhase to 0 ----
      const plSig = phaseLockCh ? phaseLockCh[i] : 0;
      if (phaseLockCh && plAmt > 0 && plPrev < 0 && plSig >= 0) {
        modPhase = modPhase * (1 - plAmt); // amt=1 -> hard reset to 0
      }
      plPrev = plSig;

      // ---- Modulation oscillator ----
      // 1V/oct: 1.0 of pitch signal = one octave. modCv passes through the
      // modCvAmount attenuverter; modPitch is direct.
      let modOct = 0;
      if (modPitchCh) modOct += modPitchCh[i];
      if (modCvCh) modOct += modCvAmount * modCvCh[i];
      const modPitchFactor = (modPitchCh || modCvCh) ? Math.exp(modOct * LN2) : 1;
      const modBaseHz = pModFreq[i * modFreqStride] * modFineFactor * rangeFactor * modPitchFactor;
      const modFmSig = modFmCh ? modFmCh[i] : 0;
      const modHz = modBaseHz + modFmSig * modFmAmount * modBaseHz;
      const modInc = modHz * invSr;
      const modDt = modInc < 0 ? -modInc : modInc;

      const modTri = triangle(modPhase);
      let modSig;
      if (modWave === WAVE_SQUARE) modSig = blepSquare(modPhase, modDt);
      else if (modWave === WAVE_SAW) modSig = blepSaw(modPhase, modDt);
      else modSig = modTri;
      const modSource = modSig;

      // ---- Principal oscillator ----
      let prinOct = 0;
      if (prinPitchCh) prinOct += prinPitchCh[i];
      if (prinCvCh) prinOct += prinCvAmount * prinCvCh[i];
      const prinPitchFactor = (prinPitchCh || prinCvCh) ? Math.exp(prinOct * LN2) : 1;
      const prinBaseHz = pPrinFreq[i * prinFreqStride] * prinFineFactor * prinPitchFactor;
      const prinFmSig = prinFmCh ? prinFmCh[i] : 0;
      const internalFm = pitchMod ? (modSource * modIndex) : 0;
      const prinHz = prinBaseHz
        + internalFm * prinBaseHz
        + prinFmSig * prinFmAmount * prinBaseHz;
      const prinInc = prinHz * invSr;
      const prinDt = prinInc < 0 ? -prinInc : prinInc;

      const prinSine = Math.sin(prinPhase * TWO_PI);
      const prinSquare = blepSquare(prinPhase, prinDt);
      const ampFactor = amplMod ? (1 + modSource * modIndex) : 1;

      // ---- Timbre/Harmonics wavefolder (oversampled, contained) ----
      let finalSample = 0;
      if (doFold) {
        // Fold controls for this base sample.
        let tval = pTimbre[i * timbreStride];
        if (timbreMod) tval += modSource * modIndex; // mod osc -> fold depth
        let drive = 1 + tval * TIMBRE_DRIVE;
        if (drive < 0) drive = 0;
        const offset = pSymmetry[i * symStride] * SYMMETRY_RANGE;
        let ord = pOrder[i * orderStride];
        if (ord < 0) ord = 0; else if (ord > 1) ord = 1;

        // Regenerate the fold input across this base sample at OS resolution,
        // fold each sub-sample, push into the decimator ring buffer.
        let foldPhase = prinPhase;
        const subInc = prinInc * invOs;
        const subDt = subInc < 0 ? -subInc : subInc;
        for (let s = 0; s < os; s++) {
          const sSine = Math.sin(foldPhase * TWO_PI);
          const sSaw = blepSaw(foldPhase, subDt);
          const foldIn = sSine + ord * (sSaw - sSine); // Order: sine -> saw
          buf[decPos] = foldTriangle(foldIn * drive + offset);
          decPos++; if (decPos >= L) decPos -= L;
          foldPhase += subInc;
          if (foldPhase >= 1) foldPhase -= 1; else if (foldPhase < 0) foldPhase += 1;
        }
        // Decimate: one FIR output per base sample over the newest L samples.
        let acc = 0;
        let idx = decPos - 1; if (idx < 0) idx += L;
        for (let k = 0; k < L; k++) {
          acc += coeffs[k] * buf[idx];
          idx--; if (idx < 0) idx += L;
        }
        finalSample = acc;
      }

      // ---- Write outputs ----
      if (outModTri) outModTri[i] = modTri * trim;
      if (outModSig) outModSig[i] = modSig * trim;
      if (outModCv) outModCv[i] = modTri;
      if (outPrinSine) outPrinSine[i] = prinSine * ampFactor * trim;
      if (outPrinSquare) outPrinSquare[i] = prinSquare * ampFactor * trim;
      if (outPrinFinal) outPrinFinal[i] = finalSample * ampFactor * trim;

      // ---- Advance phases (wrap both directions for through-zero FM) ----
      modPhase += modInc;
      if (modPhase >= 1) modPhase -= 1; else if (modPhase < 0) modPhase += 1;
      prinPhase += prinInc;
      if (prinPhase >= 1) prinPhase -= 1; else if (prinPhase < 0) prinPhase += 1;
    }

    this._modPhase = modPhase;
    this._prinPhase = prinPhase;
    this._plPrev = plPrev;
    this._decPos = decPos;
    return true;
  }
}

registerProcessor('complex-osc-259t', ComplexOsc259t);
