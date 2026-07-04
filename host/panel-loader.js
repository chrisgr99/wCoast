// panel-loader.js — load a module's faceplate SVG and bind it to the schema.
//
// This is the host side of the binding contract (DESIGN.md §5). It takes a
// module's hand-authored panel SVG plus its descriptor, VALIDATES that the
// two agree (every `data-wcoast-*` tag resolves to a real descriptor id; every
// param/port has an element; knobs have an indicator + pivot; lamp switches
// have a step-indicator per step; jacks have an anchor), and returns a binding
// model the rest of the host drives: a map of controls (knobs/switches) and
// ports (jacks), each pointing at the live SVG elements the host rotates,
// lights, or anchors cords to.
//
// The panel says HOW the module looks and WHERE each element sits; the
// descriptor stays the source of truth for WHAT each control is. This file is
// the bridge. It reads the explicit `data-wcoast-cx/cy` pivots (in viewBox mm),
// so it needs no layout measurement — parsing is pure attribute reading, which
// keeps the validation logic testable apart from the DOM.

'use strict';

// Default pointer sweep (degrees each side of straight-up), per the contract.
// A control may override with data-wcoast-angle-min / -max.
const KNOB_SPAN = 150;
const SWITCH_SPAN = 20;

// Panels are authored at the full 128.5 mm Eurorack height, but only the
// functional FACE — the region between the top and bottom frame rails — is
// displayed; the mounting-rail rim (screw ears and title strip) is cropped so
// no vertical space is wasted, and modules can be scaled a little larger. These
// bounds are the shared convention for every module panel (the 259t frame).
export const FACE_TOP_MM = 7.0994;
export const FACE_H_MM = 113.5912;
// This panel's faceplate art is offset +3.9mm from the viewBox origin (an
// authoring quirk), so the drawn panel runs x=3.9..175.2, not 0..171.3. Crop the
// viewBox to the faceplate's left edge so a module FILLS its box — otherwise it
// carries a transparent left margin that shows as a dark seam between butted
// modules. Width is unchanged, so the right edge lands on the faceplate's right.
export const FACE_LEFT_MM = 3.9;

function cropToFace(svg) {
  const vb = (svg.getAttribute('viewBox') || '').trim().split(/\s+/).map(Number);
  if (vb.length === 4) svg.setAttribute('viewBox', `${FACE_LEFT_MM} ${FACE_TOP_MM} ${vb[2]} ${FACE_H_MM}`);
}

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function round2(x) { return Math.round(x * 100) / 100; }
function numAttr(el, name) {
  const v = el.getAttribute(name);
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Resolve a point given in an element's LOCAL coordinates up to the SVG root's
// user space (viewBox mm), composing every `transform` from the element to the
// root. Port anchors need this: an authored panel may wrap its jacks in a
// translated group, so raw data-wcoast-cx/cy is local, not absolute, and a
// cable drawn to the raw value lands off-centre. (Knob pivots deliberately stay
// LOCAL — their rotation is applied inside that same transformed group.)
function matMul(A, B) { // 2x3 affine [a,b,c,d,e,f]; result applies B then A
  return [
    A[0] * B[0] + A[2] * B[1], A[1] * B[0] + A[3] * B[1],
    A[0] * B[2] + A[2] * B[3], A[1] * B[2] + A[3] * B[3],
    A[0] * B[4] + A[2] * B[5] + A[4], A[1] * B[4] + A[3] * B[5] + A[5],
  ];
}
function parseTransform(str) {
  let M = [1, 0, 0, 1, 0, 0];
  const re = /(\w+)\s*\(([^)]*)\)/g;
  let m;
  while ((m = re.exec(str))) {
    const a = m[2].split(/[\s,]+/).map(Number).filter((v) => Number.isFinite(v));
    let T = null;
    if (m[1] === 'matrix' && a.length === 6) T = a;
    else if (m[1] === 'translate') T = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (m[1] === 'scale') T = [a[0] || 1, 0, 0, a.length > 1 ? a[1] : (a[0] || 1), 0, 0];
    if (T) M = matMul(M, T);
  }
  return M;
}
export function resolveToRoot(el, x, y) {
  let M = [1, 0, 0, 1, 0, 0];
  let node = el;
  while (node && node.nodeType === 1) {
    const t = node.getAttribute('transform');
    if (t) M = matMul(parseTransform(t), M);
    if (node.tagName && node.tagName.toLowerCase() === 'svg') break;
    node = node.parentNode;
  }
  return { x: M[0] * x + M[2] * y + M[4], y: M[1] * x + M[3] * y + M[5] };
}

