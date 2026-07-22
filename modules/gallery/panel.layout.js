// panel.layout.js — the Control Gallery faceplate as data (panel editor, Phase 1).
//
// Display-only test bench for the control primitives. Lifted from the old
// gen-panel.js; one label was trimmed ("259t frequency…" -> "frequency…") to match
// the shipped panel. The wrap group is unindented here, as the original emitted it.

'use strict';

import { evenScale } from '../../panel/primitives.js';

const FACE_W = 270, FACE_H = 113.5912, MID = 104, MID2 = 160, MID3 = 230;
const FAMILIES = ['audio', 'cv', 'trig', 'pitch'];
const HZ = [['27.5', 'A1'], ['55', 'A2'], ['110', 'A3'], ['220', 'A4'], ['440', 'A5'], ['880', 'A6'], ['1760', 'A7'], ['3520', 'A8'], ['7040', 'A9']];

const items = [];
const ink = (x, y, text, opts = {}) => items.push({ t: 'label', x, y, text, opts });
const cap = (text, placement = 'below', size = 2.2) => ({ text, placement, size });
const vline = (x) => items.push({ t: 'line', x1: x, y1: 11, x2: x, y2: 111, w: 0.355 });

// face + frame + header
items.push({ t: 'rect', x: 0, y: 0, w: FACE_W, h: FACE_H, rx: 2.5, fill: 'face' });
items.push({ t: 'rect', x: 0.5, y: 0.5, w: FACE_W - 1, h: FACE_H - 1, rx: 2.2, fill: 'none', stroke: 'frame', sw: 0.5 });
ink(FACE_W / 2, 6, 'CONTROL GALLERY', { size: 3.4 });
items.push({ t: 'line', x1: 3, y1: 9, x2: FACE_W - 3, y2: 9, w: 0.355 });
vline(MID); vline(MID2); vline(MID3);

// === LEFT COLUMN: jacks + labels ===
ink(52, 15.5, 'jack — family colour + direction ring', { size: 2.4 });
const x0 = 18, dx = 22, yIn = 27, yOut = 49;
FAMILIES.forEach((f, i) => {
  const x = x0 + i * dx;
  items.push({ t: 'jack', id: `${f}In`, x, y: yIn }); ink(x, yIn + 6.5, `${f} in`);
  items.push({ t: 'jack', id: `${f}Out`, x, y: yOut }); ink(x, yOut + 6.5, `${f} out`);
});

items.push({ t: 'line', x1: 3, y1: 59, x2: MID - 3, y2: 59, w: 0.355 });
ink(52, 64, 'label — wraps to fit, attaches on any side', { size: 2.4 });
const guide = (cx, w) => items.push({ t: 'rect', x: (cx - w / 2).toFixed(2), y: 68, w, h: 11, rx: 0.8, fill: 'none', stroke: 'frame', sw: 0.2, dash: '0.8 0.8' });
guide(26, 32); ink(26, 73, 'phase lock', { size: 2.8, maxWidth: 29 }); ink(26, 84, 'free · room → one line', { size: 2.0 });
guide(78, 13); ink(78, 73, 'phase lock', { size: 2.8, maxWidth: 10 }); ink(78, 84, 'free · tight → wraps', { size: 2.0 });
const py = 100;
items.push({ t: 'jack', id: 'labelBelow', x: 18, y: py, opts: { label: cap('below') } });
items.push({ t: 'jack', id: 'labelAbove', x: 42, y: py, opts: { label: cap('above', 'above') } });
items.push({ t: 'jack', id: 'labelLeft', x: 66, y: py, opts: { label: cap('left', 'left') } });
items.push({ t: 'jack', id: 'labelRight', x: 90, y: py, opts: { label: cap('right', 'right') } });
ink(52, 112, 'attached · below · above · left · right', { size: 2.0 });

