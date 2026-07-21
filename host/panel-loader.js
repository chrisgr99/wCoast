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
// bounds are the shared convention for every module panel (the Complex Oscillator frame).
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

// A volume/gain fader taper: the throw is dB-LINEAR (equal travel = equal dB), unity at
// the top and ~GAIN_FLOOR_DB near the bottom, so it matches how the ear hears level. The
// range is deliberately moderate so a useful default sits around the middle of the throw
// (mixer channels default to ~60% travel) with clear headroom above — not pinned near the
// top. Use Mute for true silence.
const GAIN_FLOOR_DB = -36;

export function valueToPosition(meta, value) {
  if (meta.curve === 'gainDb') {
    if (value <= meta.min) return 0;
    return clamp01(1 - (20 * Math.log10(value / meta.max)) / GAIN_FLOOR_DB);
  }
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
  // A DETENT knob: integer values min..max, evenly spaced along the throw. Like a linear
  // knob for placement, but positionToValue rounds to the nearest integer so the pointer
  // (and value) only ever land on a mark.
  if (meta.curve === 'detent') {
    if (meta.max === meta.min) return 0;
    return clamp01((value - meta.min) / (meta.max - meta.min));
  }
  return clamp01((value - meta.min) / (meta.max - meta.min));
}

export function positionToValue(meta, pos) {
  pos = clamp01(pos);
  if (meta.curve === 'gainDb') {
    if (pos <= 0) return meta.min;
    return meta.max * Math.pow(10, (GAIN_FLOOR_DB * (1 - pos)) / 20);
  }
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
  // Detent knob: snap to the nearest integer in min..max, so a scroll clicks from one mark
  // to the next and never rests between them.
  if (meta.curve === 'detent') {
    return meta.min + Math.round(pos * (meta.max - meta.min));
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
    // A medium-light-gray push-button disc either way; ON lights a red LED in its
    // centre (the ledLit gradient: red core fading to the gray body) plus a glossy
    // highlight. OFF is the flat gray disc. The thin edge is black on the light
    // panel, the font-gray on the dark panel.
    el.setAttribute('fill', on ? 'url(#ledLit)' : BUTTON_OFF);
    el.setAttribute('stroke', binding.dark ? DARK_LINE : BUTTON_EDGE_LIGHT);
    // Match the jack edge's PROPORTION (~6% of radius): buttons are smaller, so a
    // fixed width read much heavier on them. Scale the edge to each button's radius.
    const r = parseFloat(el.getAttribute('r')) || 2;
    const edgeW = r * 0.06 * (on ? 1 : 2);   // double the outline on unlit buttons
    el.setAttribute('stroke-width', String(Math.round(edgeW * 1000) / 1000));
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

// Slide a fader's handle to a normalised position. The handle is authored at the
// track midpoint and translated along y; pos 1 (full) is at the top (bot..top).
export function showSlider(binding, pos) {
  if (!binding.handle || binding.top == null || binding.bot == null) return;
  const travel = binding.bot - binding.top;
  binding.handle.setAttribute('transform', `translate(0 ${round2(travel * (0.5 - clamp01(pos)))})`);
}

// Set a control from a raw descriptor value (dispatches on kind/curve).
export function showValue(binding, value) {
  if (binding.kind === 'slider') showSlider(binding, valueToPosition(binding.meta, value));
  else if (binding.meta.curve === 'stepped') showStep(binding, value);
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
    // A SLIDER (fader): a linear param whose group is tagged data-wcoast-role
    // "slider" and holds a data-wcoast-role "handle" child that rides a vertical
    // track spanning data-wcoast-top..bot (group-local y). Drag moves the handle;
    // unlike a knob it has no rotating indicator or pivot.
    if (el.getAttribute('data-wcoast-role') === 'slider') {
      const handle = el.querySelector('[data-wcoast-role="handle"]');
      const top = numAttr(el, 'data-wcoast-top');
      const bot = numAttr(el, 'data-wcoast-bot');
      if (!handle) warnings.push(`slider "${id}" has no handle element`);
      if (top == null || bot == null) warnings.push(`slider "${id}" has no track range (data-wcoast-top/bot)`);
      controls.set(id, { id, meta, group: el, kind: 'slider', handle, top, bot });
      continue;
    }
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
      stepper: el.querySelector('[data-wcoast-role="stepper"]'),
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

// A single push button (momentary or on/off) can carry an invisible hit-pad a few mm wider
// than its lamp, so it's easier to click. Placed as the FIRST child of the lamp's parent so
// it sits UNDER the lamp (the lamp still owns its own area; the pad only catches the margin)
// and never becomes the lamp's nextElementSibling (which showStep uses for the gloss).
function makeHitPad(lamp, growMm) {
  if (!(growMm > 0.05) || !lamp || !lamp.parentNode) return null;
  const cx = parseFloat(lamp.getAttribute('cx')), cy = parseFloat(lamp.getAttribute('cy')), r = parseFloat(lamp.getAttribute('r'));
  if (!isFinite(cx) || !isFinite(cy) || !isFinite(r)) return null;
  const pad = lamp.ownerDocument.createElementNS(SVG_NS, 'circle');
  pad.setAttribute('cx', cx); pad.setAttribute('cy', cy);
  pad.setAttribute('r', String(Math.round((r + growMm) * 1000) / 1000));
  pad.setAttribute('fill', 'none'); pad.setAttribute('pointer-events', 'all'); pad.setAttribute('class', 'hit-pad');
  lamp.parentNode.insertBefore(pad, lamp.parentNode.firstChild);
  return pad;
}

export function attachControlInteraction(binding, hooks, opts = {}) {
  const el = binding.group;
  if (binding.kind === 'knob' && binding.meta.curve === 'detent') {
    // A DETENT knob steps by whole integers. Momentum integration would move the
    // position by less than one detent per gentle notch and round straight back, so
    // it never leaves its mark — scroll must advance discrete detents instead. Scroll
    // deltas accumulate; each time they cross a threshold the value steps one detent.
    if (!binding.indicator || !binding.pivot) return;
    const min = binding.meta.min, max = binding.meta.max, THRESH = 100;
    let acc = 0;
    const step = (dir) => {
      const cur = Math.round(Number(hooks.get()));
      const nv = Math.max(min, Math.min(max, cur + dir));
      if (nv !== cur) hooks.set(nv);
    };
    el.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;   // ctrl+wheel is the rack pinch-zoom
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      acc += -d;   // up (negative delta) raises the value
      let guard = 0;
      while (acc >= THRESH && guard++ < 8) { acc -= THRESH; step(+1); }
      while (acc <= -THRESH && guard++ < 8) { acc += THRESH; step(-1); }
    }, { passive: false });
    return;
  }
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
  } else if (binding.kind === 'slider') {
    // Faders are DRAGGED (unlike knobs, which scroll): the value tracks the
    // pointer's y within the track. Map the client point into the group's user
    // space via the inverse screen CTM (which carries the panel's mm scale and
    // the crop translate), then normalise against top..bot. stopPropagation keeps
    // a fader grab from starting a rack module drag.
    if (!binding.handle || binding.top == null || binding.bot == null) return;
    // Widen the scroll/drag hit area to a full-travel column the WIDTH OF THE HANDLE. The track
    // alone is narrower than the handle, so as the handle scrolls out from under the pointer the
    // wheel would otherwise stop firing. An invisible rect (inserted behind everything) keeps the
    // whole handle-wide column live from bottom to top. The handle's getBBox is empty until the
    // panel is laid out, so size the rect on the next frame(s), retrying until it's valid.
    const pad = el.ownerDocument.createElementNS(SVG_NS, 'rect');
    pad.setAttribute('fill', 'none'); pad.setAttribute('pointer-events', 'all'); pad.setAttribute('class', 'hit-pad');
    el.insertBefore(pad, el.firstChild);
    // Size it once the handle can actually be measured (getBBox is empty while the panel is hidden
    // behind the startup card, so a fixed frame count can miss). Idempotent, re-run on the first
    // hover/scroll — the handle is always hittable, so the pointer reaches the group before the
    // widened column is needed.
    let padSized = false;
    const sizePad = () => {
      if (padSized) return;
      let hb = null; try { hb = binding.handle.getBBox(); } catch (_e) { /* not rendered */ }
      if (!hb || !(hb.width > 0)) return;
      const y0 = Math.min(+binding.top, +binding.bot) - hb.height / 2;
      const y1 = Math.max(+binding.top, +binding.bot) + hb.height / 2;
      pad.setAttribute('x', round2(hb.x)); pad.setAttribute('y', round2(y0));
      pad.setAttribute('width', round2(hb.width)); pad.setAttribute('height', round2(y1 - y0));
      padSized = true;
    };
    el.addEventListener('pointerenter', sizePad);
    el.addEventListener('pointermove', sizePad);
    el.addEventListener('wheel', sizePad, { passive: true });
    requestAnimationFrame(sizePad);   // common case: panel already visible
    const posFromEvent = (e) => {
      const ctm = el.getScreenCTM && el.getScreenCTM();
      if (!ctm) return null;
      const inv = ctm.inverse();
      const ly = inv.b * e.clientX + inv.d * e.clientY + inv.f;
      return clamp01((binding.bot - ly) / (binding.bot - binding.top));
    };
    const onMove = (e) => { const p = posFromEvent(e); if (p != null) hooks.set(positionToValue(binding.meta, p)); };
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      el.setPointerCapture && el.setPointerCapture(e.pointerId);
      onMove(e);
      const up = (ev) => {
        el.releasePointerCapture && el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
    // Faders also take the scroll wheel, with the same momentum feel as the knobs
    // (no radial factor — a fader is linear).
    let vel = 0, raf = null, last = 0;
    const tick = (t) => {
      const now = t || performance.now();
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const next = clamp01(valueToPosition(binding.meta, hooks.get()) + vel * dt);
      hooks.set(positionToValue(binding.meta, next));
      vel *= Math.exp(-KNOB_DRAG * dt);
      const pinned = (next <= 0 && vel < 0) || (next >= 1 && vel > 0);
      if (Math.abs(vel) > 1e-3 && !pinned) raf = requestAnimationFrame(tick);
      else { raf = null; vel = 0; }
    };
    el.addEventListener('wheel', (e) => {
      if (e.ctrlKey) return;   // ctrl+wheel is the rack pinch-zoom
      e.preventDefault();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      vel += (-d / 100) * KNOB_STEP * KNOB_DRAG;   // up (negative delta) raises
      if (vel > KNOB_MAXV) vel = KNOB_MAXV; else if (vel < -KNOB_MAXV) vel = -KNOB_MAXV;
      if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); }
    }, { passive: false });
  } else if (binding.kind === 'switch' && binding.stepCount > 1) {
    // Operate a switch by clicking its LAMPS. A multi-position switch (Range,
    // Waveshape) jumps to whichever lamp you click; a single-lamp on/off switch
    // (the centre mod switches) flips between its two states when clicked.
    const lamps = [...binding.stepIndicators.entries()];
    if (binding.stepper) {
      // A stepper: one button advances the param to its next step (wrapping); the
      // lamps only indicate the current step and are not clickable.
      binding.stepper.style.cursor = 'pointer';
      binding.stepper.addEventListener('click', (e) => {
        e.stopPropagation();
        const v = binding.stepValues, i = v.indexOf(hooks.get());
        hooks.set(v[(i + 1) % v.length]);
      });
    } else if (binding.meta.momentary && lamps.length >= 1) {
      // Momentary push button (STRIKE): ON only while held, OFF on release, and
      // every press is a fresh trigger. Capture the pointer so the release still
      // registers if it happens off the lamp.
      const lamp = lamps[0][1];
      const on = binding.stepValues.includes('on') ? 'on' : binding.stepValues[0];
      const off = binding.stepValues.find((v) => v !== on);
      const release = () => { if (hooks.get() === on) hooks.set(off); };
      const pad = makeHitPad(lamp, opts.hitGrowMm);
      for (const tgt of pad ? [lamp, pad] : [lamp]) {
        tgt.style.cursor = 'pointer';
        tgt.addEventListener('pointerdown', (e) => { e.stopPropagation(); tgt.setPointerCapture && tgt.setPointerCapture(e.pointerId); hooks.set(on); });
        tgt.addEventListener('pointerup', release);
        tgt.addEventListener('pointercancel', release);
      }
    } else if (lamps.length >= 2) {
      for (const [val, lamp] of lamps) {
        lamp.style.cursor = 'pointer';
        lamp.addEventListener('click', (e) => { e.stopPropagation(); hooks.set(val); });
      }
    } else if (lamps.length === 1) {
      const lamp = lamps[0][1];
      const toggle = (e) => {
        e.stopPropagation();
        const cur = hooks.get();
        const other = binding.stepValues.find((v) => v !== cur);
        if (other !== undefined) hooks.set(other);
      };
      const pad = makeHitPad(lamp, opts.hitGrowMm);
      for (const tgt of pad ? [lamp, pad] : [lamp]) { tgt.style.cursor = 'pointer'; tgt.addEventListener('click', toggle); }
    }
  }
}

