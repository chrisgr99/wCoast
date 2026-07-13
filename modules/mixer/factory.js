// factory.js — the Mixer's Web Audio graph.
//
// Six channels, each: input gain (level) -> mute gain -> stereo panner. All the
// panners sum into a master gain, which feeds the context destination (your two
// outputs) and drops the hot internal level toward line level. Channels A and F
// expose their panner's pan AudioParam so a control cord can voltage-control it
// (Web Audio sums the CV onto the manual pan value).
//
// The realized-instance contract matches every other module so the patchbay
// treats it uniformly:
//   getOutput(portId) -> null            (the mixer is terminal — it IS the output)
//   getInput(portId)  -> { node, index } (a channel audio input)
//   getParam(paramId) -> AudioParam      (level/pan/master; pan is also a CV target)
//   setParam(id, v)   -> level/pan/master glide; mute toggles a gain
//   supports(id)      -> everything is realized
//   dispose()

'use strict';

// Output makeup gain (linear). Our internal signals run quiet — the Complex Oscillator trims
// itself to about ±0.4 (~-8 dBFS) — and two cascaded faders (channel + master) attenuate further,
// so without makeup the system can't reach a useful loudness. This lifts the post-fader signal
// ~+20 dB into a brick-wall limiter, so a normal patch is loud with headroom and the limiter
// catches peaks instead of clipping. The master fader still sets level below this.
const OUT_MAKEUP = 10;

