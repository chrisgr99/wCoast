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
const tools = document.getElementById('tools');
const burger = document.getElementById('burger');
const menuRoot = document.getElementById('menuRoot');
const dialogRoot = document.getElementById('dialogRoot');
const floatRoot = document.getElementById('floatRoot');
const DEV_GUIDE_URL = 'https://github.com/chrisgr99/DreamRack/blob/main/MODULE-AUTHORING.md';
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
let zoom = 1;               // view zoom multiplier on top of RENDER_SCALE (View menu / Cmd +/-)
let pendingScrollFrac = null; // after a zoom re-render, restore this viewport-centre fraction

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
// A live edit (typing/spinning a field) fires many times; coalesce a stream with the
// same key within a short window into ONE undo step. Discrete actions pass no key.
let _undoKey = null, _undoAt = 0;
function pushUndo(key) {
  const now = Date.now();
  if (key && key === _undoKey && now - _undoAt < 700) { _undoAt = now; return; }
  const m = MODULES[idx]; m.undo.push(snapshot()); if (m.undo.length > 100) m.undo.shift(); m.redo.length = 0;
  _undoKey = key || null; _undoAt = now;
}
function canUndo() { return MODULES[idx].undo.length > 0; }
function canRedo() { return MODULES[idx].redo.length > 0; }
function undo() { const m = MODULES[idx]; if (!m.undo.length) return; m.redo.push(snapshot()); restoreSnap(m.undo.pop()); selectedId = null; closeFloats(); refreshToolbox(); scheduleRender(); }
function redo() { const m = MODULES[idx]; if (!m.redo.length) return; m.undo.push(snapshot()); restoreSnap(m.redo.pop()); selectedId = null; closeFloats(); refreshToolbox(); scheduleRender(); }

function selectModuleIndex(i) {
  if (i < 0 || i >= MODULES.length) return;
  idx = i; selectedId = null; activeTool = null; resetScrollNext = true;
  closeFloats(); refreshToolbox(); scheduleRender();
}

// ---- zoom (View menu, Cmd +/-) -------------------------------------------
function zoomBy(factor) {
  const nz = Math.min(6, Math.max(0.25, zoom * factor));
  if (nz === zoom) return;
  if (stage.scrollWidth > 0) pendingScrollFrac = {   // anchor the viewport centre
    x: (stage.scrollLeft + stage.clientWidth / 2) / stage.scrollWidth,
    y: (stage.scrollTop + stage.clientHeight / 2) / stage.scrollHeight,
  };
  zoom = nz; scheduleRender();
}
function zoomReset() { zoom = 1; pendingScrollFrac = null; resetScrollNext = true; scheduleRender(); }

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
    { label: 'Module settings…', disabled: !MODULES[idx].editorOwned, action: openModuleSettings },
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
  const view = [
    { label: `Zoom ${Math.round(zoom * 100)}%`, disabled: true },
    { label: 'Zoom in', action: () => zoomBy(1.2) },
    { label: 'Zoom out', action: () => zoomBy(1 / 1.2) },
    { label: 'Actual size', action: zoomReset },
  ];
  const help = [
    { label: 'How to use the editor', action: showHelp },
    ...(window.wcoast && window.wcoast.openExternal ? [{ label: 'Developer guide', action: () => window.wcoast.openExternal(DEV_GUIDE_URL) }] : []),
  ];
  return [{ label: 'File', submenu: file }, { label: 'Edit', submenu: edit }, { label: 'View', submenu: view }, { label: 'Help', submenu: help }];
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
    const eff = RENDER_SCALE * zoom;                  // effective px/mm (rack scale x view zoom)
    svg.style.height = `${vb.h * eff}px`;
    svg.style.width = `${vb.w * eff}px`;
    svg.style.boxShadow = '0 8px 30px rgba(0,0,0,0.45)';
    stage.replaceChildren(svg);
    buildOverlay(svg, layout);   // after it's in the DOM so getBBox works for group-sized handles
    if (resetScrollNext) { stage.scrollTop = 0; stage.scrollLeft = 0; resetScrollNext = false; }   // panel at the top on load / module change
    else if (pendingScrollFrac) {   // keep the viewport centre anchored across a zoom
      stage.scrollLeft = pendingScrollFrac.x * stage.scrollWidth - stage.clientWidth / 2;
      stage.scrollTop = pendingScrollFrac.y * stage.scrollHeight - stage.clientHeight / 2;
      pendingScrollFrac = null;
    }
    currentLayout = layout;
    currentSvg = svg;
    refreshStatus();
  } catch (e) {
    stage.replaceChildren();
    status.textContent = `Error rendering ${m.name}: ${e.message}`;
    console.error(e);
  }
}

