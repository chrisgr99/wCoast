// designer.js — Panel editor, Phase 3: select, move, and save.
//
// Renders a module's layout (panel.layout.js data) through the shared renderer in the
// BROWSER, then decorates it with the real panel loader (jack colours, identity band,
// vertical title) so the preview matches the shipped panel exactly. On top of the
// decorated panel it lays a transparent handle over every id-bearing control: click to
// select, drag or arrow-key to move. Moves are recorded as position overrides and, on
// Save, written to modules/<id>/panel.overrides.json and the SVGs regenerated — the
// draw-and-tune loop that replaces hand-editing the layout. See design/panel-editor.md.

import { renderPanel } from './panel/render.js';
import { loadPanel } from './host/panel-loader.js';
import { applyOverrides } from './panel/overrides.js';

import oscLayout from './modules/complex-oscillator-259t/panel.layout.js';
import oscDesc from './modules/complex-oscillator-259t/descriptor.js';
import lpgLayout from './modules/lpg-292/panel.layout.js';
import lpgDesc from './modules/lpg-292/descriptor.js';
import fnLayout from './modules/function-gen-281t/panel.layout.js';
import fnDesc from './modules/function-gen-281t/descriptor.js';
import mixerLayout from './modules/mixer/panel.layout.js';
import mixerDesc from './modules/mixer/descriptor.js';
import galleryLayout from './modules/gallery/panel.layout.js';
import galleryDesc from './modules/gallery/descriptor.js';

const NS = 'http://www.w3.org/2000/svg';
const clone = (o) => JSON.parse(JSON.stringify(o));
const round3 = (n) => Math.round(n * 1000) / 1000;

const MODULES = [
  { name: 'Complex Oscillator', dir: 'complex-oscillator-259t', base: oscLayout, desc: oscDesc },
  { name: 'Quad Low Pass Gate', dir: 'lpg-292', base: lpgLayout, desc: lpgDesc },
  { name: 'Quad Function Generator', dir: 'function-gen-281t', base: fnLayout, desc: fnDesc },
  { name: 'Mixer / Output', dir: 'mixer', base: mixerLayout, desc: mixerDesc },
  { name: 'Control Gallery', dir: 'gallery', base: galleryLayout, desc: galleryDesc },
];

const stage = document.getElementById('stage');
const picker = document.getElementById('picker');
const darkBtn = document.getElementById('darkBtn');
const saveBtn = document.getElementById('saveBtn');
const revertBtn = document.getElementById('revertBtn');
const status = document.getElementById('status');
const readout = document.getElementById('readout');

let dark = true;
let idx = 0;
let selectedId = null;
let currentLayout = null;   // the working layout of the last render (base + overrides)
let currentSvg = null;

MODULES.forEach((m, i) => {
  const o = document.createElement('option');
  o.value = String(i); o.textContent = m.name; picker.appendChild(o);
  m.overrides = {};        // live edits (loaded from disk at startup)
  m.saved = {};            // what's on disk, for revert + dirty check
});

// ---- geometry ------------------------------------------------------------
// viewBox as {x,y,w,h}, parsed from the attribute — reliable on a detached SVG,
// where viewBox.baseVal reads as 0 until the element is in the document.
function viewBoxOf(svg) {
  const [x, y, w, h] = (svg.getAttribute('viewBox') || '0 0 1 1').trim().split(/\s+/).map(Number);
  return { x, y, w, h };
}

// Where a layout's items sit in the SVG's user space. Wrapped layouts (mixer-style)
// render inside a translate(faceLeft, faceTop); no-wrap layouts are already absolute.
function itemOffset(layout) {
  return layout.wrap ? { x: layout.faceLeft || 0, y: layout.faceTop || 0 } : { x: 0, y: 0 };
}

