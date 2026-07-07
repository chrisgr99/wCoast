// Generator for the Mixer v2 faceplate — the original mixer layout rebuilt on the
// shared faceplate library (panel/*). Same 103mm size, same control positions and
// section grid as the original; every control now comes from the canonical
// primitives (the original mixer carried its own inline copies). The original
// mixer stays registered for comparison.
'use strict';
const fs = require('fs');
const { THEME } = require('../../panel/theme');
const { defs, jack, knob, slider, button, vuMeter, label } = require('../../panel/primitives');

const CH = ['A', 'B', 'C', 'D', 'E', 'F'];
const VCPAN = { A: 'panCvA', F: 'panCvF' };     // outer channels: pan-CV jack, no knob

const FACE_W = 103, FACE_H = 113.5912, FACE_LEFT = 3.9, FACE_TOP = 7.0994;
const CH_X = { A: 15.5, B: 28.5, C: 41.5, D: 54.5, E: 67.5, F: 80.5 };   // 13mm pitch
const MASTER_X = 95.5;
const ROW_LABEL_X = 11.5;

const Y_CHAN_LABEL = 9;           // A-F letters + MASTER, at the top
const Y_INPUT = 15;               // audio input jacks
const Y_LINE_IF = 21;             // input | fader divider
const SLIDER_TOP = 24, SLIDER_BOT = 78;
const Y_LINE_FC = 81;             // fader | amp-CV divider
const Y_AMPCV = 86;              // amp-CV (gain) input jacks
const Y_LINE_CE = 90.5;          // amp-CV | enable divider
const Y_MUTE = 94;               // enable lamp (lit = enabled)
const Y_LINE_EP = 98;            // enable | pan divider
const Y_PAN = 105;               // pan knobs / outer pan-CV jacks

function build(dark) {
  const th = THEME[dark ? 'dark' : 'light'];
  const p = [];
  const ink = (x, y, t, o = {}) => p.push(label(x, y, t, { fill: th.ink, ...o }));
  const vu = (role, cx, chan) => p.push(vuMeter(role, cx - 6, SLIDER_BOT, { length: SLIDER_BOT - SLIDER_TOP, orientation: 'v', segments: 12, chan, thick: 1.0, label: '', theme: th }));

  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_W}mm" height="128.5mm" viewBox="0 0 ${FACE_W} 128.5" font-family="Arial Narrow, Helvetica, Arial, sans-serif">`);
  p.push(defs(th));
  p.push(`  <g transform="translate(${FACE_LEFT} ${FACE_TOP})">`);
  p.push(`  <rect x="0" y="0" width="${FACE_W}" height="${FACE_H}" rx="2.5" fill="${th.face}"/>`);
  p.push(`  <rect x="0.5" y="0.5" width="${FACE_W - 1}" height="${FACE_H - 1}" rx="2.2" fill="none" stroke="${th.frame}" stroke-width="0.5"/>`);

  // column headers: A-F over the inputs, plus MASTER
  for (const L of CH) ink(CH_X[L], Y_CHAN_LABEL, L, { size: 2.6 });
  ink(MASTER_X - 2, Y_INPUT + 1.5, 'MASTER', { size: 2.6 });   // no input jack — sit on the INPUT row instead

  // pan row (bottom): knobs for inner channels, a pan-CV jack for A and F
  for (const L of CH) {
    if (VCPAN[L]) p.push(jack(VCPAN[L], CH_X[L], Y_PAN, {}));
    else p.push(knob(`pan${L}`, CH_X[L], Y_PAN, { radius: 4.2, cap: 3.3, theme: th }));
  }

  // left-margin row labels, right-aligned before channel A
  const rowLabel = (y, t) => ink(ROW_LABEL_X, y, t, { size: 2.5, anchor: 'end' });
  rowLabel(Y_INPUT + 1.5, 'INPUTS'); rowLabel(Y_AMPCV - 0.5, 'AMP'); rowLabel(Y_AMPCV + 2.3, 'CV IN'); rowLabel(Y_MUTE + 1, 'ENABLE'); rowLabel(Y_PAN + 1, 'PAN');

  // section dividers + per-fader separators
  const hdiv = (y) => p.push(`  <line x1="3" y1="${y}" x2="${FACE_W - 3}" y2="${y}" stroke="${th.frame}" stroke-width="0.355"/>`);
  hdiv(Y_LINE_IF); hdiv(Y_LINE_FC); hdiv(Y_LINE_CE); hdiv(Y_LINE_EP);
  const sepMid = (SLIDER_TOP + SLIDER_BOT) / 2, sepHalf = (SLIDER_BOT - SLIDER_TOP) / 3;
  for (const L of CH) p.push(`  <line x1="${CH_X[L] + 5}" y1="${(sepMid - sepHalf).toFixed(2)}" x2="${CH_X[L] + 5}" y2="${(sepMid + sepHalf).toFixed(2)}" stroke="${th.frame}" stroke-width="0.25"/>`);

  // channel strips: input jack, fader + VU, amp-CV jack, enable lamp
  for (const L of CH) {
    const cx = CH_X[L];
    p.push(jack(`chan${L}`, cx, Y_INPUT, {}));
    p.push(slider(`level${L}`, cx, { top: SLIDER_TOP, bot: SLIDER_BOT, valuePos: 0.8, theme: th }));
    p.push(jack(`ampCv${L}`, cx, Y_AMPCV, {}));
    p.push(button(`mute${L}`, cx, Y_MUTE, { r: 1.8, kind: 'red' }));
    vu('vu', cx, L);
  }

  // master strip (no audio input, no pan)
  p.push(slider('master', MASTER_X, { top: SLIDER_TOP, bot: SLIDER_BOT, valuePos: 0.7, theme: th }));
  p.push(jack('ampCvMaster', MASTER_X, Y_AMPCV, {}));
  p.push(button('masterMute', MASTER_X, Y_MUTE, { r: 1.8, kind: 'red' }));
  vu('vuMaster', MASTER_X, 'M');

  p.push(`  </g>`);
  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

fs.writeFileSync(__dirname + '/panel.svg', build(false));
fs.writeFileSync(__dirname + '/panel.dark.svg', build(true));
console.log('wrote mixer-v2 panel.svg + panel.dark.svg');