// Controls made of several elements (a whole radio row, a lamp group): the hit target
// and the selection highlight should cover the WHOLE control, so we size them from the
// rendered element's bounds. Point controls (knob, jack, button) stay a centred circle.
const GROUP_TYPES = new Set(['radio', 'stepButton', 'lampGroup', 'vu']);
function buildOverlay(svg, layout) {
  const off = itemOffset(layout);
  const g = document.createElementNS(NS, 'g');
  g.setAttribute('class', 'editor-overlay');
  layout.items.forEach((it) => {
    const cid = it.id || it.param;   // lamp groups carry `param`, not `id`
    if (!cid) return;
    let handle, selection;
    let box = null;
    if (GROUP_TYPES.has(it.t)) {
      const rendered = svg.querySelector(`[data-wcoast-param="${cid}"]`) || svg.querySelector(`[data-wcoast-port="${cid}"]`);
      if (rendered) { try { const b = rendered.getBBox(); box = { x: b.x - 0.8, y: b.y - 0.8, w: b.width + 1.6, h: b.height + 1.6 }; } catch (_e) { /* not measurable */ } }
    }
    if (box) {
      handle = document.createElementNS(NS, 'rect');
      handle.setAttribute('x', box.x); handle.setAttribute('y', box.y); handle.setAttribute('width', box.w); handle.setAttribute('height', box.h);
      if (cid === selectedId) {
        selection = document.createElementNS(NS, 'rect');
        selection.setAttribute('x', box.x); selection.setAttribute('y', box.y); selection.setAttribute('width', box.w); selection.setAttribute('height', box.h);
        selection.setAttribute('rx', '1');
      }
    } else {
      const a = anchor(it, layout);
      if (!a) return;
      const cx = off.x + a.x, cy = off.y + a.y;
      handle = document.createElementNS(NS, 'circle');
      handle.setAttribute('cx', cx); handle.setAttribute('cy', cy); handle.setAttribute('r', a.r);
      if (cid === selectedId) {
        selection = document.createElementNS(NS, 'circle');
        selection.setAttribute('cx', cx); selection.setAttribute('cy', cy); selection.setAttribute('r', a.r + 1.2);
      }
    }
    if (selection) {
      selection.setAttribute('fill', 'none'); selection.setAttribute('stroke', '#39a0ff');
      selection.setAttribute('stroke-width', '0.5'); selection.setAttribute('pointer-events', 'none');
      g.appendChild(selection);
    }
    handle.setAttribute('fill', 'transparent');
    handle.setAttribute('data-ctrl-id', cid);   // so click/right-click reach this control
    handle.style.cursor = 'grab';
    handle.addEventListener('pointerdown', (e) => startDrag(e, cid));
    g.appendChild(handle);
  });
  svg.appendChild(g);
  svg.addEventListener('pointerdown', (e) => {
    if (e.target !== svg) return;
    if (activeTool && MODULES[idx].editorOwned) placeControl(activeTool, e);
    else { selectedId = null; scheduleRender(); }   // deselect; any open settings float stays
  });
}

