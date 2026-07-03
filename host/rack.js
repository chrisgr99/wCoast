// rack.js — the case that holds module faceplates (DESIGN.md §5A).
//
// The rack lays out module panels on the Eurorack width grid across one or more
// rows, and owns their placement interaction: right-click an empty spot to add
// a module, right-click a module to delete it, and left-drag a module by its
// faceplate background to move it (snapping to HP, with a ghost preview,
// pushing neighbours right on drop). Each placed module is a live instance —
// the rack instantiates it through the host, loads and binds its panel via the
// panel-loader, and makes its knobs/switches operable. No cables yet; this is
// placement and appearance only.
//
// VIEW MODEL. Everything lives in one scaled coordinate space (millimetres of
// real panel), inside a single scrolling viewport:
//   - At zoom 1 the rows exactly fill the window height, so N rows each take
//     window_height / N.
//   - Pinch (trackpad, or ctrl+wheel) zooms the whole rack toward the cursor;
//     zoomed in, the case overflows the window on purpose and you pan around it
//     with a normal two-finger scroll (which turns a knob instead when the
//     pointer is over one). 1 HP = 5.08 mm; a module occupies descriptor.hp HP.

import { loadPanel, showValue, attachControlInteraction, FACE_H_MM, FACE_TOP_MM } from './panel-loader.js';
import { Patchbay, canConnect, DENY } from './patchbay.js';

// Friendly section prefixes so duplicate port names (two "FM In", two "CV In")
// read unambiguously in the connect menu.
const SECTION_LABEL = { modOsc: 'Mod osc', prinOsc: 'Principal', timbre: 'Timbre', middle: 'Center' };

const HP_MM = 5.08;
const PANEL_H_MM = FACE_H_MM;   // modules display only the cropped functional face
const GAP_MM = 4;               // gap between rows / around the case, in mm (scales too)
const SVG_NS = 'http://www.w3.org/2000/svg';

// Cable colour encodes DOMAIN (matching the port bodies), not identity: audio
// orange, control blue, trigger black. One thin weight for every cord — thin
// lines obscure less as they cross the panel, and colour separates them.
const STYLE_COLOR = { audio: '#ff7300', control: '#1f7fe0', trigger: '#000000' };
const domainStyle = (domain) => (domain === 'audio' ? 'audio' : domain === 'trigger' ? 'trigger' : 'control');
const CABLE_PX = 3.8;   // cord thickness in px at zoom 1 (scales up as you zoom in)