// ---- jack colour code + dark-mode decoration (applied, not authored) ----
// Jacks carry TWO reads, applied HERE (not baked per-jack in the art) so one code
// paints both panels and every module. COLOUR = signal family: audio yellow,
// CV/control orange, trigger/gate/pulse blue, with 1V/oct pitch inputs kept green;
// the same colour serves an input and an output. DIRECTION = a bold black dashed
// ring (addDirRing): an output's hugs the OUTER edge of the coloured band, an
// input's hugs the HOLE, each a third of the band wide so it reads at a glance.
// Every jack gets a thin black edge on the LIGHT panel only (black would vanish on
// the dark face). The centre hole is dark grey with a hair-thin light-grey rim.
// Unlit lamps show dark grey (not cream) on the dark panel; a vertical TITLE up
// the left edge is added in both modes.

const SVG_NS = 'http://www.w3.org/2000/svg';
const DARK_LINE = '#b8b8bc';        // dark-mode vertical title (light gray)
// Push buttons are a medium-LIGHT-gray disc in BOTH states; pressed/on adds a red
// LED in the centre (the `ledLit` gradient below). The thin edge is black on the
// light panel and the font-gray on the dark panel (set per-mode in showStep).
const BUTTON_OFF = '#505055';        // unlit push-button body: dark-medium gray
const BUTTON_EDGE_LIGHT = '#141414'; // button edge on the light panel (black); dark uses DARK_LINE