// ---- move ----------------------------------------------------------------
// A control's current position: its override if one exists, else its layout home.
// Reading the override (not the async-rendered layout) lets rapid nudges accumulate.
function baseItem(id) { return MODULES[idx].base.items.find((x) => (x.id || x.param) === id); }
function curPos(id) {
  const ov = MODULES[idx].overrides[id], b = baseItem(id);
  return { x: ov && typeof ov.x === 'number' ? ov.x : b.x, y: ov && typeof ov.y === 'number' ? ov.y : b.y };
}

function startDrag(e, id) {
  if (e.button !== 0) return;   // left-drag only; right-click opens the settings float
  e.preventDefault(); e.stopPropagation();
  selectedId = id;
  if (settingsId && settingsId !== id) openSettings(id);   // a dialog is open -> switch it to this control
  const m = MODULES[idx];
  const a = anchor(baseItem(id), m.base);
  if (!a) { scheduleRender(); return; }   // selectable but not draggable (e.g. a lamp group has no x/y anchor)
  const rect = currentSvg.getBoundingClientRect();
  const vb = viewBoxOf(currentSvg);
  const mmPerPxX = vb.w / rect.width, mmPerPxY = vb.h / rect.height;
  const startCX = e.clientX, startCY = e.clientY;
  const p = curPos(id), baseX = p.x, baseY = p.y;
  let moved = false;
  scheduleRender();   // reflect the selection ring right away

  function move(ev) {
    if (!moved) pushUndo(`drag:${id}`);   // one undo entry per drag gesture, on the first move
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
  pushUndo(`nudge:${selectedId}`);
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
  closeFloats();
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
function workItem(id) { return workingLayout().items.find((x) => (x.id || x.param) === id); }
function descEntry(id) {
  const d = MODULES[idx].workDesc || {};
  return (d.ports || []).find((p) => p.id === id) || (d.params || []).find((p) => p.id === id) || null;
}
function optVal(id, path, dflt) { const it = workItem(id); return getPath(it && it.opts, path, dflt); }
function setOpt(id, path, value) {
  pushUndo(`opt:${id}:${path}`);
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
// Apply several opts keys at once under one undo step.
function setOptPatch(id, patch, undoKey) {
  pushUndo(undoKey);
  const m = MODULES[idx];
  if (m.editorOwned) {
    const it = m.base.items.find((x) => x.id === id);
    if (it) { it.opts = it.opts || {}; Object.assign(it.opts, patch); }
    m.dirtyDraft = true;
  } else {
    const ov = m.overrides[id] || (m.overrides[id] = {}); ov.opts = ov.opts || {};
    Object.assign(ov.opts, patch);
  }
  scheduleRender();
}
// The knob "radius" field scales the WHOLE knob — radius plus its cap and skirt (if any) —
// so a knob with a fixed outer skirt (e.g. the 259t's) still visibly changes size.
function setKnobRadius(id, newR) {
  if (!(newR > 0)) return;
  const it = workItem(id);
  const oldR = (it && it.opts && it.opts.radius) || 4.6;
  const k = oldR ? newR / oldR : 1;
  const patch = { radius: newR };
  if (it && it.opts && it.opts.cap != null) patch.cap = +(it.opts.cap * k).toFixed(3);
  if (it && it.opts && it.opts.skirt != null) patch.skirt = +(it.opts.skirt * k).toFixed(3);
  setOptPatch(id, patch, `opt:${id}:radius`);
}
function setDesc(id, key, value) {
  const e = descEntry(id);
  if (!e) return;
  pushUndo(`desc:${id}:${key}`);
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
  pushUndo(`item:${id}:${key}`);
  const m = MODULES[idx];
  if (m.editorOwned) { const it = m.base.items.find((x) => x.id === id); if (it) it[key] = value; m.dirtyDraft = true; }
  scheduleRender();
}

function fieldRow(labelText, controlEl) {
  const row = document.createElement('label'); row.className = 'insp-field';
  const s = document.createElement('span'); s.textContent = labelText;
  row.append(s, controlEl); return row;
}
// Live inputs — apply as you type/spin. Undo is coalesced per field by pushUndo's key.
function numberInput(value, onChange, step = 0.1) {
  const el = document.createElement('input'); el.type = 'number'; el.step = String(step); el.value = value ?? '';
  el.addEventListener('input', () => { if (el.value === '') return; const v = Number(el.value); if (Number.isFinite(v)) onChange(v); });
  return el;
}
function textInput(value, onChange) {
  const el = document.createElement('input'); el.type = 'text'; el.value = value ?? '';
  el.addEventListener('input', () => onChange(el.value));
  return el;
}
// For an id/rename field: commit on blur/Enter, not per keystroke (renaming char-by-char is wrong).
function textInputCommit(value, onChange) {
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

// A radio/stepButton's positions: a "positions" count field sets how many, and each
// position's value + label (or glyph) is edited below. The count field adds/trims from
// the end (commit on change, then rebuild the rows); text edits are live.
function stepsEditor(id) {
  const wrap = document.createElement('div'); wrap.className = 'insp-steps';
  const steps = (optVal(id, 'steps', []) || []).map((s) => ({ ...s }));
  const commit = () => setOpt(id, 'steps', steps.map((s) => ({ ...s })));
  const isGlyph = steps.length && 'glyph' in steps[0];
  const count = document.createElement('input'); count.type = 'number'; count.min = '1'; count.step = '1'; count.value = String(steps.length);
  count.addEventListener('change', () => {
    const n = Math.max(1, Math.round(Number(count.value) || 1));
    while (steps.length < n) { const k = steps.length + 1; steps.push(isGlyph ? { value: `p${k}`, glyph: 'triangle' } : { value: `p${k}`, label: `${k}` }); }
    while (steps.length > n) steps.pop();
    setOpt(id, 'steps', steps.map((x) => ({ ...x }))); refreshSettings();
  });
  wrap.appendChild(fieldRow('positions', count));
  steps.forEach((s) => {
    const row = document.createElement('div'); row.className = 'insp-step';
    const val = document.createElement('input'); val.type = 'text'; val.value = s.value ?? ''; val.placeholder = 'value';
    val.addEventListener('input', () => { s.value = val.value; commit(); });
    const g = 'glyph' in s;
    const lab = document.createElement('input'); lab.type = 'text'; lab.value = (g ? s.glyph : s.label) ?? ''; lab.placeholder = g ? 'glyph' : 'label';
    lab.addEventListener('input', () => { if (g) s.glyph = lab.value; else s.label = lab.value; commit(); });
    row.append(val, lab); wrap.appendChild(row);
  });
  return wrap;
}

// A knob's dial scale: a "tick marks" count (0 = none) placing that many evenly-spaced
// ticks, then one label box per tick (blank = an unlabelled tick, "|" = two stacked lines),
// then the geometry that positions the scale. Maps onto the renderer's scale.marks array.
function scaleEditor(id) {
  const wrap = document.createElement('div');
  const scale = optVal(id, 'scale', null);
  const marks = (scale && Array.isArray(scale.marks)) ? scale.marks.map((m) => ({ ...m })) : [];
  const labelStr = (m) => (Array.isArray(m.label) ? m.label.join('|') : (m.label ?? ''));
  const parseLabel = (s) => { const t = (s || '').trim(); if (!t) return null; const p = t.split('|').map((x) => x.trim()); return p.length > 1 ? p : p[0]; };
  const respace = () => { const n = marks.length; marks.forEach((m, i) => { m.at = n <= 1 ? 0.5 : i / (n - 1); m.tick = true; }); };
  const commit = () => setOpt(id, 'scale.marks', marks.map((m) => ({ ...m })));

  const count = document.createElement('input'); count.type = 'number'; count.min = '0'; count.step = '1'; count.value = String(marks.length);
  count.addEventListener('change', () => {
    const n = Math.max(0, Math.round(Number(count.value) || 0));
    if (n === 0) { setOpt(id, 'scale', null); refreshSettings(); return; }
    while (marks.length < n) marks.push({ at: 0, label: null, tick: true });
    while (marks.length > n) marks.pop();
    respace();
    if (!(scale && scale.size != null)) setOpt(id, 'scale.size', 1.8);
    setOpt(id, 'scale.marks', marks.map((m) => ({ ...m })));
    refreshSettings();
  });
  wrap.appendChild(fieldRow('tick marks', count));

  marks.forEach((m) => {
    const row = document.createElement('div'); row.className = 'insp-step';
    const lab = document.createElement('input'); lab.type = 'text'; lab.value = labelStr(m); lab.placeholder = 'label (blank = tick only)';
    lab.addEventListener('input', () => { m.label = parseLabel(lab.value); commit(); });
    row.appendChild(lab); wrap.appendChild(row);
  });

  if (marks.length) {
    const sub = document.createElement('div'); sub.className = 'insp-sub'; sub.textContent = 'geometry'; wrap.appendChild(sub);
    wrap.appendChild(fieldRow('font size', numberInput(optVal(id, 'scale.size', 1.8), (v) => setOpt(id, 'scale.size', v))));
    wrap.appendChild(fieldRow('tick gap', numberInput(optVal(id, 'scale.tickGap', 0.6), (v) => setOpt(id, 'scale.tickGap', v))));
    wrap.appendChild(fieldRow('tick length', numberInput(optVal(id, 'scale.tickLen', 1.1), (v) => setOpt(id, 'scale.tickLen', v))));
    wrap.appendChild(fieldRow('label gap', numberInput(optVal(id, 'scale.labelGap', 1.8), (v) => setOpt(id, 'scale.labelGap', v))));
    const idxc = document.createElement('input'); idxc.type = 'checkbox'; idxc.checked = !!optVal(id, 'scale.index', false);
    idxc.addEventListener('change', () => setOpt(id, 'scale.index', idxc.checked));
    wrap.appendChild(fieldRow('index mark', idxc));
  }
  return wrap;
}

// Collapsible sections. `collapsed` persists which are closed across rebuilds so editing
// a field (which rebuilds the body) doesn't reset what you opened. Toggling just shows/hides.
const collapsed = new Set(['scale']);   // the dial-scale sub-section starts collapsed
function section(title, key) {
  const el = document.createElement('section'); el.className = 'insp-section';
  const h = document.createElement('h4');
  const isC = key && collapsed.has(key);
  const tri = document.createElement('span'); tri.className = 'tri'; tri.textContent = isC ? '▸' : '▾';
  const t = document.createElement('span'); t.textContent = title;
  h.append(tri, t);
  const body = document.createElement('div'); body.className = 'insp-body';
  if (isC) body.style.display = 'none';
  if (key) h.addEventListener('click', () => {
    const c = collapsed.has(key) ? (collapsed.delete(key), false) : (collapsed.add(key), true);
    body.style.display = c ? 'none' : '';
    tri.textContent = c ? '▸' : '▾';
  });
  el.append(h, body);
  return { el, body };
}
function note(body, text) { const d = document.createElement('div'); d.className = 'insp-note'; d.textContent = text; body.appendChild(d); }

// Build the settings body (presentation + data) for a control, as a detached element
// — the same fields the sidebar held, now shown in a floating panel. null if no item.
function buildSettingsBody(id) {
  const it = workItem(id);
  if (!it) return null;
  const e = descEntry(id);
  const root = document.createElement('div');

  // --- Structure items (label, divider): presentation only, no descriptor ---
  if (STRUCTURE_TYPES.has(it.t)) {
    const s = section('Structure', 'struct');
    if (it.t === 'label') {
      s.body.appendChild(fieldRow('text', textInput(it.text, (v) => setItemField(id, 'text', v))));
      s.body.appendChild(fieldRow('font size', numberInput(optVal(id, 'size', 2.4), (v) => setOpt(id, 'size', v))));
    } else {
      s.body.appendChild(fieldRow('length', numberInput(it.len, (v) => setItemField(id, 'len', v))));
      s.body.appendChild(fieldRow('thickness', numberInput(it.w, (v) => setItemField(id, 'w', v), 0.05)));
    }
    if (MODULES[idx].editorOwned) s.body.appendChild(fieldRow('id', textInputCommit(id, (v) => renameControl(id, v))));
    root.appendChild(s.el);
    return root;
  }

  // --- Presentation (layout) ---
  const pres = section('Presentation', 'pres');
  const addP = (label, el) => pres.body.appendChild(fieldRow(label, el));
  if (it.t === 'knob') addP('radius', numberInput(optVal(id, 'radius', 4.6), (v) => setKnobRadius(id, v)));
  if (it.opts && it.opts.label && typeof it.opts.label === 'object') {
    addP('label text', textInput(optVal(id, 'label.text', ''), (v) => setOpt(id, 'label.text', v)));
    addP('label place', selectInput(optVal(id, 'label.placement', 'below'), PLACEMENTS, (v) => setOpt(id, 'label.placement', v)));
    addP('font size', numberInput(optVal(id, 'label.size', 2.0), (v) => setOpt(id, 'label.size', v)));
  }
  if (it.t === 'radio' || it.t === 'stepButton') {
    addP('orientation', selectInput(optVal(id, 'orientation', 'v'), [['h', 'horizontal'], ['v', 'vertical']], (v) => setOpt(id, 'orientation', v)));
    addP('spacing', numberInput(optVal(id, 'spacing', 5.6), (v) => setOpt(id, 'spacing', v)));
    addP('LED radius', numberInput(optVal(id, 'ledR', 2.16), (v) => setOpt(id, 'ledR', v)));
    const sub = document.createElement('div'); sub.className = 'insp-sub'; sub.textContent = 'positions'; pres.body.appendChild(sub);
    pres.body.appendChild(stepsEditor(id));
  }
  if (it.t === 'button') { addP('radius', numberInput(optVal(id, 'r', 2.0), (v) => setOpt(id, 'r', v))); addP('kind', textInput(optVal(id, 'kind', 'red'), (v) => setOpt(id, 'kind', v))); }
  if (it.t === 'knob') {   // dial scale as its own collapsible sub-section
    const sc = section('Dial scale', 'scale'); sc.el.classList.add('sub');
    sc.body.appendChild(scaleEditor(id));
    pres.body.appendChild(sc.el);
  }
  if (!pres.body.children.length) note(pres.body, 'no presentation options for this control');
  root.appendChild(pres.el);

  // --- Data (descriptor) ---
  const data = section('Descriptors', 'desc');
  const owned = MODULES[idx].editorOwned;
  note(data.body, owned ? 'generated into descriptor.js on Save' : 'live preview — written to descriptor.js in a later phase');
  const addD = (label, el) => data.body.appendChild(fieldRow(label, el));
  if (owned && e) {
    addD('id', textInputCommit(id, (v) => renameControl(id, v)));
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
  root.appendChild(data.el);
  return root;
}

// ---- floating panels (settings, module) — draggable, non-modal ------------
let settingsId = null;   // control id the settings float currently shows
function makeDraggable(el, handle) {
  handle.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.float-close')) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = parseFloat(el.style.left) || 0, oy = parseFloat(el.style.top) || 0;
    const move = (ev) => { el.style.left = `${ox + ev.clientX - sx}px`; el.style.top = `${oy + ev.clientY - sy}px`; };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  });
}
function clampFloat(f) {
  const r = f.getBoundingClientRect();
  if (r.right > innerWidth) f.style.left = `${Math.max(4, innerWidth - r.width - 4)}px`;
  if (r.bottom > innerHeight) f.style.top = `${Math.max(4, innerHeight - r.height - 4)}px`;
}
// Show/update a floating panel by key. x/y position it (undefined = keep current position).
function showFloat(key, title, bodyEl, x, y) {
  let f = floatRoot.querySelector(`.float[data-float="${key}"]`);
  if (!f) {
    f = document.createElement('div'); f.className = 'float'; f.dataset.float = key;
    const head = document.createElement('div'); head.className = 'float-head';
    const t = document.createElement('span'); t.className = 'float-title';
    const close = document.createElement('button'); close.className = 'float-close'; close.textContent = '×';
    close.addEventListener('click', () => { f.remove(); if (key === 'settings') settingsId = null; });
    head.append(t, close); makeDraggable(f, head);
    const body = document.createElement('div'); body.className = 'float-body';
    f.append(head, body); floatRoot.appendChild(f);
    if (x == null) { x = 120; y = 120; }
  }
  f.querySelector('.float-title').textContent = title;
  f.querySelector('.float-body').replaceChildren(bodyEl);
  if (x != null) { f.style.left = `${x}px`; f.style.top = `${y}px`; clampFloat(f); }
}
function openSettings(id) {
  const body = buildSettingsBody(id);
  if (!body) { closeSettings(); return; }
  settingsId = id;
  const it = workItem(id);
  showFloat('settings', `${it.t} · ${id}`, body);
  positionSettingsByControl(id);
}
// Pop the settings float just to the RIGHT of the control being edited (the knob/jack
// itself), vertically centred on it; if there's no room, flip to its left.
function positionSettingsByControl(id) {
  const f = floatRoot.querySelector('.float[data-float="settings"]');
  if (!f || !currentSvg) return;
  const ctrl = currentSvg.querySelector(`[data-wcoast-param="${id}"]`) || currentSvg.querySelector(`[data-wcoast-port="${id}"]`) || currentSvg.querySelector(`[data-ctrl-id="${id}"]`);
  if (!ctrl) return;
  const a = ctrl.getBoundingClientRect();
  const fh = f.getBoundingClientRect().height;
  f.style.left = `${a.right + 12}px`;
  f.style.top = `${a.top + a.height / 2 - fh / 2}px`;
  if (f.getBoundingClientRect().right > innerWidth) f.style.left = `${Math.max(4, a.left - f.getBoundingClientRect().width - 12)}px`;
  clampFloat(f);
}
function refreshSettings() {   // rebuild the settings float in place after a structural edit
  if (!settingsId) return;
  const body = buildSettingsBody(settingsId);
  const it = workItem(settingsId);
  if (!body || !it) { closeSettings(); return; }
  showFloat('settings', `${it.t} · ${settingsId}`, body);
}
function closeSettings() { settingsId = null; const f = floatRoot.querySelector('.float[data-float="settings"]'); if (f) f.remove(); }
function closeFloats() { floatRoot.replaceChildren(); settingsId = null; }   // module change / big state change

// Module settings (name / id / width) — a floating panel reached from the File menu.
function openModuleSettings() {
  const m = MODULES[idx];
  const root = document.createElement('div');
  const mod = section('Module', 'module');
  mod.body.appendChild(fieldRow('name', textInput(m.workDesc.name, (v) => { m.workDesc.name = v; m.name = v; m.dirtyDraft = true; refreshStatus(); })));
  mod.body.appendChild(fieldRow('id', textInputCommit(m.workDesc.id, (v) => { m.workDesc.id = (v || '').trim() || m.workDesc.id; m.dirtyDraft = true; })));
  mod.body.appendChild(fieldRow('width mm', numberInput(m.base.faceW, (v) => { pushUndo('modWidth'); m.base.faceW = v; m.base.items[0].w = v; m.base.items[1].w = v - 1; m.dirtyDraft = true; scheduleRender(); }, 1)));
  root.appendChild(mod.el);
  showFloat('module', `Module · ${m.workDesc.id}`, root, 140, 120);
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
  selectedId = null; activeTool = null; resetScrollNext = true; closeFloats(); refreshToolbox(); scheduleRender();
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
  selectedId = made.item.id; openSettings(selectedId); scheduleRender();   // open its settings to configure
}
function renameControl(oldId, newId) {
  const m = MODULES[idx]; if (!m.editorOwned) return;
  newId = (newId || '').trim();
  if (!newId || newId === oldId) { refreshSettings(); return; }
  const clash = m.base.items.some((i) => i.id === newId) || (m.workDesc.ports || []).some((p) => p.id === newId) || (m.workDesc.params || []).some((p) => p.id === newId);
  if (clash) { status.textContent = `id "${newId}" is already used`; refreshSettings(); return; }
  pushUndo();
  const it = m.base.items.find((i) => i.id === oldId); if (it) it.id = newId;
  const e = descEntry(oldId); if (e) e.id = newId;
  if (settingsId === oldId) settingsId = newId;
  selectedId = newId; m.dirtyDraft = true; scheduleRender(); refreshSettings();
}
function moveEntry(id, dir) {
  const m = MODULES[idx];
  const arr = (m.workDesc.ports || []).some((p) => p.id === id) ? m.workDesc.ports : m.workDesc.params;
  const i = arr.findIndex((p) => p.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= arr.length) return;
  pushUndo();
  [arr[i], arr[j]] = [arr[j], arr[i]];
  m.dirtyDraft = true; refreshSettings();
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
  readout.textContent = MODULES[idx].editorOwned
    ? 'Pick a tool to add a control · click to select, drag or arrow-keys to move · right-click for settings'
    : 'Click a control to select · drag or arrow-keys to move · right-click for settings · Shift = ×5';
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
  scheduleRender();
}

// The main menu: hamburger (top-left) and right-click. Right-clicking a control opens
// that control's settings float instead; right-clicking anywhere else opens the menu.
burger.addEventListener('click', () => { const r = burger.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, mainMenu()); });
document.getElementById('closeBtn').addEventListener('click', () => window.close());
document.addEventListener('contextmenu', (e) => {
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;   // leave native editing menus alone
  e.preventDefault();
  const handle = e.target.closest && e.target.closest('[data-ctrl-id]');
  if (handle) { const id = handle.getAttribute('data-ctrl-id'); selectedId = id; openSettings(id); scheduleRender(); return; }
  openMenu(e.clientX, e.clientY, mainMenu());
});
// Click outside an open settings/module float closes it (like a popover). Capture phase, and
// a click inside a float (its fields or header) is left alone so editing/dragging still works.
document.addEventListener('pointerdown', (e) => {
  if (!floatRoot.firstChild) return;
  if (e.target.closest && e.target.closest('.float')) return;         // inside a float — keep it
  if (e.target.closest && e.target.closest('[data-ctrl-id]')) return; // clicking a control — switch, don't close
  closeFloats();
}, true);
window.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (dirty()) save(); return; }
  if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); (e.shiftKey ? redo : undo)(); return; }
  if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newDraft(); return; }
  if (mod && (e.key === '=' || e.key === '+')) { e.preventDefault(); zoomBy(1.2); return; }
  if (mod && e.key === '-') { e.preventDefault(); zoomBy(1 / 1.2); return; }
  if (mod && e.key === '0') { e.preventDefault(); zoomReset(); return; }
  if (e.key === 'Escape') {   // back out one level (works from inside a field too); else close the editor
    if (menuRoot.firstChild) { closeMenus(); return; }
    if (dialogRoot.firstChild) { dialogRoot.replaceChildren(); return; }
    if (floatRoot.firstChild) { closeFloats(); return; }
    if (selectedId) { selectedId = null; scheduleRender(); return; }
    window.close();
    return;
  }
  const tag = (e.target.tagName || '').toLowerCase();
  if (tag === 'input' || tag === 'select' || tag === 'textarea') return;
  const step = e.shiftKey ? 1.0 : 0.2;
  const map = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
  if (map[e.key]) { e.preventDefault(); nudge(...map[e.key]); }
});

buildToolbox();
boot();
