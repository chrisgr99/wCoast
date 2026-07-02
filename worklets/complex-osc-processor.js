// complex-osc-processor.js — the Complex Oscillator (259t) DSP core.
//
// One AudioWorkletProcessor realizes BOTH of the 259t's oscillators — the
// modulation oscillator and the principal oscillator — plus their internal
// interaction (the middle section: pitch/FM, amplitude, and timbre mod from
// the modulation osc into the principal). They live in one processor, not two,
// because they interact sample-by-sample (through-zero FM between them), and
// keeping both phase accumulators in the same process() loop is the only way
// to get that interaction exact and allocation-free.
//
// WHAT THIS MILESTONE IMPLEMENTS (bare oscillators + FM, per HANDOFF/DESIGN):
//   - Two band-limited oscillators. Saw and square are PolyBLEP-corrected so
//     they do not alias; sine and triangle are effectively free (a sine has no
//     harmonics; the naive triangle's harmonics fall off as 1/n^2 and are
//     inaudible at these ranges). This is the "band-limited from the start"
//     rule (DESIGN §6) honoured before any wavefolder exists to break it.
//   - FM built into the PHASE INCREMENT, not layered on afterwards, so it is
//     exact through zero (negative instantaneous frequency is allowed and the
//     phase runs backwards) — unlike the built-in OscillatorNode's detune
//     approximation. FM arrives three ways: the external FM-in jacks (audio
//     inputs), and the internal pitch-mod path (modulation osc -> principal).
//   - Amplitude mod (ring/AM) from the modulation osc into the principal.
//
// DEFERRED (declared in the descriptor, no DSP yet — see the switch below and
// DESIGN §8): the Timbre/Harmonics wavefolder (timbre/order/symmetry) and the
// phase-lock input. Until the folder lands, the principal's "Final" output
// carries the raw pre-fold waveform (a band-limited saw), which is the signal
// the folder will later shape — so Final is honest, just unshaped. Timbre-mod
// is accepted as a switch but has nothing to modulate yet, so it is a no-op.
//
// ZERO ALLOCATION (DESIGN §6, the single most important discipline): process()
// allocates nothing. No object/array literals, no per-block or per-sample
// closures. Every value is a preallocated instance field or a stack local.
// The PolyBLEP helpers are module-scope functions (defined once, never
// re-created). A stray allocation here triggers GC and blows the 128-sample
// deadline — the top cause of audible glitches — so the loop is kept lean.
//
// SAMPLE RATE is read from the `sampleRate` global at construction (it may be
// 44100 or 48000); every increment and coefficient is derived from it.

// --- Module-scope band-limiting helpers (defined once; never allocate) ---

// PolyBLEP residual for a discontinuity. `t` is the phase in [0,1); `dt` is
// the phase increment magnitude for this sample. Returns a small correction
// that, subtracted/added around a jump, removes most of the aliasing energy.
// Two-sided: it corrects the sample just before and just after the wrap.
function polyBlep(t, dt) {
  if (dt <= 0) return 0;
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1; // 2x - x^2 - 1
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1; // x^2 + 2x + 1
  }
  return 0;
}

// Band-limited sawtooth in [-1, 1]. Naive saw (2*phase - 1) minus the BLEP at
// the phase=0 wrap.
function blepSaw(phase, dt) {
  return (2 * phase - 1) - polyBlep(phase, dt);
}

// Band-limited square in [-1, 1]. Naive square corrected at both edges: the
// rising edge at phase 0 and the falling edge at phase 0.5.
function blepSquare(phase, dt) {
  const naive = phase < 0.5 ? 1 : -1;
  let half = phase + 0.5;
  if (half >= 1) half -= 1;
  return naive + polyBlep(phase, dt) - polyBlep(half, dt);
}

// Naive triangle in [-1, 1] from the phase. Harmonics fall off as 1/n^2, so
// aliasing is negligible in use; a BLAMP-integrated triangle can replace this
// later if a very high modulation frequency ever exposes it.
function triangle(phase) {
  let t = phase * 2;      // 0..2
  if (t > 1) t = 2 - t;   // fold to 0..1 triangle ramp
  return t * 2 - 1;       // -1..1
}

const TWO_PI = 6.283185307179586;

