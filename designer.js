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
const status = document.getElementById('status');
const readout = document.getElementById('readout');
const inspector = document.getElementById('inspector');
const tools = document.getElementById('tools');
const burger = document.getElementById('burger');
const menuRoot = document.getElementById('menuRoot');
const dialogRoot = document.getElementById('dialogRoot');
const DEV_GUIDE_URL = 'https://github.com/chrisgr99/wCoast/blob/main/MODULE-AUTHORING.md';
// Render scale (px per mm). Opened from the rack, ?scale carries the rack's current
// px/mm so the panel appears at the same size it does in the rack; else a rack-like default.
const urlScale = parseFloat(new URLSearchParams(location.search).get('scale'));
const RENDER_SCALE = urlScale > 0 ? urlScale : 3;

const dark = true;   // the editor is always dark — a panel is always drawn in dark mode here
let idx = 0;
let selectedId = null;
let currentLayout = null;   // the working layout of the last render (base + overrides)
let currentSvg = null;
let activeTool = null;      // a toolbox type armed for placement (editor-owned modules only)
let lastWarnings = [];      // binding warnings from the last render — the validation signal
let draftCount = 0;
let resetScrollNext = true; // scroll the stage to the top on load / module change (not mid-edit)

MODULES.forEach((m) => {
  m.overrides = {};             // live edits (loaded from disk at startup)
  m.saved = {};                 // what's on disk, for revert + dirty check
  m.workDesc = clone(m.desc);   // in-memory interface model; data-face edits mutate it
  m.undo = [];                  // per-module undo/redo snapshot stacks
  m.redo = [];
});

// ---- undo / redo (per module) --------------------------------------------
// Snapshot everything a mutation can touch: overrides + working descriptor always,
// plus the base layout for authored drafts. Cheap because it's all JSON-cloneable.
function snapshot() {
  const m = MODULES[idx];
  return { overrides: clone(m.overrides), workDesc: clone(m.workDesc), base: m.editorOwned ? clone(m.base) : null };
}
function restoreSnap(s) {
  const m = MODULES[idx];
  m.overrides = clone(s.overrides); m.workDesc = clone(s.workDesc);
  if (m.editorOwned && s.base) m.base = clone(s.base);
}
function pushUndo() { const m = MODULES[idx]; m.undo.push(snapshot()); if (m.undo.length > 100) m.undo.shift(); m.redo.length = 0; }
function canUndo() { return MODULES[idx].undo.length > 0; }
function canRedo() { return MODULES[idx].redo.length > 0; }
function undo() { const m = MODULES[idx]; if (!m.undo.length) return; m.redo.push(snapshot()); restoreSnap(m.undo.pop()); selectedId = null; clearInspector(); refreshToolbox(); scheduleRender(); }
function redo() { const m = MODULES[idx]; if (!m.redo.length) return; m.undo.push(snapshot()); restoreSnap(m.redo.pop()); selectedId = null; clearInspector(); refreshToolbox(); scheduleRender(); }

function selectModuleIndex(i) {
  if (i < 0 || i >= MODULES.length) return;
  idx = i; selectedId = null; activeTool = null; resetScrollNext = true;
  clearInspector(); refreshToolbox(); scheduleRender();
}