// A movable control's grab point + which axes it can move on. Only id-bearing controls
// are movable in this phase; labels, dividers and marks come later.
function anchor(it, layout) {
  switch (it.t) {
    case 'knob':       return { x: it.x, y: it.y, axes: 'xy', r: Math.max(3, (it.opts && it.opts.radius || 4.6) * 0.5) };
    case 'jack':       return { x: it.x, y: it.y, axes: 'xy', r: 3.0 };
    case 'button':     return { x: it.x, y: it.y, axes: 'xy', r: 3.0 };
    case 'radio':      return { x: it.x, y: it.y, axes: 'xy', r: 3.4 };
    case 'stepButton': return { x: it.x, y: it.y, axes: 'xy', r: 3.4 };
    case 'vu':         return { x: it.x, y: it.y, axes: 'xy', r: 3.2 };
    case 'slider':     return { x: it.x, y: (layout.faceH || 113.5912) / 2, axes: 'x', r: 4.0 };
    default:           return null;
  }
}

// ---- render --------------------------------------------------------------
let pending = false, rendering = false;
function scheduleRender() { pending = true; if (!rendering) pump(); }
async function pump() {
  rendering = true;
  while (pending) { pending = false; await renderOnce(); }
  rendering = false;
}

async function renderOnce() {
  const m = MODULES[idx];
  const layout = applyOverrides(clone(m.base), m.overrides);
  try {
    const svgText = renderPanel(layout, dark);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    const { svg } = await loadPanel(url, m.desc, { dark });   // real loader: crop, colour jacks, identity band, title
    const vb = viewBoxOf(svg);   // attribute-parsed: baseVal reads 0 on a detached SVG
    const H = 620;
    svg.style.height = `${H}px`;
    svg.style.width = `${(H * vb.w) / vb.h}px`;
    svg.style.boxShadow = '0 8px 30px rgba(0,0,0,0.45)';
    buildOverlay(svg, layout);
    stage.replaceChildren(svg);
    currentLayout = layout;
    currentSvg = svg;
    refreshStatus();
  } catch (e) {
    stage.replaceChildren();
    status.textContent = `Error rendering ${m.name}: ${e.message}`;
    console.error(e);
  }
}

function buildOverlay(svg, layout) {
  const off = itemOffset(layout);
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'editor-overlay');
  layout.items.forEach((it, i) => {
    if (!it.id) return;
    const a = anchor(it, layout);
    if (!a) return;
    const cx = off.x + a.x, cy = off.y + a.y;
    if (it.id === selectedId) {
      const ring = document.createElementNS(NS, 'circle');
      ring.setAttribute('cx', cx); ring.setAttribute('cy', cy); ring.setAttribute('r', a.r + 1.2);
      ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', '#39a0ff');
      ring.setAttribute('stroke-width', '0.5'); ring.setAttribute('pointer-events', 'none');
      g.appendChild(ring);
    }
    const h = document.createElementNS(NS, 'circle');
    h.setAttribute('cx', cx); h.setAttribute('cy', cy); h.setAttribute('r', a.r);
    h.setAttribute('fill', 'transparent');
    h.style.cursor = 'grab';
    h.addEventListener('pointerdown', (e) => startDrag(e, it.id));
    g.appendChild(h);
  });
  svg.appendChild(g);
  svg.addEventListener('pointerdown', (e) => { if (e.target === svg) { selectedId = null; scheduleRender(); } });
}

// ---- move ----------------------------------------------------------------
// A control's current position: its override if one exists, else its layout home.
// Reading the override (not the async-rendered layout) lets rapid nudges accumulate.
function baseItem(id) { return MODULES[idx].base.items.find((x) => x.id === id); }
function curPos(id) {
  const ov = MODULES[idx].overrides[id], b = baseItem(id);
  return { x: ov && typeof ov.x === 'number' ? ov.x : b.x, y: ov && typeof ov.y === 'number' ? ov.y : b.y };
}

