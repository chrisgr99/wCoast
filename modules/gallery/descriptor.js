// descriptor.js — Control Gallery: a display-only module that previews the
// canonical control primitives through the real panel loader (family colours,
// direction rings, dark mode, magnification). Not a sound source. It grows a
// control at a time as the shared faceplate library is built; for now, jacks.
'use strict';

// One in + one out per signal family, so every family colour and both direction
// rings are on screen. Pitch is flagged by role so the loader tints it green.
const FAMILIES = [
  { key: 'audio', domain: 'audio' },
  { key: 'cv', domain: 'control' },
  { key: 'trig', domain: 'trigger' },
  { key: 'pitch', domain: 'control', role: 'pitch' },
];

const ports = [];
for (const f of FAMILIES) {
  ports.push({ id: `${f.key}In`, name: `${f.key} in`, section: 'jacks', domain: f.domain, role: f.role, dir: 'in' });
  ports.push({ id: `${f.key}Out`, name: `${f.key} out`, section: 'jacks', domain: f.domain, role: f.role, dir: 'out' });
}
// Controls that draw their own attached label, one per placement side, to show
// labels sit below / above / left / right (and still wrap).
for (const side of ['Below', 'Above', 'Left', 'Right']) {
  ports.push({ id: `label${side}`, name: side.toLowerCase(), section: 'labels', domain: 'control', dir: 'in' });
}

// Demo knobs: a few sizes, a narrowed sweep, and one with ticks off. Linear so the
// pointer sits at 12 o'clock (default 0.5) for a clean display.
const params = [];
// A couple of off-centre defaults so the rotation (ticks turning with the pointer)
// is visible on load without grabbing a knob.
const KNOB_DEFAULT = { knobSmall: 0.5, knobMedium: 0.5, knobLarge: 0.82, knobDiv: 0.18, knobBare: 0.5, knobSkirt: 0.5 };
for (const [id, def] of Object.entries(KNOB_DEFAULT)) {
  params.push({ id, name: id, section: 'knobs', curve: 'linear', min: 0, max: 1, default: def, glideMs: 0 });
}

// Radio groups (stepped), momentary/toggle buttons (on/off), and a fader (linear).
const step = (v) => ({ value: v });
params.push({ id: 'radioMode', name: 'Mode', section: 'controls', curve: 'stepped', steps: ['transient', 'sustained', 'cyclic'].map(step), default: 'transient' });
params.push({ id: 'radioRange', name: 'Range', section: 'controls', curve: 'stepped', steps: ['low', 'high'].map(step), default: 'low' });
for (const id of ['btnStrike', 'btnTrig']) {   // white momentary push-buttons (on only while held)
  params.push({ id, name: id, section: 'controls', curve: 'stepped', steps: ['off', 'on'].map(step), default: 'off', momentary: true });
}
for (const id of ['btnToggle', 'btnOn']) {      // latching toggles (push on, push off)
  params.push({ id, name: id, section: 'controls', curve: 'stepped', steps: ['off', 'on'].map(step), default: 'off' });
}
params.push({ id: 'sliderLevel', name: 'Level', section: 'controls', curve: 'linear', min: 0, max: 1, default: 0.7, glideMs: 0 });
// Stepper buttons: one button cycles a one-of-N setting shown on a lamp row.
params.push({ id: 'stepWave', name: 'Wave', section: 'controls', curve: 'stepped', steps: ['sawtooth', 'square', 'triangle', 'sustained'].map(step), default: 'sawtooth' });
params.push({ id: 'stepRange', name: 'Range', section: 'controls', curve: 'stepped', steps: ['lo', 'mid', 'hi'].map(step), default: 'lo' });

export default {
  id: 'wcoast.gallery',
  apiVersion: 1,
  name: 'Control Gallery',
  hp: 53,
  ports,
  params,
};