const round3 = (x) => Math.round(x * 1000) / 1000;

// The jack colour code — one colour per SIGNAL FAMILY, the same for in and out
// (direction is carried by the dashed ring, addDirRing).
const JACK = {
  audio: '#f3c40b',    // audio — yellow
  cv: '#ff7300',       // CV / control — orange
  trigger: '#5aa0e6',  // trigger / gate / pulse — light blue (black dashes read on it)
  pitch: '#39a85a',    // 1V/oct pitch — green (kept distinct)
  ring: '#000000',     // the direction dashes
  hole: '#2f2f33',     // centre plug-hole
  holeRim: '#cfcfd3',  // hair-thin light rim around the hole
  holeRimW: '0.15',
  edge: '#111111',     // thin black edge on every jack (light panel only)
  edgeW: '0.22',
};

function isPitch(meta) { return meta.role === 'pitch' || meta.name === '1V/Oct'; }
function jackFill(meta) {
  if (isPitch(meta)) return JACK.pitch;         // 1V/oct pitch stays green
  if (meta.domain === 'audio') return JACK.audio;
  if (meta.domain === 'trigger') return JACK.trigger;
  return JACK.cv;                               // control / CV
}

// Paint one jack: outer ring = type colour with a thin black edge on the light
// panel (defines every jack against the light face; black would be invisible on
// the dark panel, so it's dropped there); inner hole = dark grey with a hair-thin
// light rim.
function paintJack(port, dark) {
  const circles = [...port.element.querySelectorAll('circle')];
  if (!circles.length || !port.meta) return;
  let outer = circles[0], hole = circles[0], ro = -1, rh = Infinity;
  for (const c of circles) { const r = parseFloat(c.getAttribute('r')) || 0; if (r > ro) { ro = r; outer = c; } if (r < rh) { rh = r; hole = c; } }
  outer.setAttribute('fill', jackFill(port.meta));
  if (!dark) { outer.setAttribute('stroke', JACK.edge); outer.setAttribute('stroke-width', JACK.edgeW); }
  else { outer.setAttribute('stroke', 'none'); outer.setAttribute('stroke-width', '0'); }
  if (hole !== outer) { hole.setAttribute('fill', JACK.hole); hole.setAttribute('stroke', JACK.holeRim); hole.setAttribute('stroke-width', JACK.holeRimW); }
  addDirRing(port, outer, ro, rh);
}

