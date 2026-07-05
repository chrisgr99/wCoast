// Generator for the Mixer faceplate (panel.svg + panel.dark.svg).
// Six channels, tight-packed. TOP: pan knobs, but the two OUTER channels (A, F)
// take a pan-CV input jack where the knob would be. Then a PAN label + full-width
// divider, faders, mute, VU, and the audio input jacks at the BOTTOM with A-F
// labels. Master on the right. Colours/lines/knob metal match the 259t exactly.
'use strict';
const fs = require('fs');

const CH = ['A', 'B', 'C', 'D', 'E', 'F'];
const VCPAN = { A: 'panCvA', F: 'panCvF' };     // outer channels: CV jack, no knob

const FACE_W = 103, FACE_H = 113.5912;
const CH_X = { A: 15.5, B: 28.5, C: 41.5, D: 54.5, E: 67.5, F: 80.5 };   // 13mm pitch; tight left column for labels
const MASTER_X = 95.5, DIVIDER_X = 88.5;
const ROW_LABEL_X = 11.5;                                     // right edge of the left-margin row labels

const Y_CHAN_LABEL = 9;           // A-F, above the pan row
const Y_PAN = 15;                 // pan knobs / outer CV jacks
const Y_LINE = 21;                // pan | fader divider
const SLIDER_TOP = 24, SLIDER_BOT = 72;
const VU_SEGS = 12;              // circular VU LEDs down the left of each fader
const Y_LINE_FC = 75;            // fader | amp-CV divider
const Y_AMPCV = 80.5;            // amp-CV (gain) input jacks
const Y_LINE_CE = 86;            // amp-CV | enable divider
const Y_MUTE = 89.5;             // enable lamp (gate gain; sense flipped so lit = enabled)
const Y_LINE_EI = 93;            // enable | input divider
const Y_PORT_LABEL = 98;          // A-F above the input ports
const Y_INPUT = 104;

function jack(id, cx, cy, kind) {
  const outer = kind === 'audio' ? '#ff7300' : '#1f7fe0';
  return `  <g data-wcoast-port="${id}" data-wcoast-cx="${cx}" data-wcoast-cy="${cy}">
    <circle cx="${cx}" cy="${cy}" r="3.0" fill="${outer}" stroke="#000" stroke-width="0.3" filter="url(#softShadow)"/>
    <circle cx="${cx}" cy="${cy}" r="1.6" fill="#000"/>
  </g>`;
}

function slider(id, cx, valuePos, th) {
  const travel = SLIDER_BOT - SLIDER_TOP, mid = SLIDER_TOP + travel / 2;
  const hy = SLIDER_BOT - valuePos * travel;
  return `  <g data-wcoast-param="${id}" data-wcoast-role="slider" data-wcoast-cx="${cx}" data-wcoast-top="${SLIDER_TOP}" data-wcoast-bot="${SLIDER_BOT}">
    <rect x="${cx - 1.2}" y="${SLIDER_TOP - 2}" width="2.4" height="${travel + 4}" rx="1.2" fill="${th.track}" stroke="${th.trackEdge}" stroke-width="0.3"/>
    <g data-wcoast-role="handle" transform="translate(0 ${(hy - mid).toFixed(3)})">
      <rect x="${cx - 4}" y="${mid - 2.2}" width="8" height="4.4" rx="1.1" fill="${th.handle}" stroke="${th.handleEdge}" stroke-width="0.4" filter="url(#softShadow)"/>
      <line x1="${cx - 3.2}" y1="${mid}" x2="${cx + 3.2}" y2="${mid}" stroke="${th.handleLine}" stroke-width="0.7"/>
    </g>
  </g>`;
}

function panKnob(id, cx, cy, th) {
  const r = 4.2, cap = 3.3, span = 150 * Math.PI / 180;
  let ticks = '';
  for (let k = 0; k < 7; k++) {
    const a = -span + (k / 6) * (2 * span);
    const x1 = cx + Math.sin(a) * (r + 0.3), y1 = cy - Math.cos(a) * (r + 0.3);
    const x2 = cx + Math.sin(a) * (r + 1.0), y2 = cy - Math.cos(a) * (r + 1.0);
    ticks += `\n    <line x1="${x1.toFixed(3)}" y1="${y1.toFixed(3)}" x2="${x2.toFixed(3)}" y2="${y2.toFixed(3)}" stroke="${th.ink}" stroke-width="0.3"/>`;
  }
  return `  <g data-wcoast-param="${id}" data-wcoast-cx="${cx}" data-wcoast-cy="${cy}" data-wcoast-angle-min="-150" data-wcoast-angle-max="150">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#blueRing)" stroke="${th.ringStroke}" stroke-width="0.355" filter="url(#softShadow)"/>${ticks}
    <circle cx="${cx}" cy="${cy}" r="${cap}" fill="url(#knobCap)" stroke="${th.capStroke}" stroke-width="0.2366"/>
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - cap}" stroke="${th.ink}" stroke-width="0.55" data-wcoast-role="indicator"/>
  </g>`;
}

