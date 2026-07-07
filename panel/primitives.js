'use strict';
// Canonical faceplate control primitives. Each function draws ONE control type as
// an SVG string, styled centrally so every module looks the same. Size, count,
// and position are parameters; style is fixed here. Controls emit the binding
// attributes the host reads (data-wcoast-port / -param / -cx / -cy). See
// design/faceplate-system.md and DESIGN.md §5 (binding contract).

const { JACK_NEUTRAL, JACK_HOLE } = require('./theme');

// Shared <defs> every panel needs: soft drop shadow, the house blue knob ring
// (theme-independent), and the knob cap gradient (theme-dependent — pass the theme
// so light/dark caps differ). Theme is optional (falls back to the light cap).
function defs(theme) {
  const cap = (theme && theme.cap) || ['#f8f8f8', '#bfc3c5', '#f4f4f4', '#777777'];
  return `<defs>
  <filter id="softShadow" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0.4733" dy="0.5916" stdDeviation="0.4733" flood-color="#000" flood-opacity=".28"/></filter>
  <radialGradient id="blueRing"><stop offset="0" stop-color="#1688cc"/><stop offset="0.55" stop-color="#006da8"/><stop offset="1" stop-color="#003d62"/></radialGradient>
  <radialGradient id="blueDial"><stop offset="0" stop-color="#1d79b7"/><stop offset="0.6" stop-color="#00639a"/><stop offset="1" stop-color="#00456e"/></radialGradient>
  <radialGradient id="knobCap"><stop offset="0" stop-color="${cap[0]}"/><stop offset="0.4" stop-color="${cap[1]}"/><stop offset="0.62" stop-color="${cap[2]}"/><stop offset="1" stop-color="${cap[3]}"/></radialGradient>
  <radialGradient id="redLed"><stop offset="0" stop-color="#ff4a4a"/><stop offset="0.55" stop-color="#d00000"/><stop offset="1" stop-color="#650000"/></radialGradient>
</defs>`;
}

// Jack (port). Geometry only, per the binding contract: an outer ring around a
// concentric hole, tagged with the port id and its cord-anchor pivot. Neutral by
// default — the host repaints the outer ring by signal family and draws the
// dashed direction ring. `fill` lets the gallery preview a family colour without
// the running host; real panels leave it neutral.
function jack(id, cx, cy, { r = 3.0, hole = 1.6, fill = JACK_NEUTRAL, label: lab = null } = {}) {
  let out = `  <g data-wcoast-port="${id}" data-wcoast-cx="${cx}" data-wcoast-cy="${cy}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#000000" stroke-width="0.3" filter="url(#softShadow)"/>
    <circle cx="${cx}" cy="${cy}" r="${hole}" fill="${JACK_HOLE}"/>
  </g>`;
  // Optional attached label the jack draws itself — on any side (lab.placement),
  // wrapping to fit (lab.maxWidth), via the shared attachedLabel helper.
  if (lab) out += '\n' + attachedLabel(cx, cy, r, r, lab);
  return out;
}