// The direction ring: a bold black dashed band a THIRD of the coloured surround
// wide, laid on the OUTER third (touching the outer edge) for an output and the
// INNER third (touching the hole) for an input — so one family colour reads as in
// or out. Dashes are equal and short, fitted to a whole number of periods so the
// ring closes cleanly. Idempotent: a re-paint (e.g. dark-mode toggle) replaces it.
function addDirRing(port, outer, ro, rh) {
  const old = port.element.querySelector('.jack-dir-ring');
  if (old) old.remove();
  if (!(ro > 0) || !(rh < ro) || !port.meta.dir) return;
  const band = ro - rh, w = band / 3;
  const cx = parseFloat(outer.getAttribute('cx')) || 0;
  const cy = parseFloat(outer.getAttribute('cy')) || 0;
  const ringR = port.meta.dir === 'out' ? ro - w / 2 : rh + w / 2;
  const circ = 2 * Math.PI * ringR;
  const n = Math.max(6, Math.round(circ / (w * 1.6)));   // dash+gap ≈ 1.6·w
  const seg = circ / (2 * n);                            // equal dash and gap
  const ring = port.element.ownerDocument.createElementNS(SVG_NS, 'circle');
  ring.setAttribute('class', 'jack-dir-ring');
  ring.setAttribute('cx', round3(cx)); ring.setAttribute('cy', round3(cy)); ring.setAttribute('r', round3(ringR));
  ring.setAttribute('fill', 'none');
  ring.setAttribute('stroke', JACK.ring);
  ring.setAttribute('stroke-width', round3(w));
  ring.setAttribute('stroke-dasharray', round3(seg) + ' ' + round3(seg));
  port.element.appendChild(ring);
}

