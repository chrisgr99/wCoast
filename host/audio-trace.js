// audio-trace.js — the running sound, reduced to measurements.
//
// An AI cannot hear audio, but audio reduced to a compact stream of measurements
// is very reasonable to reason about. This module drives read-only AnalyserNode
// taps on every point where signal matters — each wired module output, each mixer
// channel (post level+mute), and the master — and each write tick emits a compact
// snapshot (levels in dBFS, spectral centroid, and clip/silent/dc/nan flags) plus
// a rolling log of onsets (envelope peaks, i.e. strikes). See design/ai-mirror.md.
//
// The taps are pure fan-outs with no onward connection, so nothing here touches
// the audio thread's signal path; all the math runs on the control thread.
//
//   createAudioTrace({ ctx, rack, mixer }) -> { start(pushFn), stop({writeOff}), running }
//
// `mixer` is the mixer INSTANCE (it exposes `.analysers`). `pushFn(traceObject)`
// persists one snapshot (the caller writes it to the mirror). The loop runs only
// while sound plays AND the mirror is enabled — the caller starts/stops it.

'use strict';

const PROTOCOL = 1;
const FAST_MS = 60;          // envelope-tracking tick (onset detection)
const WRITE_EVERY = 4;       // emit a snapshot every Nth fast tick (~240 ms)
const ONSET_LOW = 0.02;      // linear peak: envelope must fall below this…
const ONSET_HIGH = 0.08;     // …then rise above this to count as a strike
const ONSET_REFRACTORY = 0.08;   // seconds between strikes on one endpoint
const ONSET_KEEP = 24;       // rolling onset log length
const HIST_KEEP = 48;        // master-peak history length

const round1 = (n) => Math.round(n * 10) / 10;
const round3 = (n) => Math.round(n * 1000) / 1000;
const dbfs = (v) => (v <= 1e-6 ? -120 : Math.max(-120, round1(20 * Math.log10(v))));

