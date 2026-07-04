// descriptor.js — Quad Low Pass Gate (292), a data-only module schema.
//
// A Buchla-292-style quad low pass gate: four identical vactrol gates, each a
// 2-pole lowpass and a VCA driven together by one slow opto (vactrol) envelope.
// Per channel: an audio input, a control (CV) input that pushes the gate open,
// a trigger input that STRIKES it, a LEVEL and a DECAY knob, a MODE pair (two
// buttons — LP and VCA; both on = the combined "both" mode), a per-channel
// clock DIVIDER and an ON button that lets the module's own clock strike it.
// Three ways to fire each gate: the panel STRIKE button, the trigger input, or
// the internal clock. Outputs: each gate individually, plus the Buchla odd/even
// summed pair (A+C -> odd, B+D -> even) for an automatic stereo spread, plus a
// clock output. See design/lpg-292-mock.svg for the faceplate.
//
// The gate art and coordinate convention follow the 259t (see
// project-wcoast-faceplates): active-area-only panel, no rack ears or holes.

'use strict';

const CH = ['A', 'B', 'C', 'D'];
const ODD = new Set(['A', 'C']);          // A,C -> odd sum; B,D -> even sum
const DIVISORS = [1, 2, 3, 4, 6, 8];      // clock-divider detents (also read by the factory)

const ports = [];
const params = [];

// Ports. The dir="in" order here fixes the worklet's audio-input indices, and
// the dir="out" order fixes its output indices — the factory asserts both.
// Grouped so the worklet inputs come out as [in A-D, cv A-D, trig A-D].
for (const L of CH) ports.push({ id: `in${L}`, name: L, section: 'channel', domain: 'audio', dir: 'in' });
for (const L of CH) ports.push({ id: `cv${L}`, name: `CV ${L}`, section: 'channel', domain: 'control', dir: 'in' });
for (const L of CH) ports.push({ id: `trig${L}`, name: `Trig ${L}`, section: 'channel', domain: 'trigger', dir: 'in' });
for (const L of CH) ports.push({ id: `out${L}`, name: `Out ${L}`, section: 'channel', domain: 'audio', dir: 'out' });
ports.push({ id: 'mixOdd', name: 'Odd', section: 'sum', domain: 'audio', dir: 'out' });
ports.push({ id: 'mixEven', name: 'Even', section: 'sum', domain: 'audio', dir: 'out' });
ports.push({ id: 'clkOut', name: 'Clk Out', section: 'clock', domain: 'trigger', dir: 'out' });

// Params. LEVEL and DECAY are knobs; MODE is two independent toggles (LP, VCA);
// STRIKE is a momentary button (each press fires a strike); the per-channel
// clock DIV is a stepped-value knob (quantised to DIVISORS in the factory) and
// its ON button gates the internal clock into that channel.
const onoff = () => ({ curve: 'stepped', steps: [{ value: 'off' }, { value: 'on' }] });
for (const L of CH) {
  params.push({ id: `level${L}`, name: `Level ${L}`, section: 'channel', curve: 'linear', min: 0, max: 1, default: 0.8, glideMs: 15 });
  params.push({ id: `decay${L}`, name: `Decay ${L}`, section: 'channel', curve: 'linear', min: 0, max: 1, default: 0.4, glideMs: 10 });
  params.push({ id: `lp${L}`, name: `Lowpass ${L}`, section: 'channel', ...onoff(), default: 'on' });
  params.push({ id: `vca${L}`, name: `VCA ${L}`, section: 'channel', ...onoff(), default: 'on' });
  params.push({ id: `strike${L}`, name: `Strike ${L}`, section: 'channel', ...onoff(), default: 'off' });
  params.push({ id: `div${L}`, name: `Divide ${L}`, section: 'channel', curve: 'linear', min: 0, max: 1, default: 0, glideMs: 0 });
  params.push({ id: `clkOn${L}`, name: `Clock ${L}`, section: 'channel', ...onoff(), default: 'off' });
}
params.push({ id: 'rate', name: 'Clock Rate', section: 'clock', curve: 'linear', min: 0, max: 1, default: 0.35, glideMs: 10 });
params.push({ id: 'run', name: 'Clock Run', section: 'clock', ...onoff(), default: 'off' });

export default {
  id: 'lpg-292',
  apiVersion: 1,
  name: 'Quad Low Pass Gate',
  worklets: ['modules/lpg-292/lpg-292-processor.js'],
  channels: CH,
  odd: [...CH].filter((L) => ODD.has(L)),
  even: [...CH].filter((L) => !ODD.has(L)),
  divisors: DIVISORS,
  ports,
  params,
};
