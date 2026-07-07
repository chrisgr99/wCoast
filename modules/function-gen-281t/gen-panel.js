// Generator for the Quad Function Generator faceplate — the original 281t
// layout rebuilt on the shared faceplate library (panel/*). Same 98mm size,
// control positions, and interior grid as the original; every control now comes
// from the canonical primitives (the original 281t carried its own inline copies,
// even though the library primitives were first extracted from it). The original
// function-gen-281t stays registered for comparison.
'use strict';
const fs = require('fs');
const { THEME } = require('../../panel/theme');
const { defs, jack, knob, button, radioGroup, label, evenScale } = require('../../panel/primitives');

const CH = ['A', 'B', 'C', 'D'];
const FACE_W = 99, FACE_H = 113.5912, FACE_LEFT = 3.9, FACE_TOP = 7.0994;

const COL_TRIG = 10, COL_CYCLE = 19, COL_ACV = 29, COL_ATK = 40,
  COL_DCV = 51, COL_DEC = 62, COL_OUT = 74, COL_LED = 80;   // attack-CV col rightward shifted +1mm to clear the mode radio
const DIVIDER_X = 83;
const Q_KNOB_X = 91;

const Y_TITLE = 5.5, Y_RULE = 9;
const ROW_Y = [21.5, 46.5, 71.5, 96.5];
const ROW_DIV = [34, 59, 84];
const Y_BOTTOM = 109;
const TIME_SCALE = ['.001', '.03', '.3', '10'];   // exp time-knob calibration, min→max

function build(dark) {
  const th = THEME[dark ? 'dark' : 'light'];
  const p = [];
  const ink = (x, y, t, size, anchor = 'middle') => p.push(label(x, y, t, { size, fill: th.ink, anchor }));
  const indLed = (cx, cy, colour) => p.push(`  <circle cx="${cx}" cy="${cy}" r="1.15" fill="${colour}" stroke="#00000055" stroke-width="0.2" filter="url(#softShadow)"/>`);

  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_W}mm" height="128.5mm" viewBox="0 0 ${FACE_W} 128.5" font-family="Arial Narrow, Helvetica, Arial, sans-serif">`);
  p.push(defs(th));
  p.push(`  <g transform="translate(${FACE_LEFT} ${FACE_TOP})">`);
  p.push(`  <rect x="0" y="0" width="${FACE_W}" height="${FACE_H}" rx="2.5" fill="${th.face}"/>`);
  p.push(`  <rect x="0.5" y="0.5" width="${FACE_W - 1}" height="${FACE_H - 1}" rx="2.2" fill="none" stroke="${th.frame}" stroke-width="0.5"/>`);

  // title + interior grid
  ink(FACE_W / 2, Y_TITLE, 'QUAD FUNCTION GENERATOR 281t', 3.4);
  const hline = (y, x1 = 3, x2 = FACE_W - 3) => p.push(`  <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${th.frame}" stroke-width="0.355"/>`);
  hline(Y_RULE);
  hline(ROW_DIV[0], 3, DIVIDER_X); hline(ROW_DIV[1]); hline(ROW_DIV[2], 3, DIVIDER_X); hline(Y_BOTTOM);
  p.push(`  <line x1="${DIVIDER_X}" y1="${Y_RULE}" x2="${DIVIDER_X}" y2="${Y_BOTTOM}" stroke="${th.frame}" stroke-width="0.355"/>`);

  // channel rows
  const MODE = [{ value: 'transient', glyph: 'transient' }, { value: 'sustained', glyph: 'sustained' }, { value: 'cyclic', glyph: 'cyclic' }];
  for (let ci = 0; ci < CH.length; ci++) {
    const L = CH[ci], cy = ROW_Y[ci];
    p.push(jack(`trig${L}`, COL_TRIG, cy - 5, {}));
    ink(COL_TRIG, cy + 1.2, 'trig', 2.1);
    p.push(button(`trigBtn${L}`, COL_TRIG, cy + 6.5, { r: 2.2, kind: 'white' }));
    p.push(jack(`cycleIn${L}`, COL_CYCLE, cy - 5, {}));
    ink(COL_CYCLE, cy - 0.3, 'cycle', 2.0);
    p.push(radioGroup(`mode${L}`, COL_CYCLE, cy + 4, { orientation: 'h', spacing: 4.2, ledR: 1.3, theme: th, steps: MODE }));
    p.push(jack(`attackCv${L}`, COL_ACV, cy - 1.5, {}));
    ink(COL_ACV, cy + 4.5, 'c.v. in', 2.4);
    p.push(knob(`attack${L}`, COL_ATK, cy - 1, { radius: 4.6, theme: th, scale: { marks: evenScale(TIME_SCALE), size: 2.0 } }));
    ink(COL_ATK, cy + 11, 'attack', 2.2);
    p.push(jack(`decayCv${L}`, COL_DCV, cy - 1.5, {}));
    ink(COL_DCV, cy + 4.5, 'c.v. in', 2.4);
    p.push(knob(`decay${L}`, COL_DEC, cy - 1, { radius: 4.6, theme: th, scale: { marks: evenScale(TIME_SCALE), size: 2.0 } }));
    ink(COL_DEC, cy + 11, 'decay', 2.2);
    ink(COL_OUT, cy - 9, 'pulse out', 2.1);
    p.push(jack(`pulse${L}`, COL_OUT, cy - 5, {}));
    p.push(jack(`fn${L}`, COL_OUT, cy + 5, {}));
    ink(COL_OUT, cy + 9.7, 'CV out', 2.1);
    indLed(COL_LED, cy - 5, dark ? '#d33' : '#c00');
    indLed(COL_LED, cy + 5, '#1f7fe0');
  }

  // quadrature band: A-B and C-D regions
  const quadRegion = (knobId, portId, enId, cy, nm) => {
    const [up, dn] = nm.split('-');
    p.push(label(Q_KNOB_X, cy - 18, 'QUAD- RATURE', { size: 2.0, fill: th.ink, maxWidth: 9 }));
    p.push(button(enId, Q_KNOB_X, cy - 9.25, { r: 1.65, kind: 'red' }));
    ink(Q_KNOB_X, cy - 12, 'on', 1.9);
    p.push(knob(knobId, Q_KNOB_X, cy, { radius: 6.4, angleMin: -215, angleMax: 35, ticks: 11, theme: th }));
    ink(Q_KNOB_X - 6.5, cy - 5.1, up, 2.6);
    ink(Q_KNOB_X - 6.5, cy + 6.9, dn, 2.6);
    ink(Q_KNOB_X, cy + 9.5, 'mix', 2.0);
    p.push(jack(portId, Q_KNOB_X, cy + 15, {}));
    ink(Q_KNOB_X, cy + 20.5, `${nm} out`, 2.0);
  };
  quadRegion('quadTimeAB', 'quadOutAB', 'quadEnAB', 34, 'A-B');
  quadRegion('quadTimeCD', 'quadOutCD', 'quadEnCD', 84, 'C-D');

  p.push(`  </g>`);
  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

fs.writeFileSync(__dirname + '/panel.svg', build(false));
fs.writeFileSync(__dirname + '/panel.dark.svg', build(true));
console.log('wrote panel.svg + panel.dark.svg');