export function create(ctx, services) {
  const { descriptor } = services;
  const CH = descriptor.channels;
  const vcPan = new Set(descriptor.vcPan || []);   // outer channels: CV-only pan

  const master = ctx.createGain();
  master.gain.value = paramDefault('master');
  // A mute gain after the master feeds the destination; muting silences the whole
  // output without disturbing the master level.
  const masterMute = ctx.createGain();
  // Enable sense flipped: 'on' = enabled (pass), 'off' = disabled (silent).
  masterMute.gain.value = paramDefault('masterMute') === 'on' ? 1 : 0;
  master.connect(masterMute);
  // A solo-duck after the mute silences the normal output while an ear monitor is
  // auditioning a single terminal, without disturbing the user's master-enable state.
  const soloDuck = ctx.createGain();
  masterMute.connect(soloDuck);
  // Output makeup + brick-wall limiter (see OUT_MAKEUP): lift the quiet post-fader signal up so the
  // system is actually loud, and catch peaks safely instead of clipping. Everything upstream (mute,
  // solo, master fader) still shapes the signal before it reaches here.
  const makeup = ctx.createGain();
  makeup.gain.value = OUT_MAKEUP;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -1; limiter.knee.value = 0; limiter.ratio.value = 20; limiter.attack.value = 0.003; limiter.release.value = 0.12;
  soloDuck.connect(makeup); makeup.connect(limiter); limiter.connect(ctx.destination);
  function setSolo(on) { soloDuck.gain.setTargetAtTime(on ? 0 : 1, ctx.currentTime, 0.008); }

  // Stereo VU tap: read the FINAL (post-makeup, post-limiter) output so the meters reflect what you
  // actually hear. (A pure read — it doesn't alter the signal reaching the destination.)
  const splitter = ctx.createChannelSplitter(2);
  limiter.connect(splitter);
  const meterL = ctx.createAnalyser(); meterL.fftSize = 256;
  const meterR = ctx.createAnalyser(); meterR.fftSize = 256;
  splitter.connect(meterL, 0);
  splitter.connect(meterR, 1);

  const channels = CH.map((L) => {
    const level = ctx.createGain();
    const mute = ctx.createGain();
    const pan = ctx.createStereoPanner();
    level.gain.value = paramDefault(`level${L}`);
    mute.gain.value = paramDefault(`mute${L}`) === 'on' ? 1 : 0;
    level.connect(mute); mute.connect(pan); pan.connect(master);
    // Outer channels are pan-CV only (no knob): the panner rests full-left (−1)
    // and a ×2 scaler turns a 0..1 CV into a full −1..+1 sweep. Inner channels
    // take their manual pan default.
    let panScale = null;
    if (vcPan.has(L)) {
      pan.pan.value = -1;
      panScale = ctx.createGain(); panScale.gain.value = 2; panScale.connect(pan.pan);
    } else {
      pan.pan.value = paramDefault(`pan${L}`);
    }
    // A per-channel analysis tap, post level+mute (so a zeroed fader or a mute
    // reads as silence): a read-only fan-out for the VU meters and audio-trace.
    const meter = ctx.createAnalyser(); meter.fftSize = 1024;
    mute.connect(meter);
    return { L, level, mute, pan, meter, panScale };
  });

  const byLetter = new Map(channels.map((c) => [c.L, c]));
  const inIndex = new Map(CH.map((L, i) => [`chan${L}`, i]));

  function paramDefault(id) {
    const p = descriptor.params.find((x) => x.id === id);
    return p ? p.default : 0;
  }

  function getOutput() { return null; }                 // terminal
  function getInput(portId) {
    const i = inIndex.get(portId);
    if (i !== undefined) return { node: channels[i].level, index: 0 };
    // Pan CV on the outer channels routes through the ×2/−1 pan scaler so a 0..1
    // CV sweeps the panner fully left..right.
    if (portId.startsWith('panCv')) { const c = byLetter.get(portId.slice(5)); return c && c.panScale ? { node: c.panScale, index: 0 } : null; }
    return null;
  }
  function getParam(paramId) {
    if (paramId === 'master') return master.gain;
    if (paramId.startsWith('level')) { const c = byLetter.get(paramId.slice(5)); return c ? c.level.gain : null; }
    // Inner channels expose their pan AudioParam; outer (CV-only) channels do not.
    if (paramId.startsWith('pan')) { const c = byLetter.get(paramId.slice(3)); return c && !c.panScale ? c.pan.pan : null; }
    return null;
  }
  function supports() { return true; }
  function setParam(paramId, value, atTime) {
    if (paramId === 'masterMute') { masterMute.gain.value = value === 'on' ? 1 : 0; return; }
    if (paramId.startsWith('mute')) {
      const c = byLetter.get(paramId.slice(4));
      if (c) c.mute.gain.value = value === 'on' ? 1 : 0;
      return;
    }
    const ap = getParam(paramId);
    if (!ap) return;
    const t = atTime === undefined ? ctx.currentTime : atTime;
    ap.setTargetAtTime(value, t, 0.02);
  }
  function dispose() {
    try { master.disconnect(); masterMute.disconnect(); soloDuck.disconnect(); makeup.disconnect(); limiter.disconnect(); } catch (_e) { /* gone */ }
    for (const c of channels) { try { c.level.disconnect(); c.mute.disconnect(); c.pan.disconnect(); if (c.panScale) c.panScale.disconnect(); } catch (_e) { /* gone */ } }
  }

  // RMS level (0..~1) of each output channel, for the VU meters.
  const buf = new Float32Array(meterL.fftSize);
  function rms(an) {
    an.getFloatTimeDomainData(buf);
    let s = 0;
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
    return Math.sqrt(s / buf.length);
  }
  function meters() { return { l: rms(meterL), r: rms(meterR) }; }

  // Per-channel + master RMS levels (0..~1) for the VU meters. One reused buffer
  // sized to the largest analyser avoids per-frame allocation.
  const vbuf = new Float32Array(1024);
  function levelOf(an) {
    an.getFloatTimeDomainData(vbuf);
    let s = 0; const n = an.fftSize;
    for (let i = 0; i < n; i++) s += vbuf[i] * vbuf[i];
    return Math.sqrt(s / n);
  }
  function levels() {
    const ch = {};
    for (const c of channels) ch[c.L] = levelOf(c.meter);
    return { channels: ch, master: Math.max(levelOf(meterL), levelOf(meterR)) };
  }

  // Read-only analyser taps for the audio-trace mirror: the master (stereo) plus
  // one per channel (post level+mute). Pure fan-outs; not part of the audio path.
  const analysers = {
    master: { l: meterL, r: meterR },
    channels: new Map(channels.map((c) => [c.L, c.meter])),
  };

  return { getOutput, getInput, getParam, setParam, supports, dispose, setSolo, master, meters, levels, analysers };
}
