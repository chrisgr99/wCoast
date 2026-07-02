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

function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }
function round2(x) { return Math.round(x * 100) / 100; }
function numAttr(el, name) {
  const v = el.getAttribute(name);
  if (v == null) return null;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
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

// Show a stepped param's current step: light the matching lamp (dim the rest),
// or, for a lever-style switch, rotate the lever to that step's angle.
export function showStep(binding, stepValue) {
  if (binding.stepIndicators.size) {
    for (const [val, el] of binding.stepIndicators) {
      el.setAttribute('opacity', val === stepValue ? '1' : '0.18');
    }
  } else if (binding.indicator && binding.stepCount > 1) {
    const i = binding.stepValues.indexOf(stepValue);
    showPosition(binding, (i < 0 ? 0 : i) / (binding.stepCount - 1));
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
    } else if (binding.stepIndicators.size) {
      for (const s of meta.steps) {
        if (!binding.stepIndicators.has(s.value)) {
          warnings.push(`switch "${id}" has no lamp for step "${s.value}"`);
        }
      }
    } else if (!binding.indicator) {
      warnings.push(`switch "${id}" has neither step-indicators nor a lever indicator`);
    } else if (!binding.pivot) {
      warnings.push(`switch "${id}" lever has no pivot`);
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
    ports.set(id, { id, meta, element: el, anchor: (cx != null && cy != null) ? { x: cx, y: cy } : null });
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

const WHEEL_STEP = 0.005;  // position change per wheel notch (0..1 over 200 notches)

export function attachControlInteraction(binding, hooks) {
  const el = binding.group;
  if (binding.kind === 'knob') {
    if (!binding.indicator || !binding.pivot) return;
    // Scroll the wheel over a knob to turn it.
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const dir = e.deltaY < 0 ? 1 : -1;
      const pos = clamp01(valueToPosition(binding.meta, hooks.get()) + dir * WHEEL_STEP);
      hooks.set(positionToValue(binding.meta, pos));
    }, { passive: false });
  } else if (binding.kind === 'switch' && binding.stepCount > 1) {
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      const cur = hooks.get();
      const i = binding.stepValues.indexOf(cur);
      const next = binding.stepValues[(i + 1) % binding.stepCount];
      hooks.set(next);
    });
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
  return parsePanel(doc.documentElement, descriptor);
}