// The lit-button gradient: a red LED core fading to the gray button body, so an
// ON button reads as a dark-gray disc with a glowing centre. Injected once per
// panel so showStep can reference url(#ledLit).
function ensureLedGradient(svg) {
  const doc = svg.ownerDocument;
  let defs = svg.querySelector('defs');
  if (!defs) { defs = doc.createElementNS(SVG_NS, 'defs'); svg.insertBefore(defs, svg.firstChild); }
  if (svg.querySelector('#ledLit')) return;
  const g = doc.createElementNS(SVG_NS, 'radialGradient');
  g.setAttribute('id', 'ledLit');
  // Red LED lens fills the WHOLE button (a glowing dome, bright centre → deep red
  // edge) — no gray rim; the only ring is the thin outline the button already has.
  for (const [off, col] of [['0', '#ff7a5a'], ['0.5', '#ee2a10'], ['0.82', '#d21010'], ['1', '#8f0c0c']]) {
    const s = doc.createElementNS(SVG_NS, 'stop'); s.setAttribute('offset', off); s.setAttribute('stop-color', col); g.appendChild(s);
  }
  defs.appendChild(g);
}

// ---- Module identity strip -------------------------------------------------
// A set of coloured stripes down the title column, whose colour(s) are the signal type(s) the module
// OUTPUTS — the same palette as the jacks — so a rack's structure reads at a glance from the pattern
// of module colours. Derived from the module's output ports (primary = the type it outputs most),
// unless the descriptor names it explicitly via `signalIdentity` (an ordered list like
// ['cv','trigger']). The stripes run SIDE BY SIDE, each the full height of the module (primary on the
// LEFT), so every colour spans the whole module and reads as one identity — not a top vs a bottom.
// They break around the vertical title so they never run behind the label.
const IDENTITY_KEY_COLOR = { audio: JACK.audio, cv: JACK.cv, control: JACK.cv, trigger: JACK.trigger, gate: JACK.trigger, pitch: JACK.pitch };

