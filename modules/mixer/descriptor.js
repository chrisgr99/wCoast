// descriptor.js — the output Mixer (207-style), a data-only module schema.
//
// The mixer is our output stage, modelled on the Buchla 207: a six-input,
// two-output stereo mixer with per-channel level and pan, plus voltage control
// of pan on two channels (A and F, as on the 207). We drop the parts that don't
// apply to a computer — the microphone preamp, headphone/monitor output, preset
// storage — and add a per-channel mute (our own, not on the real panel).
//
// Unlike a rack module, the mixer isn't placed in the case: its jacks live in
// the toolbar and its per-channel controls open in a floating panel. But it IS
// a normal patch destination — the host instantiates it and the patchbay wires
// module outputs into its channel inputs exactly like any other module input.

'use strict';

const CH = ['A', 'B', 'C', 'D', 'E', 'F'];
const VC_PAN = new Set(['A', 'F']);   // channels whose pan is voltage-controllable

const ports = [];
const params = [];
for (const L of CH) {
  ports.push({ id: `chan${L}`, name: L, section: 'channel', domain: 'audio', dir: 'in' });
  params.push({ id: `level${L}`, name: `Level ${L}`, section: 'channel', curve: 'linear', min: 0, max: 1, default: 0.8, glideMs: 20 });
  params.push({ id: `pan${L}`, name: `Pan ${L}`, section: 'channel', curve: 'linear', min: -1, max: 1, default: 0, glideMs: 20 });
  params.push({ id: `mute${L}`, name: `Mute ${L}`, section: 'channel', curve: 'stepped', steps: [{ value: 'off' }, { value: 'on' }], default: 'off' });
}
for (const L of CH) {
  if (!VC_PAN.has(L)) continue;
  // A CV input that targets the channel's pan param (Web Audio sums the CV onto
  // the manual pan value).
  ports.push({ id: `panCv${L}`, name: `Pan ${L}`, section: 'panCv', domain: 'control', dir: 'in', target: `pan${L}` });
}
params.push({ id: 'master', name: 'Master', section: 'master', curve: 'linear', min: 0, max: 1, default: 0.7, glideMs: 20 });

export default {
  id: 'mixer',
  apiVersion: 1,
  name: 'Mixer',
  worklets: [],          // native Web Audio nodes only
  channels: CH,
  vcPan: [...VC_PAN],
  ports,
  params,
};
