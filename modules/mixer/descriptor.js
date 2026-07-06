// descriptor.js — the output Mixer (207-style), a data-only module schema.
//
// The mixer is our output stage, modelled on the Buchla 207: a six-input,
// two-output stereo mixer with per-channel level and pan, plus voltage control
// of pan on the two OUTER channels (A and F) — a left pan-CV that sweeps A and a
// right pan-CV that sweeps F (CV 0 = full left, 1 = full right); on those two
// channels the CV jack takes the pan knob's spot (no manual pan knob). We drop
// the parts that don't
// apply to a computer — the microphone preamp, headphone/monitor output, preset
// storage — and add a per-channel mute (our own, not on the real panel).
//
// The mixer is a normal rack module — a terminal one: it has no output jacks
// because it IS the output (its master feeds the speakers). It's a singleton the
// host always keeps present (default lower-right, draggable, not deletable), and
// the patchbay wires module outputs into its channel inputs like any other input.
// A master level + stereo VU also mirror into the toolbar for always-on reach.

'use strict';

const CH = ['A', 'B', 'C', 'D', 'E', 'F'];
const VC_PAN = new Set(['A', 'F']);   // first and last channel: voltage-controllable pan

const ports = [];
const params = [];
for (const L of CH) {
  ports.push({ id: `chan${L}`, name: L, section: 'channel', domain: 'audio', dir: 'in' });
  // Gain (amp) CV: a control-voltage input that drives the channel level 0..1, the
  // same range the fader spans bottom-to-top.
  ports.push({ id: `ampCv${L}`, name: `Gain ${L}`, section: 'ampCv', domain: 'control', dir: 'in', target: `level${L}` });
  params.push({ id: `level${L}`, name: `Level ${L}`, section: 'channel', curve: 'linear', min: 0, max: 1, default: 0.8, glideMs: 20 });
  params.push({ id: `pan${L}`, name: `Pan ${L}`, section: 'channel', curve: 'linear', min: -1, max: 1, default: 0, glideMs: 20 });
  // Enable lamp: lit = channel enabled (passing audio). Internally still a mute
  // gain, but the sense is flipped — 'on' now means enabled, and it defaults on.
  params.push({ id: `mute${L}`, name: `Enable ${L}`, section: 'channel', curve: 'stepped', steps: [{ value: 'off' }, { value: 'on' }], default: 'on' });
}
for (const L of CH) {
  if (!VC_PAN.has(L)) continue;
  // A CV input that targets the channel's pan param (Web Audio sums the CV onto
  // the manual pan value).
  ports.push({ id: `panCv${L}`, name: `Pan ${L}`, section: 'panCv', domain: 'control', dir: 'in', target: `pan${L}` });
}
ports.push({ id: 'ampCvMaster', name: 'Gain Master', section: 'ampCv', domain: 'control', dir: 'in', target: 'master' });
params.push({ id: 'master', name: 'Master', section: 'master', curve: 'linear', min: 0, max: 1, default: 0.7, glideMs: 20 });
params.push({ id: 'masterMute', name: 'Master Enable', section: 'master', curve: 'stepped', steps: [{ value: 'off' }, { value: 'on' }], default: 'on' });

export default {
  id: 'mixer',
  apiVersion: 1,
  name: 'Mixer',
  abbreviation: 'Mixer',
  worklets: [],          // native Web Audio nodes only
  channels: CH,
  vcPan: [...VC_PAN],
  ports,
  params,
};
