// panel.layout.js — the Complex Oscillator faceplate as data (panel editor, Phase 1).
//
// The theme-independent item list the shared renderer (panel/render.js) turns into
// panel.svg + panel.dark.svg. Same layout the old gen-panel.js hand-authored, lifted
// out of the drawing code. Absolute-coordinate (no-wrap) scaffold: the module supplies
// its own face + frame rects and lays out in face coordinates.

'use strict';

import { evenScale } from '../../panel/primitives.js';

const FACE_W = 164.133, OX = 3.9, OY = 1.036;
const HZ = [['27.5', 'A1'], ['55', 'A2'], ['110', 'A3'], ['220', 'A4'], ['440', 'A5'], ['880', 'A6'], ['1760', 'A7'], ['3520', 'A8'], ['7040', 'A9']];

const items = [];
const ink = (x, y, text, opts = {}) => items.push({ t: 'label', x, y, text, opts });
const hdr = (x, y, text, size = 2.6) => ink(x, y, text, { size });
const lab = (text, placement = 'below', size = 2.0) => ({ text, placement, size });
const K = (id, x, y, radius, name, extra = {}) => items.push({ t: 'knob', id, x, y, opts: { radius, ...(name ? { label: lab(name) } : {}), ...extra } });
const oj = (id, x, y, txt) => items.push({ t: 'jack', id, x, y, opts: { label: lab(txt, 'below') } });
const ij = (id, x, y, txt) => items.push({ t: 'jack', id, x, y, opts: { label: lab(txt, 'above') } });
const jp = (id, x, y) => items.push({ t: 'jack', id, x, y });
const mark = (x, y, r) => items.push({ t: 'bipolarMark', x, y, r });

// face background + frame border
items.push({ t: 'rect', x: OX, y: OY, w: FACE_W, h: 128.5, fill: 'face' });
items.push({ t: 'rect', x: 4.4, y: 7.5994, w: FACE_W - 1, h: 112.5912, rx: 2.2, fill: 'none', stroke: 'frame', sw: 0.5 });

// section dividers — exact coordinates from the original 259t
const line = (x1, y1, x2, y2) => items.push({ t: 'line', x1, y1, x2, y2, w: 0.355 });
[
  [68.15, 9.18, 68.15, 122.77], [89.68, 9.18, 89.68, 122.77], [144.51, 9.18, 144.51, 122.77],
  [39.75, 28.9, 39.75, 51.48],
  [7.8, 29.53, 66.96, 29.53], [89.68, 29.53, 144.51, 29.53],
  [7.8, 50.94, 66.96, 50.94], [89.68, 50.94, 144.51, 50.94],
  [144.51, 69, 179.13, 69],
  [7.8, 122.77, 179.13, 122.77],
].forEach((l) => line(...l));

// ---- Modulation oscillator (left) ----
hdr(36.7, 12.5, 'MODULATION OSC OUTPUTS', 2.3);
oj('modTriOut', 24, 17.4, 'tri'); oj('modCvOut', 36.7, 17.4, 'c.v.'); oj('modSigOut', 49.8, 17.4, 'signal');
items.push({ t: 'radio', id: 'modRange', x: 23.78, y: 34, opts: { orientation: 'h', spacing: 8, ledR: 1.9, steps: [{ value: 'low', label: 'low' }, { value: 'high', label: 'high' }] } });
hdr(23.78, 48.5, 'RANGE', 2.2);
items.push({ t: 'radio', id: 'modWave', x: 53.95, y: 34, opts: { orientation: 'h', spacing: 8, ledR: 1.9, steps: [{ value: 'sawtooth', glyph: 'sawtooth' }, { value: 'square', glyph: 'square' }, { value: 'triangle', glyph: 'triangle' }] } });
hdr(53.95, 48.5, 'WAVESHAPE', 2.2);
const dX = 2.5;
K('modFreq', 28.7 + dX, 69.7, 8.046, null, { cap: 6.5, skirt: 12.424, ticks: 0, scale: { marks: evenScale(HZ), size: 1.6 } });
hdr(28.7 + dX, 90, 'FREQUENCY (Hz)', 3.4);
K('modFine', 54.8 + dX, 62.6, 6.98, 'fine');
K('modFmAmount', 15.3 + dX, 98.1, 7.22, 'f.m.'); jp('modFmIn', 15.3 + dX, 114.8);
K('modCvAmount', 54.8 + dX, 98.1, 7.22, 'c.v.'); mark(54.8 + dX, 98.1, 7.22); jp('modCvIn', 54.8 + dX, 114.8);
ij('modPitchIn', 37 + dX, 113.3, '1V/oct');