function startDrag(e, id) {
  e.preventDefault(); e.stopPropagation();
  selectedId = id;
  const m = MODULES[idx];
  const a = anchor(baseItem(id), m.base);
  const rect = currentSvg.getBoundingClientRect();
  const vb = viewBoxOf(currentSvg);
  const mmPerPxX = vb.w / rect.width, mmPerPxY = vb.h / rect.height;
  const startCX = e.clientX, startCY = e.clientY;
  const p = curPos(id), baseX = p.x, baseY = p.y;
  let moved = false;
  scheduleRender();   // reflect the selection ring right away

  function move(ev) {
    const nx = a.axes.includes('x') ? round3(baseX + (ev.clientX - startCX) * mmPerPxX) : baseX;
    const ny = a.axes === 'xy' ? round3(baseY + (ev.clientY - startCY) * mmPerPxY) : baseY;
    m.overrides[id] = a.axes === 'x' ? { x: nx } : { x: nx, y: ny };
    moved = true;
    scheduleRender();
  }
  function up() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    if (moved) refreshStatus();
  }
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
}

function nudge(dx, dy) {
  if (!selectedId) return;
  const m = MODULES[idx];
  const it = baseItem(selectedId);
  if (!it) return;
  const a = anchor(it, m.base);
  const p = curPos(selectedId);
  const nx = round3(p.x + (a.axes.includes('x') ? dx : 0));
  const ny = round3(p.y + (a.axes === 'xy' ? dy : 0));
  m.overrides[selectedId] = a.axes === 'x' ? { x: nx } : { x: nx, y: ny };
  scheduleRender();
}

// ---- save / revert -------------------------------------------------------
function dirty() { return JSON.stringify(MODULES[idx].overrides) !== JSON.stringify(MODULES[idx].saved); }

async function save() {
  const m = MODULES[idx];
  saveBtn.disabled = true; status.textContent = 'Saving…';
  try {
    const res = await fetch('/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir: m.dir, overrides: m.overrides }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || res.statusText);
    m.saved = clone(m.overrides);
    status.textContent = `Saved ${m.name} — panel.svg + panel.dark.svg regenerated`;
  } catch (e) {
    status.textContent = `Save failed: ${e.message}`;
  }
  refreshStatus();
}

function revert() {
  const m = MODULES[idx];
  m.overrides = clone(m.saved);
  selectedId = null;
  scheduleRender();
}

// ---- status --------------------------------------------------------------
function refreshStatus() {
  const m = MODULES[idx];
  const n = Object.keys(m.overrides).length;
  saveBtn.disabled = !dirty();
  revertBtn.disabled = !dirty();
  status.textContent = `${m.name} — ${m.base.items.length} items` + (n ? `, ${n} moved${dirty() ? ' (unsaved)' : ''}` : '');
  if (selectedId && currentLayout) {
    const it = currentLayout.items.find((x) => x.id === selectedId);
    if (it) { readout.textContent = `${selectedId}  ·  x ${it.x}  y ${it.y}`; return; }
  }
  readout.textContent = 'Click a control to select · drag or arrow-keys to move · Shift = ×5';
}

// ---- load saved overrides, then first render -----------------------------
async function boot() {
  await Promise.all(MODULES.map(async (m) => {
    try {
      const res = await fetch(`/modules/${m.dir}/panel.overrides.json`);
      if (res.ok) { const ov = await res.json(); m.overrides = ov; m.saved = clone(ov); }
    } catch (_e) { /* none saved */ }
  }));
  scheduleRender();
}

picker.addEventListener('change', () => { idx = Number(picker.value); selectedId = null; scheduleRender(); });
darkBtn.addEventListener('click', () => { dark = !dark; darkBtn.textContent = dark ? 'Dark' : 'Light'; scheduleRender(); });
saveBtn.addEventListener('click', save);
revertBtn.addEventListener('click', revert);
window.addEventListener('keydown', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (e.key === 'Escape') { selectedId = null; scheduleRender(); return; }
  const step = e.shiftKey ? 1.0 : 0.2;
  const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (map[e.key]) { e.preventDefault(); nudge(...map[e.key]); }
});

boot();
