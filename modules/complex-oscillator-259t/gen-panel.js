// Generator for the Complex Oscillator faceplate — the original 259t layout,
// every control rebuilt on the shared faceplate library (panel/*). Same overall
// dimensions (171.333 × 128.5 mm) and the same control positions as the original;
// only the drawing comes from the canonical primitives.
'use strict';
const fs = require('fs');
const { THEME } = require('../../panel/theme');
const { defs, jack, knob, radioGroup, button, label, attachedLabel, evenScale, bipolarMark } = require('../../panel/primitives');

const FACE_W = 164.133, OX = 3.9, OY = 1.036;   // right edge pulled in after tucking the harmonics CV jacks
const HZ = [['27.5', 'A1'], ['55', 'A2'], ['110', 'A3'], ['220', 'A4'], ['440', 'A5'], ['880', 'A6'], ['1760', 'A7'], ['3520', 'A8'], ['7040', 'A9']];

function build(dark) {
  const th = THEME[dark ? 'dark' : 'light'];
  const p = [];
  const ink = (x, y, txt, opts = {}) => label(x, y, txt, { fill: th.ink, ...opts });
  const hdr = (x, y, txt, size = 2.6) => ink(x, y, txt, { size });
  const lab = (text, placement = 'below', size = 2.0) => ({ text, placement, fill: th.ink, size });
  const K = (id, x, y, radius, name, extra = {}) => knob(id, x, y, { radius, theme: th, label: name ? lab(name) : null, ...extra });
  const oj = (id, x, y, txt) => { p.push(jack(id, x, y, { label: lab(txt, 'below') })); };   // output jack, label below
  const ij = (id, x, y, txt) => { p.push(jack(id, x, y, { label: lab(txt, 'above') })); };   // input jack, label above
  const jp = (id, x, y) => { p.push(jack(id, x, y, {})); };   // plain jack — label carried by the knob above it

  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_W}mm" height="128.5mm" viewBox="0 0 ${FACE_W} 128.5" font-family="Arial Narrow, Helvetica, Arial, sans-serif">`);
  p.push(defs(th));
  p.push(`  <rect x="${OX}" y="${OY}" width="${FACE_W}" height="128.5" fill="${th.face}"/>`);
  p.push(`  <rect x="4.4" y="7.5994" width="${FACE_W - 1}" height="112.5912" rx="2.2" fill="none" stroke="${th.frame}" stroke-width="0.5"/>`);

  // ---- Section dividers — exact coordinates from the original 259t ----
  const line = (x1, y1, x2, y2) => `  <line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${th.frame}" stroke-width="0.355"/>`;
  [
    [68.15, 9.18, 68.15, 122.77], [89.68, 9.18, 89.68, 122.77], [144.51, 9.18, 144.51, 122.77], // section verticals (harmonics moved 2mm left)
    [39.75, 28.9, 39.75, 51.48],                                                                 // range | waveshape
    [7.8, 29.53, 66.96, 29.53], [89.68, 29.53, 144.51, 29.53],                                   // under output rows
    [7.8, 50.94, 66.96, 50.94], [89.68, 50.94, 144.51, 50.94],                                   // under radios / phase-lock
    [144.51, 69, 179.13, 69],                                                                    // harmonics: order | timbre (dropped clear of the Order jack)
    [7.8, 122.77, 179.13, 122.77],                                                               // bottom rule
  ].forEach((l) => p.push(line(...l)));

  // ---- Modulation oscillator (left) ----
  p.push(hdr(36.7, 12.5, 'MODULATION OSC OUTPUTS', 2.3));
  oj('modTriOut', 24, 17.4, 'tri'); oj('modCvOut', 36.7, 17.4, 'c.v.'); oj('modSigOut', 49.8, 17.4, 'signal');
  p.push(radioGroup('modRange', 23.78, 34, { orientation: 'h', spacing: 8, ledR: 1.9, theme: th, steps: [{ value: 'low', label: 'low' }, { value: 'high', label: 'high' }] }));
  p.push(hdr(23.78, 48.5, 'RANGE', 2.2));
  p.push(radioGroup('modWave', 53.95, 34, { orientation: 'h', spacing: 8, ledR: 1.9, theme: th, steps: [{ value: 'sawtooth', glyph: 'sawtooth' }, { value: 'square', glyph: 'square' }, { value: 'triangle', glyph: 'triangle' }] }));
  p.push(hdr(53.95, 48.5, 'WAVESHAPE', 2.2));
  const dX = 2.5;   // nudge the whole frequency sub-panel right so it sits centred in the column
  p.push(K('modFreq', 28.7 + dX, 69.7, 8.046, null, { cap: 6.5, skirt: 12.424, ticks: 0, scale: { marks: evenScale(HZ), size: 1.6 } }));
  p.push(hdr(28.7 + dX, 90, 'FREQUENCY (Hz)', 3.4));
  p.push(K('modFine', 54.8 + dX, 62.6, 6.98, 'fine'));
  p.push(K('modFmAmount', 15.3 + dX, 98.1, 7.22, 'f.m.')); jp('modFmIn', 15.3 + dX, 114.8);
  p.push(K('modCvAmount', 54.8 + dX, 98.1, 7.22, 'c.v.')); p.push(bipolarMark(54.8 + dX, 98.1, 7.22, { color: th.ink })); jp('modCvIn', 54.8 + dX, 114.8);
  ij('modPitchIn', 37 + dX, 113.3, '1V/oct');

  // ---- Middle: mod index + mod switches + phase lock ----
  const sw = (id, y, txt) => { p.push(button(id, 74.4, y, { r: 2.0, kind: 'red' })); p.push(attachedLabel(74.4, y, 2.0, 2.0, { text: txt, placement: 'right', maxWidth: 7, size: 2.0, fill: th.ink })); };
  sw('phaseLock', 16.65, 'phase lock'); sw('amplMod', 28.84, 'ampl mod'); sw('pitchMod', 41.27, 'pitch mod'); sw('timbreMod', 53.69, 'timbre mod');
  const dXm = 1.25;   // nudge the Mod Index column right so it sits centred between the two oscillators
  p.push(K('modIndex', 78.0 + dXm, 70.8, 7.69, null)); p.push(bipolarMark(78.0 + dXm, 70.8, 7.69, { color: th.ink }));
  p.push(hdr(78.0 + dXm, 84, 'MOD. INDEX', 2.4));
  p.push(K('modIndexCvAmount', 78.0 + dXm, 97.7, 7.22, 'c.v.')); jp('modIndexCvIn', 78.0 + dXm, 114.4);

  // ---- Principal oscillator ----
  p.push(hdr(117.7, 12.5, 'PRINCIPAL OSC OUTPUTS', 2.3));
  oj('prinSineOut', 104.4, 17.4, 'sine'); oj('prinSquareOut', 117.8, 17.4, 'square'); oj('prinFinalOut', 131, 17.4, 'final');
  p.push(hdr(114, 35, 'PHASE LOCK', 2.4));
  ij('phaseLockIn', 114.5, 43.5, 'input');
  p.push(K('phaseLockAmount', 132.9, 38.0, 7.45, 'gain'));
  const dXp = 1.25;   // nudge the whole Pitch sub-panel right so it sits centred in the column
  p.push(K('prinFreq', 108.3 + dXp, 69.7, 8.046, null, { cap: 6.5, skirt: 12.424, ticks: 0, scale: { marks: evenScale(HZ), size: 1.6 } }));
  p.push(hdr(108.3 + dXp, 90, 'PITCH (Hz)', 3.4));
  p.push(K('prinFine', 134.4 + dXp, 62.6, 6.98, 'fine'));
  p.push(K('prinFmAmount', 97.7 + dXp, 98.1, 7.22, 'f.m.')); jp('prinFmIn', 97.7 + dXp, 114.8);
  p.push(K('prinCvAmount', 132.9 + dXp, 98.1, 7.22, 'c.v.')); p.push(bipolarMark(132.9 + dXp, 98.1, 7.22, { color: th.ink })); jp('prinCvIn', 132.9 + dXp, 114.8);
  ij('prinPitchIn', 116.9 + dXp, 113.3, '1V/oct');

  // ---- Harmonics (right) ----
  const hX = 159;         // harmonics labels + jacks column
  const kX = hX - 2;      // knob BODIES shifted left ~5px; their labels and jacks stay at hX
  p.push(hdr(hX, 12.5, 'HARMONICS', 2.4));
  p.push(K('symmetry', kX, 28.8, 8.05, null)); p.push(attachedLabel(hX, 28.8, 8.05, 8.05, lab('Symmetry'))); jp('symmetryCvIn', 148.5, 39.8);
  p.push(K('order', kX, 53.7, 8.05, null)); p.push(attachedLabel(hX, 53.7, 8.05, 8.05, lab('Order'))); jp('orderCvIn', 148.5, 64.8);
  p.push(K('timbre', kX, 78.1, 7.45, null)); p.push(attachedLabel(hX, 78.1, 7.45, 7.45, lab('TIMBRE')));
  p.push(K('timbreCvAmount', kX, 100.6, 6.98, null)); p.push(attachedLabel(hX, 100.6, 6.98, 6.98, lab('c.v.'))); p.push(bipolarMark(kX, 100.6, 6.98, { color: th.ink })); jp('timbreCvIn', 148.5, 111.6);   // matched to the Symmetry/Order jacks' lower-left offset

  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

fs.writeFileSync(__dirname + '/panel.svg', build(false));
fs.writeFileSync(__dirname + '/panel.dark.svg', build(true));
console.log('wrote panel.svg + panel.dark.svg');