// ---- Middle: mod index + mod switches + phase lock ----
const sw = (id, y, txt) => {
  items.push({ t: 'button', id, x: 74.4, y, opts: { r: 2.0, kind: 'red' } });
  items.push({ t: 'attachedLabel', x: 74.4, y, hw: 2.0, hh: 2.0, opts: { text: txt, placement: 'right', maxWidth: 7, size: 2.0 } });
};
sw('phaseLock', 16.65, 'phase lock'); sw('amplMod', 28.84, 'ampl mod'); sw('pitchMod', 41.27, 'pitch mod'); sw('timbreMod', 53.69, 'timbre mod');
const dXm = 1.25;
K('modIndex', 78.0 + dXm, 70.8, 7.69, null); mark(78.0 + dXm, 70.8, 7.69);
hdr(78.0 + dXm, 84, 'MOD. INDEX', 2.4);
K('modIndexCvAmount', 78.0 + dXm, 97.7, 7.22, 'c.v.'); jp('modIndexCvIn', 78.0 + dXm, 114.4);

// ---- Principal oscillator ----
hdr(117.7, 12.5, 'PRINCIPAL OSC OUTPUTS', 2.3);
oj('prinSineOut', 104.4, 17.4, 'sine'); oj('prinSquareOut', 117.8, 17.4, 'square'); oj('prinFinalOut', 131, 17.4, 'final');
hdr(114, 35, 'PHASE LOCK', 2.4);
ij('phaseLockIn', 114.5, 43.5, 'input');
K('phaseLockAmount', 132.9, 38.0, 7.45, 'gain');
const dXp = 1.25;
K('prinFreq', 108.3 + dXp, 69.7, 8.046, null, { cap: 6.5, skirt: 12.424, ticks: 0, scale: { marks: evenScale(HZ), size: 1.6 } });
hdr(108.3 + dXp, 90, 'PITCH (Hz)', 3.4);
K('prinFine', 134.4 + dXp, 62.6, 6.98, 'fine');
K('prinFmAmount', 97.7 + dXp, 98.1, 7.22, 'f.m.'); jp('prinFmIn', 97.7 + dXp, 114.8);
K('prinCvAmount', 132.9 + dXp, 98.1, 7.22, 'c.v.'); mark(132.9 + dXp, 98.1, 7.22); jp('prinCvIn', 132.9 + dXp, 114.8);
ij('prinPitchIn', 116.9 + dXp, 113.3, '1V/oct');

// ---- Harmonics (right) ----
const hX = 159;
const kX = hX - 2;
hdr(hX, 12.5, 'HARMONICS', 2.4);
K('symmetry', kX, 28.8, 8.05, null); items.push({ t: 'attachedLabel', x: hX, y: 28.8, hw: 8.05, hh: 8.05, opts: lab('Symmetry') }); jp('symmetryCvIn', 148.5, 39.8);
K('order', kX, 53.7, 8.05, null); items.push({ t: 'attachedLabel', x: hX, y: 53.7, hw: 8.05, hh: 8.05, opts: lab('Order') }); jp('orderCvIn', 148.5, 64.8);
K('timbre', kX, 78.1, 7.45, null); items.push({ t: 'attachedLabel', x: hX, y: 78.1, hw: 7.45, hh: 7.45, opts: lab('TIMBRE') });
K('timbreCvAmount', kX, 100.6, 6.98, null); items.push({ t: 'attachedLabel', x: hX, y: 100.6, hw: 6.98, hh: 6.98, opts: lab('c.v.') }); mark(kX, 100.6, 6.98); jp('timbreCvIn', 148.5, 111.6);

export default { faceW: FACE_W, wrap: false, items };