function mute(id, cx, cy) {
  return `  <g data-wcoast-param="${id}">
    <circle cx="${cx}" cy="${cy}" r="1.8" fill="url(#redLed)" stroke="#7c0000" stroke-width="0.2366" filter="url(#softShadow)" data-wcoast-role="step-indicator" data-wcoast-step="on"/>
    <circle cx="${cx - 0.5}" cy="${cy - 0.5}" r="0.5" fill="#ffb4b4" opacity="0.85" pointer-events="none"/>
  </g>`;
}

function vu(role, cx, th, chan) {
  // A vertical column of circular LEDs down the left of the fader, 1mm off the
  // handle's left edge, spanning the fader travel. Unlit = a frame-grey ring.
  const ledX = cx - 5.75, span = SLIDER_BOT - SLIDER_TOP;
  let leds = '';
  for (let i = 0; i < VU_SEGS; i++) {
    const cy = SLIDER_BOT - i * span / (VU_SEGS - 1);
    leds += `\n    <circle cx="${ledX}" cy="${cy.toFixed(3)}" r="0.75" fill="none" stroke="${th.frame}" stroke-width="0.3" data-wcoast-seg="${i}"/>`;
  }
  return `  <g data-wcoast-role="${role}" data-wcoast-chan="${chan}">${leds}\n  </g>`;
}

function label(x, y, text, fill, size = 2.3, anchor = 'middle') {
  return `  <text x="${x}" y="${y}" font-size="${size}" font-weight="700" font-style="italic" fill="${fill}" text-anchor="${anchor}">${text}</text>`;
}