// ---- menus (hamburger + right-click, matching the app) -------------------
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
function closeMenus() { menuRoot.replaceChildren(); document.removeEventListener('pointerdown', onDocDown, true); }
function onDocDown(e) { if (!e.target.closest('.menu')) closeMenus(); }
function renderLevel(items) {
  const el = document.createElement('div'); el.className = 'menu';
  for (const it of items) {
    if (it.separator) { const s = document.createElement('div'); s.className = 'menu-sep'; el.appendChild(s); continue; }
    const row = document.createElement('div');
    row.className = 'menu-item' + (it.disabled ? ' disabled' : '');
    row.innerHTML = `<span>${it.checked ? '✓ ' : ''}${esc(it.label)}</span>` + (it.submenu ? '<span class="menu-arrow">▸</span>' : '');
    const clearSubs = () => el.querySelectorAll(':scope > .menu-item.open').forEach((r) => { r.classList.remove('open'); r.querySelectorAll('.submenu').forEach((s) => s.remove()); });
    if (it.submenu) {
      row.addEventListener('pointerenter', () => { clearSubs(); row.classList.add('open'); const sub = renderLevel(it.submenu); sub.classList.add('submenu'); row.appendChild(sub); });
    } else {
      row.addEventListener('pointerenter', clearSubs);
      if (!it.disabled) row.addEventListener('click', (e) => { e.stopPropagation(); closeMenus(); if (it.action) it.action(); });
    }
    el.appendChild(row);
  }
  return el;
}
function openMenu(x, y, items) {
  closeMenus();
  const menu = renderLevel(items);
  menu.style.left = x + 'px'; menu.style.top = y + 'px';
  menuRoot.appendChild(menu);
  const r = menu.getBoundingClientRect();
  if (r.right > innerWidth) menu.style.left = Math.max(4, innerWidth - r.width - 4) + 'px';
  if (r.bottom > innerHeight) menu.style.top = Math.max(4, innerHeight - r.height - 4) + 'px';
  setTimeout(() => document.addEventListener('pointerdown', onDocDown, true), 0);
}
function mainMenu() {
  const modules = MODULES.map((m, i) => ({ label: m.name + (m.editorOwned ? ' (draft)' : ''), checked: i === idx, action: () => selectModuleIndex(i) }));
  const file = [
    { label: 'Open module', submenu: modules },
    { label: 'New module', action: newDraft },
    { separator: true },
    { label: 'Save', disabled: !dirty(), action: save },
    { label: 'Revert', disabled: !dirty(), action: revert },
    { separator: true },
    { label: 'Close editor', action: () => window.close() },
  ];
  const edit = [
    { label: 'Undo', disabled: !canUndo(), action: undo },
    { label: 'Redo', disabled: !canRedo(), action: redo },
  ];
  const help = [
    { label: 'How to use the editor', action: showHelp },
    ...(window.wcoast && window.wcoast.openExternal ? [{ label: 'Developer guide', action: () => window.wcoast.openExternal(DEV_GUIDE_URL) }] : []),
  ];
  return [{ label: 'File', submenu: file }, { label: 'Edit', submenu: edit }, { label: 'Help', submenu: help }];
}

function showHelp() {
  dialogRoot.innerHTML = `<div class="dlg-overlay"><div class="dlg">
    <h2>Panel editor</h2>
    <div class="dlg-body">
      <p>Draw a module's faceplate; its descriptor is generated from what you draw.</p>
      <ul>
        <li><b>Shipped modules</b> can be re-arranged; to add controls, start a <b>New module</b> (File menu).</li>
        <li><b>Add a control:</b> pick a tool from the strip, then click the panel to place it.</li>
        <li><b>Move:</b> click a control to select it, then drag, or use the arrow keys (Shift = &times;5).</li>
        <li><b>Edit:</b> the right panel shows the selected control's presentation and data.</li>
        <li><b>Save</b> (File menu, or ⌘S) writes the layout, descriptor, and panels to disk.</li>
        <li><b>Undo / Redo:</b> Edit menu, or ⌘Z / ⌘⇧Z.</li>
      </ul>
    </div>
    <button class="dlg-close">Close</button>
  </div></div>`;
  const close = () => dialogRoot.replaceChildren();
  dialogRoot.querySelector('.dlg-overlay').addEventListener('pointerdown', (e) => { if (e.target.classList.contains('dlg-overlay')) close(); });
  dialogRoot.querySelector('.dlg-close').addEventListener('click', close);
}

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
    case 'label':      return { x: it.x, y: it.y, axes: 'xy', r: 3.0 };
    case 'divider':    return { x: it.x, y: it.y, axes: 'xy', r: 3.0 };
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
    const { svg, warnings } = await loadPanel(url, m.workDesc, { dark });   // real loader: crop, colour jacks, identity band, title; warnings = binding validation
    lastWarnings = warnings || [];
    const vb = viewBoxOf(svg);   // attribute-parsed: baseVal reads 0 on a detached SVG
    svg.style.height = `${vb.h * RENDER_SCALE}px`;   // mm -> px at the rack's scale
    svg.style.width = `${vb.w * RENDER_SCALE}px`;
    svg.style.boxShadow = '0 8px 30px rgba(0,0,0,0.45)';
    buildOverlay(svg, layout);
    stage.replaceChildren(svg);
    if (resetScrollNext) { stage.scrollTop = 0; stage.scrollLeft = 0; resetScrollNext = false; }   // panel at the top on load / module change
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
  svg.addEventListener('pointerdown', (e) => {
    if (e.target !== svg) return;
    if (activeTool && MODULES[idx].editorOwned) placeControl(activeTool, e);
    else { selectedId = null; clearInspector(); scheduleRender(); }
  });
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
  buildInspector(id);
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
    if (!moved) pushUndo();   // one undo entry per drag gesture, on the first move
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
  pushUndo();
  const a = anchor(it, m.base);
  const p = curPos(selectedId);
  const nx = round3(p.x + (a.axes.includes('x') ? dx : 0));
  const ny = round3(p.y + (a.axes === 'xy' ? dy : 0));
  m.overrides[selectedId] = a.axes === 'x' ? { x: nx } : { x: nx, y: ny };
  scheduleRender();
}