// Knob (continuous control). House blue ring + metal cap + tick marks + a single
// pointer (the indicator the host rotates). Emits the binding tags and the angle
// sweep. Style is fixed; radius, cap, sweep, and tick count are params. Scales
// (numbers around the dial) are added as a later option. Needs theme for the ink /
// ring-stroke / cap-stroke colours (knobs are baked per theme, not repainted).
function knob(id, cx, cy, opts = {}) {
  const { radius = 4.6, cap = +(radius * 0.72).toFixed(2), angleMin = -150, angleMax = 150,
    ticks = 7, tickColor = '#ffffff', ring = 'url(#blueRing)', skirt = 0, scale = null, theme = {}, label: lab = null } = opts;
  const ink = theme.ink || '#163a69', ringStroke = theme.ringStroke || '#004b7a', capStroke = theme.capStroke || '#666666';
  const a0 = angleMin * Math.PI / 180, a1 = angleMax * Math.PI / 180;
  // White ticks around the rim — mostly ON the blue ring (so they read white in
  // both themes) with a very slight protrusion past the outer circumference.
  const tIn = radius - 1.0, tOut = radius + 0.5;
  let tickSvg = '';
  for (let k = 0; k < ticks; k++) {
    const a = ticks === 1 ? (a0 + a1) / 2 : a0 + (k / (ticks - 1)) * (a1 - a0);
    const x1 = cx + Math.sin(a) * tIn, y1 = cy - Math.cos(a) * tIn;
    const x2 = cx + Math.sin(a) * tOut, y2 = cy - Math.cos(a) * tOut;
    tickSvg += `\n    <line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${tickColor}" stroke-width="0.4"/>`;
  }
  // Optional outer skirt (the large "259t" two-tier knob): a wider dark-blue disc
  // beneath the inner ring. Static, like the ring — only the face rotates.
  const hasSkirt = skirt > radius;
  const skirtSvg = hasSkirt
    ? `\n    <circle cx="${cx}" cy="${cy}" r="${skirt}" fill="url(#blueDial)" stroke="#00507f" stroke-width="0.355" filter="url(#softShadow)"/>` : '';
  // A second pointer segment across the skirt band, colinear with the inner pointer
  // (from the skirt's inner edge out to its outer circumference), same weight. In the
  // indicator group, so it turns with the knob.
  const skirtLine = hasSkirt
    ? `\n      <line x1="${cx}" y1="${(cy - radius).toFixed(2)}" x2="${cx}" y2="${(cy - skirt).toFixed(2)}" stroke="${ink}" stroke-width="0.55"/>` : '';
  // Calibration scale — fixed panel art around the knob: a tick and/or a label at
  // each mark's angle (from `at` 0..1 along the sweep, or an explicit `angle`), the
  // label one or more lines. Optional 12-o'clock index triangle. Static (not rotated).
  const outerR = hasSkirt ? skirt : radius;
  let scaleSvg = '';
  if (scale) {
    const gap = scale.tickGap ?? 0.6, tlen = scale.tickLen ?? 1.1, lgap = scale.labelGap ?? 1.8;
    const scCol = scale.color || ink, scSize = scale.size ?? 2.0, bSc = scSize + LABEL_BUMP, lh = bSc * 1.1;
    const r0 = outerR + gap, r1 = r0 + tlen, rl = r1 + lgap;
    for (const m of (scale.marks || [])) {
      const deg = m.angle != null ? m.angle : angleMin + (m.at ?? 0) * (angleMax - angleMin);
      const rad = deg * Math.PI / 180, sn = Math.sin(rad), cs = Math.cos(rad);
      if (m.tick !== false) scaleSvg += `\n    <line x1="${(cx + sn * r0).toFixed(2)}" y1="${(cy - cs * r0).toFixed(2)}" x2="${(cx + sn * r1).toFixed(2)}" y2="${(cy - cs * r1).toFixed(2)}" stroke="${scCol}" stroke-width="0.355"/>`;
      if (m.label != null) {
        const lines = Array.isArray(m.label) ? m.label : [m.label];
        const lx = cx + sn * rl, ly = cy - cs * rl;
        lines.forEach((ln, i) => {
          scaleSvg += '\n    ' + label(lx, ly - (lines.length - 1) * lh / 2 + i * lh + bSc * 0.35, ln, { size: scSize, fill: scCol });
        });
      }
    }
    if (scale.index) {
      const bR = outerR + gap, tR = bR + tlen + 1.4;
      scaleSvg += `\n    <path d="M ${(cx - 1.3).toFixed(2)} ${(cy - bR).toFixed(2)} L ${cx} ${(cy - tR).toFixed(2)} L ${(cx + 1.3).toFixed(2)} ${(cy - bR).toFixed(2)} Z" fill="#f0f0f0" stroke="${ink}" stroke-width="0.24" stroke-linejoin="round"/>`;
    }
  }
  // The ring (with its directional drop-shadow) and the cap are rotationally
  // symmetric, so they stay put. The ticks and the pointer ARE the knob face — they
  // sit in the indicator group and rotate together, so the ticks turn with the knob.
  let out = `  <g data-wcoast-param="${id}" data-wcoast-cx="${cx}" data-wcoast-cy="${cy}" data-wcoast-angle-min="${angleMin}" data-wcoast-angle-max="${angleMax}">${skirtSvg}
    <circle cx="${cx}" cy="${cy}" r="${radius}" fill="${ring}" stroke="${ringStroke}" stroke-width="0.355" filter="url(#softShadow)"/>
    <circle cx="${cx}" cy="${cy}" r="${cap}" fill="url(#knobCap)" stroke="${capStroke}" stroke-width="0.2366"/>${scaleSvg}
    <g data-wcoast-role="indicator">${tickSvg}
      <line x1="${cx}" y1="${cy}" x2="${cx}" y2="${(cy - cap).toFixed(2)}" stroke="${ink}" stroke-width="0.55"/>${skirtLine}
    </g>
  </g>`;
  const ext = Math.max(radius, skirt);   // label clears the outermost tier (skirt if present)
  if (lab) out += '\n' + attachedLabel(cx, cy, ext, ext, lab);
  return out;
}

