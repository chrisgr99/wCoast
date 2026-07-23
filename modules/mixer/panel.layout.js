// panel.layout.js — the Mixer / Output faceplate as data (panel editor, Phase 1).
//
// The theme-independent item list the shared renderer (panel/render.js) turns into
// panel.svg + panel.dark.svg. Reconstructed from the shipped panel (which had been
// hand-edited past its old generator): six channels, plus the master section — a
// Monitor and a Master fader, their two bus-enable lamps, and two VU meters.

'use strict';

const CH = ['A', 'B', 'C', 'D', 'E', 'F'];
const VCPAN = { A: 'panCvA', F: 'panCvF' };

const FACE_W = 114, FACE_H = 113.5912, FACE_LEFT = 3.9, FACE_TOP = 7.0994;
const CH_X = { A: 15.5, B: 28.5, C: 41.5, D: 54.5, E: 67.5, F: 80.5 };
const MON_X = 95.5, MSTR_X = 108, ENGINE_X = 101.75, ROW_LABEL_X = 11.5;
const Y_CHAN_LABEL = 9, Y_INPUT = 15, Y_LINE_IF = 21, SLIDER_TOP = 24, SLIDER_BOT = 78;
const Y_LINE_FC = 81, Y_AMPCV = 86, Y_LINE_CE = 90.5, Y_MUTE = 94, Y_LINE_EP = 98, Y_PAN = 105;

const items = [];
const ink = (x, y, text, opts = {}) => items.push({ t: 'label', x, y, text, opts });
const vu = (role, cx, chan) => items.push({ t: 'vu', role, x: cx - 6, y: SLIDER_BOT, opts: { length: SLIDER_BOT - SLIDER_TOP, orientation: 'v', segments: 12, chan, thick: 1.0, label: '' } });

// face + frame
items.push({ t: 'rect', x: 0, y: 0, w: FACE_W, h: FACE_H, rx: 2.5, fill: 'face' });
items.push({ t: 'rect', x: 0.5, y: 0.5, w: FACE_W - 1, h: FACE_H - 1, rx: 2.2, fill: 'none', stroke: 'frame', sw: 0.5 });

// column headers: A-F over the inputs, plus MON / MSTR over the master faders
for (const L of CH) ink(CH_X[L], Y_CHAN_LABEL, L, { size: 2.6 });
ink(MON_X, Y_INPUT + 1.5, 'MON', { size: 2.1 });
ink(MSTR_X, Y_INPUT + 1.5, 'MSTR', { size: 2.1 });

// pan row
for (const L of CH) {
  if (VCPAN[L]) items.push({ t: 'jack', id: VCPAN[L], x: CH_X[L], y: Y_PAN });
  else items.push({ t: 'knob', id: `pan${L}`, x: CH_X[L], y: Y_PAN, opts: { radius: 4.2, cap: 3.3 } });
}

// left-margin row labels, right-aligned
const rowLabel = (y, t) => ink(ROW_LABEL_X, y, t, { size: 2.5, anchor: 'end' });
rowLabel(Y_INPUT + 1.5, 'INPUTS'); rowLabel(Y_AMPCV - 0.5, 'AMP'); rowLabel(Y_AMPCV + 2.3, 'CV IN'); rowLabel(Y_MUTE + 1, 'ENABLE'); rowLabel(Y_PAN + 1, 'PAN');

// section dividers (the lower two stop before the master section) + per-fader separators
items.push({ t: 'line', x1: 3, y1: Y_LINE_IF, x2: FACE_W - 3, y2: Y_LINE_IF, w: 0.355 });
items.push({ t: 'line', x1: 3, y1: Y_LINE_FC, x2: FACE_W - 3, y2: Y_LINE_FC, w: 0.355 });
items.push({ t: 'line', x1: 3, y1: Y_LINE_CE, x2: 85, y2: Y_LINE_CE, w: 0.355 });
items.push({ t: 'line', x1: 3, y1: Y_LINE_EP, x2: 85, y2: Y_LINE_EP, w: 0.355 });
const sepMid = (SLIDER_TOP + SLIDER_BOT) / 2, sepHalf = (SLIDER_BOT - SLIDER_TOP) / 3;
for (const L of CH) items.push({ t: 'line', x1: CH_X[L] + 5, y1: (sepMid - sepHalf).toFixed(2), x2: CH_X[L] + 5, y2: (sepMid + sepHalf).toFixed(2), w: 0.25 });

// channel strips
for (const L of CH) {
  items.push({ t: 'jack', id: `chan${L}`, x: CH_X[L], y: Y_INPUT });
  items.push({ t: 'slider', id: `level${L}`, x: CH_X[L], opts: { top: SLIDER_TOP, bot: SLIDER_BOT, valuePos: 0.8 } });
  items.push({ t: 'jack', id: `ampCv${L}`, x: CH_X[L], y: Y_AMPCV });
  items.push({ t: 'button', id: `mute${L}`, x: CH_X[L], y: Y_MUTE, opts: { r: 1.8, kind: 'red' } });
  vu('vu', CH_X[L], L);
}

// master section: Monitor + Master faders, their two bus-enable lamps, VU meters
items.push({ t: 'slider', id: 'monitorLevel', x: MON_X, opts: { top: SLIDER_TOP, bot: SLIDER_BOT, valuePos: 0.7 } });
items.push({ t: 'slider', id: 'master', x: MSTR_X, opts: { top: SLIDER_TOP, bot: SLIDER_BOT, valuePos: 0.7 } });
ink(MON_X, Y_AMPCV - 1.5, 'MON', { size: 1.694 });
ink(MSTR_X, Y_AMPCV - 1.5, 'MSTR', { size: 1.694 });
items.push({ t: 'button', id: 'monitorEnable', x: MON_X, y: 88, opts: { r: 1.8, kind: 'red' } });
items.push({ t: 'button', id: 'masterEnable', x: MSTR_X, y: 88, opts: { r: 1.8, kind: 'red' } });
vu('vuMonitor', MON_X, 'MON');
vu('vuMaster', MSTR_X, 'M');

export default { faceW: FACE_W, faceH: FACE_H, faceLeft: FACE_LEFT, faceTop: FACE_TOP, wrap: true, items };