// The band is a large block of colour, so it reads brighter than the small jacks that use the same
// palette. Knock the band's brightness down (hue and saturation kept: every channel scaled equally)
// so it sits back without changing which colour it is. The jacks/cables keep the full palette.
const BAND_DIM = 0.8;
function dimColor(hex, f) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '');
  if (!m) return hex;
  const to = (v) => Math.round(parseInt(v, 16) * f).toString(16).padStart(2, '0');
  return '#' + to(m[1]) + to(m[2]) + to(m[3]);
}

function moduleIdentityColors(descriptor, ports) {
  const decl = descriptor && descriptor.signalIdentity;
  if (Array.isArray(decl) && decl.length) return decl.map((k) => IDENTITY_KEY_COLOR[k] || JACK.cv).slice(0, 3);
  const tally = new Map();
  for (const p of ports.values()) {
    if (!p.meta || p.meta.dir !== 'out') continue;
    const c = jackFill(p.meta);
    tally.set(c, (tally.get(c) || 0) + 1);
  }
  return [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, 3);   // primary (most outputs) first
}

// [a,b] with the label gap [ga,gb] cut out → 0, 1 or 2 sub-intervals.
function minusGap(a, b, ga, gb) {
  if (gb <= ga || gb <= a || ga >= b) return [[a, b]];
  const out = [];
  if (a < ga) out.push([a, Math.min(ga, b)]);
  if (b > gb) out.push([Math.max(gb, a), b]);
  return out;
}