export function createAudioTrace({ ctx, rack, mixer }) {
  const registry = rack.host.registry;
  const timeBuf = new Float32Array(1024);
  const freqBuf = new Float32Array(512);

  const moduleTaps = new Map();   // "key.portId" -> { analyser, node, index, key, portId, descriptorId }
  const env = new Map();          // endpoint id -> last peak (for onset edge detection)
  const onsetAt = new Map();      // endpoint id -> last onset time (refractory)
  let onsets = [];
  let masterHist = [];
  let timer = null;
  let ticks = 0;
  let pushFn = null;

  const nameOf = (key) => (rack.records.get(key)?.name) || key;
  const portName = (descId, portId) => (registry.portById(descId, portId)?.name) || portId;

  // Reconcile the per-output taps against the live patch: tap every distinct
  // wired module output, drop taps whose cable is gone. Sources feeding the mixer
  // are module outputs too, so a direct osc→mixer voice is covered here.
  function reconcileTaps() {
    const want = new Map();
    for (const e of rack.patchbay.list()) {
      const id = `${e.src.key}.${e.src.portId}`;
      if (!want.has(id)) want.set(id, e);
    }
    for (const [id, e] of want) {
      if (moduleTaps.has(id)) continue;
      try {
        const analyser = ctx.createAnalyser(); analyser.fftSize = 1024;
        e.out.node.connect(analyser, e.out.index);
        moduleTaps.set(id, { analyser, node: e.out.node, index: e.out.index, key: e.src.key, portId: e.src.portId, descriptorId: e.src.descriptorId });
      } catch (_e) { /* node may be mid-teardown */ }
    }
    for (const [id, t] of [...moduleTaps]) {
      if (want.has(id)) continue;
      try { t.node.disconnect(t.analyser, t.index); } catch (_e) { /* already gone */ }
      moduleTaps.delete(id); env.delete(id); onsetAt.delete(id);
    }
  }

  // Peak of an analyser's current time-domain frame (cheap; for onset tracking).
  function peakOf(analyser) {
    const n = analyser.fftSize;
    analyser.getFloatTimeDomainData(timeBuf);
    let peak = 0;
    for (let i = 0; i < n; i++) { const a = Math.abs(timeBuf[i]); if (a > peak) peak = a; }
    return peak;
  }

  // Full measurement of one analyser: RMS/peak in dBFS, spectral centroid, flags.
  function measure(analyser) {
    const n = analyser.fftSize;
    analyser.getFloatTimeDomainData(timeBuf);
    let peak = 0, sumSq = 0, mean = 0, bad = false;
    for (let i = 0; i < n; i++) {
      const x = timeBuf[i];
      if (!Number.isFinite(x)) { bad = true; break; }
      const a = Math.abs(x);
      if (a > peak) peak = a;
      sumSq += x * x; mean += x;
    }
    const rms = bad ? 0 : Math.sqrt(sumSq / n);
    mean = bad ? 0 : mean / n;

    const nb = analyser.frequencyBinCount;
    analyser.getFloatFrequencyData(freqBuf);
    const binHz = ctx.sampleRate / analyser.fftSize;
    let num = 0, den = 0;
    for (let i = 1; i < nb; i++) { const m = Math.pow(10, freqBuf[i] / 20); num += i * binHz * m; den += m; }
    const centroid = den > 1e-9 ? Math.round(num / den) : 0;

    const flags = [];
    if (bad) flags.push('nan');
    else {
      if (peak >= 0.997) flags.push('clip');
      if (dbfs(peak) < -90) flags.push('silent');
      if (Math.abs(mean) > 0.03 && rms > 1e-4) flags.push('dc');
    }
    return { rms_dbfs: dbfs(rms), peak_dbfs: dbfs(peak), centroid_hz: centroid, flags, _peak: peak };
  }

  // Endpoints that can fire onsets: module outputs and mixer channels (not the
  // master, which would just re-report the sum of the others).
  function* onsetEndpoints() {
    for (const [id, t] of moduleTaps) yield [id, t.analyser];
    if (mixer.analysers) for (const [L, an] of mixer.analysers.channels) yield [`mixer.chan${L}`, an];
  }

  function detectOnsets() {
    const now = ctx.currentTime;
    for (const [id, an] of onsetEndpoints()) {
      const prev = env.get(id) || 0;
      const cur = peakOf(an);
      env.set(id, cur);
      if (prev < ONSET_LOW && cur > ONSET_HIGH) {
        const last = onsetAt.get(id) || -1;
        if (now - last >= ONSET_REFRACTORY) {
          onsetAt.set(id, now);
          const m = measure(an);
          onsets.push({ t: round3(now), endpoint: id, peak_dbfs: dbfs(cur), centroid_hz: m.centroid_hz });
          if (onsets.length > ONSET_KEEP) onsets = onsets.slice(-ONSET_KEEP);
        }
      }
    }
  }

  const clean = (m, id, module, port) => ({ id, module, port, rms_dbfs: m.rms_dbfs, peak_dbfs: m.peak_dbfs, centroid_hz: m.centroid_hz, flags: m.flags });

  function buildTrace() {
    const endpoints = [];
    for (const [id, t] of moduleTaps) endpoints.push(clean(measure(t.analyser), id, nameOf(t.key), portName(t.descriptorId, t.portId)));
    if (mixer.analysers) {
      for (const [L, an] of mixer.analysers.channels) endpoints.push(clean(measure(an), `mixer.chan${L}`, 'Mixer', `channel ${L}`));
      const ml = measure(mixer.analysers.master.l), mr = measure(mixer.analysers.master.r);
      const flags = [...new Set([...ml.flags, ...mr.flags])];
      const masterPeak = Math.max(ml.peak_dbfs, mr.peak_dbfs);
      endpoints.push({ id: 'mixer.master', module: 'Mixer', port: 'master',
        rms_dbfs: round1((ml.rms_dbfs + mr.rms_dbfs) / 2), peak_dbfs: masterPeak,
        centroid_hz: Math.round((ml.centroid_hz + mr.centroid_hz) / 2), flags });
      masterHist.push(masterPeak);
      if (masterHist.length > HIST_KEEP) masterHist = masterHist.slice(-HIST_KEEP);
    }
    return {
      protocolVersion: PROTOCOL,
      capturedAt: new Date().toISOString(),
      sound: 'on',
      sampleRateHz: ctx.sampleRate,
      endpoints,
      onsets: [...onsets],
      masterPeakHistory_dbfs: [...masterHist],
    };
  }

  function offTrace() {
    return { protocolVersion: PROTOCOL, capturedAt: new Date().toISOString(), sound: 'off', sampleRateHz: ctx.sampleRate, endpoints: [], onsets: [], masterPeakHistory_dbfs: [] };
  }

  function tick() {
    ticks++;
    if (ticks % WRITE_EVERY === 1) reconcileTaps();   // patch topology changes are infrequent
    detectOnsets();
    if (ticks % WRITE_EVERY === 0 && pushFn) pushFn(buildTrace());
  }

  function disconnectAll() {
    for (const [, t] of moduleTaps) { try { t.node.disconnect(t.analyser, t.index); } catch (_e) { /* gone */ } }
    moduleTaps.clear(); env.clear(); onsetAt.clear(); onsets = []; masterHist = [];
  }

  function start(fn) {
    if (timer) return;
    pushFn = fn; ticks = 0;
    reconcileTaps();
    timer = setInterval(tick, FAST_MS);
  }
  function stop(opts) {
    if (timer) { clearInterval(timer); timer = null; }
    if (opts && opts.writeOff && pushFn) pushFn(offTrace());
    disconnectAll();
    pushFn = null;
  }

  return { start, stop, running: () => timer !== null };
}
