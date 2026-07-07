// Generator for the Control Gallery faceplate. Lays out the canonical control
// primitives from panel/* so the running app previews them through the real
// loader. Two columns: jacks + labels on the left, knobs on the right. Grows a
// control at a time.
'use strict';
const fs = require('fs');
const { THEME } = require('../../panel/theme');
const { defs, jack, knob, label, evenScale, bipolarMark, radioGroup, button, slider, vuMeter } = require('../../panel/primitives');

const FACE_W = 270, FACE_H = 113.5912, MID = 104, MID2 = 160, MID3 = 230;
const FAMILIES = ['audio', 'cv', 'trig', 'pitch'];

function build(dark) {
  const th = THEME[dark ? 'dark' : 'light'];
  const ink = (x, y, txt, opts = {}) => label(x, y, txt, { fill: th.ink, ...opts });
  const cap = (text, placement = 'below', size = 2.2) => ({ text, placement, fill: th.ink, size });
  const p = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_W}mm" height="128.5mm" viewBox="0 0 ${FACE_W} 128.5" font-family="Arial Narrow, Helvetica, Arial, sans-serif">`);
  p.push(defs(th));
  p.push(`<g transform="translate(0 7.0994)">`);
  p.push(`  <rect x="0" y="0" width="${FACE_W}" height="${FACE_H}" rx="2.5" fill="${th.face}"/>`);
  p.push(`  <rect x="0.5" y="0.5" width="${FACE_W - 1}" height="${FACE_H - 1}" rx="2.2" fill="none" stroke="${th.frame}" stroke-width="0.5"/>`);
  p.push(ink(FACE_W / 2, 6, 'CONTROL GALLERY', { size: 3.4 }));
  p.push(`  <line x1="3" y1="9" x2="${FACE_W - 3}" y2="9" stroke="${th.frame}" stroke-width="0.355"/>`);
  p.push(`  <line x1="${MID}" y1="11" x2="${MID}" y2="111" stroke="${th.frame}" stroke-width="0.355"/>`);
  p.push(`  <line x1="${MID2}" y1="11" x2="${MID2}" y2="111" stroke="${th.frame}" stroke-width="0.355"/>`);
  p.push(`  <line x1="${MID3}" y1="11" x2="${MID3}" y2="111" stroke="${th.frame}" stroke-width="0.355"/>`);

  // === LEFT COLUMN: jacks + labels ===
  p.push(ink(52, 15.5, 'jack — family colour + direction ring', { size: 2.4 }));
  const x0 = 18, dx = 22, yIn = 27, yOut = 49;
  FAMILIES.forEach((f, i) => {
    const x = x0 + i * dx;
    p.push(jack(`${f}In`, x, yIn)); p.push(ink(x, yIn + 6.5, `${f} in`));
    p.push(jack(`${f}Out`, x, yOut)); p.push(ink(x, yOut + 6.5, `${f} out`));
  });

  p.push(`  <line x1="3" y1="59" x2="${MID - 3}" y2="59" stroke="${th.frame}" stroke-width="0.355"/>`);
  p.push(ink(52, 64, 'label — wraps to fit, attaches on any side', { size: 2.4 }));
  const guide = (cx, w) => `  <rect x="${(cx - w / 2).toFixed(2)}" y="68" width="${w}" height="11" rx="0.8" fill="none" stroke="${th.frame}" stroke-width="0.2" stroke-dasharray="0.8 0.8"/>`;
  p.push(guide(26, 32)); p.push(ink(26, 73, 'phase lock', { size: 2.8, maxWidth: 29 })); p.push(ink(26, 84, 'free · room → one line', { size: 2.0 }));
  p.push(guide(78, 13)); p.push(ink(78, 73, 'phase lock', { size: 2.8, maxWidth: 10 })); p.push(ink(78, 84, 'free · tight → wraps', { size: 2.0 }));
  const py = 100;
  p.push(jack('labelBelow', 18, py, { label: cap('below') }));
  p.push(jack('labelAbove', 42, py, { label: cap('above', 'above') }));
  p.push(jack('labelLeft', 66, py, { label: cap('left', 'left') }));
  p.push(jack('labelRight', 90, py, { label: cap('right', 'right') }));
  p.push(ink(52, 112, 'attached · below · above · left · right', { size: 2.0 }));

  // === RIGHT COLUMN: knobs ===
  p.push(ink(130, 15.5, 'knob — size · sweep · ticks · skirt · scale', { size: 2.2 }));
  p.push(knob('knobSmall', 114, 26, { radius: 4.2, theme: th, label: cap('r 4.2') }));
  p.push(knob('knobMedium', 132, 26, { radius: 6.4, theme: th, label: cap('r 6.4') }));
  p.push(knob('knobLarge', 150, 26, { radius: 7.0, theme: th, label: cap('r 7') }));
  p.push(knob('knobDiv', 118, 52, { radius: 6.0, angleMin: -135, angleMax: 135, theme: th, label: cap('±135°') }));
  p.push(bipolarMark(118, 52, 6.0, { color: th.ink }));   // marking wraps around the bipolar knob
  p.push(knob('knobBare', 146, 52, { radius: 6.0, ticks: 0, theme: th, label: cap('ticks off') }));
  // Full 259t frequency knob: skirt + two-line Hz/note calibration scale.
  const HZ = [['27.5', 'A1'], ['55', 'A2'], ['110', 'A3'], ['220', 'A4'], ['440', 'A5'], ['880', 'A6'], ['1760', 'A7'], ['3520', 'A8'], ['7040', 'A9']];
  p.push(knob('knobSkirt', 130, 86, { radius: 7.0, cap: 5.5, skirt: 11.0, ticks: 0, theme: th, scale: { marks: evenScale(HZ), size: 1.5 } }));
  p.push(ink(130, 110, '259t frequency · calibration scale', { size: 2.0 }));

  // === THIRD COLUMN: radio · button · slider ===
  p.push(ink(192, 15.5, 'radio · button · slider', { size: 2.4 }));
  // Radio, horizontal, with wave glyphs (like the 281t mode selector).
  p.push(radioGroup('radioMode', 184, 26, { orientation: 'h', spacing: 6, theme: th, steps: [
    { value: 'transient', glyph: 'transient' }, { value: 'sustained', glyph: 'sustained' }, { value: 'cyclic', glyph: 'cyclic' }] }));
  p.push(ink(184, 36, 'radio · horizontal + glyphs', { size: 1.9 }));
  // Radio, vertical, with side labels (like the 292 VCA/LP).
  p.push(radioGroup('radioRange', 170, 48, { orientation: 'v', spacing: 5.2, theme: th, steps: [
    { value: 'low', label: 'low' }, { value: 'high', label: 'high' }] }));
  p.push(ink(170, 59, 'radio · vertical', { size: 1.9 }));
  // Buttons: red LED (strike-size), white momentary, small on-lamp.
  p.push(button('btnStrike', 192, 44, { r: 2.4, kind: 'white' })); p.push(ink(192, 49.5, 'strike', { size: 1.8 }));
  p.push(button('btnTrig', 210, 44, { r: 2.4, kind: 'white' })); p.push(ink(210, 49.5, 'trig', { size: 1.8 }));
  p.push(button('btnToggle', 192, 60, { r: 2.4, kind: 'white' })); p.push(ink(192, 65.5, 'toggle', { size: 1.8 }));
  p.push(button('btnOn', 210, 60, { r: 2.16, kind: 'red' })); p.push(ink(210, 65, 'on', { size: 1.8 }));
  p.push(ink(201, 73, 'momentary (strike/trig) · toggle · lamp', { size: 1.8 }));
  // Slider (vertical fader), on the far right of the column.
  p.push(slider('sliderLevel', 222, { top: 30, bot: 84, valuePos: 0.7, theme: th }));
  p.push(ink(222, 90, 'slider', { size: 2.0 }));

  // === FOURTH COLUMN: VU meters (rectangular segments; lit shown statically) ===
  p.push(ink(250, 15.5, 'VU meter · length · count · v/h', { size: 2.2 }));
  p.push(vuMeter('vu', 243, 78, { length: 42, orientation: 'v', segments: 12, chan: 'A', lit: 8, theme: th }));
  p.push(vuMeter('vu', 237, 98, { length: 26, orientation: 'h', segments: 9, chan: 'B', lit: 5, theme: th }));

  p.push(`</g>`);
  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

fs.writeFileSync(__dirname + '/panel.svg', build(false));
fs.writeFileSync(__dirname + '/panel.dark.svg', build(true));
console.log('wrote gallery panel.svg + panel.dark.svg');
