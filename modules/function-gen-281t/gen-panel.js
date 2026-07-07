// Generator for the Quad Function Generator (281t) faceplate (panel.svg +
// panel.dark.svg). Four identical channel rows (A–D) plus a QUADRATURE section on
// the right. Authored in the house style (see DESIGN §5): framed rounded border,
// line-grey dividers, house blue knobs, jacks the loader repaints by domain, and
// red-LED step-indicator lamps for the on/off switches (as the 259t does for its
// hardware toggles). Layout, labels, and every interior line follow the panel.
'use strict';
const fs = require('fs');

const CH = ['A', 'B', 'C', 'D'];
const FACE_W = 98, FACE_H = 113.5912;

// Channel-row columns. The channel letter sits BETWEEN the two output jacks, so
// the divider can slide in tight against the outputs and the panel packs tighter.
const COL_TRIG = 10, COL_CYCLE = 19, COL_ACV = 28, COL_ATK = 39,
  COL_DCV = 50, COL_DEC = 61, COL_OUT = 73, COL_LED = 79;   // tightened to ~knob-cluster spacing; decay CV LEFT of decay knob
const DIVIDER_X = 82;                        // channels | quadrature
// Quadrature band (right of the divider): two stacked regions (A-B, C-D). Each
// mix knob sits snug to the divider on the projected A-B / C-D row line, its CV
// output jack below it, and the enable button in the triangular gap between them.
const Q_KNOB_X = 90, Q_HDR_X = 91;

const Y_TITLE = 5.5, Y_RULE = 9;            // title + underline
const ROW_Y = [21.5, 46.5, 71.5, 96.5];     // row centres
const ROW_DIV = [34, 59, 84];               // dividers between rows
const Y_BOTTOM = 109;

function label(x, y, text, fill, size, anchor = 'middle') {
  return `  <text x="${x}" y="${y}" font-size="${size}" font-weight="700" font-style="italic" fill="${fill}" text-anchor="${anchor}">${text}</text>`;
}

function jack(id, cx, cy) {   // neutral fill; the loader repaints by domain
  return `  <g data-wcoast-port="${id}" data-wcoast-cx="${cx}" data-wcoast-cy="${cy}">
    <circle cx="${cx}" cy="${cy}" r="3.0" fill="#8a8a8a" stroke="#000" stroke-width="0.3" filter="url(#softShadow)"/>
    <circle cx="${cx}" cy="${cy}" r="1.6" fill="#000"/>
  </g>`;
}

// angMin/angMax are the indicator angles (deg, clockwise from straight-up) at
// the param's min and max; the host draws the indicator straight up and rotates
// it. A sweep centred on -90 (e.g. -165..-15) makes the mid value point LEFT.
function knob(id, cx, cy, r, th, angMin = -150, angMax = 150, N = 7) {
  const cap = +(r * 0.72).toFixed(2);
  const a0 = angMin * Math.PI / 180, a1 = angMax * Math.PI / 180;
  let ticks = '';
  for (let k = 0; k < N; k++) {
    const a = a0 + (k / (N - 1)) * (a1 - a0);
    const x1 = cx + Math.sin(a) * (r + 0.3), y1 = cy - Math.cos(a) * (r + 0.3);
    const x2 = cx + Math.sin(a) * (r + 1.0), y2 = cy - Math.cos(a) * (r + 1.0);
    ticks += `\n    <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${th.ink}" stroke-width="0.3"/>`;
  }
  return `  <g data-wcoast-param="${id}" data-wcoast-cx="${cx}" data-wcoast-cy="${cy}" data-wcoast-angle-min="${angMin}" data-wcoast-angle-max="${angMax}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#blueRing)" stroke="${th.ringStroke}" stroke-width="0.355" filter="url(#softShadow)"/>${ticks}
    <circle cx="${cx}" cy="${cy}" r="${cap}" fill="url(#knobCap)" stroke="${th.capStroke}" stroke-width="0.2366"/>
    <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${(cy - cap).toFixed(2)}" stroke="${th.ink}" stroke-width="0.55" data-wcoast-role="indicator"/>
  </g>`;
}

function led(id, cx, cy) {   // on/off (or momentary) switch as a red LED lamp
  return `  <g data-wcoast-param="${id}">
    <circle cx="${cx}" cy="${cy}" r="1.65" fill="url(#redLed)" stroke="#7c0000" stroke-width="0.2366" filter="url(#softShadow)" data-wcoast-role="step-indicator" data-wcoast-step="on"/>
    <circle cx="${cx - 0.47}" cy="${cy - 0.47}" r="0.47" fill="#ffb4b4" opacity="0.85" pointer-events="none"/>
  </g>`;
}

