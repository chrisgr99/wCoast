// test-tone-processor.js — the spike worklet.
//
// This AudioWorkletProcessor exists to prove the worklet toolchain end to
// end inside Electron: that the module loads over the app:// origin, that
// the processor registers, that it runs on the audio thread without
// glitching, and that parameter messages reach it. The DSP is deliberately
// the simplest possible thing that makes a pitched tone — a naive sine —
// so that ANY problem at this stage is unambiguously a pipeline problem,
// not a synthesis bug. The real band-limited PolyBLEP oscillator replaces
// the guts of process() at a later milestone; the surrounding scaffolding
// (registration, message handling, zero-allocation loop) stays.
//
// Zero-allocation discipline. Even though this is throwaway DSP, it is
// written the way all LibreModular audio-thread code must be written: the
// process() method allocates NOTHING. No object literals, no array
// literals, no closures created per block or per sample. Every value it
// needs is either a preallocated instance field or a stack local. The
// single most likely cause of an audible glitch in this whole project is
// a stray allocation on the audio thread triggering garbage collection
// mid-block and blowing the 128-sample real-time deadline — so the habit
// starts here, against a sine, where it is easy to get right.
//
// Control model. Frequency and amplitude are handled as smoothed instance
// state rather than as k-rate AudioParams, on purpose: it rehearses the
// destination-side glide that the GXW bridge will rely on. A message sets
// a TARGET; process() eases the current value toward the target a little
// each sample (a one-pole approach), so a sudden frequency or gain change
// arrives as a short glide instead of a zipper-inducing step. The glide
// time constant is expressed in seconds and converted to a per-sample
// coefficient once, at construction, using the real sample rate.

class TestToneProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    // Phase accumulator, normalised to [0, 1). Kept as a plain number and
    // advanced by a per-sample increment each frame.
    this._phase = 0;

    // Current and target values for the two controllable quantities. The
    // "current" values are what actually drive the DSP; the "target"
    // values are what messages set. Each sample nudges current toward
    // target, which is the glide that hides stepped control input.
    this._freq = 220;
    this._freqTarget = 220;
    this._amp = 0.0;         // start silent; ramp up when told to play
    this._ampTarget = 0.0;

    // Per-sample glide coefficient derived from a time constant and the
    // actual context sample rate. A one-pole smoother of the form
    //   current += (target - current) * coeff
    // reaches ~63% of the way to target in `tau` seconds. Computed once
    // here so the process loop does no per-sample transcendental math for
    // smoothing. `sampleRate` is a global available inside the worklet
    // scope and reflects the real AudioContext rate, which we must read
    // rather than assume (it may be 44100 or 48000 depending on hardware).
    const glideTau = 0.02; // 20 ms — musical, and well above zipper range
    this._glideCoeff = 1 - Math.exp(-1 / (glideTau * sampleRate));

    // Precompute the reciprocal of the sample rate so the per-sample
    // phase increment is a multiply, not a divide.
    this._invSampleRate = 1 / sampleRate;

    // Message handling. The main thread posts { type, ... } objects. We
    // only READ from them here and copy primitives into instance fields;
    // we never retain the message object, so nothing the audio loop
    // touches was allocated by this handler. onmessage runs on the audio
    // thread's message pump between render quanta, not inside process(),
    // so a little work here is fine.
    this.port.onmessage = (event) => {
      const msg = event.data;
      if (msg == null) return;
      switch (msg.type) {
        case 'setFreq':
          if (typeof msg.value === 'number' && msg.value > 0) {
            this._freqTarget = msg.value;
          }
          break;
        case 'setAmp':
          if (typeof msg.value === 'number') {
            // Clamp to a sane range so a bad message can't blast output.
            let v = msg.value;
            if (v < 0) v = 0;
            if (v > 1) v = 1;
            this._ampTarget = v;
          }
          break;
        case 'noteOn':
          // Convenience: set frequency (if given) and open the amplitude.
          if (typeof msg.freq === 'number' && msg.freq > 0) {
            this._freqTarget = msg.freq;
          }
          this._ampTarget = 0.2;
          break;
        case 'noteOff':
          this._ampTarget = 0.0;
          break;
        default:
          break;
      }
    };
  }

  // process(inputs, outputs, parameters) runs once per 128-sample render
  // quantum on the audio thread. The argument ORDER is fixed by the Web
  // Audio spec: inputs first, outputs SECOND. This node has no inputs, so
  // we ignore the first argument and write into outputs[0]. (An earlier
  // version of this file named the first parameter `outputs` and took only
  // one argument — that reads the empty inputs array, finds nothing, and
  // emits silence with no error. Keep the two-argument signature.)
  // Must return true to keep the node alive. NOTHING inside this method
  // allocates.
  process(inputs, outputs) {
    const output = outputs[0];
    if (output === undefined) return true;

    // Pull instance state into stack locals. Reading/writing locals in the
    // inner loop is faster than repeated `this.` property access and makes
    // the no-allocation property obvious.
    let phase = this._phase;
    let freq = this._freq;
    let amp = this._amp;
    const freqTarget = this._freqTarget;
    const ampTarget = this._ampTarget;
    const glide = this._glideCoeff;
    const invSr = this._invSampleRate;
    const TWO_PI = 6.283185307179586;

    const channel0 = output[0];
    const frameCount = channel0.length;

    for (let i = 0; i < frameCount; i++) {
      // Glide current values toward their targets (one-pole smoother).
      freq += (freqTarget - freq) * glide;
      amp += (ampTarget - amp) * glide;

      // Naive sine. This is the ONLY part that the real band-limited
      // oscillator will replace. A sine has no harmonics, so it doesn't
      // alias, which is why it's a safe stand-in that tells us the
      // pipeline works without confounding it with aliasing artifacts.
      const sample = Math.sin(phase * TWO_PI) * amp;

      // Advance and wrap the phase.
      phase += freq * invSr;
      if (phase >= 1) phase -= 1;

      // Write the same sample to every output channel (mono source fanned
      // out to however many channels the output has).
      for (let c = 0; c < output.length; c++) {
        output[c][i] = sample;
      }
    }

    // Store the evolved state back onto the instance for the next quantum.
    this._phase = phase;
    this._freq = freq;
    this._amp = amp;

    return true;
  }
}

registerProcessor('test-tone', TestToneProcessor);