// ---- save / revert -------------------------------------------------------
function dirty() { const m = MODULES[idx]; return m.editorOwned ? !!m.dirtyDraft : JSON.stringify(m.overrides) !== JSON.stringify(m.saved); }

async function save() {
  const m = MODULES[idx];
  status.textContent = 'Saving…';
  const body = m.editorOwned
    ? { dir: m.dir, editorOwned: true, layout: applyOverrides(clone(m.base), m.overrides), descriptor: m.workDesc }
    : { dir: m.dir, overrides: m.overrides };
  try {
    let data;
    if (window.wcoast && window.wcoast.designerSave) {
      data = await window.wcoast.designerSave(body);   // in-app: IPC to the main process (no server)
    } else {
      const res = await fetch('/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });   // standalone dev server
      data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
    }
    if (!data || !data.ok) throw new Error((data && data.error) || 'save failed');
    if (m.editorOwned) { m.savedLayout = clone(m.base); m.savedDesc = clone(m.workDesc); m.dirtyDraft = false; status.textContent = `Saved ${m.name} → modules/${m.dir}/ (layout + descriptor + panels)`; }
    else { m.saved = clone(m.overrides); status.textContent = `Saved ${m.name} — panel.svg + panel.dark.svg regenerated`; }
  } catch (e) {
    status.textContent = `Save failed: ${e.message}`;
  }
  refreshStatus();
}

function revert() {
  const m = MODULES[idx];
  if (m.editorOwned) {
    if (m.savedLayout) { m.base = clone(m.savedLayout); m.workDesc = clone(m.savedDesc); m.dirtyDraft = false; }
  } else {
    m.overrides = clone(m.saved);
    m.workDesc = clone(m.desc);   // data edits aren't persisted yet; drop them too
  }
  selectedId = null;
  clearInspector();
  scheduleRender();
}

// ---- properties inspector ------------------------------------------------
// Two faces. PRESENTATION edits the layout item's opts through the overrides layer
// (live re-render, saved with the panel). DATA edits the in-memory working
// descriptor (jack colour / identity update live; written to descriptor.js in a
// later phase). The inspector is rebuilt only on selection change, not on every
// render, so typing in a field never loses focus.
const PLACEMENTS = ['below', 'above', 'left', 'right'];

function getPath(o, path, dflt) {
  let cur = o;
  for (const k of path.split('.')) { if (cur == null) return dflt; cur = cur[k]; }
  return cur === undefined ? dflt : cur;
}
function setPath(o, path, v) {
  const ks = path.split('.'); let cur = o;
  for (let i = 0; i < ks.length - 1; i++) { if (typeof cur[ks[i]] !== 'object' || cur[ks[i]] == null) cur[ks[i]] = {}; cur = cur[ks[i]]; }
  cur[ks[ks.length - 1]] = v;
}
function workingLayout() { const m = MODULES[idx]; return applyOverrides(clone(m.base), m.overrides); }
function workItem(id) { return workingLayout().items.find((x) => x.id === id); }
function descEntry(id) {
  const d = MODULES[idx].workDesc || {};
  return (d.ports || []).find((p) => p.id === id) || (d.params || []).find((p) => p.id === id) || null;
}
function optVal(id, path, dflt) { const it = workItem(id); return getPath(it && it.opts, path, dflt); }
function setOpt(id, path, value) {
  pushUndo();
  const m = MODULES[idx];
  if (m.editorOwned) {
    const it = m.base.items.find((x) => x.id === id);
    if (it) { setPath(it.opts || (it.opts = {}), path, value); if (path === 'steps') syncStepped(id, value); }
    m.dirtyDraft = true;
  } else {
    const ov = m.overrides[id] || (m.overrides[id] = {});
    ov.opts = ov.opts || {};
    setPath(ov.opts, path, value);
  }
  scheduleRender();
}
function setDesc(id, key, value) {
  const e = descEntry(id);
  if (!e) return;
  pushUndo();
  e[key] = value;
  if (MODULES[idx].editorOwned) MODULES[idx].dirtyDraft = true;
  scheduleRender();
}
// A drawn stepped control's descriptor enum is derived from its drawn positions:
// keep the param's steps (value + name) in sync with the layout's opts.steps.
function syncStepped(id, steps) {
  const e = descEntry(id);
  if (!e || !Array.isArray(steps)) return;
  e.steps = steps.map((s) => ({ value: s.value, name: s.label || s.glyph || s.value }));
  if (!e.steps.some((s) => s.value === e.default)) e.default = e.steps.length ? e.steps[0].value : undefined;
}
// A top-level item field (structure items: a label's text, a divider's len/thickness).
function setItemField(id, key, value) {
  pushUndo();
  const m = MODULES[idx];
  if (m.editorOwned) { const it = m.base.items.find((x) => x.id === id); if (it) it[key] = value; m.dirtyDraft = true; }
  scheduleRender();
}

function fieldRow(labelText, controlEl) {
  const row = document.createElement('label'); row.className = 'insp-field';
  const s = document.createElement('span'); s.textContent = labelText;
  row.append(s, controlEl); return row;
}
function numberInput(value, onChange, step = 0.1) {
  const el = document.createElement('input'); el.type = 'number'; el.step = String(step); el.value = value ?? '';
  el.addEventListener('change', () => onChange(el.value === '' ? undefined : Number(el.value)));
  return el;
}
function textInput(value, onChange) {
  const el = document.createElement('input'); el.type = 'text'; el.value = value ?? '';
  el.addEventListener('change', () => onChange(el.value));
  return el;
}
function selectInput(value, options, onChange) {
  const el = document.createElement('select');
  for (const o of options) { const [v, t] = Array.isArray(o) ? o : [o, o]; const opt = document.createElement('option'); opt.value = v; opt.textContent = t; el.appendChild(opt); }
  el.value = value; el.addEventListener('change', () => onChange(el.value));
  return el;
}

// A radio/stepButton's positions: value + label (or glyph). Add/remove rebuilds the
// inspector (a click, no focus to lose); text edits commit on change and re-render.
function stepsEditor(id) {
  const wrap = document.createElement('div'); wrap.className = 'insp-steps';
  const steps = (optVal(id, 'steps', []) || []).map((s) => ({ ...s }));
  const commit = () => setOpt(id, 'steps', steps.map((s) => ({ ...s })));
  steps.forEach((s, i) => {
    const row = document.createElement('div'); row.className = 'insp-step';
    const val = document.createElement('input'); val.type = 'text'; val.value = s.value ?? ''; val.placeholder = 'value';
    val.addEventListener('change', () => { s.value = val.value; commit(); });
    const isGlyph = 'glyph' in s;
    const lab = document.createElement('input'); lab.type = 'text'; lab.value = (isGlyph ? s.glyph : s.label) ?? ''; lab.placeholder = isGlyph ? 'glyph' : 'label';
    lab.addEventListener('change', () => { if (isGlyph) s.glyph = lab.value; else s.label = lab.value; commit(); });
    const del = document.createElement('button'); del.className = 'insp-del'; del.textContent = '×'; del.title = 'remove position';
    del.addEventListener('click', () => { steps.splice(i, 1); setOpt(id, 'steps', steps.map((x) => ({ ...x }))); buildInspector(id); });
    row.append(val, lab, del); wrap.appendChild(row);
  });
  const add = document.createElement('button'); add.className = 'insp-add'; add.textContent = '+ position';
  add.addEventListener('click', () => {
    const last = steps[steps.length - 1] || {};
    steps.push('glyph' in last ? { value: 'new', glyph: 'triangle' } : { value: 'new', label: 'new' });
    setOpt(id, 'steps', steps.map((x) => ({ ...x }))); buildInspector(id);
  });
  wrap.appendChild(add); return wrap;
}

function section(title) {
  const el = document.createElement('section'); el.className = 'insp-section';
  const h = document.createElement('h4'); h.textContent = title; el.appendChild(h);
  const body = document.createElement('div'); body.className = 'insp-body'; el.appendChild(body);
  return { el, body };
}
function note(body, text) { const d = document.createElement('div'); d.className = 'insp-note'; d.textContent = text; body.appendChild(d); }

function buildInspector(id) {
  const it = workItem(id);
  if (!it) { clearInspector(); return; }
  const e = descEntry(id);
  inspector.replaceChildren();
  const head = document.createElement('div'); head.className = 'insp-head'; head.textContent = `${it.t} · ${id}`;
  inspector.appendChild(head);

  // --- Structure items (label, divider): presentation only, no descriptor ---
  if (STRUCTURE_TYPES.has(it.t)) {
    const s = section('Structure');
    if (it.t === 'label') {
      s.body.appendChild(fieldRow('text', textInput(it.text, (v) => setItemField(id, 'text', v))));
      s.body.appendChild(fieldRow('size', numberInput(optVal(id, 'size', 2.4), (v) => setOpt(id, 'size', v))));
    } else {
      s.body.appendChild(fieldRow('length', numberInput(it.len, (v) => setItemField(id, 'len', v))));
      s.body.appendChild(fieldRow('thickness', numberInput(it.w, (v) => setItemField(id, 'w', v), 0.05)));
    }
    if (MODULES[idx].editorOwned) s.body.appendChild(fieldRow('id', textInput(id, (v) => renameControl(id, v))));
    inspector.appendChild(s.el);
    return;
  }

  // --- Presentation (layout) ---
  const pres = section('Presentation');
  const addP = (label, el) => pres.body.appendChild(fieldRow(label, el));
  if (it.t === 'knob') addP('radius', numberInput(optVal(id, 'radius', 4.6), (v) => setOpt(id, 'radius', v)));
  if (it.opts && it.opts.label && typeof it.opts.label === 'object') {
    addP('label text', textInput(optVal(id, 'label.text', ''), (v) => setOpt(id, 'label.text', v)));
    addP('label place', selectInput(optVal(id, 'label.placement', 'below'), PLACEMENTS, (v) => setOpt(id, 'label.placement', v)));
    addP('label size', numberInput(optVal(id, 'label.size', 2.0), (v) => setOpt(id, 'label.size', v)));
  }
  if (it.t === 'radio' || it.t === 'stepButton') {
    addP('orientation', selectInput(optVal(id, 'orientation', 'v'), [['h', 'horizontal'], ['v', 'vertical']], (v) => setOpt(id, 'orientation', v)));
    addP('spacing', numberInput(optVal(id, 'spacing', 5.6), (v) => setOpt(id, 'spacing', v)));
    addP('LED radius', numberInput(optVal(id, 'ledR', 2.16), (v) => setOpt(id, 'ledR', v)));
    const sub = document.createElement('div'); sub.className = 'insp-sub'; sub.textContent = 'positions'; pres.body.appendChild(sub);
    pres.body.appendChild(stepsEditor(id));
  }
  if (it.t === 'button') { addP('radius', numberInput(optVal(id, 'r', 2.0), (v) => setOpt(id, 'r', v))); addP('kind', textInput(optVal(id, 'kind', 'red'), (v) => setOpt(id, 'kind', v))); }
  if (!pres.body.children.length) note(pres.body, 'no presentation options for this control');
  inspector.appendChild(pres.el);

  // --- Data (descriptor) ---
  const data = section('Data');
  const owned = MODULES[idx].editorOwned;
  note(data.body, owned ? 'generated into descriptor.js on Save' : 'live preview — written to descriptor.js in a later phase');
  const addD = (label, el) => data.body.appendChild(fieldRow(label, el));
  if (owned && e) {
    addD('id', textInput(id, (v) => renameControl(id, v)));
    note(data.body, 'id is the contract the factory + saved patches use — rename deliberately');
    const row = document.createElement('label'); row.className = 'insp-field';
    const s = document.createElement('span'); s.textContent = 'order'; row.appendChild(s);
    const grp = document.createElement('div'); grp.style.display = 'flex'; grp.style.gap = '6px';
    const up = document.createElement('button'); up.className = 'insp-add'; up.textContent = '▲ up'; up.addEventListener('click', () => moveEntry(id, -1));
    const dn = document.createElement('button'); dn.className = 'insp-add'; dn.textContent = '▼ down'; dn.addEventListener('click', () => moveEntry(id, 1));
    grp.append(up, dn); row.appendChild(grp); data.body.appendChild(row);
  }
  if (!e) {
    note(data.body, 'no descriptor entry for this id');
  } else if (it.t === 'jack') {
    addD('name', textInput(e.name, (v) => setDesc(id, 'name', v)));
    addD('domain', selectInput(e.domain || 'control', ['audio', 'control', 'trigger'], (v) => setDesc(id, 'domain', v)));
    addD('direction', selectInput(e.dir || 'in', [['in', 'input'], ['out', 'output']], (v) => setDesc(id, 'dir', v)));
  } else if (e.curve === 'stepped' || Array.isArray(e.steps)) {
    addD('name', textInput(e.name, (v) => setDesc(id, 'name', v)));
    if (Array.isArray(e.steps) && e.steps.length) addD('default', selectInput(e.default, e.steps.map((s) => s.value), (v) => setDesc(id, 'default', v)));
    note(data.body, 'positions are set in Presentation');
  } else {
    addD('name', textInput(e.name, (v) => setDesc(id, 'name', v)));
    addD('min', numberInput(e.min, (v) => setDesc(id, 'min', v)));
    addD('max', numberInput(e.max, (v) => setDesc(id, 'max', v)));
    addD('default', numberInput(e.default, (v) => setDesc(id, 'default', v)));
    addD('curve', selectInput(e.curve || 'linear', ['linear', 'exp', 'stepped'], (v) => setDesc(id, 'curve', v)));
    addD('unit', textInput(e.unit || '', (v) => setDesc(id, 'unit', v)));
  }
  inspector.appendChild(data.el);
}

function clearInspector() {
  inspector.replaceChildren();
  const m = MODULES[idx];
  if (m && m.editorOwned) {
    const mod = section('Module');
    mod.body.appendChild(fieldRow('name', textInput(m.workDesc.name, (v) => { m.workDesc.name = v; m.name = v; m.dirtyDraft = true; refreshStatus(); })));
    mod.body.appendChild(fieldRow('id', textInput(m.workDesc.id, (v) => { m.workDesc.id = (v || '').trim() || m.workDesc.id; m.dirtyDraft = true; })));
    mod.body.appendChild(fieldRow('width mm', numberInput(m.base.faceW, (v) => { m.base.faceW = v; m.base.items[0].w = v; m.base.items[1].w = v - 1; m.dirtyDraft = true; scheduleRender(); }, 1)));
    inspector.appendChild(mod.el);
    note(inspector, 'pick a tool above, then click the panel to add a control');
    return;
  }
  const d = document.createElement('div'); d.className = 'insp-empty'; d.textContent = 'Select a control to edit its properties';
  inspector.appendChild(d);
}

// ---- toolbox & authoring (editor-owned draft modules) --------------------
const TOOLS = [
  { type: 'jack', label: 'Jack' }, { type: 'knob', label: 'Knob' },
  { type: 'radio', label: 'Radio' }, { type: 'button', label: 'Button' }, { type: 'slider', label: 'Slider' },
  { type: 'label', label: 'Label', structure: true }, { type: 'divider', label: 'Divider', structure: true },
];
const STRUCTURE_TYPES = new Set(['label', 'divider']);
function buildToolbox() {
  tools.replaceChildren();
  const lab = document.createElement('span'); lab.className = 'tlabel'; lab.textContent = 'Add'; tools.appendChild(lab);
  for (const t of TOOLS) {
    const b = document.createElement('button'); b.textContent = t.label; b.dataset.tool = t.type;
    b.addEventListener('click', () => { activeTool = activeTool === t.type ? null : t.type; refreshToolbox(); });
    tools.appendChild(b);
  }
  const hint = document.createElement('span'); hint.className = 'tlabel'; hint.id = 'toolHint'; tools.appendChild(hint);
  refreshToolbox();
}
function refreshToolbox() {
  const owned = MODULES[idx] && MODULES[idx].editorOwned;
  for (const b of tools.querySelectorAll('button')) { b.disabled = !owned; b.classList.toggle('active', !!owned && b.dataset.tool === activeTool); }
  const hint = document.getElementById('toolHint');
  if (hint) hint.textContent = !owned ? 'shipped module — start a new module to add controls' : activeTool ? 'click the panel to place' : '';
}

function newDraft() {
  const n = ++draftCount;
  const W = 44, H = 113.5912;
  const base = { faceW: W, faceH: H, faceLeft: 3.9, faceTop: 7.0994, wrap: true, items: [
    { t: 'rect', x: 0, y: 0, w: W, h: H, rx: 2.5, fill: 'face' },
    { t: 'rect', x: 0.5, y: 0.5, w: W - 1, h: H - 1, rx: 2.2, fill: 'none', stroke: 'frame', sw: 0.5 },
  ] };
  const desc = { apiVersion: 1, id: `draft${n}`, name: `New Module ${n}`, params: [], ports: [] };
  const m = { name: `New Module ${n}`, dir: `draft-${n}`, base, desc, workDesc: clone(desc), overrides: {}, saved: {}, editorOwned: true, dirtyDraft: true, undo: [], redo: [] };
  MODULES.push(m);
  idx = MODULES.length - 1;
  selectedId = null; activeTool = null; resetScrollNext = true; clearInspector(); refreshToolbox(); scheduleRender();
}

let idSeq = 0;
function uniqueId(m, base) {
  const taken = new Set([...m.base.items.map((i) => i.id).filter(Boolean), ...(m.workDesc.ports || []).map((p) => p.id), ...(m.workDesc.params || []).map((p) => p.id)]);
  let id; do { id = `${base}${++idSeq}`; } while (taken.has(id));
  return id;
}
// A dropped control -> a layout item + a descriptor entry (port for jacks, param
// for the rest), with sensible defaults the inspector then refines.
function makeControl(type, id, x, y) {
  const lbl = (text) => ({ text, placement: 'below', size: 2.0 });
  switch (type) {
    case 'jack':   return { item: { t: 'jack', id, x, y, opts: { label: lbl('in') } }, entry: { id, name: 'In', domain: 'control', dir: 'in' }, kind: 'port' };
    case 'knob':   return { item: { t: 'knob', id, x, y, opts: { radius: 4.6, label: lbl('knob') } }, entry: { id, name: 'Knob', min: 0, max: 1, default: 0, unit: '', curve: 'linear' }, kind: 'param' };
    case 'radio':  return { item: { t: 'radio', id, x, y, opts: { orientation: 'v', spacing: 5.6, ledR: 2.16, steps: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }] } }, entry: { id, name: 'Switch', curve: 'stepped', default: 'a', steps: [{ value: 'a', name: 'A' }, { value: 'b', name: 'B' }] }, kind: 'param' };
    case 'button': return { item: { t: 'button', id, x, y, opts: { r: 2.0, kind: 'red' } }, entry: { id, name: 'Button', curve: 'stepped', default: 'off', steps: [{ value: 'off', name: 'Off' }, { value: 'on', name: 'On' }] }, kind: 'param' };
    case 'slider': return { item: { t: 'slider', id, x, opts: {} }, entry: { id, name: 'Level', min: 0, max: 1, default: 0.8, unit: '', curve: 'linear' }, kind: 'param' };
    // Structure — no descriptor entry; the id is only an editor handle.
    case 'label':   return { item: { t: 'label', id, x, y, text: 'Label', opts: { size: 2.4 } }, kind: 'structure' };
    case 'divider': return { item: { t: 'divider', id, x, y, len: 30, w: 0.355 }, kind: 'structure' };
    default: return null;
  }
}
function placeControl(type, e) {
  const m = MODULES[idx];
  const rect = currentSvg.getBoundingClientRect(), vb = viewBoxOf(currentSvg);
  const ux = vb.x + (e.clientX - rect.left) * (vb.w / rect.width);
  const uy = vb.y + (e.clientY - rect.top) * (vb.h / rect.height);
  const off = itemOffset(m.base);
  const made = makeControl(type, uniqueId(m, type), round3(ux - off.x), round3(uy - off.y));
  if (!made) return;
  pushUndo();
  m.base.items.push(made.item);
  if (made.kind === 'port') m.workDesc.ports.push(made.entry);
  else if (made.kind === 'param') m.workDesc.params.push(made.entry);
  m.dirtyDraft = true; activeTool = null; refreshToolbox();
  selectedId = made.item.id; buildInspector(selectedId); scheduleRender();
}
function renameControl(oldId, newId) {
  const m = MODULES[idx]; if (!m.editorOwned) return;
  newId = (newId || '').trim();
  if (!newId || newId === oldId) { buildInspector(oldId); return; }
  const clash = m.base.items.some((i) => i.id === newId) || (m.workDesc.ports || []).some((p) => p.id === newId) || (m.workDesc.params || []).some((p) => p.id === newId);
  if (clash) { status.textContent = `id "${newId}" is already used`; buildInspector(oldId); return; }
  pushUndo();
  const it = m.base.items.find((i) => i.id === oldId); if (it) it.id = newId;
  const e = descEntry(oldId); if (e) e.id = newId;
  selectedId = newId; m.dirtyDraft = true; scheduleRender(); buildInspector(newId);
}
function moveEntry(id, dir) {
  const m = MODULES[idx];
  const arr = (m.workDesc.ports || []).some((p) => p.id === id) ? m.workDesc.ports : m.workDesc.params;
  const i = arr.findIndex((p) => p.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  pushUndo();
  [arr[i], arr[j]] = [arr[j], arr[i]];
  m.dirtyDraft = true; buildInspector(id);
}

// ---- status --------------------------------------------------------------
function refreshStatus() {
  const m = MODULES[idx];
  document.title = `${m.name}${m.editorOwned ? ' (draft)' : ''} — DreamRack Panel Editor`;   // window title bar
  if (m.editorOwned) {
    const np = (m.workDesc.params || []).length, npo = (m.workDesc.ports || []).length;
    status.textContent = `${m.name} (draft) — ${npo} ports, ${np} params · ` + (lastWarnings.length === 0 ? 'validates ✓' : `${lastWarnings.length} binding issue(s)`);
  } else {
    const n = Object.keys(m.overrides).length;
    status.textContent = `${m.name} — ${m.base.items.length} items` + (n ? `, ${n} moved${dirty() ? ' (unsaved)' : ''}` : '');
  }
  if (selectedId && currentLayout) {
    const it = currentLayout.items.find((x) => x.id === selectedId);
    if (it) { readout.textContent = `${selectedId}  ·  x ${it.x ?? '—'}  y ${it.y ?? '—'}`; return; }
  }
  readout.textContent = MODULES[idx].editorOwned ? 'Pick a tool to add a control · click a control to select · drag or arrow-keys to move' : 'Click a control to select · drag or arrow-keys to move · Shift = ×5';
}

// Select a module by its descriptor id (e.g. from "Edit this panel…" in the rack, or ?module=).
function selectModuleById(id) {
  const i = MODULES.findIndex((m) => m.desc && m.desc.id === id);
  if (i < 0) return false;
  selectModuleIndex(i);
  return true;
}

// ---- load saved overrides, then first render -----------------------------
async function boot() {
  await Promise.all(MODULES.map(async (m) => {
    try {
      const res = await fetch(`/modules/${m.dir}/panel.overrides.json`);
      if (res.ok) { const ov = await res.json(); m.overrides = ov; m.saved = clone(ov); }
    } catch (_e) { /* none saved */ }
  }));
  const wanted = new URLSearchParams(location.search).get('module');
  if (wanted) selectModuleById(wanted);   // opened from "Edit this panel…"
  if (window.wcoast && window.wcoast.onSelectModule) window.wcoast.onSelectModule(selectModuleById);
  clearInspector();
  scheduleRender();
}

// The main menu: hamburger (top-left) and right-click, both opening the same model.
burger.addEventListener('click', () => { const r = burger.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, mainMenu()); });
document.addEventListener('contextmenu', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;   // leave native editing menus alone
  e.preventDefault();
  openMenu(e.clientX, e.clientY, mainMenu());
});
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty()) save(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
  if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newDraft(); return; }
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  if (e.key === 'Escape') {   // back out one level; when nothing is open/selected, close the editor
    if (menuRoot.firstChild) { closeMenus(); return; }
    if (dialogRoot.firstChild) { dialogRoot.replaceChildren(); return; }
    if (selectedId) { selectedId = null; clearInspector(); scheduleRender(); return; }
    window.close();
    return;
  }
  const step = e.shiftKey ? 1.0 : 0.2;
  const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (map[e.key]) { e.preventDefault(); nudge(...map[e.key]); }
});

buildToolbox();
boot();