function r2(x) { return Math.round(x * 100) / 100; }
function unit(dx, dy) { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; }
function clamp01(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

export class Rack {
  // opts: { host, moduleTypes:[{descriptorId,name,hp,panelUrl,descriptor}], rowCount, onChange }
  constructor(container, opts) {
    this.container = container;   // the scrolling viewport
    this.host = opts.host;
    this.moduleTypes = opts.moduleTypes;
    this.onChange = opts.onChange || (() => {});
    this.rowCount = opts.rowCount || 2;
    this.rows = [];
    for (let i = 0; i < this.rowCount; i++) this.rows.push([]);
    this.records = new Map();     // key -> record
    this.pxPerMm = 1;
    this.zoom = 1;
    this._hoverRec = null;   // module under the pointer (for focus-zoom key)
    this._focusRec = null;   // module currently focus-zoomed to full height
    this._zoomAnim = null;   // rAF handle for the zoom transition
    this._clickTimer = null; // single/double-click discrimination
    this._clickRec = null;
    this._seq = 0;
    this._rowEls = [];
    this._menuEl = null;
    this._ghostEl = null;
    this._tempCable = null;
    this._dragEdgeId = null;   // edge whose end is being dragged (hidden meanwhile)
    this._highlights = null;   // candidate rings thickened during a drag
    this._contentWmm = 0;
    this._contentHmm = 0;

    // The connection layer: the netlist + audio wiring (host/patchbay.js), and
    // an SVG overlay the cords are drawn onto (pointer-transparent, so it never
    // steals clicks from the jacks and knobs beneath it).
    this.patchbay = new Patchbay(this.host.ctx, this.host.registry);

    this.container.classList.add('rack');
    this.content = document.createElement('div');
    this.content.className = 'rack-content';
    this.container.appendChild(this.content);
    this.cables = document.createElementNS(SVG_NS, 'svg');
    this.cables.setAttribute('class', 'rack-cables');
    this._buildRows();

    window.addEventListener('resize', () => this.relayout());
    document.addEventListener('pointerdown', (e) => {
      if (this._menuEl && !this._menuEl.contains(e.target)) this._closeMenu();
    }, true);
    // Pinch / ctrl-wheel to zoom (capture phase, so it beats a knob's wheel).
    this.container.addEventListener('wheel', (e) => {
      if (e.ctrlKey) this._onPinch(e);
    }, { passive: false, capture: true });
    // '/' over a module focus-zooms it to full height (toggle). Faceplate
    // background clicks are handled per-module in _startDrag: double-click
    // zooms the module, single-click restores the fitted view while zoomed.
    document.addEventListener('keydown', (e) => this._onKey(e));
  }

  _onKey(e) {
    const t = e.target;
    if (t && /^(INPUT|SELECT|TEXTAREA)$/.test(t.tagName)) return;
    if (e.key === '/') {
      e.preventDefault();
      if (this._focusRec) this._resetZoom();
      else if (this._hoverRec) this._focusModule(this._hoverRec);
    }
  }

  // Zoom so one module fills the full window height, and scroll it into view.
  _focusModule(rec) {
    const vpH = this.container.clientHeight || 600;
    const vpW = this.container.clientWidth || 800;
    const contentHmm = this.rowCount * PANEL_H_MM + (this.rowCount + 1) * GAP_MM;
    const fit = vpH / contentHmm;
    const targetZoom = (vpH / PANEL_H_MM) / fit;   // module height == window height
    const s = fit * targetZoom;                     // pxPerMm at the target zoom
    const rowTopMm = GAP_MM + rec.row * (PANEL_H_MM + GAP_MM);
    const targetTop = Math.max(0, rowTopMm * s);
    const targetLeft = Math.max(0, rec.hp * HP_MM * s + rec.panelWmm * s / 2 - vpW / 2);
    this._focusRec = rec;
    this._animateZoom(targetZoom, targetLeft, targetTop);
  }

  _resetZoom() {
    this._focusRec = null;
    this._animateZoom(1, 0, 0);
  }

  // Smoothly interpolate zoom (and scroll) to a target, relaying out each frame.
  _animateZoom(targetZoom, targetLeft, targetTop) {
    if (this._zoomAnim) cancelAnimationFrame(this._zoomAnim);
    const startZoom = this.zoom;
    const startLeft = this.container.scrollLeft;
    const startTop = this.container.scrollTop;
    const dur = 260;
    const t0 = performance.now();
    const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const k = ease(t);
      this.zoom = startZoom + (targetZoom - startZoom) * k;
      this.relayout();
      this.container.scrollLeft = startLeft + (targetLeft - startLeft) * k;
      this.container.scrollTop = startTop + (targetTop - startTop) * k;
      this._zoomAnim = t < 1 ? requestAnimationFrame(step) : null;
    };
    this._zoomAnim = requestAnimationFrame(step);
  }

  // A background click on a faceplate: double-click zooms the module to full
  // height; a single click while zoomed restores the fitted view. Timed here so
  // the single action doesn't fire on the way to a double.
  _handleClick(rec) {
    if (this._clickTimer && this._clickRec === rec) {
      clearTimeout(this._clickTimer);
      this._clickTimer = null; this._clickRec = null;
      this._focusModule(rec);                  // double-click → zoom to full height
      return;
    }
    if (this._clickTimer) clearTimeout(this._clickTimer);
    this._clickRec = rec;
    this._clickTimer = setTimeout(() => {
      this._clickTimer = null; this._clickRec = null;
      if (this._focusRec) this._resetZoom();   // single click while zoomed → restore
    }, 250);
  }

  moduleCount() { return this.records.size; }
  moduleRecords() { return [...this.records.values()]; }

  setRowCount(n) {
    n = Math.max(1, Math.min(6, Math.round(n)));
    if (n === this.rowCount) return;
    if (n < this.rowCount) {
      for (let i = n; i < this.rowCount; i++) {
        for (const rec of this.rows[i]) { rec.row = n - 1; this.rows[n - 1].push(rec); }
      }
      this.rows.length = n;
    } else {
      for (let i = this.rowCount; i < n; i++) this.rows.push([]);
    }
    this.rowCount = n;
    for (const r of this.rows) this._resolveRow(r);
    this._buildRows();
    this.relayout();
  }

  _buildRows() {
    this.content.textContent = '';
    this._rowEls = [];
    for (let i = 0; i < this.rowCount; i++) {
      const row = document.createElement('div');
      row.className = 'rack-row';
      row.dataset.row = String(i);
      row.addEventListener('contextmenu', (e) => this._onRowContextMenu(e, i));
      this.content.appendChild(row);
      this._rowEls.push(row);
    }
    for (const rec of this.records.values()) this._rowEls[rec.row].appendChild(rec.el);
    this.content.appendChild(this.cables);   // cords paint above the panels
  }

  // ---- geometry / scaling ----
  relayout() {
    const vpH = this.container.clientHeight || 600;
    const vpW = this.container.clientWidth || 800;
    const contentHmm = this.rowCount * PANEL_H_MM + (this.rowCount + 1) * GAP_MM;
    const fit = vpH / contentHmm;           // fill the viewport height at zoom 1
    this._fit = fit;                        // px-per-mm at zoom 1 (for cord thickness)
    this.pxPerMm = fit * this.zoom;
    const s = this.pxPerMm;

    let maxRightMm = 0;
    for (const r of this.rows) for (const rec of r) maxRightMm = Math.max(maxRightMm, (rec.hp + rec.hpWidth) * HP_MM);
    const contentWmm = Math.max(maxRightMm + GAP_MM, vpW / s);
    this._contentWmm = contentWmm;
    this._contentHmm = contentHmm;

    this.content.style.width = (contentWmm * s) + 'px';
    this.content.style.height = (contentHmm * s) + 'px';
    for (let i = 0; i < this.rowCount; i++) {
      const el = this._rowEls[i];
      el.style.top = ((GAP_MM + i * (PANEL_H_MM + GAP_MM)) * s) + 'px';
      el.style.height = (PANEL_H_MM * s) + 'px';
      el.style.width = (contentWmm * s) + 'px';
    }
    for (const rec of this.records.values()) this._placeEl(rec);
    this._drawCables();
  }

  _placeEl(rec) {
    const s = this.pxPerMm;
    rec.el.style.left = (rec.hp * HP_MM * s) + 'px';
    rec.el.style.width = (rec.panelWmm * s) + 'px';
    rec.el.style.height = (PANEL_H_MM * s) + 'px';
  }

  // ---- cables (netlist rendered onto the panel) ----
  // A jack's anchor is in panel-viewBox mm; convert to content mm (which the
  // overlay's viewBox uses, so cords line up at any zoom). Everything is mm here
  // and the overlay is px-sized in _drawCables, so a zoom needs no path rework.
  _jackPosMm(key, portId) {
    const rec = this.records.get(key);
    if (!rec) return null;
    const port = rec.panel.ports.get(portId);
    if (!port || !port.anchor) return null;
    return {
      x: rec.hp * HP_MM + port.anchor.x,
      y: GAP_MM + rec.row * (PANEL_H_MM + GAP_MM) + (port.anchor.y - FACE_TOP_MM),
      r: port.holeR || 0,
    };
  }

  _clientToMm(clientX, clientY) {
    const r = this.content.getBoundingClientRect();
    const s = this.pxPerMm || 1;
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  }

  // Straight cord between two jack centres (cA/cB). Because both ends sit on the
  // line joining the centres, the cord aims exactly at each centre; it stops at
  // holeR + w/2 so the round cap butts the hole rim without covering it.
  _cordPath(cA, rA, cB, rB, w) {
    const dx = cB.x - cA.x, dy = cB.y - cA.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const p0 = { x: cA.x + ux * (rA + w / 2), y: cA.y + uy * (rA + w / 2) };
    const p3 = { x: cB.x - ux * (rB + w / 2), y: cB.y - uy * (rB + w / 2) };
    return `M${r2(p0.x)},${r2(p0.y)} L${r2(p3.x)},${r2(p3.y)}`;
  }

  // The belly point a cord passes through, from its stored bow {f,d} (or a gentle
  // default). f is the horizontal fraction between the two jacks (0..1); d is the
  // depth below the straight chord (>=0). Both are relative, so the cord re-hangs
  // itself when a module moves. This is also where the gravity limits live.
  _bellyPoint(a, b, bow) {
    const leftX = Math.min(a.x, b.x), rightX = Math.max(a.x, b.x);
    const span = rightX - leftX;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const f = bow ? clamp01(bow.f) : 0.5;
    const d = bow ? Math.max(0, bow.d) : Math.max(5, 0.14 * dist);
    if (span < 1e-3) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + d };
    const bx = leftX + f * span;
    const chordY = a.y + (b.y - a.y) * (bx - a.x) / (b.x - a.x);
    return { x: bx, y: chordY + d };
  }

  // Turn a dragged point into a stored bow {f,d}, clamped to the gravity box:
  // horizontally between the jacks, vertically at or below the chord.
  _bowFromPoint(a, b, m) {
    const leftX = Math.min(a.x, b.x), rightX = Math.max(a.x, b.x);
    const span = rightX - leftX;
    if (span < 1e-3) return { f: 0.5, d: Math.max(0, m.y - (a.y + b.y) / 2) };
    const bx = Math.max(leftX, Math.min(rightX, m.x));
    const chordY = a.y + (b.y - a.y) * (bx - a.x) / (b.x - a.x);
    return { f: (bx - leftX) / span, d: Math.max(0, m.y - chordY) };
  }

  // The cord's geometry: a quadratic (parabola => never inflects) through the
  // belly, with each end attached at the hole rim along the line to the control
  // point Q — so the end tangent passes through that jack's centre.
  _cordGeom(e) {
    const a = this._jackPosMm(e.src.key, e.src.portId);
    const b = this._jackPosMm(e.dst.key, e.dst.portId);
    if (!a || !b) return null;
    const w = CABLE_PX / (this._fit || 1);
    const belly = this._bellyPoint(a, b, e.bow);
    const Q = { x: 2 * belly.x - (a.x + b.x) / 2, y: 2 * belly.y - (a.y + b.y) / 2 };
    const u0 = unit(Q.x - a.x, Q.y - a.y);
    const u3 = unit(Q.x - b.x, Q.y - b.y);
    const p0 = { x: a.x + (a.r + w / 2) * u0.x, y: a.y + (a.r + w / 2) * u0.y };
    const p3 = { x: b.x + (b.r + w / 2) * u3.x, y: b.y + (b.r + w / 2) * u3.y };
    return { a, b, w, Q, u0, u3, p0, p3 };
  }

  _drawCables() {
    if (!this.cables) return;
    const s = this.pxPerMm;
    this.cables.setAttribute('viewBox', `0 0 ${r2(this._contentWmm)} ${r2(this._contentHmm)}`);
    this.cables.style.width = (this._contentWmm * s) + 'px';
    this.cables.style.height = (this._contentHmm * s) + 'px';
    this.cables.textContent = '';
    const wmm = CABLE_PX / (this._fit || 1);   // mm width -> CABLE_PX at zoom 1, scales with zoom
    const hitMm = 9 / (s || 1);                // ~9 px grab target
    const mk = (d, stroke, sw, opacity, pe) => {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('fill', 'none');
      p.setAttribute('stroke', stroke);
      p.setAttribute('stroke-width', r2(sw));
      if (opacity != null) p.style.opacity = String(opacity);
      if (pe) p.style.pointerEvents = pe;
      this.cables.appendChild(p);
      return p;
    };
    for (const e of this.patchbay.list()) {
      if (e.id === this._dragEdgeId) continue; // hidden while its end is being dragged
      const g = this._cordGeom(e);
      if (!g) continue;
      const color = STYLE_COLOR[e.style] || STYLE_COLOR.control;
      const cordD = `M${r2(g.p0.x)},${r2(g.p0.y)} Q${r2(g.Q.x)},${r2(g.Q.y)} ${r2(g.p3.x)},${r2(g.p3.y)}`;
      // Ghosted whole cord (inherits pointer-events:none, so clicks fall through);
      // a wide transparent reshape hit-path over it grabs the cord to droop it.
      mk(cordD, color, wmm, 0.5, null);
      mk(cordD, 'transparent', hitMm, null, 'stroke')
        .addEventListener('pointerdown', (ev) => this._startReshape(ev, e));
      // An opaque stub along each end tangent, plus a grab hit-path that moves or
      // deletes THIS cable's end. Appended last, so it wins over the reshape path.
      for (const en of [{ p: g.p0, u: g.u0, r: g.a.r, end: 'src' }, { p: g.p3, u: g.u3, r: g.b.r, end: 'dst' }]) {
        const sd = `M${r2(en.p.x)},${r2(en.p.y)} L${r2(en.p.x + en.u.x * 2 * en.r)},${r2(en.p.y + en.u.y * 2 * en.r)}`;
        mk(sd, color, wmm, 1, null);
        mk(sd, 'transparent', hitMm, null, 'stroke')
          .addEventListener('pointerdown', (ev) => this._startRegrab(ev, e, en.end));
      }
    }
    if (this._tempCable) {
      this._tempCable.setAttribute('stroke-width', r2(wmm));
      this.cables.appendChild(this._tempCable);
    }
  }

  // ---- drag-to-patch ----
  // Resolve the DOM element under the cursor to a { key, portId } jack.
  _jackFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const jack = el && el.closest && el.closest('[data-wcoast-port]');
    if (!jack) return null;
    const modEl = jack.closest('.rack-module');
    if (!modEl || !this.records.has(modEl.dataset.key)) return null;
    return { key: modEl.dataset.key, portId: jack.getAttribute('data-wcoast-port') };
  }

  // Start a NEW cable by dragging from a bare part of a port.
  _startCable(e, rec, portId) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = { key: rec.key, portId };
    const meta = rec.panel.ports.get(portId).meta;
    const a = this._jackPosMm(rec.key, portId);
    const wmm = CABLE_PX / (this._fit || 1);
    const tmp = document.createElementNS(SVG_NS, 'path');
    tmp.setAttribute('class', 'rack-cable rack-cable-temp');
    tmp.setAttribute('stroke', STYLE_COLOR[domainStyle(meta.domain)]);
    tmp.setAttribute('stroke-width', r2(wmm));
    this._tempCable = tmp;
    this.cables.appendChild(tmp);
    this._highlightCandidates(meta.domain, meta.dir === 'out' ? 'in' : 'out');

    const onMove = (ev) => {
      const m = this._clientToMm(ev.clientX, ev.clientY);
      tmp.setAttribute('d', this._cordPath(a, a.r, m, 0, wmm));
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      tmp.remove();
      this._tempCable = null;
      this._clearHighlights();
      const drop = this._jackFromPoint(ev.clientX, ev.clientY);
      if (drop && !(drop.key === start.key && drop.portId === start.portId)) {
        this._tryConnect(start, drop);
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // Grab an existing cable by one of its stub ends: drag it to another valid port
  // to move that end, or onto nothing to delete the cable. The fixed end stays.
  _startRegrab(ev, edge, grabbedEnd) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const fixed = grabbedEnd === 'src' ? edge.dst : edge.src;
    const grabbed = grabbedEnd === 'src' ? edge.src : edge.dst;
    const fixedRec = this.records.get(fixed.key);
    if (!fixedRec) return;
    const fixedMeta = fixedRec.panel.ports.get(fixed.portId).meta;
    const fixedPos = this._jackPosMm(fixed.key, fixed.portId);
    const wantDir = fixedMeta.dir === 'out' ? 'in' : 'out';
    const wmm = CABLE_PX / (this._fit || 1);

    this._dragEdgeId = edge.id;    // hide the grabbed cord while dragging it
    this._drawCables();
    const tmp = document.createElementNS(SVG_NS, 'path');
    tmp.setAttribute('class', 'rack-cable rack-cable-temp');
    tmp.setAttribute('stroke', STYLE_COLOR[domainStyle(fixedMeta.domain)]);
    tmp.setAttribute('stroke-width', r2(wmm));
    this._tempCable = tmp;
    this.cables.appendChild(tmp);
    this._highlightCandidates(fixedMeta.domain, wantDir);

    const onMove = (e2) => {
      const m = this._clientToMm(e2.clientX, e2.clientY);
      tmp.setAttribute('d', this._cordPath(fixedPos, fixedPos.r, m, 0, wmm));
    };
    const onUp = (e2) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      tmp.remove();
      this._tempCable = null;
      this._clearHighlights();
      this._dragEdgeId = null;
      const drop = this._jackFromPoint(e2.clientX, e2.clientY);
      const droppedBack = drop && drop.key === grabbed.key && drop.portId === grabbed.portId;
      if (droppedBack) {
        this._drawCables();                              // unchanged — just restore
      } else if (drop && this._isCandidate(drop, fixedMeta.domain, wantDir)) {
        this.patchbay.disconnect(edge);                  // move: reconnect fixed end -> new port
        this._tryConnect({ key: fixed.key, portId: fixed.portId }, drop);
      } else {
        this.patchbay.disconnect(edge);                  // dropped on nothing -> delete
        this._drawCables();
        this.onChange();
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // Press on the cord's translucent body: a drag droops it (the belly follows
  // the pointer, clamped to the gravity box); a click with no drag passes through
  // to whatever is behind the cord, preserving click-through.
  _startReshape(ev, edge) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const startX = ev.clientX, startY = ev.clientY;
    const a = this._jackPosMm(edge.src.key, edge.src.portId);
    const b = this._jackPosMm(edge.dst.key, edge.dst.portId);
    if (!a || !b) return;
    const target = ev.target;
    let moved = false;
    const onMove = (e2) => {
      if (!moved && Math.abs(e2.clientX - startX) + Math.abs(e2.clientY - startY) < 3) return;
      moved = true;
      edge.bow = this._bowFromPoint(a, b, this._clientToMm(e2.clientX, e2.clientY));
      this._drawCables();
    };
    const onUp = (e2) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      if (moved) { this.onChange(); return; }
      // No drag: forward the click to the element behind the cord.
      target.style.pointerEvents = 'none';
      const under = document.elementFromPoint(e2.clientX, e2.clientY);
      target.style.pointerEvents = 'stroke';
      if (under) under.dispatchEvent(new MouseEvent('click',
        { bubbles: true, cancelable: true, clientX: e2.clientX, clientY: e2.clientY, view: window }));
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _isCandidate(jack, domain, wantDir) {
    const rec = this.records.get(jack.key);
    const port = rec && rec.panel.ports.get(jack.portId);
    return !!port && port.meta.dir === wantDir && port.meta.domain === domain;
  }

  // While a cable is dragging, thicken the outer ring of every valid target port
  // (same domain, opposite direction) by ~2 px so candidates stand out.
  _highlightCandidates(domain, wantDir) {
    this._clearHighlights();
    this._highlights = [];
    const delta = 2 / (this.pxPerMm || 1);   // 2 screen px expressed in panel mm
    for (const rec of this.records.values()) {
      for (const [, port] of rec.panel.ports) {
        if (port.meta.dir !== wantDir || port.meta.domain !== domain) continue;
        const ring = port.element.querySelector('circle');   // the outer coloured ring
        if (!ring) continue;
        const orig = ring.getAttribute('stroke-width');
        ring.setAttribute('stroke-width', r2((parseFloat(orig) || 0) + delta));
        this._highlights.push({ ring, orig });
      }
    }
  }

  _clearHighlights() {
    if (!this._highlights) return;
    for (const h of this._highlights) {
      if (h.orig == null) h.ring.removeAttribute('stroke-width');
      else h.ring.setAttribute('stroke-width', h.orig);
    }
    this._highlights = [];
  }

  // Orient the two jacks into (output -> input) and make the edge.
  _tryConnect(jackA, jackB) {
    const recA = this.records.get(jackA.key);
    const recB = this.records.get(jackB.key);
    if (!recA || !recB) return;
    const dirA = recA.panel.ports.get(jackA.portId).meta.dir;
    const dirB = recB.panel.ports.get(jackB.portId).meta.dir;
    let src, dst;
    if (dirA === 'out' && dirB === 'in') { src = { rec: recA, portId: jackA.portId }; dst = { rec: recB, portId: jackB.portId }; }
    else if (dirA === 'in' && dirB === 'out') { src = { rec: recB, portId: jackB.portId }; dst = { rec: recA, portId: jackA.portId }; }
    else return;   // output-to-output or input-to-input: not a valid cord

    const dstMeta = dst.rec.panel.ports.get(dst.portId).meta;
    const initialDepth = dstMeta.via ? dst.rec.values.get(dstMeta.via) : undefined;
    const res = this.patchbay.connect(
      { key: src.rec.key, instance: src.rec.instance, descriptorId: src.rec.descriptorId, portId: src.portId },
      { key: dst.rec.key, instance: dst.rec.instance, descriptorId: dst.rec.descriptorId, portId: dst.portId },
      initialDepth,
    );
    if (res.ok) { this._drawCables(); this.onChange(); }
  }

  _portLabel(port) {
    const sec = SECTION_LABEL[port.section];
    return sec ? `${sec} · ${port.name}` : port.name;
  }

  // The edge (if any) directly joining two jacks, either orientation.
  _edgeBetween(aKey, aPort, bKey, bPort) {
    return this.patchbay.list().find((e) =>
      (e.src.key === aKey && e.src.portId === aPort && e.dst.key === bKey && e.dst.portId === bPort)
      || (e.src.key === bKey && e.src.portId === bPort && e.dst.key === aKey && e.dst.portId === aPort));
  }

  // Right-click a port: a menu of every port it can sensibly connect to, on this
  // module and others, checkmarked where the cord already exists. Clicking an
  // item toggles that connection (draws or removes the same cord a drag would).
  // Normal click shows only same-domain candidates; Command-click also shows the
  // cross-domain ones (e.g. audio into a control input), dimmed.
  _onJackContextMenu(e, rec, portId) {
    e.preventDefault();
    e.stopPropagation();
    const here = rec.panel.ports.get(portId).meta;
    const wantDir = here.dir === 'out' ? 'in' : 'out';
    const showCross = e.metaKey;   // Command+right-click widens to cross-domain
    const items = [];
    const mods = this.moduleRecords();
    for (let i = 0; i < mods.length; i++) {
      const m = mods[i];
      const group = [];
      for (const p of this.host.registry.ports(m.descriptorId)) {
        if (p.dir !== wantDir) continue;
        if (m.key === rec.key && p.id === portId) continue;       // never itself
        const sameDomain = p.domain === here.domain;
        if (!sameDomain && !showCross) continue;                  // normal menu: same domain only
        const srcDomain = here.dir === 'out' ? here.domain : p.domain;
        const dstDomain = here.dir === 'out' ? p.domain : here.domain;
        if (canConnect(srcDomain, dstDomain) === DENY) continue;  // never today; future-proof
        const connected = !!this._edgeBetween(rec.key, portId, m.key, p.id);
        group.push({
          label: this._portLabel(p),
          checked: connected,
          dim: !sameDomain,
          action: () => this._toggleConnection(rec, portId, m, p.id, connected),
        });
      }
      if (group.length) {
        items.push({ header: true, label: `Module ${i + 1}${m.key === rec.key ? ' (this one)' : ''}` });
        for (const it of group) items.push(it);
      }
    }
    if (!items.length) items.push({ header: true, label: 'No compatible ports' });
    this._openMenu(e.clientX, e.clientY, items);
  }

  _toggleConnection(thisRec, thisPort, candRec, candPort, wasConnected) {
    if (wasConnected) {
      const edge = this._edgeBetween(thisRec.key, thisPort, candRec.key, candPort);
      if (edge) { this.patchbay.disconnect(edge); this._drawCables(); this.onChange(); }
    } else {
      this._tryConnect({ key: thisRec.key, portId: thisPort }, { key: candRec.key, portId: candPort });
    }
  }

  _onPinch(e) {
    e.preventDefault();
    e.stopPropagation();
    if (this._zoomAnim) { cancelAnimationFrame(this._zoomAnim); this._zoomAnim = null; }
    this._focusRec = null;   // manual zoom takes over from focus-zoom
    const rect = this.container.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const cx = this.container.scrollLeft + px, cy = this.container.scrollTop + py;
    const old = this.pxPerMm;
    this.zoom = Math.max(0.4, Math.min(8, this.zoom * Math.exp(-e.deltaY * 0.01)));
    this.relayout();
    const ratio = this.pxPerMm / old;
    this.container.scrollLeft = cx * ratio - px;
    this.container.scrollTop = cy * ratio - py;
  }

  // ---- placement / push-right collision ----
  _resolveRow(row) {
    row.sort((a, b) => a.hp - b.hp);
    for (let i = 1; i < row.length; i++) {
      const prevEnd = row[i - 1].hp + row[i - 1].hpWidth;
      if (row[i].hp < prevEnd) row[i].hp = prevEnd;
    }
  }

  async addModule(descriptorId, rowIndex, hp) {
    const type = this.moduleTypes.find((t) => t.descriptorId === descriptorId);
    if (!type) return null;
    rowIndex = Math.max(0, Math.min(this.rowCount - 1, rowIndex | 0));

    const { instanceId, instance } = await this.host.instantiate(descriptorId);
    const panel = await loadPanel(type.panelUrl, type.descriptor);

    const el = document.createElement('div');
    el.className = 'rack-module';
    const svg = document.adoptNode(panel.svg);
    const vb = (svg.getAttribute('viewBox') || '0 0 171 128.5').split(/\s+/).map(Number);
    const panelWmm = vb[2];
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    el.appendChild(svg);

    const rec = {
      key: 'm' + (this._seq++), descriptorId, name: type.name,
      hp: Math.max(0, Math.round(hp || 0)), hpWidth: type.hp, row: rowIndex,
      instanceId, instance, panel, el, panelWmm, values: new Map(),
    };
    el.dataset.key = rec.key;
    for (const p of type.descriptor.params) rec.values.set(p.id, p.default);
    for (const b of panel.controls.values()) {
      const v = rec.values.get(b.id);
      if (v !== undefined) showValue(b, v);
      attachControlInteraction(b, {
        get: () => rec.values.get(b.id),
        set: (val) => this._setParam(rec, b.id, val),
      });
      b.group.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    // Jacks: pointerdown drags a cord (patching); right-click offers disconnect.
    // stopPropagation keeps a jack press from starting a module drag.
    for (const [portId, port] of panel.ports) {
      port.element.style.cursor = 'crosshair';
      port.element.addEventListener('pointerdown', (e) => { e.stopPropagation(); this._startCable(e, rec, portId); });
      port.element.addEventListener('contextmenu', (e) => this._onJackContextMenu(e, rec, portId));
    }
    for (const [id, v] of rec.values) if (instance.supports(id)) instance.setParam(id, v);

    el.addEventListener('pointerdown', (e) => this._startDrag(e, rec));
    el.addEventListener('contextmenu', (e) => this._onModuleContextMenu(e, rec));
    el.addEventListener('pointerenter', () => { this._hoverRec = rec; });
    el.addEventListener('pointerleave', () => { if (this._hoverRec === rec) this._hoverRec = null; });

    this.records.set(rec.key, rec);
    this.rows[rowIndex].push(rec);
    this._resolveRow(this.rows[rowIndex]);
    this._rowEls[rowIndex].appendChild(el);
    this.relayout();
    this.onChange();
    return rec;
  }

  _setParam(rec, id, value) {
    rec.values.set(id, value);
    if (rec.instance.supports(id)) rec.instance.setParam(id, value);
    const b = rec.panel.controls.get(id);
    if (b) showValue(b, value);
    this.patchbay.setDepth(rec.key, id, value);   // if this knob is a cord's depth control
  }

  deleteModule(rec) {
    if (this._hoverRec === rec) this._hoverRec = null;
    if (this._focusRec === rec) { this._focusRec = null; this.zoom = 1; }
    this.patchbay.disconnectModule(rec.key);   // pull its cords before the nodes go
    const row = this.rows[rec.row];
    const i = row.indexOf(rec);
    if (i >= 0) row.splice(i, 1);
    rec.el.remove();
    this.host.dispose(rec.instanceId);
    this.records.delete(rec.key);
    this._drawCables();
    this.onChange();
  }

  _moveModule(rec, newRow, newHp) {
    const old = this.rows[rec.row];
    const i = old.indexOf(rec);
    if (i >= 0) old.splice(i, 1);
    rec.row = newRow;
    rec.hp = Math.max(0, Math.round(newHp));
    this.rows[newRow].push(rec);
    this._resolveRow(this.rows[newRow]);
    if (rec.el.parentElement !== this._rowEls[newRow]) this._rowEls[newRow].appendChild(rec.el);
    this.relayout();
    this.onChange();
  }

  // ---- drag (left button, from the faceplate background) ----
  _startDrag(e, rec) {
    if (e.button !== 0) return;
    e.preventDefault();
    const s = this.pxPerMm;
    const startX = e.clientX, startY = e.clientY;
    const rect0 = this._rowEls[rec.row].getBoundingClientRect();
    const grabDx = e.clientX - (rect0.left + rec.hp * HP_MM * s);
    let moved = false;
    let dropRow = rec.row, dropHp = rec.hp;
    const ghost = this._ensureGhost();

    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4) return;
      moved = true;
      rec.el.classList.add('dragging');
      dropRow = this._rowFromY(ev.clientY);
      const rEl = this._rowEls[dropRow];
      const rRect = rEl.getBoundingClientRect();
      dropHp = Math.max(0, Math.round((ev.clientX - rRect.left - grabDx) / (HP_MM * s)));
      rEl.appendChild(ghost);
      ghost.style.display = 'block';
      ghost.style.left = (dropHp * HP_MM * s) + 'px';
      ghost.style.width = (rec.hpWidth * HP_MM * s) + 'px';
      ghost.style.height = (PANEL_H_MM * s) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      rec.el.classList.remove('dragging');
      ghost.style.display = 'none';
      if (moved) this._moveModule(rec, dropRow, dropHp);
      else this._handleClick(rec);
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  _rowFromY(y) {
    for (let i = 0; i < this._rowEls.length; i++) {
      const r = this._rowEls[i].getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return i;
    }
    return y < this._rowEls[0].getBoundingClientRect().top ? 0 : this.rowCount - 1;
  }

  _ensureGhost() {
    if (!this._ghostEl) {
      const g = document.createElement('div');
      g.className = 'rack-ghost';
      g.style.display = 'none';
      this._ghostEl = g;
    }
    return this._ghostEl;
  }

  // ---- context menus ----
  _hpUnderCursor(rowEl, clientX) {
    const rRect = rowEl.getBoundingClientRect();
    return Math.max(0, Math.round((clientX - rRect.left) / (HP_MM * this.pxPerMm)));
  }

  _onRowContextMenu(e, rowIndex) {
    if (e.target.closest('.rack-module')) return;
    e.preventDefault();
    const hp = this._hpUnderCursor(this._rowEls[rowIndex], e.clientX);
    const items = this.moduleTypes.map((t) => ({
      label: `Add ${t.name}`,
      action: () => this.addModule(t.descriptorId, rowIndex, hp),
    }));
    this._openMenu(e.clientX, e.clientY, items);
  }

  _onModuleContextMenu(e, rec) {
    e.preventDefault();
    e.stopPropagation();
    this._openMenu(e.clientX, e.clientY, [
      { label: `Delete ${rec.name}`, action: () => this.deleteModule(rec) },
    ]);
  }

  // items: { label, action } clickable rows, plus optional { header:true } group
  // labels and optional { checked, dim } for the connect menu's checkmark/dimming.
  _openMenu(x, y, items) {
    this._closeMenu();
    const menu = document.createElement('div');
    menu.className = 'rack-menu';
    for (const it of items) {
      if (it.header) {
        const h = document.createElement('div');
        h.className = 'rack-menu-header';
        h.textContent = it.label;
        menu.appendChild(h);
        continue;
      }
      const item = document.createElement('div');
      item.className = 'rack-menu-item' + (it.dim ? ' dim' : '');
      if (it.checked !== undefined) {
        const ck = document.createElement('span');
        ck.className = 'rack-menu-check';
        ck.textContent = it.checked ? '✓' : '';
        item.appendChild(ck);
      }
      const lbl = document.createElement('span');
      lbl.textContent = it.label;
      item.appendChild(lbl);
      item.addEventListener('click', () => { this._closeMenu(); it.action(); });
      menu.appendChild(item);
    }
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
    document.body.appendChild(menu);
    this._menuEl = menu;
  }

  _closeMenu() {
    if (this._menuEl) { this._menuEl.remove(); this._menuEl = null; }
  }
}
