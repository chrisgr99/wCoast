// Generator for the Quad Low Pass Gate faceplate — the original lpg-292
// layout rebuilt on the shared faceplate library (panel/*), ~20mm narrower
// (140mm vs 160mm). The per-channel controls are placed so the *visual* white
// space (edge-to-edge, not centre-to-centre) between neighbours is equal: each
// control declares its left/right visual extent and a single gap G is solved to
// fill the row. Row y-positions and the inter-track divider lines follow the
// original.
'use strict';
const fs = require('fs');
const { THEME } = require('../../panel/theme');
const { defs, jack, knob, button, label, evenScale } = require('../../panel/primitives');

const FACE_W = 140, FACE_H = 113.5912;
// The loader's cropToFace() shows only viewBox (3.9, 7.0994)..; the panel body is
// drawn inside a translate(FACE_LEFT, FACE_TOP) group so its frame sits within
// the visible face (top+left border no longer cropped), matching the 259t.
const FACE_LEFT = 3.9, FACE_TOP = 7.0994;
const CH = ['A', 'B', 'C', 'D'];
const ROWY = { A: 16.95, B: 37.65, C: 58.35, D: 79.05 };
const BOT = 98.5;
const DIVLINES = [27.3, 48.0, 68.7, 89.4];   // A|B, B|C, C|D, D|bottom

// Equal visual-gap column layout. eL/eR = each control's visual half-extent to
// the left / right of its anchor (knob+ticks, jack, LED, or LED+side-label).
const seq = [
  { k: 'in', eL: 3, eR: 3 }, { k: 'cv', eL: 3, eR: 3 }, { k: 'trig', eL: 3, eR: 3 },
  { k: 'strike', eL: 2.2, eR: 2.2 },
  { k: 'level', eL: 6.7, eR: 6.7 }, { k: 'decay', eL: 5.9, eR: 5.9 },
  { k: 'mode', eL: 1.9, eR: 7.8 },
  { k: 'div', eL: 7.5, eR: 7.5 }, { k: 'on', eL: 2.0, eR: 2.0 }, { k: 'out', eL: 3, eR: 3 },
];
const X0 = 13, X1 = 135;                       // flow spans first-left-edge .. last-right-edge
const sumW = seq.reduce((s, c) => s + c.eL + c.eR, 0);
const GAP = (X1 - X0 - sumW) / (seq.length - 1);
const X = {}; { let cur = X0; for (const c of seq) { cur += c.eL; X[c.k] = +cur.toFixed(2); cur += c.eR + GAP; } }