// --- text / labels ------------------------------------------------------------
// One canonical text style (house italic bold), used by free-floating labels and
// by controls' own attached labels. Supports multi-line: pass an explicit break
// with "\n", or a `maxWidth` (mm) to word-wrap to fit — so the SAME label reads
// "phase lock" on one line where there's room, or wraps to two lines where it's
// tight, chosen by the space it's given rather than by re-authoring the text.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Rough per-glyph advance for Arial Narrow at a given size — enough to decide word
// wraps for short control legends (no DOM at generation time).
function charW(ch, size) {
  if (ch === ' ') return 0.28 * size;
  if ("iljtI.,'!|:;".includes(ch)) return 0.22 * size;
  if ('fr'.includes(ch)) return 0.33 * size;
  if ('mw'.includes(ch)) return 0.72 * size;
  if ('MW'.includes(ch)) return 0.80 * size;
  if (ch >= 'A' && ch <= 'Z') return 0.56 * size;
  if (ch >= '0' && ch <= '9') return 0.50 * size;
  return 0.46 * size;
}
const textWidth = (str, size) => { let w = 0; for (const ch of String(str)) w += charW(ch, size); return w; };

// Split into display lines: honour explicit "\n", then greedy word-wrap each
// segment to maxWidth (skipped when maxWidth <= 0).
function wrapLines(text, size, maxWidth) {
  const out = [];
  for (const seg of String(text).split('\n')) {
    if (!(maxWidth > 0)) { out.push(seg); continue; }
    let line = '';
    for (const word of seg.split(/\s+/).filter(Boolean)) {
      const trial = line ? line + ' ' + word : word;
      if (line && textWidth(trial, size) > maxWidth) { out.push(line); line = word; } else line = trial;
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

// Global bump applied to every rendered label — ~2 typographic points (0.706mm).
const LABEL_BUMP = 0.706;

// Label. `x,y` is the anchor of the FIRST line; extra lines stack downward.
function label(x, y, text, { size = 2.4, fill = '#000000', anchor = 'middle', rotation = 0, maxWidth = 0, lineHeight = 1.15, weight = 700, italic = true } = {}) {
  size += LABEL_BUMP;
  const lines = wrapLines(text, size, maxWidth);
  const style = `font-size="${size}" font-weight="${weight}"${italic ? ' font-style="italic"' : ''} fill="${fill}" text-anchor="${anchor}" font-family="Arial Narrow, Helvetica, Arial, sans-serif"`;
  const rot = rotation ? ` transform="rotate(${rotation} ${x} ${y})"` : '';
  if (lines.length === 1) return `  <text x="${x}" y="${y}" ${style}${rot}>${esc(lines[0])}</text>`;
  const dy = +(size * lineHeight).toFixed(2);
  const tspans = lines.map((ln, i) => `<tspan x="${x}" dy="${i ? dy : 0}">${esc(ln)}</tspan>`).join('');
  return `  <text x="${x}" y="${y}" ${style}${rot}>${tspans}</text>`;
}

// Attach a label to a control centred at (cx,cy) with half-width hw and half-height
// hh. `placement` puts it below / above / left / right; the text block is centred
// on the control's axis and wraps to `maxWidth`. Control-type-agnostic — any
// control that names itself calls this, so placement and wrapping behave the same
// everywhere. Returns the label SVG.
function attachedLabel(cx, cy, hw, hh, spec = {}) {
  const { text, placement = 'below', gap = 1.6, size = 2.4, maxWidth = 0, fill = '#000000', lineHeight = 1.15 } = spec;
  const bs = size + LABEL_BUMP;   // label() bumps too; position/wrap at the same size
  const lines = wrapLines(text, bs, maxWidth);
  const n = lines.length, lh = bs * lineHeight, cap = bs * 0.72;
  let x, y, anchor;
  if (placement === 'left' || placement === 'right') {
    anchor = placement === 'left' ? 'end' : 'start';
    x = cx + (placement === 'left' ? -(hw + gap) : hw + gap);
    y = cy - (n - 1) * lh / 2 + cap * 0.5;            // vertically centre the block on cy
  } else if (placement === 'above') {
    anchor = 'middle'; x = cx;
    y = cy - hh - gap - (n - 1) * lh;                 // last line sits just above the control
  } else {                                            // below (default)
    anchor = 'middle'; x = cx;
    y = cy + hh + gap + cap;                          // first line sits just below the control
  }
  return label(x, y, lines.join('\n'), { size, fill, anchor, lineHeight });
}

// --- LED lamp · buttons · radio groups · slider -------------------------------

// A red LED lamp with a highlight — the shared building block for radios, buttons,
// and indicators. Pass role/step to make it a bindable step-indicator; `white` for
// the light push-button disc instead of the red LED.
function ledLamp(cx, cy, { r = 1.66, role = null, step = null, white = false } = {}) {
  const fill = white ? '#e9e9ec' : 'url(#redLed)', stroke = white ? '#8a8a8e' : '#7c0000', sw = white ? '0.35' : '0.2366';
  const roleAttr = role ? ` data-wcoast-role="${role}"${step != null ? ` data-wcoast-step="${step}"` : ''}` : '';
  const hr = 0.3 * r, hx = cx - 0.28 * r, hy = cy - 0.28 * r, hFill = white ? '#ffffff' : '#ffb4b4', hOp = white ? '0.8' : '0.85';
  return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}" filter="url(#softShadow)"${roleAttr}/>`
    + `<circle cx="${hx.toFixed(2)}" cy="${hy.toFixed(2)}" r="${hr.toFixed(2)}" fill="${hFill}" opacity="${hOp}" pointer-events="none"/>`;
}

// Small wave/shape glyph for a mode step, centred at (gx,gy): transient · sustained
// · cyclic (also triangle) · sawtooth · square.
function waveGlyph(kind, gx, gy, color = '#163a69', w = 1.3) {
  const t = (gy - 0.7).toFixed(2), b = (gy + 0.7).toFixed(2), sw = 0.3, L = (gx - w).toFixed(2), R = (gx + w).toFixed(2);
  if (kind === 'square') return `<path d="M ${L} ${b} L ${L} ${t} L ${gx} ${t} L ${gx} ${b} L ${R} ${b} L ${R} ${t}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`;
  let pts;
  if (kind === 'transient') pts = `${L},${b} ${gx},${t} ${R},${b}`;
  else if (kind === 'sustained') pts = `${L},${b} ${(gx - 0.5).toFixed(2)},${t} ${(gx + 0.5).toFixed(2)},${t} ${R},${b}`;
  else if (kind === 'sawtooth') pts = `${L},${b} ${R},${t} ${R},${b}`;
  else pts = `${L},${b} ${(gx - 0.65).toFixed(2)},${t} ${gx},${b} ${(gx + 0.65).toFixed(2)},${t} ${R},${b}`;   // cyclic / triangle
  return `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>`;
}

// Momentary / toggle push-button — a single step-indicator lamp. kind 'red' (LED)
// or 'white' (light disc). Covers strike, trig, mute, clock-on.
function button(id, cx, cy, { r = 2.2, kind = 'red' } = {}) {
  return `  <g data-wcoast-param="${id}">${ledLamp(cx, cy, { r, white: kind === 'white', role: 'step-indicator', step: 'on' })}</g>`;
}

// Radio group — one stepped param shown as a row/column of LED lamps (one lit).
// steps: [{ value, label?, glyph? }]. orientation 'h' | 'v'. Each LED can carry a
// side label (v → right, h → below) or a wave glyph (below).
function radioGroup(id, cx, cy, { steps = [], orientation = 'v', spacing = 5.6, ledR = 2.16, size = 2.1, theme = {} } = {}) {
  const ink = theme.ink || '#163a69', n = steps.length;
  let g = `  <g data-wcoast-param="${id}">`;
  steps.forEach((s, i) => {
    const off = (i - (n - 1) / 2) * spacing;
    const lx = orientation === 'h' ? cx + off : cx, ly = orientation === 'h' ? cy : cy + off;
    g += `\n    ${ledLamp(lx, ly, { r: ledR, role: 'step-indicator', step: s.value })}`;
    if (s.glyph) {
      const gx = orientation === 'h' ? lx : lx + ledR + 2.2, gy = orientation === 'h' ? ly + ledR + 2.4 : ly;
      g += `\n    ${waveGlyph(s.glyph, gx, gy, ink)}`;
    }
    if (s.label) {
      const tx = orientation === 'h' ? lx : lx + ledR + 1.3, ty = orientation === 'h' ? ly + ledR + 3 : ly + size * 0.35;
      g += `\n    ${label(tx, ty, s.label, { size, fill: ink, anchor: orientation === 'h' ? 'middle' : 'start' })}`;
    }
  });
  return g + `\n  </g>`;
}

// Vertical fader — a track with a handle riding top..bot; the host translates the
// handle by value. `valuePos` 0..1 sets the authored (rendered) position.
function slider(id, cx, { top = 24, bot = 78, valuePos = 0.5, theme = {} } = {}) {
  const track = theme.track || '#3a3d43', trackEdge = theme.trackEdge || '#222222';
  const handle = theme.handle || '#e9e9ec', handleEdge = theme.handleEdge || '#8a8a8e', handleLine = theme.handleLine || '#555555';
  const travel = bot - top, mid = top + travel / 2, hy = bot - valuePos * travel;
  return `  <g data-wcoast-param="${id}" data-wcoast-role="slider" data-wcoast-cx="${cx}" data-wcoast-top="${top}" data-wcoast-bot="${bot}">
    <rect x="${(cx - 1.2).toFixed(2)}" y="${(top - 2).toFixed(2)}" width="2.4" height="${(travel + 4).toFixed(2)}" rx="1.2" fill="${track}" stroke="${trackEdge}" stroke-width="0.3"/>
    <g data-wcoast-role="handle" transform="translate(0 ${(hy - mid).toFixed(3)})">
      <rect x="${(cx - 4).toFixed(2)}" y="${(mid - 2.2).toFixed(2)}" width="8" height="4.4" rx="1.1" fill="${handle}" stroke="${handleEdge}" stroke-width="0.4" filter="url(#softShadow)"/>
      <line x1="${(cx - 3.2).toFixed(2)}" y1="${mid}" x2="${(cx + 3.2).toFixed(2)}" y2="${mid}" stroke="${handleLine}" stroke-width="0.7"/>
    </g>
  </g>`;
}

// VU meter — a run of small rectangular segments the host lights from level. Each
// segment is 1.5mm along the run and 3× that across it (the long side perpendicular
// to the run). (cx,cy) is the bottom end (vertical) or left end (horizontal); the
// meter grows up / right over `length`, `segments` bars spaced evenly. Segments
// carry the binding tags so the host's RMS loop finds and fills them; `lit` pre-fills
// N bars (green→yellow→red) for a static preview where there's no live signal. A
// label (default 'VU') sits just past the anchor end.
function vuMeter(role, cx, cy, { length = 44, orientation = 'v', segments = 12, chan = '', label: lab = 'VU', lit = 0, theme = {} } = {}) {
  const frame = theme.frame || '#7d7d7d', ink = theme.ink || '#163a69';
  const T = 1.5, L = T * 3, half = T / 2, lhalf = L / 2;   // short side (run) / long side (across)
  const vertical = orientation !== 'h';
  const litColour = (f) => f > 0.85 ? '#ff5a4a' : f > 0.6 ? '#f4c430' : '#3ad16b';
  let segs = '';
  for (let i = 0; i < segments; i++) {
    const t = segments <= 1 ? 0 : i / (segments - 1);
    const x = vertical ? cx - lhalf : cx + t * length - half;
    const y = vertical ? cy - t * length - half : cy - lhalf;
    const w = vertical ? L : T, h = vertical ? T : L;
    const fill = i < lit ? litColour(t) : 'none';
    segs += `\n    <rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${w}" height="${h}" rx="0.35" fill="${fill}" stroke="${frame}" stroke-width="0.3" data-wcoast-seg="${i}"/>`;
  }
  const text = lab ? '\n' + label(vertical ? cx : cx + length / 2, (vertical ? cy + half : cy + lhalf) + 3.3, lab, { size: 2.2, fill: ink }) : '';
  return `  <g data-wcoast-role="${role}" data-wcoast-chan="${chan}">${segs}\n  </g>${text}`;
}

// Build evenly-spaced scale marks from a list of labels (each a string, or a line
// array for multi-line like ['220','A4']). Spreads them across the whole sweep.
function evenScale(labels, { tick = true } = {}) {
  const n = labels.length;
  return labels.map((label, i) => ({ at: n <= 1 ? 0.5 : i / (n - 1), label, tick }));
}

// Panel marking — a bipolar/polarity indicator drawn AROUND a knob: a curved double
// arrow concentric with the knob, arcing over its top with an arrowhead at each end
// pointing to a minus-circle (left) and a plus-circle (right), plus a short radial
// centre tick running from the knob edge out past the arc. Pass the KNOB's centre
// (kx,ky) and radius kr. Pure panel art, no binding.
function bipolarMark(kx, ky, kr, { gap = 2.0, spanDeg = 23, r = 1.27, color = '#163a69', sw = 0.4 } = {}) {
  const R = kr + gap, a = spanDeg * Math.PI / 180, sn = Math.sin(a), cs = Math.cos(a);
  const p0 = [kx - sn * R, ky - cs * R], p1 = [kx + sn * R, ky - cs * R];   // left / right arc ends
  const dir0 = [-cs, sn], dir1 = [cs, sn];                                  // unit tangents; heads point out toward the circles
  const rot = (vx, vy, t) => [vx * Math.cos(t) - vy * Math.sin(t), vx * Math.sin(t) + vy * Math.cos(t)];
  const head = (px, py, dx, dy) => {
    const bl = 1.2, [b1x, b1y] = rot(-dx, -dy, 0.5), [b2x, b2y] = rot(-dx, -dy, -0.5);
    return `<path d="M ${px.toFixed(2)} ${py.toFixed(2)} l ${(b1x * bl).toFixed(2)} ${(b1y * bl).toFixed(2)} M ${px.toFixed(2)} ${py.toFixed(2)} l ${(b2x * bl).toFixed(2)} ${(b2y * bl).toFixed(2)}" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  };
  const off = 1.2 + r + 0.7;                                                // circle centre sits beyond each head
  const cL = [p0[0] + dir0[0] * off, p0[1] + dir0[1] * off], cR = [p1[0] + dir1[0] * off, p1[1] + dir1[1] * off];
  const q = r * 0.5;
  const sign = (c, plus) => {
    let s = `<circle cx="${c[0].toFixed(2)}" cy="${c[1].toFixed(2)}" r="${r}" fill="none" stroke="${color}" stroke-width="${sw}"/>`;
    s += `<line x1="${(c[0] - q).toFixed(2)}" y1="${c[1].toFixed(2)}" x2="${(c[0] + q).toFixed(2)}" y2="${c[1].toFixed(2)}" stroke="${color}" stroke-width="${sw}"/>`;
    if (plus) s += `<line x1="${c[0].toFixed(2)}" y1="${(c[1] - q).toFixed(2)}" x2="${c[0].toFixed(2)}" y2="${(c[1] + q).toFixed(2)}" stroke="${color}" stroke-width="${sw}"/>`;
    return s;
  };
  const parts = [
    `<path d="M ${p0[0].toFixed(2)} ${p0[1].toFixed(2)} A ${R.toFixed(2)} ${R.toFixed(2)} 0 0 1 ${p1[0].toFixed(2)} ${p1[1].toFixed(2)}" fill="none" stroke="${color}" stroke-width="${sw}"/>`,
    head(p0[0], p0[1], dir0[0], dir0[1]), head(p1[0], p1[1], dir1[0], dir1[1]),
    `<line x1="${kx}" y1="${(ky - kr).toFixed(2)}" x2="${kx}" y2="${(ky - R - 1.3).toFixed(2)}" stroke="${color}" stroke-width="${sw}"/>`,
    sign(cL, false), sign(cR, true),
  ];
  return `  <g>\n    ${parts.join('\n    ')}\n  </g>`;
}

module.exports = { defs, jack, knob, label, attachedLabel, evenScale, bipolarMark, ledLamp, waveGlyph, button, radioGroup, slider, vuMeter, textWidth, wrapLines };