function button(id, cx, cy) {   // white momentary push-button (still a step-indicator)
  return `  <g data-wcoast-param="${id}">
    <circle cx="${cx}" cy="${cy}" r="2.2" fill="#e9e9ec" stroke="#8a8a8e" stroke-width="0.35" filter="url(#softShadow)" data-wcoast-role="step-indicator" data-wcoast-step="on"/>
    <circle cx="${cx - 0.6}" cy="${cy - 0.6}" r="0.55" fill="#ffffff" opacity="0.8" pointer-events="none"/>
  </g>`;
}

function indicatorLed(cx, cy, colour) {   // static activity LED (decorative)
  return `  <circle cx="${cx}" cy="${cy}" r="1.15" fill="${colour}" stroke="#00000055" stroke-width="0.2" filter="url(#softShadow)"/>`;
}

function knobScale(cx, cy, r, th) {   // .001 .03 .3 10 around a time knob
  const s = 2.0;
  return [
    label(cx - r - 1.6, cy - r + 1.2, '.03', th.ink, s, 'middle'),
    label(cx + r + 1.6, cy - r + 1.2, '.3', th.ink, s, 'middle'),
    label(cx - r - 1.2, cy + r + 1.2, '.001', th.ink, s, 'middle'),
    label(cx + r + 1.2, cy + r + 1.2, '10', th.ink, s, 'middle'),
  ].join('\n');
}

// A little waveform glyph for a mode: transient = one peak, sustained = a
// trapezoid (rise/hold/fall), cyclic = a repeating zigzag.
function glyph(kind, gx, gy, th) {
  const w = 1.3, t = (gy - 0.7).toFixed(2), b = (gy + 0.7).toFixed(2);
  let pts;
  if (kind === 'transient') pts = `${(gx - w).toFixed(2)},${b} ${gx},${t} ${(gx + w).toFixed(2)},${b}`;
  else if (kind === 'sustained') pts = `${(gx - w).toFixed(2)},${b} ${(gx - 0.5).toFixed(2)},${t} ${(gx + 0.5).toFixed(2)},${t} ${(gx + w).toFixed(2)},${b}`;
  else pts = `${(gx - w).toFixed(2)},${b} ${(gx - 0.65).toFixed(2)},${t} ${gx},${b} ${(gx + 0.65).toFixed(2)},${t} ${(gx + w).toFixed(2)},${b}`;
  return `<polyline points="${pts}" fill="none" stroke="${th.ink}" stroke-width="0.3" stroke-linejoin="round"/>`;
}

// Three-position MODE selector: a row of LED lamps (one lit, radio-style) with a
// waveform glyph under each, like the 259t's Waveshape control.
function modeSelector(id, cx, cy, th) {
  const steps = [['transient', cx - 4.2], ['sustained', cx], ['cyclic', cx + 4.2]];
  let out = `  <g data-wcoast-param="${id}">`;
  for (const [v, gx] of steps) {
    out += `\n    <circle cx="${gx}" cy="${cy}" r="1.15" fill="url(#redLed)" stroke="#7c0000" stroke-width="0.2366" filter="url(#softShadow)" data-wcoast-role="step-indicator" data-wcoast-step="${v}"/>`;
    out += `\n    ${glyph(v, gx, cy + 3.85, th)}`;
  }
  return out + `\n  </g>`;
}