// ---- value <-> normalised position (0..1) -------------------------------
// A knob turns LINEARLY in position; the value comes from position through the
// descriptor's curve (so an exp knob turns evenly while its Hz value tapers).

export function valueToPosition(meta, value) {
  if (meta.curve === 'exp') {
    const lo = Math.max(meta.min, 1e-6);
    return clamp01(Math.log(value / lo) / Math.log(meta.max / lo));
  }
  if (meta.curve === 'stepped') {
    const steps = meta.steps || [];
    if (steps.length < 2) return 0;
    const i = steps.findIndex((s) => s.value === value);
    return (i < 0 ? 0 : i) / (steps.length - 1);
  }
  return clamp01((value - meta.min) / (meta.max - meta.min));
}

export function positionToValue(meta, pos) {
  pos = clamp01(pos);
  if (meta.curve === 'exp') {
    const lo = Math.max(meta.min, 1e-6);
    return lo * Math.pow(meta.max / lo, pos);
  }
  if (meta.curve === 'stepped') {
    const steps = meta.steps || [];
    if (!steps.length) return undefined;
    const i = Math.round(pos * (steps.length - 1));
    return steps[Math.max(0, Math.min(steps.length - 1, i))].value;
  }
  return meta.min + pos * (meta.max - meta.min);
}

// ---- applying a value to the SVG ----------------------------------------

// Rotate a knob's pointer (or a lever switch's lever) to a normalised position.
export function showPosition(binding, pos) {
  if (!binding.indicator || !binding.pivot) return;
  const a = binding.angleMin + clamp01(pos) * (binding.angleMax - binding.angleMin);
  binding.indicator.setAttribute(
    'transform', `rotate(${round2(a)} ${binding.pivot.x} ${binding.pivot.y})`);
}

// Show a stepped param's current step: light the matching lamp(s) (dim the
// rest) AND displace the blade/lever to its position — an on/off toggle throws
// left for on and right for off; a multi-position selector fans across its
// positions.
export function showStep(binding, stepValue) {
  for (const [val, el] of binding.stepIndicators) {
    const on = val === stepValue;
    // On: a glowing red lamp. Off: a cream centre with a red ring (the same red
    // it glows) so an off lamp stays clearly visible against the light panel.
    el.setAttribute('fill', on ? 'url(#redLed)' : '#f6eccf');
    el.setAttribute('stroke', on ? '#7c0000' : '#d00000');
    el.setAttribute('stroke-width', on ? '0.2366' : '0.5');
    el.setAttribute('opacity', '1');
    const hi = el.nextElementSibling;   // the little glossy highlight
    if (hi && hi.getAttribute && hi.getAttribute('fill') === '#ffb4b4') {
      hi.setAttribute('opacity', on ? '0.85' : '0');
    }
  }
  if (binding.indicator && binding.pivot) {
    let angle = 0;
    if (binding.switchStyle === 'toggle') {
      const on = binding.stepValues.includes('on') ? 'on' : binding.stepValues[0];
      angle = (stepValue === on) ? -70 : 70;          // on -> left, off -> right
    } else {
      const n = binding.stepCount;
      const i = binding.stepValues.indexOf(stepValue);
      const spread = 55;
      angle = n > 1 ? -spread + (i < 0 ? 0 : i) * (2 * spread / (n - 1)) : 0;
    }
    binding.indicator.setAttribute('transform',
      `rotate(${round2(angle)} ${binding.pivot.x} ${binding.pivot.y})`);
  }
}

// Set a control from a raw descriptor value (dispatches on curve).
export function showValue(binding, value) {
  if (binding.meta.curve === 'stepped') showStep(binding, value);
  else showPosition(binding, valueToPosition(binding.meta, value));
}

// ---- parsing / validation -----------------------------------------------