function drawIdentityStrip(svg, descriptor, ports, name) {
  const old = svg.querySelector('.module-identity');
  if (old) old.remove();
  const colors = moduleIdentityColors(descriptor, ports);
  if (!colors.length) return;
  const doc = svg.ownerDocument;
  const g = doc.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'module-identity');
  g.setAttribute('pointer-events', 'none');
  const N = colors.length;
  // The band spans the vertical title's WIDTH (the glyph height — a font-fixed constant, not the name
  // length). The rotated glyph block sits ~1.1mm toward the OUTER side of the baseline (ascenders reach
  // further than descenders), so centre the band on the glyph block, not on the baseline, or the label
  // reads off-centre in its box.
  const cx = FACE_LEFT_MM + 3.4;                            // title baseline column (x = 7.3)
  const labelCenter = cx - 1.12;                            // the glyph block's actual centre
  const glyphHalf = 1.79, margin = 0.25;                    // half the glyph height + a hair of breathing room
  const outerX = round3(labelCenter - glyphHalf - margin);  // band outer (left) edge
  const innerX = round3(labelCenter + glyphHalf + margin);  // band inner (right) edge — just past the label
  const w = (innerX - outerX) / N;                          // stripe width; PRIMARY on the RIGHT, nearest the label
  const top = FACE_TOP_MM, H = FACE_H_MM, bottom = top + H, centerY = top + H / 2;
  // The vertical title's length (name-dependent) — estimated at ~1.5mm/char, since a detached SVG can't
  // measure text — with a small pad so the stripes HUG the name. An empty name leaves no gap.
  let gapTop = centerY, gapBot = centerY;
  if (name) { const half = (name.length * 1.5) / 2 + 0.8; gapTop = Math.max(top, centerY - half); gapBot = Math.min(bottom, centerY + half); }
  // The primary (inner) edge continues straight down through the gap as a hair-thin line, UNDERLINING
  // the label — joining the stripes above and below so the name sits in a colour "box".
  const lineW = 0.3;
  const line = doc.createElementNS(SVG_NS, 'rect');
  line.setAttribute('x', round3(innerX - lineW)); line.setAttribute('y', round3(top));
  line.setAttribute('width', lineW); line.setAttribute('height', round3(H));
  line.setAttribute('fill', dimColor(colors[0], BAND_DIM));  // primary colour, dimmed
  g.appendChild(line);
  for (let i = 0; i < N; i++) {
    const x = round3(outerX + i * w);
    const col = colors[N - 1 - i];                          // reversed: primary rightmost, nearest the label
    for (const [a, b] of minusGap(top, bottom, gapTop, gapBot)) {   // each stripe runs full height, broken at the label
      if (b - a < 0.6) continue;
      const r = doc.createElementNS(SVG_NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', round3(a));
      r.setAttribute('width', round3(w)); r.setAttribute('height', round3(b - a));
      r.setAttribute('fill', dimColor(col, BAND_DIM));
      g.appendChild(r);
    }
  }
  svg.appendChild(g);   // above the faceplate art, below the title text (appended next)
}

function decoratePanel(parsed, descriptor, opts) {
  const { svg, controls, ports } = parsed;
  ensureLedGradient(svg);
  for (const b of controls.values()) b.dark = opts.dark;   // showStep picks the button edge by mode
  for (const port of ports.values()) paintJack(port, opts.dark);
  // Vertical title up the left edge, fitted into the existing left margin.
  const name = (descriptor && descriptor.name) || '';
  drawIdentityStrip(svg, descriptor, ports, name);   // colour bar in the title column (breaks around the label below)
  if (name) {
    const t = svg.ownerDocument.createElementNS(SVG_NS, 'text');
    t.setAttribute('transform', `translate(${round2(FACE_LEFT_MM + 3.4)} ${round2(FACE_TOP_MM + FACE_H_MM / 2)}) rotate(-90)`);
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('font-size', '3.1');
    t.setAttribute('font-weight', '700');
    t.setAttribute('letter-spacing', '0.2');
    t.setAttribute('fill', opts.dark ? '#ffffff' : '#163a69');
    t.setAttribute('class', 'module-title');
    t.setAttribute('opacity', '0.9');
    t.setAttribute('pointer-events', 'auto');   // the title is the delete/move handle (right-click for its pie)
    t.textContent = name;
    svg.appendChild(t);
  }
}

// Fetch the panel SVG, parse it, and bind it. The URL is used as-is — RELATIVE to
// the document — so it resolves whether the page is served at the origin root
// (Electron's app:// scheme) or under a sub-path (e.g. GitHub Pages). `opts.dark`
// selects the dark decoration (the caller has already chosen the dark file URL).
export async function loadPanel(url, descriptor, opts = {}) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`panel fetch ${url} failed: ${res.status}`);
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error(`panel SVG parse error: ${err.textContent.trim()}`);
  const svg = doc.documentElement;
  cropToFace(svg);   // show only the functional face; crop the mounting rim
  const parsed = parsePanel(svg, descriptor);
  decoratePanel(parsed, descriptor, opts);
  return parsed;
}
