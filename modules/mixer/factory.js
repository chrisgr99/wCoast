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

export function create(ctx, services) {
  const { descriptor } = services;
  const CH = descriptor.channels;

  const master = ctx.createGain();
  master.gain.value = paramDefault('master');
  master.connect(ctx.destination);

  const channels = CH.map((L) => {
    const level = ctx.createGain();
    const mute = ctx.createGain();
    const pan = ctx.createStereoPanner();
    level.gain.value = paramDefault(`level${L}`);
    mute.gain.value = paramDefault(`mute${L}`) === 'on' ? 0 : 1;
    pan.pan.value = paramDefault(`pan${L}`);
    level.connect(mute); mute.connect(pan); pan.connect(master);
    return { L, level, mute, pan };
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
    return i === undefined ? null : { node: channels[i].level, index: 0 };
  }
  function getParam(paramId) {
    if (paramId === 'master') return master.gain;
    if (paramId.startsWith('level')) { const c = byLetter.get(paramId.slice(5)); return c ? c.level.gain : null; }
    if (paramId.startsWith('pan')) { const c = byLetter.get(paramId.slice(3)); return c ? c.pan.pan : null; }
    return null;
  }
  function supports() { return true; }
  function setParam(paramId, value, atTime) {
    if (paramId.startsWith('mute')) {
      const c = byLetter.get(paramId.slice(4));
      if (c) c.mute.gain.value = value === 'on' ? 0 : 1;
      return;
    }
    const ap = getParam(paramId);
    if (!ap) return;
    const t = atTime === undefined ? ctx.currentTime : atTime;
    ap.setTargetAtTime(value, t, 0.02);
  }
  function dispose() {
    try { master.disconnect(); } catch (_e) { /* gone */ }
    for (const c of channels) { try { c.level.disconnect(); c.mute.disconnect(); c.pan.disconnect(); } catch (_e) { /* gone */ } }
  }

  return { getOutput, getInput, getParam, setParam, supports, dispose, master };
}