// Build the binding model from an already-parsed SVG root and a descriptor.
// Pure DOM reading + validation; returns { svg, controls, ports, warnings }.
export function parsePanel(svg, descriptor) {
  const warnings = [];
  const paramMeta = new Map((descriptor.params || []).map((p) => [p.id, p]));
  const portMeta = new Map((descriptor.ports || []).map((p) => [p.id, p]));
  const controls = new Map();
  const ports = new Map();

  for (const el of svg.querySelectorAll('[data-wcoast-param]')) {
    const id = el.getAttribute('data-wcoast-param');
    const meta = paramMeta.get(id);
    if (!meta) { warnings.push(`unknown param tag "${id}"`); continue; }
    if (controls.has(id)) { warnings.push(`duplicate param "${id}"`); continue; }

    const stepped = meta.curve === 'stepped';
    const span = stepped ? SWITCH_SPAN : KNOB_SPAN;
    const cx = numAttr(el, 'data-wcoast-cx');
    const cy = numAttr(el, 'data-wcoast-cy');
    let angleMin = numAttr(el, 'data-wcoast-angle-min'); if (angleMin == null) angleMin = -span;
    let angleMax = numAttr(el, 'data-wcoast-angle-max'); if (angleMax == null) angleMax = span;

    const binding = {
      id, meta, group: el,
      kind: stepped ? 'switch' : 'knob',
      pivot: (cx != null && cy != null) ? { x: cx, y: cy } : null,
      indicator: el.querySelector('[data-wcoast-role="indicator"]'),
      operator: el.querySelector('[data-wcoast-role="operator"]'),
      switchStyle: el.getAttribute('data-wcoast-switch') || null,
      stepIndicators: new Map(),
      stepValues: (meta.steps || []).map((s) => s.value),
      stepCount: (meta.steps || []).length,
      angleMin, angleMax,
    };
    for (const s of el.querySelectorAll('[data-wcoast-role="step-indicator"]')) {
      binding.stepIndicators.set(s.getAttribute('data-wcoast-step'), s);
    }

    // Geometry validation (the contract's load-time checks).
    if (!stepped) {
      if (!binding.indicator) warnings.push(`knob "${id}" has no indicator element`);
      if (!binding.pivot) warnings.push(`knob "${id}" has no pivot (data-wcoast-cx/cy)`);
    } else {
      // A switch needs SOMETHING to operate/show it. Lamps needn't cover every
      // step (an on/off toggle has one "on" lamp; "off" is all-dark).
      for (const [val] of binding.stepIndicators) {
        if (!binding.stepValues.includes(val)) warnings.push(`switch "${id}" has a lamp for unknown step "${val}"`);
      }
      if (!binding.indicator && !binding.operator && !binding.stepIndicators.size) {
        warnings.push(`switch "${id}" has no operator, lever, or lamps`);
      }
    }
    controls.set(id, binding);
  }

  for (const el of svg.querySelectorAll('[data-wcoast-port]')) {
    const id = el.getAttribute('data-wcoast-port');
    const meta = portMeta.get(id);
    if (!meta) { warnings.push(`unknown port tag "${id}"`); continue; }
    if (ports.has(id)) { warnings.push(`duplicate port "${id}"`); continue; }
    const cx = numAttr(el, 'data-wcoast-cx');
    const cy = numAttr(el, 'data-wcoast-cy');
    if (cx == null || cy == null) warnings.push(`port "${id}" has no anchor (data-wcoast-cx/cy)`);
    // Resolve to root user space so cords land on the jack's true centre even
    // when the panel wraps the jack in a transformed group.
    const anchor = (cx != null && cy != null) ? resolveToRoot(el, cx, cy) : null;
    // The inner-hole radius (smallest circle) and the outer radius (largest), so
    // a cord can end in the middle of the jack's coloured ring — inside the colour
    // but clear of the dark centre hole.
    let holeR = 0, outerR = 0;
    for (const c of el.querySelectorAll('circle')) {
      const r = numAttr(c, 'r');
      if (r == null) continue;
      if (holeR === 0 || r < holeR) holeR = r;
      if (r > outerR) outerR = r;
    }
    ports.set(id, { id, meta, element: el, anchor, holeR, outerR });
  }

  // Coverage: every descriptor param/port must have exactly one element.
  for (const p of (descriptor.params || [])) {
    if (!controls.has(p.id)) warnings.push(`descriptor param "${p.id}" has no panel element`);
  }
  for (const p of (descriptor.ports || [])) {
    if (!ports.has(p.id)) warnings.push(`descriptor port "${p.id}" has no panel element`);
  }

  return { svg, controls, ports, warnings };
}

// ---- interaction --------------------------------------------------------
// Make a control operable. `hooks.get()` returns the control's current raw
// value; `hooks.set(value)` is called with the new value as the user scrolls
// or clicks. The host owns interaction uniformly across modules; the panel only
// supplies geometry. Knobs turn with the scroll wheel (pointer-drag is
// deliberately NOT used — it fights screen magnification, where the cursor
// can't be held still); switches cycle their steps on click. The caller's
// set() updates the visuals via showValue, so there is a single update path.