// === RIGHT COLUMN: knobs ===
ink(130, 15.5, 'knob — size · sweep · ticks · skirt · scale', { size: 2.2 });
items.push({ t: 'knob', id: 'knobSmall', x: 114, y: 26, opts: { radius: 4.2, label: cap('r 4.2') } });
items.push({ t: 'knob', id: 'knobMedium', x: 132, y: 26, opts: { radius: 6.4, label: cap('r 6.4') } });
items.push({ t: 'knob', id: 'knobLarge', x: 150, y: 26, opts: { radius: 7.0, label: cap('r 7') } });
items.push({ t: 'knob', id: 'knobDiv', x: 118, y: 52, opts: { radius: 6.0, angleMin: -135, angleMax: 135, label: cap('±135°') } });
items.push({ t: 'bipolarMark', x: 118, y: 52, r: 6.0 });
items.push({ t: 'knob', id: 'knobBare', x: 146, y: 52, opts: { radius: 6.0, ticks: 0, label: cap('ticks off') } });
items.push({ t: 'knob', id: 'knobSkirt', x: 130, y: 86, opts: { radius: 7.0, cap: 5.5, skirt: 11.0, ticks: 0, scale: { marks: evenScale(HZ), size: 1.5 } } });
ink(130, 110, 'frequency · calibration scale', { size: 2.0 });

// === THIRD COLUMN: radio · button · slider ===
ink(192, 15.5, 'radio · button · slider', { size: 2.4 });
items.push({ t: 'radio', id: 'radioMode', x: 184, y: 26, opts: { orientation: 'h', spacing: 6, steps: [{ value: 'transient', glyph: 'transient' }, { value: 'sustained', glyph: 'sustained' }, { value: 'cyclic', glyph: 'cyclic' }] } });
ink(184, 36, 'radio · horizontal + glyphs', { size: 1.9 });
items.push({ t: 'radio', id: 'radioRange', x: 170, y: 48, opts: { orientation: 'v', spacing: 5.2, steps: [{ value: 'low', label: 'low' }, { value: 'high', label: 'high' }] } });
ink(170, 59, 'radio · vertical', { size: 1.9 });
items.push({ t: 'button', id: 'btnStrike', x: 192, y: 44, opts: { r: 2.4, kind: 'white' } }); ink(192, 49.5, 'strike', { size: 1.8 });
items.push({ t: 'button', id: 'btnTrig', x: 210, y: 44, opts: { r: 2.4, kind: 'white' } }); ink(210, 49.5, 'trig', { size: 1.8 });
items.push({ t: 'button', id: 'btnToggle', x: 192, y: 60, opts: { r: 2.4, kind: 'white' } }); ink(192, 65.5, 'toggle', { size: 1.8 });
items.push({ t: 'button', id: 'btnOn', x: 210, y: 60, opts: { r: 2.16, kind: 'red' } }); ink(210, 65, 'on', { size: 1.8 });
ink(201, 73, 'momentary (strike/trig) · toggle · lamp', { size: 1.8 });
items.push({ t: 'stepButton', id: 'stepWave', x: 178, y: 84, opts: { orientation: 'v', steps: [{ value: 'sawtooth', glyph: 'sawtooth' }, { value: 'square', glyph: 'square' }, { value: 'triangle', glyph: 'triangle' }, { value: 'sustained', glyph: 'sustained' }] } });
ink(178, 98, 'stepper · button above · glyphs', { size: 1.7 });
items.push({ t: 'stepButton', id: 'stepRange', x: 165, y: 106, opts: { orientation: 'h', steps: [{ value: 'lo', label: 'lo' }, { value: 'mid', label: 'mid' }, { value: 'hi', label: 'hi' }] } });
ink(178, 112, 'stepper · button left · text', { size: 1.7 });
items.push({ t: 'slider', id: 'sliderLevel', x: 222, opts: { top: 30, bot: 84, valuePos: 0.7 } });
ink(222, 90, 'slider', { size: 2.0 });

// === FOURTH COLUMN: VU meters ===
ink(250, 15.5, 'VU meter · length · count · v/h', { size: 2.2 });
items.push({ t: 'vu', role: 'vu', x: 243, y: 78, opts: { length: 42, orientation: 'v', segments: 12, chan: 'A', lit: 8 } });
items.push({ t: 'vu', role: 'vu', x: 237, y: 98, opts: { length: 26, orientation: 'h', segments: 9, chan: 'B', lit: 5 } });

export default { faceW: FACE_W, faceH: FACE_H, faceLeft: 0, faceTop: 7.0994, wrap: true, wrapIndent: '', items };
