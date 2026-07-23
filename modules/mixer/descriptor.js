// descriptor.js — the output Mixer (207-style), a data-only module schema.
//
// The mixer is our output stage, modelled on the Buchla 207: a six-input,
// two-output stereo mixer with per-channel level and pan, plus voltage control
// of pan on the two OUTER channels (A and F) — the CV jack takes the pan knob's
// spot there (no manual pan knob). Every channel rests CENTRED; on A and F the
// pan CV sums onto centre (a bipolar CV sweeps full left..right). We drop
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
  params.push({ id: `level${L}`, name: `Level ${L}`, section: 'channel', curve: 'gainDb', min: 0, max: 1, default: 0.29, glideMs: 20 });   // ~-11 dB → ~70% up the throw
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
params.push({ id: 'master', name: 'Master', section: 'master', curve: 'gainDb', min: 0, max: 1, default: 0.29, glideMs: 20 });   // ~-11 dB → ~70% up the throw
// Monitor bus: its own fader (level) beside the master. Its enable is INDEPENDENT of the master's
// (see the per-bus enables below) — both, either, or neither bus can play. Enabling a monitor object
// turns the Monitor bus on. All handled by the host (routing lives in the rack), not the DSP.
params.push({ id: 'monitorLevel', name: 'Monitor', section: 'master', curve: 'gainDb', min: 0, max: 1, default: 0.29, glideMs: 20 });
// The two buses, each an independent on/off lamp under its fader (NOT a radio — both, either, or
// neither can play). There is no separate engine: these ARE the transport. Master defaults on,
// monitor off; enabling a monitor object turns the monitor bus on. Routing lives in the rack.
params.push({ id: 'masterEnable', name: 'Master enable', section: 'master', curve: 'stepped', steps: [{ value: 'off' }, { value: 'on' }], default: 'on' });
params.push({ id: 'monitorEnable', name: 'Monitor enable', section: 'master', curve: 'stepped', steps: [{ value: 'off' }, { value: 'on' }], default: 'off' });

export default {
  id: 'mixer',
  apiVersion: 1,
  name: 'Mixer / Output',
  abbreviation: 'Mix',
  worklets: [],          // native Web Audio nodes only
  sectioned: true,       // six independent channel strips — net highlight scopes to the hovered channel
  channels: CH,
  vcPan: [...VC_PAN],
  // No output jacks (it's the terminal output), so the identity strip has no
  // ports to derive from. Declare it explicitly: this module outputs audio — to
  // the speakers rather than to a jack — so it wears the audio-yellow band.
  signalIdentity: ['audio'],
  ports,
  params,
};