// Momentum smoothing for knob scrolling: a wheel/trackpad pulse adds velocity,
// which decays with drag while an animation loop integrates it into position.
const KNOB_STEP = 0.04;    // position move per normalised notch, pointer at centre
const KNOB_DRAG = 6;       // velocity decay per second (coast ~ 1/DRAG seconds)
const KNOB_MAXV = 8;       // clamp runaway velocity (position units / second)

export function attachControlInteraction(binding, hooks) {
  const el = binding.group;
  if (binding.kind === 'knob') {
    if (!binding.indicator || !binding.pivot) return;
    // Momentum: each scroll pulse adds velocity (scaled by the actual scroll
    // amount AND the radial fine-control factor); an animation loop integrates
    // it while drag bleeds it off, so the discrete pulses become smooth motion
    // and a gentle two-finger scroll makes very small, smooth changes.
    let vel = 0;      // position units per second
    let raf = null;
    let last = 0;
    const tick = (t) => {
      const now = t || performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const next = clamp01(valueToPosition(binding.meta, hooks.get()) + vel * dt);
      hooks.set(positionToValue(binding.meta, next));
      vel *= Math.exp(-KNOB_DRAG * dt);
      // Stop only when the velocity is spent, or when we're pushing INTO a
      // boundary (not when velocity would carry us away from it — that's how you
      // leave the edge again).
      const pinned = (next <= 0 && vel < 0) || (next >= 1 && vel > 0);
      if (Math.abs(vel) > 1e-3 && !pinned) raf = requestAnimationFrame(tick);
      else { raf = null; vel = 0; }
    };
    el.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;   // ctrl+wheel is a pinch-zoom for the rack, not a knob turn
      e.preventDefault();
      // Normalise the scroll amount across devices (px / lines / pages).
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      // Radial fine control: full rate at the centre, a quarter at the rim.
      let factor = 1;
      const ctm = el.getScreenCTM && el.getScreenCTM();
      if (ctm && binding.pivot) {
        const cx = ctm.a * binding.pivot.x + ctm.c * binding.pivot.y + ctm.e;
        const cy = ctm.b * binding.pivot.x + ctm.d * binding.pivot.y + ctm.f;
        const R = (el.getBoundingClientRect().width / 2) || 1;
        const r = Math.hypot(e.clientX - cx, e.clientY - cy);
        factor = Math.max(0.25, 1 - 0.75 * Math.min(1, r / R));
      }
      vel += (-d / 100) * KNOB_STEP * KNOB_DRAG * factor;   // up (negative delta) raises
      if (vel > KNOB_MAXV) vel = KNOB_MAXV; else if (vel < -KNOB_MAXV) vel = -KNOB_MAXV;
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }, { passive: false });
  } else if (binding.kind === 'switch' && binding.stepCount > 1) {
    // Operate a switch by clicking its LAMPS. A multi-position switch (Range,
    // Waveshape) jumps to whichever lamp you click; a single-lamp on/off switch
    // (the centre mod switches) flips between its two states when clicked.
    const lamps = [...binding.stepIndicators.entries()];
    if (lamps.length >= 2) {
      for (const [val, lamp] of lamps) {
        lamp.style.cursor = 'pointer';
        lamp.addEventListener('click', (e) => { e.stopPropagation(); hooks.set(val); });
      }
    } else if (lamps.length === 1) {
      const lamp = lamps[0][1];
      lamp.style.cursor = 'pointer';
      lamp.addEventListener('click', (e) => {
        e.stopPropagation();
        const cur = hooks.get();
        const other = binding.stepValues.find((v) => v !== cur);
        if (other !== undefined) hooks.set(other);
      });
    }
  }
}

// Fetch the panel SVG over the app:// origin, parse it, and bind it. Paths are
// relative to the origin root (a leading slash resolves against it).
export async function loadPanel(url, descriptor) {
  const href = url.startsWith('/') || url.includes('://') ? url : `/${url}`;
  const res = await fetch(href);
  if (!res.ok) throw new Error(`panel fetch ${href} failed: ${res.status}`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`panel SVG parse error: ${err.textContent.trim()}`);
  const svg = doc.documentElement;
  cropToFace(svg);   // show only the functional face; crop the mounting rim
  return parsePanel(svg, descriptor);
}