function build(dark) {
  const th = THEME[dark ? 'dark' : 'light'];
  const p = [];
  const ink = (x, y, t, o = {}) => p.push(label(x, y, t, { fill: th.ink, ...o }));
  const lab = (text, placement = 'below', size = 1.9) => ({ text, placement, fill: th.ink, size });

  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_W}mm" height="128.5mm" viewBox="0 0 ${FACE_W} 128.5" font-family="Arial Narrow, Helvetica, Arial, sans-serif">`);
  p.push(defs(th));
  p.push(`  <g transform="translate(${FACE_LEFT} ${FACE_TOP})">`);
  p.push(`  <rect x="0" y="0" width="${FACE_W}" height="${FACE_H}" rx="2.5" fill="${th.face}"/>`);
  p.push(`  <rect x="0.5" y="0.5" width="${FACE_W - 1}" height="${FACE_H - 1}" rx="2.2" fill="none" stroke="${th.frame}" stroke-width="0.5"/>`);

  // inter-track dividers
  const line = (y) => `  <line x1="6" y1="${y}" x2="${FACE_W - 6}" y2="${y}" stroke="${th.frame}" stroke-width="0.355"/>`;
  DIVLINES.forEach((y) => p.push(line(y)));

  // vertical column dividers (mode|clock, on|out) placed mid-gap, spanning the
  // four channel rows down to the last track divider.
  const eR = (k) => seq.find((s) => s.k === k).eR, eL = (k) => seq.find((s) => s.k === k).eL;
  const vmid = (a, b) => +(((X[a] + eR(a)) + (X[b] - eL(b))) / 2).toFixed(2);
  const vline = (x) => `  <line x1="${x}" y1="13" x2="${x}" y2="${DIVLINES[3]}" stroke="${th.frame}" stroke-width="0.355"/>`;
  p.push(vline(vmid('mode', 'div')));
  p.push(vline(vmid('on', 'out')));

  // top headers
  ink(X.level, 10, 'LEVEL', { size: 2.4 });
  ink(X.decay, 10, 'DECAY', { size: 2.4 });
  ink(X.mode + 3, 10, 'MODE', { size: 2.4 });
  ink(X.strike, 10, 'STRIKE', { size: 2.4 });
  ink((X.div + X.on) / 2, 10, 'CLOCK', { size: 2.4 });

  // channel rows
  for (const L of CH) {
    const y = ROWY[L];
    ink(8.5, y + 2, L, { size: 5.5, anchor: 'middle' });
    p.push(jack(`in${L}`, X.in, y, { label: lab('IN') }));
    p.push(jack(`cv${L}`, X.cv, y, { label: lab('CV') }));
    p.push(jack(`trig${L}`, X.trig, y, { label: lab('TRIG') }));
    p.push(knob(`level${L}`, X.level, y, { radius: 6.2, theme: th }));
    p.push(knob(`decay${L}`, X.decay, y, { radius: 5.4, theme: th }));
    p.push(button(`vca${L}`, X.mode, y - 2.6, { r: 1.9, kind: 'red' })); ink(X.mode + 3.2, y - 2.6 + 0.9, 'VCA', { size: 1.9, anchor: 'start' });
    p.push(button(`lp${L}`, X.mode, y + 2.6, { r: 1.9, kind: 'red' })); ink(X.mode + 3.2, y + 2.6 + 0.9, 'LP', { size: 1.9, anchor: 'start' });
    p.push(button(`strike${L}`, X.strike, y, { r: 2.2, kind: 'red' }));
    p.push(knob(`div${L}`, X.div, y, { radius: 4.0, theme: th, ticks: 0, scale: { marks: evenScale(['1', '2', '3', '4', '6', '8']), size: 1.5 } }));
    p.push(button(`clkOn${L}`, X.on, y, { r: 2.0, kind: 'red', label: { text: 'CLK ON', placement: 'below', size: 1.8, maxWidth: 4, fill: th.ink } }));
    p.push(jack(`out${L}`, X.out, y, { label: lab('OUT') }));
  }

  // bottom row: clock + sum
  ink(8.5, BOT, 'CLK', { size: 2.2 });
  p.push(knob('rate', 18, BOT, { radius: 4.4, theme: th, label: lab('RATE') }));
  p.push(button('run', 30, BOT, { r: 2.0, kind: 'red', label: { text: 'RUN', placement: 'below', size: 1.8, fill: th.ink } }));
  p.push(jack('clkOut', 41, BOT, { label: lab('CLK OUT') }));
  ink(72, BOT - 0.6, 'three ways to strike:', { size: 1.9 });
  ink(72, BOT + 2.4, 'button · external · clock', { size: 1.9 });
  ink(96, BOT, 'SUM', { size: 2.2 });
  p.push(jack('mixOdd', 112, BOT, { label: lab('ODD A C') }));
  p.push(jack('mixEven', 126, BOT, { label: lab('EVEN B D') }));

  p.push(`  </g>`);
  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

fs.writeFileSync(__dirname + '/panel.svg', build(false));
fs.writeFileSync(__dirname + '/panel.dark.svg', build(true));
console.log('wrote panel.svg + panel.dark.svg  (gap=' + GAP.toFixed(2) + 'mm)');