function build(dark) {
  const th = dark ? {
    face: '#262629', grain: '#2a2a2d', ink: '#b8b8bc', frame: '#808085',
    cap: ['#3a3d43', '#4c5058', '#5a5f67', '#6b7079'], ringStroke: '#6fa8d6', capStroke: '#b8b8bc',
  } : {
    face: '#cfcfcf', grain: '#d0d0d0', ink: '#163a69', frame: '#7d7d7d',
    cap: ['#f8f8f8', '#bfc3c5', '#f4f4f4', '#777'], ringStroke: '#004b7a', capStroke: '#666',
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
  // Framed border (house), 0.5mm inside the face.
  p.push(`  <rect x="0.5" y="0.5" width="${FACE_W - 1}" height="${FACE_H - 1}" rx="2.2" fill="none" stroke="${th.frame}" stroke-width="0.5"/>`);

  // Title + underline.
  p.push(label(FACE_W / 2, Y_TITLE, 'QUAD FUNCTION GENERATOR 281t', th.ink, 3.4));
  const hline = (y, x1 = 3, x2 = FACE_W - 3) => `  <line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}" stroke="${th.frame}" stroke-width="0.355"/>`;
  p.push(hline(Y_RULE));
  // A|B and C|D lines stop at the vertical divider (the quad knobs sit on their
  // projection); the B|C line runs full width and also splits the two quad regions.
  p.push(hline(ROW_DIV[0], 3, DIVIDER_X));
  p.push(hline(ROW_DIV[1]));
  p.push(hline(ROW_DIV[2], 3, DIVIDER_X));
  p.push(hline(Y_BOTTOM));
  // Vertical divider: channels | quadrature.
  p.push(`  <line x1="${DIVIDER_X}" y1="${Y_RULE}" x2="${DIVIDER_X}" y2="${Y_BOTTOM}" stroke="${th.frame}" stroke-width="0.355"/>`);

  // Channel rows.
  for (let ci = 0; ci < CH.length; ci++) {
    const L = CH[ci], cy = ROW_Y[ci];
    // trig: jack, label, momentary button
    p.push(jack(`trig${L}`, COL_TRIG, cy - 5));
    p.push(label(COL_TRIG, cy + 1.2, 'trig', th.ink, 2.1));
    p.push(button(`trigBtn${L}`, COL_TRIG, cy + 6.5));
    // cycle gate input + the 3-position MODE selector (transient/sustained/cyclic)
    p.push(jack(`cycleIn${L}`, COL_CYCLE, cy - 5));
    p.push(label(COL_CYCLE, cy - 0.3, 'cycle', th.ink, 2.0));
    p.push(modeSelector(`mode${L}`, COL_CYCLE, cy + 4, th));
    // attack CV in
    p.push(jack(`attackCv${L}`, COL_ACV, cy - 1.5));
    p.push(label(COL_ACV, cy + 4.5, 'c.v. in', th.ink, 2.4));
    // attack knob + scale
    p.push(knob(`attack${L}`, COL_ATK, cy - 1, 4.6, th));
    p.push(knobScale(COL_ATK, cy - 1, 4.6, th));
    p.push(label(COL_ATK, cy + 9, 'attack', th.ink, 2.2));
    // decay knob + scale
    p.push(knob(`decay${L}`, COL_DEC, cy - 1, 4.6, th));
    p.push(knobScale(COL_DEC, cy - 1, 4.6, th));
    p.push(label(COL_DEC, cy + 9, 'decay', th.ink, 2.2));
    // decay CV in
    p.push(jack(`decayCv${L}`, COL_DCV, cy - 1.5));
    p.push(label(COL_DCV, cy + 4.5, 'c.v. in', th.ink, 2.4));
    // outputs: pulse out (top, trigger) + CV out (bottom, control); the channel
    // letter sits between the two jacks.
    p.push(label(COL_OUT, cy - 9, 'pulse out', th.ink, 2.1));
    p.push(jack(`pulse${L}`, COL_OUT, cy - 5));
    p.push(jack(`fn${L}`, COL_OUT, cy + 5));
    p.push(label(COL_OUT, cy + 9.7, 'CV out', th.ink, 2.1));
    p.push(indicatorLed(COL_LED, cy - 5, dark ? '#d33' : '#c00'));   // red (pulse)
    p.push(indicatorLed(COL_LED, cy + 5, '#1f7fe0'));   // blue (CV)
  }

  // Quadrature band: two regions (A-B rows, C-D rows). Each has a "quadrature"
  // header, the mix knob on the projected row line snug to the divider, the paired
  // CV output jack below it, and the enable button beside that jack.
  const quadRegion = (knobId, portId, enId, cy, nm) => {
    const [up, dn] = nm.split('-');   // e.g. A / B
    p.push(label(Q_KNOB_X, cy - 14, 'QUADRATURE', th.ink, 2.0));    // header, centred above the button
    p.push(led(enId, Q_KNOB_X, cy - 9.25));                         // button, tight above the knob
    p.push(label(Q_KNOB_X, cy - 12, 'on', th.ink, 1.9));           // centred above the button, midway to the header
    p.push(knob(knobId, Q_KNOB_X, cy, 6.4, th, -215, 35, 11));      // mid points LEFT; 11 ticks
    // channel letters in the left triangle, up-left / down-left of the knob,
    // equidistant above/below the line (baselines offset to visually centre them).
    p.push(label(Q_KNOB_X - 6.5, cy - 5.1, up, th.ink, 2.6));
    p.push(label(Q_KNOB_X - 6.5, cy + 6.9, dn, th.ink, 2.6));
    p.push(label(Q_KNOB_X, cy + 9.5, 'mix', th.ink, 2.0));          // knob name, below the knob
    p.push(jack(portId, Q_KNOB_X, cy + 15));
    p.push(label(Q_KNOB_X, cy + 20.5, `${nm} out`, th.ink, 2.0));
  };
  quadRegion('quadTimeAB', 'quadOutAB', 'quadEnAB', 34, 'A-B');
  quadRegion('quadTimeCD', 'quadOutCD', 'quadEnCD', 84, 'C-D');

  p.push(`</g>`);
  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

const dir = __dirname;
fs.writeFileSync(dir + '/panel.svg', build(false));
fs.writeFileSync(dir + '/panel.dark.svg', build(true));
console.log('wrote panel.svg + panel.dark.svg');
