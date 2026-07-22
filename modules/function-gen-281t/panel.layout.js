// panel.layout.js — the Quad Function Generator faceplate as data (panel editor, Phase 1).
//
// The theme-independent item list the shared renderer (panel/render.js) turns into
// panel.svg + panel.dark.svg. Lifted from the old gen-panel.js; the redundant top
// title (the vertical left-edge title suffices) is dropped, matching the shipped panel.

'use strict';

import { evenScale } from '../../panel/primitives.js';

const CH = ['A', 'B', 'C', 'D'];
const FACE_W = 99, FACE_H = 113.5912, FACE_LEFT = 3.9, FACE_TOP = 7.0994;
const COL_TRIG = 10, COL_CYCLE = 19, COL_ACV = 29, COL_ATK = 40, COL_DCV = 51, COL_DEC = 62, COL_OUT = 74, COL_LED = 80;
const DIVIDER_X = 83, Q_KNOB_X = 91;
const Y_RULE = 9, ROW_Y = [21.5, 46.5, 71.5, 96.5], ROW_DIV = [34, 59, 84], Y_BOTTOM = 109;
const TIME_SCALE = ['.001', '.03', '.3', '10'];

const items = [];
const ink = (x, y, text, size) => items.push({ t: 'label', x, y, text, opts: { size } });
const line = (x1, y, x2) => items.push({ t: 'line', x1, y1: y, x2, y2: y, w: 0.355 });

// face + frame
items.push({ t: 'rect', x: 0, y: 0, w: FACE_W, h: FACE_H, rx: 2.5, fill: 'face' });
items.push({ t: 'rect', x: 0.5, y: 0.5, w: FACE_W - 1, h: FACE_H - 1, rx: 2.2, fill: 'none', stroke: 'frame', sw: 0.5 });

// interior grid (no top title)
line(3, Y_RULE, FACE_W - 3);
line(3, ROW_DIV[0], DIVIDER_X); line(3, ROW_DIV[1], FACE_W - 3); line(3, ROW_DIV[2], DIVIDER_X); line(3, Y_BOTTOM, FACE_W - 3);
items.push({ t: 'line', x1: DIVIDER_X, y1: Y_RULE, x2: DIVIDER_X, y2: Y_BOTTOM, w: 0.355 });

// channel rows
const MODE = [{ value: 'transient', glyph: 'transient' }, { value: 'sustained', glyph: 'sustained' }, { value: 'cyclic', glyph: 'cyclic' }];
for (let ci = 0; ci < CH.length; ci++) {
  const L = CH[ci], cy = ROW_Y[ci];
  items.push({ t: 'jack', id: `trig${L}`, x: COL_TRIG, y: cy - 5 });
  ink(COL_TRIG, cy + 1.2, 'trig', 2.1);
  items.push({ t: 'button', id: `trigBtn${L}`, x: COL_TRIG, y: cy + 6.5, opts: { r: 2.2, kind: 'white' } });
  items.push({ t: 'jack', id: `cycleIn${L}`, x: COL_CYCLE, y: cy - 5 });
  ink(COL_CYCLE, cy - 0.3, 'cycle', 2.0);
  items.push({ t: 'radio', id: `mode${L}`, x: COL_CYCLE, y: cy + 4, opts: { orientation: 'h', spacing: 4.2, ledR: 1.3, steps: MODE } });
  items.push({ t: 'jack', id: `attackCv${L}`, x: COL_ACV, y: cy - 1.5 });
  ink(COL_ACV, cy + 4.5, 'c.v. in', 2.4);
  items.push({ t: 'knob', id: `attack${L}`, x: COL_ATK, y: cy - 1, opts: { radius: 4.6, scale: { marks: evenScale(TIME_SCALE), size: 2.0 } } });
  ink(COL_ATK, cy + 11, 'attack', 2.2);
  items.push({ t: 'jack', id: `decayCv${L}`, x: COL_DCV, y: cy - 1.5 });
  ink(COL_DCV, cy + 4.5, 'c.v. in', 2.4);
  items.push({ t: 'knob', id: `decay${L}`, x: COL_DEC, y: cy - 1, opts: { radius: 4.6, scale: { marks: evenScale(TIME_SCALE), size: 2.0 } } });
  ink(COL_DEC, cy + 11, 'decay', 2.2);
  ink(COL_OUT, cy - 9, 'pulse out', 2.1);
  items.push({ t: 'jack', id: `pulse${L}`, x: COL_OUT, y: cy - 5 });
  items.push({ t: 'jack', id: `fn${L}`, x: COL_OUT, y: cy + 5 });
  ink(COL_OUT, cy + 9.7, 'CV out', 2.1);
  items.push({ t: 'indLed', x: COL_LED, y: cy - 5, color: 'ledRed' });
  items.push({ t: 'indLed', x: COL_LED, y: cy + 5, color: '#1f7fe0' });
}

// quadrature bands: A-B and C-D
function quadRegion(knobId, portId, enId, cy, nm) {
  const [up, dn] = nm.split('-');
  items.push({ t: 'label', x: Q_KNOB_X, y: cy - 18, text: 'QUAD- RATURE', opts: { size: 2.0, maxWidth: 9 } });
  items.push({ t: 'button', id: enId, x: Q_KNOB_X, y: cy - 9.25, opts: { r: 1.65, kind: 'red' } });
  ink(Q_KNOB_X, cy - 12, 'on', 1.9);
  items.push({ t: 'knob', id: knobId, x: Q_KNOB_X, y: cy, opts: { radius: 6.4, angleMin: -215, angleMax: 35, ticks: 11 } });
  ink(Q_KNOB_X - 6.5, cy - 5.1, up, 2.6);
  ink(Q_KNOB_X - 6.5, cy + 6.9, dn, 2.6);
  ink(Q_KNOB_X, cy + 9.5, 'mix', 2.0);
  items.push({ t: 'jack', id: portId, x: Q_KNOB_X, y: cy + 15 });
  ink(Q_KNOB_X, cy + 20.5, `${nm} out`, 2.0);
}
quadRegion('quadTimeAB', 'quadOutAB', 'quadEnAB', 34, 'A-B');
quadRegion('quadTimeCD', 'quadOutCD', 'quadEnCD', 84, 'C-D');

export default { faceW: FACE_W, faceH: FACE_H, faceLeft: FACE_LEFT, faceTop: FACE_TOP, wrap: true, items };