function build(dark) {
  const th = dark ? {
    face: '#262629', grain: '#2a2a2d', ink: '#b8b8bc', frame: '#808085',
    cap: ['#3a3d43', '#4c5058', '#5a5f67', '#6b7079'],
    track: '#626771', trackEdge: '#1b1b1e', handle: '#9aa4b2', handleEdge: '#1b1b1e', handleLine: '#1c2026',
    ringStroke: '#6fa8d6', capStroke: '#b8b8bc', vuOff: '#3a3f47', vuEdge: '#606670',
  } : {
    face: '#cfcfcf', grain: '#d0d0d0', ink: '#163a69', frame: '#7d7d7d',
    cap: ['#f8f8f8', '#bfc3c5', '#f4f4f4', '#777'],
    track: '#20242a', trackEdge: '#000', handle: '#3c4653', handleEdge: '#0d1218', handleLine: '#e6ecf3',
    ringStroke: '#004b7a', capStroke: '#666', vuOff: '#cfd3d8', vuEdge: '#8a8f96',
  };
  const p = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${FACE_W}mm" height="128.5mm" viewBox="0 0 ${FACE_W} 128.5" font-family="Arial Narrow, Helvetica, Arial, sans-serif">`);
  p.push(`<defs>
  <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="6.8" numOctaves="2" stitchTiles="stitch"/><feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="table" tableValues="0 .10"/></feComponentTransfer></filter>
  <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0.4733" dy="0.5916" stdDeviation="0.4733" flood-color="#000" flood-opacity=".28"/></filter>
  <radialGradient id="knobCap"><stop offset="0" stop-color="${th.cap[0]}"/><stop offset="0.4" stop-color="${th.cap[1]}"/><stop offset="0.62" stop-color="${th.cap[2]}"/><stop offset="1" stop-color="${th.cap[3]}"/></radialGradient>
  <radialGradient id="blueRing"><stop offset="0" stop-color="#1688cc"/><stop offset="0.55" stop-color="#006da8"/><stop offset="1" stop-color="#003d62"/></radialGradient>
  <radialGradient id="redLed"><stop offset="0" stop-color="#ff4a4a"/><stop offset="0.55" stop-color="#d00000"/><stop offset="1" stop-color="#650000"/></radialGradient>
</defs>`);
  p.push(`<g transform="translate(3.9 7.0994)">`);
  p.push(`<rect x="0" y="0" width="${FACE_W}" height="${FACE_H}" rx="2.5" fill="${th.face}"/>`);
  p.push(`<rect x="0" y="0" width="${FACE_W}" height="${FACE_H}" rx="2.5" fill="${th.grain}" filter="url(#grain)"/>`);
  // Framed border, 0.5mm inside the face all around (matches the lpg-292).
  p.push(`  <rect x="0.5" y="0.5" width="${FACE_W - 1}" height="${FACE_H - 1}" rx="2.2" fill="none" stroke="${th.frame}" stroke-width="0.5"/>`);

  // Column headers A-F above the pan row (MASTER is labelled lower, by its fader).
  for (const L of CH) p.push(label(CH_X[L], Y_CHAN_LABEL, L, th.ink, 2.6));

  // Pan row: knobs for the inner channels, a pan-CV jack for A and F.
  for (const L of CH) {
    if (VCPAN[L]) p.push(jack(VCPAN[L], CH_X[L], Y_PAN, 'control'));
    else p.push(panKnob(`pan${L}`, CH_X[L], Y_PAN, th));
  }
  // Row labels down the left margin, right-aligned just before channel A.
  const rowLabel = (y, text) => label(ROW_LABEL_X, y, text, th.ink, 2.5, 'end');
  p.push(rowLabel(16, 'PAN'));
  p.push(rowLabel(Y_AMPCV - 0.5, 'AMP'));
  p.push(rowLabel(Y_AMPCV + 2.3, 'CV IN'));
  p.push(rowLabel(Y_MUTE + 1, 'ENABLE'));
  p.push(rowLabel(Y_INPUT + 1.5, 'INPUT'));

  // Section dividers: pan | fader | mute | VU | input, plus the channel/master
  // vertical divider.
  const hdiv = (y) => `  <line x1="3" y1="${y}" x2="${FACE_W - 3}" y2="${y}" stroke="${th.frame}" stroke-width="0.355"/>`;
  p.push(hdiv(Y_LINE)); p.push(hdiv(Y_LINE_FC)); p.push(hdiv(Y_LINE_CE)); p.push(hdiv(Y_LINE_EI));
  // Thin separators between each fader/VU column: 2/3 of the fader-region height,
  // centred, 1mm right of each handle. The one right of F divides off the master.
  const sepMid = (SLIDER_TOP + SLIDER_BOT) / 2, sepHalf = (SLIDER_BOT - SLIDER_TOP) / 3;
  for (const L of CH) {
    p.push(`  <line x1="${CH_X[L] + 5}" y1="${(sepMid - sepHalf).toFixed(2)}" x2="${CH_X[L] + 5}" y2="${(sepMid + sepHalf).toFixed(2)}" stroke="${th.frame}" stroke-width="0.25"/>`);
  }

  // Channel strips: fader, mute, VU, input jack (bottom) + letter.
  for (const L of CH) {
    const cx = CH_X[L];
    p.push(slider(`level${L}`, cx, 0.8, th));
    p.push(jack(`ampCv${L}`, cx, Y_AMPCV, 'control'));
    p.push(mute(`mute${L}`, cx, Y_MUTE));
    p.push(vu('vu', cx, th, L));
    p.push(label(cx, Y_PORT_LABEL, L, th.ink, 2.4));
    p.push(jack(`chan${L}`, cx, Y_INPUT, 'audio'));
  }

  // Master strip; its label sits up by the pan row, to the right of the channels.
  p.push(label(MASTER_X, Y_LINE - 1.4, 'MASTER', th.ink, 2.6));
  p.push(slider('master', MASTER_X, 0.7, th));
  p.push(jack('ampCvMaster', MASTER_X, Y_AMPCV, 'control'));
  p.push(mute('masterMute', MASTER_X, Y_MUTE));
  p.push(vu('vuMaster', MASTER_X, th, 'M'));

  p.push(`</g>`);
  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

const dir = __dirname;
fs.writeFileSync(dir + '/panel.svg', build(false));
fs.writeFileSync(dir + '/panel.dark.svg', build(true));
console.log('wrote panel.svg + panel.dark.svg');