// Switch-value codes. Stepped params arrive as messages (they are enums, not
// AudioParams) and are stored as small integers so the process loop compares
// numbers, never strings.
const RANGE_HIGH = 0, RANGE_LOW = 1;
const WAVE_TRI = 0, WAVE_SQUARE = 1, WAVE_SAW = 2;

class ComplexOsc259t extends AudioWorkletProcessor {
  // The modulatable and continuous-numeric controls are AudioParams so that
  // (a) the knob and any patched CV sum natively on the audio thread, and
  // (b) the host gets free k-rate/a-rate smoothing. Frequencies are a-rate
  // (they can be FM'd by audio-rate CV once patched); the rest are k-rate.
  // Switches and the deferred folder params are NOT here — switches come by
  // message; folder params have no DSP yet.
  static get parameterDescriptors() {
    return [
      { name: 'prinFreq', defaultValue: 110, minValue: 0, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'prinFine', defaultValue: 0, minValue: -3.5, maxValue: 3.5, automationRate: 'k-rate' },
      { name: 'prinFmAmount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'modFreq', defaultValue: 220, minValue: 0, maxValue: 20000, automationRate: 'a-rate' },
      { name: 'modFine', defaultValue: 0, minValue: -3.5, maxValue: 3.5, automationRate: 'k-rate' },
      { name: 'modFmAmount', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'modIndex', defaultValue: 0, minValue: -1, maxValue: 1, automationRate: 'k-rate' },
    ];
  }

  constructor() {
    super();

    // Two phase accumulators, each normalised to [0,1). They can advance in
    // either direction (through-zero FM), so wrapping handles both signs.
    this._modPhase = 0;
    this._prinPhase = 0;

    this._invSampleRate = 1 / sampleRate;

    // Switch state (see the codes above). Defaults mirror the descriptor:
    // modRange high, modWave triangle, all three mod switches off.
    this._modRange = RANGE_HIGH;
    this._modWave = WAVE_TRI;
    this._pitchMod = 0;   // modulation osc -> principal frequency (FM)
    this._amplMod = 0;    // modulation osc -> principal amplitude (ring/AM)
    this._timbreMod = 0;  // accepted but no DSP target yet (folder deferred)

    // Overall output trim so a raw waveform at [-1,1] leaves the module at a
    // sane level; the debug surface / rack applies its own master gain on top.
    this._trim = 0.4;

    // Low range (LFO) divides the frequency into the sub-audio band. The
    // descriptor's modFreq range is the audio band; this factor maps it down
    // roughly to the 259t's low range without a second frequency control.
    this._lowRangeFactor = 1 / 128;

    // Message pump. Runs on the audio thread between render quanta, not inside
    // process(), so reading primitives out of the message here is fine — we
    // never retain the message object, so the process loop stays alloc-free.
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

  // Outputs (index order fixed by the descriptor's out-port order; the factory
  // asserts the descriptor still matches this):
  //   0 modTriOut   1 modSigOut   2 modCvOut
  //   3 prinSineOut 4 prinSquareOut 5 prinFinalOut
  // Inputs (pure signal ins, descriptor order):
  //   0 modFmIn     1 prinFmIn     2 phaseLockIn (accepted, not yet used)
  process(inputs, outputs, parameters) {
    // Output channel arrays. Any output may be unconnected; guard each. All
    // are mono (outputChannelCount all 1), so channel 0 is the signal.
    const outModTri = outputs[0] && outputs[0][0];
    const outModSig = outputs[1] && outputs[1][0];
    const outModCv = outputs[2] && outputs[2][0];
    const outPrinSine = outputs[3] && outputs[3][0];
    const outPrinSquare = outputs[4] && outputs[4][0];
    const outPrinFinal = outputs[5] && outputs[5][0];

    // The FM-in signal arrays may be empty when nothing is patched. A null
    // channel means "no external FM this block".
    const modFmCh = inputs[0] && inputs[0][0];
    const prinFmCh = inputs[1] && inputs[1][0];

    // Params. a-rate params give a length-128 array (or length-1 if constant
    // this block); k-rate give length-1. Read length once to pick the stride.
    const pPrinFreq = parameters.prinFreq;
    const pModFreq = parameters.modFreq;
    const prinFreqStride = pPrinFreq.length > 1 ? 1 : 0;
    const modFreqStride = pModFreq.length > 1 ? 1 : 0;
    const prinFine = parameters.prinFine[0];
    const prinFmAmount = parameters.prinFmAmount[0];
    const modFine = parameters.modFine[0];
    const modFmAmount = parameters.modFmAmount[0];
    const modIndex = parameters.modIndex[0];

    // Precompute per-block constants that don't vary per sample.
    const invSr = this._invSampleRate;
    const trim = this._trim;
    const rangeFactor = this._modRange === RANGE_LOW ? this._lowRangeFactor : 1;
    const modFineRatio = Math.pow(2, modFine / 12);
    const prinFineRatio = Math.pow(2, prinFine / 12);
    const modWave = this._modWave;
    const pitchMod = this._pitchMod;
    const amplMod = this._amplMod;

    // Stack-local phase accumulators.
    let modPhase = this._modPhase;
    let prinPhase = this._prinPhase;

    // Frame count from whichever output is connected; fall back to 128.
    const frameCount =
      (outPrinFinal && outPrinFinal.length) ||
      (outModSig && outModSig.length) ||
      (outModTri && outModTri.length) || 128;

    for (let i = 0; i < frameCount; i++) {
      // ---- Modulation oscillator ----
      const modBaseHz = pModFreq[i * modFreqStride] * modFineRatio * rangeFactor;
      // External FM into the mod osc: ratio FM (index scales with pitch, so
      // timbre stays constant across the keyboard). Through-zero permitted.
      const modFmSig = modFmCh ? modFmCh[i] : 0;
      const modHz = modBaseHz + modFmSig * modFmAmount * modBaseHz;
      const modInc = modHz * invSr;
      const modDt = modInc < 0 ? -modInc : modInc;

      // Mod waveforms at the current phase.
      const modTri = triangle(modPhase);
      let modSig;
      if (modWave === WAVE_SQUARE) modSig = blepSquare(modPhase, modDt);
      else if (modWave === WAVE_SAW) modSig = blepSaw(modPhase, modDt);
      else modSig = modTri;

      // The modulation source feeding the middle section is the SELECTED
      // signal waveform (what a patch would take from the Signal jack).
      const modSource = modSig;

      // ---- Principal oscillator ----
      const prinBaseHz = pPrinFreq[i * prinFreqStride] * prinFineRatio;
      // Internal pitch mod (mod osc -> principal), plus external FM-in. Both
      // are ratio FM folded into the increment, so both are through-zero.
      const prinFmSig = prinFmCh ? prinFmCh[i] : 0;
      const internalFm = pitchMod ? (modSource * modIndex) : 0;
      const prinHz = prinBaseHz
        + internalFm * prinBaseHz
        + prinFmSig * prinFmAmount * prinBaseHz;
      const prinInc = prinHz * invSr;
      const prinDt = prinInc < 0 ? -prinInc : prinInc;

      // Principal waveforms.
      const prinSine = Math.sin(prinPhase * TWO_PI);
      const prinSquare = blepSquare(prinPhase, prinDt);
      // "Final" pre-fold source: a band-limited saw, the richest raw shape and
      // exactly what the wavefolder will consume once it exists.
      const prinFinalRaw = blepSaw(prinPhase, prinDt);

      // Amplitude mod (ring-ish): scale the principal by the mod source. With
      // modIndex at 0 or the switch off, the factor is 1 (no effect).
      const ampFactor = amplMod ? (1 + modSource * modIndex) : 1;

      // ---- Write outputs (guarded; only connected outputs cost anything) ----
      if (outModTri) outModTri[i] = modTri * trim;
      if (outModSig) outModSig[i] = modSig * trim;
      if (outModCv) outModCv[i] = modTri; // control copy, full-scale bipolar
      if (outPrinSine) outPrinSine[i] = prinSine * ampFactor * trim;
      if (outPrinSquare) outPrinSquare[i] = prinSquare * ampFactor * trim;
      if (outPrinFinal) outPrinFinal[i] = prinFinalRaw * ampFactor * trim;

      // ---- Advance phases (wrap both directions for through-zero FM) ----
      modPhase += modInc;
      if (modPhase >= 1) modPhase -= 1; else if (modPhase < 0) modPhase += 1;
      prinPhase += prinInc;
      if (prinPhase >= 1) prinPhase -= 1; else if (prinPhase < 0) prinPhase += 1;
    }

    this._modPhase = modPhase;
    this._prinPhase = prinPhase;
    return true;
  }
}

registerProcessor('complex-osc-259t', ComplexOsc259t);
