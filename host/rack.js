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
//     pointer is over one). Modules are placed and sized by their real panel
//     width in mm (no HP grid); neighbours butt together edge to edge.

import { loadPanel, showValue, attachControlInteraction, FACE_H_MM, FACE_TOP_MM, FACE_LEFT_MM } from './panel-loader.js';
import { Patchbay, canConnect, DENY } from './patchbay.js';

// Friendly section prefixes so duplicate port names (two "FM In", two "CV In")
// read unambiguously in the connect menu.
// Section prefixes disambiguate ports that share a name (both oscillators have a
// "CV In", "FM In", "1V/Oct"). The middle section's ports ("Phase Lock In", "Mod
// Index CV") are already unique, so they carry no prefix — just the name.
const SECTION_LABEL = { modOsc: 'Mod osc', prinOsc: 'Principal', timbre: 'Timbre' };

const PANEL_H_MM = FACE_H_MM;   // modules display only the cropped functional face
const ROW_GAP_MM = 0;           // vertical gap between rows (0 = flush, faceplates touch)
const GAP_MM = 4;               // horizontal margin at the right of the case, in mm
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
    this._hoverCableEdgeId = null;  // cable under the pointer (reveals its reshape handle)
    this._reshaping = false;   // a middle-handle reshape drag is in progress
    this._menuJack = null;     // the terminal whose connection menu is currently open
    this._justClosedJack = null;   // terminal whose menu a press just closed (for click-again-to-close)
    this._contentWmm = 0;
    this._contentHmm = 0;
    this.mixer = null;         // toolbar output mixer (set via setMixer)
    this._toolbarCords = [];   // per-frame: cord paths to redraw in the toolbar overlay

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
      if (this._menuEl && !this._menuEl.contains(e.target)) {
        // Remember which terminal's menu this press is closing, so a press on that
        // SAME terminal toggles the menu shut instead of closing-then-reopening.
        this._justClosedJack = this._menuJack;
        this._closeMenu();
      } else if (!this._menuEl) {
        this._justClosedJack = null;   // fresh press, no menu open: clear any stale toggle flag
      }
    }, true);
    // Pinch / ctrl-wheel to zoom (capture phase, so it beats a knob's wheel).
    this.container.addEventListener('wheel', (e) => {
      if (e.ctrlKey) this._onPinch(e);
    }, { passive: false, capture: true });
    // '/' over a module focus-zooms it to full height (toggle). Faceplate
    // background clicks are handled per-module in _startDrag: double-click
    // zooms the module, single-click restores the fitted view while zoomed.
    document.addEventListener('keydown', (e) => this._onKey(e));
    // Toolbar (mixer) cords track the rack's scroll: their toolbar end is fixed
    // in screen space while the modules scroll beneath.
    this.container.addEventListener('scroll', () => { if (this.mixer) this._drawCables(); });
    // A cable body is click-through, so it fires no hover events of its own.
    // Detect a hovered cable by proximity and reveal its middle reshape handle.
    this.container.addEventListener('pointermove', (e) => this._updateCableHover(e));
    this.container.addEventListener('pointerleave', () => {
      if (this._hoverCableEdgeId !== null) { this._hoverCableEdgeId = null; this._drawCables(); }
    });
  }

  // Register the toolbar output mixer as a patch endpoint. mixer:
  // { key, descriptorId, instance, jacks:Map(portId->svgEl), linesSvg, toolbarEl }.
  setMixer(mixer) {
    this.mixer = mixer;
    for (const [portId, svg] of mixer.jacks) {
      const el = (svg.closest && svg.closest('.toolbar-jack')) || svg;
      // Mixer jacks behave like every other terminal: a click (or right-click)
      // opens their connection menu; patching is menu-only.
      el.addEventListener('pointerdown', (e) => this._onJackPointerDown(e, this.mixer.key, portId));
      el.addEventListener('contextmenu', (e) => this._onJackContextMenu(e, this.mixer.key, portId));
    }
    this._drawCables();
  }

  // A patch endpoint (module or mixer) resolved to a common shape.
  _ep(key, portId) {
    if (this.mixer && key === this.mixer.key) {
      const meta = this.host.registry.portById(this.mixer.descriptorId, portId);
      return meta ? { key, portId, instance: this.mixer.instance, descriptorId: this.mixer.descriptorId, meta } : null;
    }
    const rec = this.records.get(key);
    const port = rec && rec.panel.ports.get(portId);
    return port ? { key, portId, instance: rec.instance, descriptorId: rec.descriptorId, meta: port.meta, rec } : null;
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
    const contentHmm = this.rowCount * PANEL_H_MM + (this.rowCount - 1) * ROW_GAP_MM;
    const fit = vpH / contentHmm;
    const targetZoom = (vpH / PANEL_H_MM) / fit;   // module height == window height
    const s = fit * targetZoom;                     // pxPerMm at the target zoom
    const rowTopMm = rec.row * (PANEL_H_MM + ROW_GAP_MM);
    const targetTop = Math.max(0, rowTopMm * s);
    const targetLeft = Math.max(0, rec.x * s + rec.panelWmm * s / 2 - vpW / 2);
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

  // The rendered height of a module at default zoom (zoom 1), in px — used to
  // size the mixer panel to match a faceplate.
  moduleHeightPx() { return PANEL_H_MM * (this._fit || 1); }

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
    // No top/bottom padding — the first row sits flush under the toolbar; rows
    // are separated only by ROW_GAP_MM (0 = touching).
    const contentHmm = this.rowCount * PANEL_H_MM + (this.rowCount - 1) * ROW_GAP_MM;
    const fit = vpH / contentHmm;           // fill the viewport height at zoom 1
    this._fit = fit;                        // px-per-mm at zoom 1 (for cord thickness)
    this.pxPerMm = fit * this.zoom;
    const s = this.pxPerMm;

    let maxRightMm = 0;
    for (const r of this.rows) for (const rec of r) maxRightMm = Math.max(maxRightMm, rec.x + rec.panelWmm);
    const contentWmm = Math.max(maxRightMm + GAP_MM, vpW / s);
    this._contentWmm = contentWmm;
    this._contentHmm = contentHmm;

    this.content.style.width = (contentWmm * s) + 'px';
    this.content.style.height = (contentHmm * s) + 'px';
    for (let i = 0; i < this.rowCount; i++) {
      const el = this._rowEls[i];
      el.style.top = (i * (PANEL_H_MM + ROW_GAP_MM) * s) + 'px';
      el.style.height = (PANEL_H_MM * s) + 'px';
      el.style.width = (contentWmm * s) + 'px';
    }
    for (const rec of this.records.values()) this._placeEl(rec);
    this._drawCables();
  }

  _placeEl(rec) {
    const s = this.pxPerMm;
    rec.el.style.left = (rec.x * s) + 'px';
    rec.el.style.width = (rec.panelWmm * s) + 'px';
    rec.el.style.height = (PANEL_H_MM * s) + 'px';
  }

  // ---- cables (netlist rendered onto the panel) ----
  // A jack's anchor is in panel-viewBox mm; convert to content mm (which the
  // overlay's viewBox uses, so cords line up at any zoom). Everything is mm here
  // and the overlay is px-sized in _drawCables, so a zoom needs no path rework.
  // A toolbar mixer jack's position projected into content mm (it lives above
  // the rack, so its content y is negative; the cord is clipped at the seam and
  // the toolbar line covers the rest).
  _mixerJackPosMm(portId) {
    const svg = this.mixer && this.mixer.jacks.get(portId);
    if (!svg) return null;
    const r = svg.getBoundingClientRect();
    // Emerge from the middle of the coloured ring (hole r=4.4, outer r=10 in the
    // 24-unit jack) on its lower edge, so the cord blends into the jack.
    const ringScreen = r.height * (7.2 / 24);
    const p = this._clientToMm(r.left + r.width / 2, r.top + r.height / 2 + ringScreen);
    return { x: p.x, y: p.y, r: 1.2, ring: 1.2 };
  }

  _jackPosMm(key, portId) {
    if (this.mixer && key === this.mixer.key) return this._mixerJackPosMm(portId);
    const rec = this.records.get(key);
    if (!rec) return null;
    const port = rec.panel.ports.get(portId);
    if (!port || !port.anchor) return null;
    const hole = port.holeR || 0;
    return {
      x: rec.x + (port.anchor.x - FACE_LEFT_MM),
      y: rec.row * (PANEL_H_MM + ROW_GAP_MM) + (port.anchor.y - FACE_TOP_MM),
      r: hole,
      // Mid-ring radius: where a stub-less cord ends (middle of the coloured band).
      ring: port.outerR ? (hole + port.outerR) / 2 : hole,
    };
  }

  _clientToMm(clientX, clientY) {
    const r = this.content.getBoundingClientRect();
    const s = this.pxPerMm || 1;
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  }

  // The belly point a cord passes through, from its stored bow {along,perp} (or a
  // gentle default). `along` is the fraction along the chord A->B (0..1); `perp`
  // is a SIGNED perpendicular offset from the chord, so a cord can bow to either
  // side (the cables lie on a surface, not just hang under gravity). Both are
  // relative to the jacks, so the shape follows when a module moves.
  _bellyPoint(a, b, bow) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const len = Math.hypot(abx, aby) || 1;
    if (!bow) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + Math.max(5, 0.14 * len) };
    const nx = -aby / len, ny = abx / len;   // unit normal to the chord
    return { x: a.x + bow.along * abx + bow.perp * nx, y: a.y + bow.along * aby + bow.perp * ny };
  }

  // Turn a dragged point into a stored bow {along,perp}: project onto the chord
  // for `along` (clamped between the jacks) and the signed distance off it for
  // `perp` (either side allowed).
  _bowFromPoint(a, b, m) {
    const abx = b.x - a.x, aby = b.y - a.y;
    const len = Math.hypot(abx, aby) || 1;
    const along = clamp01(((m.x - a.x) * abx + (m.y - a.y) * aby) / (len * len));
    const nx = -aby / len, ny = abx / len;
    return { along, perp: (m.x - a.x) * nx + (m.y - a.y) * ny };
  }

  // The cord's geometry as a CUBIC (independent handle per end, so each end can
  // aim any direction). Each end departs radially toward the belly P: a stub runs
  // from the hole rim out 2·r along that direction, and the ghosted cord is a
  // cubic between the two stub ENDS, tangent to each stub — so the stub reads as
  // the cable's plug and the ghosted cord continues from it with no kink.
  _cordGeom(e) {
    const a = this._jackPosMm(e.src.key, e.src.portId);
    const b = this._jackPosMm(e.dst.key, e.dst.portId);
    if (!a || !b) return null;
    const w = CABLE_PX / (this._fit || 1);
    const P = this._bellyPoint(a, b, e.bow);
    const uA = unit(P.x - a.x, P.y - a.y);
    const uB = unit(P.x - b.x, P.y - b.y);
    // Each end sits in the MIDDLE of the jack's coloured ring (no stub plug) and
    // the cord is a cubic between those points, departing radially toward the belly.
    const pA = { x: a.x + uA.x * a.ring, y: a.y + uA.y * a.ring };
    const pB = { x: b.x + uB.x * b.ring, y: b.y + uB.y * b.ring };
    const L = Math.hypot(pB.x - pA.x, pB.y - pA.y) * 0.4;
    const c1 = { x: pA.x + uA.x * L, y: pA.y + uA.y * L };
    const c2 = { x: pB.x + uB.x * L, y: pB.y + uB.y * L };
    return { a, b, w, uA, uB, pA, pB, c1, c2 };
  }

  _drawCables() {
    if (!this.cables) return;
    const s = this.pxPerMm;
    this.cables.setAttribute('viewBox', `0 0 ${r2(this._contentWmm)} ${r2(this._contentHmm)}`);
    this.cables.style.width = (this._contentWmm * s) + 'px';
    this.cables.style.height = (this._contentHmm * s) + 'px';
    this.cables.textContent = '';
    const wmm = CABLE_PX / (this._fit || 1);   // mm width -> CABLE_PX at zoom 1, scales with zoom
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
    this._toolbarCords = [];
    for (const e of this.patchbay.list()) {
      if (this.mixer && (e.src.key === this.mixer.key || e.dst.key === this.mixer.key)) {
        this._drawMixerEdge(e, wmm, mk);
        continue;
      }
      const g = this._cordGeom(e);
      if (!g) continue;
      const color = STYLE_COLOR[e.style] || STYLE_COLOR.control;
      const op = this._cableOpacity(e);
      // The whole cable is pointer-events:none, so clicks and drags fall straight
      // through to the panel behind it. A stub-less cord runs ring-mid to ring-mid;
      // its only grab point is the middle reshape handle, shown on hover.
      const bodyD = `M${r2(g.pA.x)},${r2(g.pA.y)} C${r2(g.c1.x)},${r2(g.c1.y)} ${r2(g.c2.x)},${r2(g.c2.y)} ${r2(g.pB.x)},${r2(g.pB.y)}`;
      mk(bodyD, color, wmm, op, null);
      // Middle reshape handle, shown only while this cable is hovered.
      if (e.id === this._hoverCableEdgeId) {
        const mid = {
          x: 0.125 * g.pA.x + 0.375 * g.c1.x + 0.375 * g.c2.x + 0.125 * g.pB.x,
          y: 0.125 * g.pA.y + 0.375 * g.c1.y + 0.375 * g.c2.y + 0.125 * g.pB.y,
        };
        const rMm = 5.5 / (s || 1);
        const hd = document.createElementNS(SVG_NS, 'circle');
        hd.setAttribute('cx', r2(mid.x)); hd.setAttribute('cy', r2(mid.y)); hd.setAttribute('r', r2(rMm));
        hd.setAttribute('fill', color); hd.setAttribute('stroke', '#fff'); hd.setAttribute('stroke-width', r2(rMm * 0.28));
        hd.style.pointerEvents = 'auto';
        hd.style.cursor = 'var(--grip)';
        hd.addEventListener('pointerdown', (ev) => this._startReshape(ev, e));
        this.cables.appendChild(hd);
      }
    }
    this._drawToolbarCords();
  }

  // A cord to a toolbar mixer jack. We compute ONE cord from the jack (T, above
  // the seam) to the module (M), and draw the SAME path in both overlays: the
  // rack overlay clips it below the seam, the toolbar overlay clips it above —
  // so it's one continuous curve with no kink where they meet.
  _drawMixerEdge(e, wmm, mk) {
    const mixerEnd = e.src.key === this.mixer.key ? 'src' : 'dst';
    const moduleEnd = mixerEnd === 'src' ? 'dst' : 'src';
    const other = e[moduleEnd];
    const T = this._mixerJackPosMm(e[mixerEnd].portId);
    const M = this._jackPosMm(other.key, other.portId);
    if (!T || !M) return;
    const color = STYLE_COLOR[e.style] || STYLE_COLOR.control;
    const op = this._cableOpacity(e);
    const path = this._toolbarCordPath(T, M, wmm);
    mk(path, color, wmm, op, null);                    // rack part (clipped below the seam)
    this._toolbarCords.push({ path, color, wmm, opacity: op });   // toolbar part (same path, clipped above)
  }

  // A cable is faint (one-third opaque) by default; the cables of the module
  // under the pointer go fully opaque so you can trace them. Purely visual — the
  // body stays click-through either way.
  _cableOpacity(e) {
    const h = this._hoverRec;
    return (h && (e.src.key === h.key || e.dst.key === h.key)) ? 1 : 0.5;
  }

  // Nearest module-to-module cable to a point (mm), within a small pixel radius,
  // or null. Samples each cord's cubic and measures point-to-segment distance.
  _nearestCable(m) {
    const thr = 8 / (this.pxPerMm || 1);
    let best = null, bestD = thr;
    for (const e of this.patchbay.list()) {
      if (this.mixer && (e.src.key === this.mixer.key || e.dst.key === this.mixer.key)) continue;
      const g = this._cordGeom(e);
      if (!g) continue;
      let prev = g.pA;
      for (let i = 1; i <= 16; i++) {
        const t = i / 16, mt = 1 - t;
        const cur = {
          x: mt * mt * mt * g.pA.x + 3 * mt * mt * t * g.c1.x + 3 * mt * t * t * g.c2.x + t * t * t * g.pB.x,
          y: mt * mt * mt * g.pA.y + 3 * mt * mt * t * g.c1.y + 3 * mt * t * t * g.c2.y + t * t * t * g.pB.y,
        };
        const d = this._distToSeg(m, prev, cur);
        if (d < bestD) { bestD = d; best = e; }
        prev = cur;
      }
    }
    return best;
  }

  _distToSeg(p, a, b) {
    const vx = b.x - a.x, vy = b.y - a.y;
    const c1 = vx * (p.x - a.x) + vy * (p.y - a.y);
    if (c1 <= 0) return Math.hypot(p.x - a.x, p.y - a.y);
    const c2 = vx * vx + vy * vy;
    if (c2 <= c1) return Math.hypot(p.x - b.x, p.y - b.y);
    const t = c1 / c2;
    return Math.hypot(p.x - (a.x + t * vx), p.y - (a.y + t * vy));
  }

  // Track the hovered cable (skip while a cable interaction is under way), and
  // redraw only when it changes so the middle handle appears/disappears.
  _updateCableHover(ev) {
    if (this._reshaping) return;
    const near = this._nearestCable(this._clientToMm(ev.clientX, ev.clientY));
    const id = near ? near.id : null;
    if (id !== this._hoverCableEdgeId) { this._hoverCableEdgeId = id; this._drawCables(); }
  }

  // Rack cord for a toolbar edge. It leaves T straight down, PAST the seam by a
  // fixed drop, so at the seam the cord is vertical — tangent to the toolbar
  // line — before it curves to M's rim aiming at M's centre.
  _toolbarCordPath(T, M, w) {
    const u = unit(M.x - T.x, M.y - T.y);           // T -> M
    const p3 = { x: M.x - u.x * M.ring, y: M.y - u.y * M.ring };   // middle of M's coloured ring
    const drop = Math.max(0, -T.y) + 10;            // clear the seam (y=0) vertically
    const c1 = { x: T.x, y: T.y + drop };
    const h = Math.max(8, Math.hypot(p3.x - c1.x, p3.y - c1.y) * 0.4);
    const c2 = { x: p3.x - u.x * h, y: p3.y - u.y * h };  // radial into M
    return `M${r2(T.x)},${r2(T.y)} C${r2(c1.x)},${r2(c1.y)} ${r2(c2.x)},${r2(c2.y)} ${r2(p3.x)},${r2(p3.y)}`;
  }

  // Draw the toolbar half of each mixer cord: the SAME content-mm path, in a
  // group transformed so content mm maps to toolbar screen px. The overlay clips
  // it at the seam (toolbar bottom); the rack overlay draws the rest — so the two
  // halves are one continuous curve.
  _drawToolbarCords() {
    if (!this.mixer || !this.mixer.linesSvg) return;
    const svg = this.mixer.linesSvg;
    svg.textContent = '';
    if (!this._toolbarCords.length) return;
    const cr = this.content.getBoundingClientRect();
    const tb = this.mixer.toolbarEl.getBoundingClientRect();
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('transform', `translate(${r2(cr.left - tb.left)},${r2(cr.top - tb.top)}) scale(${r2(this.pxPerMm)})`);
    for (const c of this._toolbarCords) {
      const p = document.createElementNS(SVG_NS, 'path');
      p.setAttribute('d', c.path); p.setAttribute('fill', 'none');
      p.setAttribute('stroke', c.color); p.setAttribute('stroke-width', r2(c.wmm));
      p.setAttribute('stroke-linecap', 'round');
      if (c.opacity != null) p.style.opacity = String(c.opacity);
      g.appendChild(p);
    }
    svg.appendChild(g);
  }

  // A LEFT click on a jack — press and release without dragging — opens its
  // connection menu. Cables are made and broken only through that menu now, so a
  // drag off a jack does nothing. `key` is the endpoint (a rack module or the
  // mixer). stopPropagation keeps the press off the module drag; right-click also
  // opens the menu via its contextmenu handler.
  _onJackPointerDown(e, key, portId) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    let moved = false;
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    const onMove = (ev) => { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) >= 4) moved = true; };
    const onUp = (ev) => {
      cleanup();
      if (!moved) this._onJackContextMenu(ev, key, portId);   // clean click -> menu
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // Press the cable's middle handle (shown on hover): a drag bends the cord (the
  // belly follows the pointer, either side of the chord); a click with no drag
  // passes through to whatever is behind the handle, preserving click-through.
  _startReshape(ev, edge) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    this._reshaping = true;
    const startX = ev.clientX, startY = ev.clientY;
    const a = this._jackPosMm(edge.src.key, edge.src.portId);
    const b = this._jackPosMm(edge.dst.key, edge.dst.portId);
    if (!a || !b) { this._reshaping = false; return; }
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
      this._reshaping = false;
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

  // Orient the two jacks into (output -> input) and make the edge. Either end
  // may be a module or the toolbar mixer.
  _tryConnect(jackA, jackB) {
    const A = this._ep(jackA.key, jackA.portId);
    const B = this._ep(jackB.key, jackB.portId);
    if (!A || !B) return;
    let src, dst;
    if (A.meta.dir === 'out' && B.meta.dir === 'in') { src = A; dst = B; }
    else if (A.meta.dir === 'in' && B.meta.dir === 'out') { src = B; dst = A; }
    else return;   // output-to-output or input-to-input: not a valid cord

    const initialDepth = (dst.meta.via && dst.rec) ? dst.rec.values.get(dst.meta.via) : undefined;
    const res = this.patchbay.connect(
      { key: src.key, instance: src.instance, descriptorId: src.descriptorId, portId: src.portId },
      { key: dst.key, instance: dst.instance, descriptorId: dst.descriptorId, portId: dst.portId },
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

  // Open a jack's connection menu: every port it can sensibly connect to, on this
  // module and others (and the mixer), checkmarked where the cord already exists.
  // Clicking an item toggles that connection. `key` is any endpoint — a rack
  // module or the mixer — so the same menu serves every jack. Normal open shows
  // only same-domain candidates; Command widens to cross-domain ones, dimmed.
  _onJackContextMenu(e, key, portId) {
    e.preventDefault();
    e.stopPropagation();
    // Clicking the same terminal whose menu is open toggles it shut: the press
    // already closed the menu (above), so just don't reopen it.
    if (this._justClosedJack && this._justClosedJack.key === key && this._justClosedJack.portId === portId) {
      this._justClosedJack = null;
      return;
    }
    this._justClosedJack = null;
    const ep = this._ep(key, portId);
    if (!ep) return;
    const here = ep.meta;
    const wantDir = here.dir === 'out' ? 'in' : 'out';
    const showCross = e.metaKey;   // Command+right-click widens to cross-domain
    const items = [];
    // Candidates: every rack module PLUS the mixer (its jacks live in the
    // toolbar, but it is a real patch endpoint, so its channels must show here —
    // checkmarked and removable — like any module). Disambiguate repeated module
    // names with an ordinal so a header reads as the actual module, not "Module 2".
    // Order candidates the way the rack reads — row by row, left to right — but
    // keep instances of the SAME module type together (Complex Oscillator 1, 2, …),
    // the types ordered by their first (topmost-leftmost) instance and numbered in
    // that positional order. The mixer, which has no rack position, comes last.
    const byPos = [...this.moduleRecords()].sort((a, b) => (a.row - b.row) || (a.x - b.x));
    const buckets = new Map();
    for (const m of byPos) {
      if (!buckets.has(m.descriptorId)) buckets.set(m.descriptorId, []);
      buckets.get(m.descriptorId).push(m);
    }
    const cand = [];
    for (const bucket of buckets.values()) for (const m of bucket) cand.push(m);
    if (this.mixer) cand.push({ key: this.mixer.key, descriptorId: this.mixer.descriptorId, name: 'Mixer' });
    const nameCount = new Map();
    for (const m of cand) nameCount.set(m.name, (nameCount.get(m.name) || 0) + 1);
    const nameSeen = new Map();
    const nameOf = new Map();
    for (const m of cand) {
      let nm = m.name;
      if (nameCount.get(m.name) > 1) { const k = (nameSeen.get(m.name) || 0) + 1; nameSeen.set(m.name, k); nm = `${nm} ${k}`; }
      nameOf.set(m.key, nm);
    }
    for (const m of cand) {
      const group = [];
      for (const p of this.host.registry.ports(m.descriptorId)) {
        if (p.dir !== wantDir) continue;
        if (m.key === key && p.id === portId) continue;           // never itself
        const sameDomain = p.domain === here.domain;
        if (!sameDomain && !showCross) continue;                  // normal menu: same domain only
        const srcDomain = here.dir === 'out' ? here.domain : p.domain;
        const dstDomain = here.dir === 'out' ? p.domain : here.domain;
        if (canConnect(srcDomain, dstDomain) === DENY) continue;  // never today; future-proof
        // An input holds one cable. Selecting a candidate makes the connection,
        // replacing whatever is already on the input side (the checkmark moves to
        // it); clicking the checked row disconnects. checkFn keeps the mark live so
        // the menu can stay open while you repatch.
        group.push({
          label: this._portLabel(p),
          checkFn: () => !!this._edgeBetween(key, portId, m.key, p.id),
          dim: !sameDomain,
          action: () => this._toggleConnection(key, portId, m.key, p.id),
        });
      }
      if (group.length) {
        const anyConn = group.some((g) => g.checkFn && g.checkFn());
        items.push({
          header: true,
          label: nameOf.get(m.key) + (m.key === key ? ' (this one)' : ''),
          collapsible: true,
          // Open by default ONLY a module that holds a current connection to this
          // terminal (so its checkmark shows) — including this module itself if the
          // terminal is patched within it. With no connection at all, every module
          // opens collapsed, since the user usually patches to a different module.
          open: anyConn,
        });
        for (const it of group) items.push(it);
      }
    }
    if (!items.length) items.push({ header: true, label: 'No compatible ports' });
    this._openMenu(e.clientX, e.clientY, items);
    this._menuJack = { key, portId };   // for click-again-on-this-terminal-to-close
  }

  _toggleConnection(thisKey, thisPort, candKey, candPort) {
    const edge = this._edgeBetween(thisKey, thisPort, candKey, candPort);
    if (edge) {   // clicking the connected row disconnects it
      this.patchbay.disconnect(edge);
      this._drawCables();
      this.onChange();
      return;
    }
    // Make the connection, first clearing any cable already on the INPUT side —
    // an input holds one cable, so this moves it (the checkmark follows).
    const a = this._ep(thisKey, thisPort);
    const b = this._ep(candKey, candPort);
    const inEp = (a && a.meta.dir === 'in') ? a : (b && b.meta.dir === 'in') ? b : null;
    if (inEp) {
      for (const e of this.patchbay.edgesAtJack(inEp.key, inEp.portId)) {
        if (e.dst.key === inEp.key && e.dst.portId === inEp.portId) this.patchbay.disconnect(e);
      }
    }
    this._tryConnect({ key: thisKey, portId: thisPort }, { key: candKey, portId: candPort });
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

  // ---- placement: push-right collision (all in mm) ----
  // Sort by x; a module that overlaps its left neighbour is pushed flush against
  // it, but a module dropped in open space keeps its x — so you can leave gaps
  // and drop another module between two others.
  _resolveRow(row) {
    row.sort((a, b) => a.x - b.x);
    for (let i = 1; i < row.length; i++) {
      const prevEnd = row[i - 1].x + row[i - 1].panelWmm;
      if (row[i].x < prevEnd) row[i].x = prevEnd;
    }
  }

  async addModule(descriptorId, rowIndex, xMm) {
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
      x: Math.max(0, xMm || 0), row: rowIndex,
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
      port.element.addEventListener('pointerdown', (e) => this._onJackPointerDown(e, rec.key, portId));
      port.element.addEventListener('contextmenu', (e) => this._onJackContextMenu(e, rec.key, portId));
    }
    for (const [id, v] of rec.values) if (instance.supports(id)) instance.setParam(id, v);

    el.addEventListener('pointerdown', (e) => this._startDrag(e, rec));
    el.addEventListener('contextmenu', (e) => this._onModuleContextMenu(e, rec));
    el.addEventListener('pointerenter', () => { this._hoverRec = rec; this._drawCables(); });
    el.addEventListener('pointerleave', () => { if (this._hoverRec === rec) { this._hoverRec = null; this._drawCables(); } });

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

  _moveModule(rec, newRow, newX) {
    const old = this.rows[rec.row];
    const i = old.indexOf(rec);
    if (i >= 0) old.splice(i, 1);
    rec.row = newRow;
    rec.x = Math.max(0, newX);
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
    const grabDx = e.clientX - (rect0.left + rec.x * s);
    let moved = false;
    let dropRow = rec.row, dropX = rec.x;
    const ghost = this._ensureGhost();

    const onMove = (ev) => {
      if (!moved && Math.abs(ev.clientX - startX) + Math.abs(ev.clientY - startY) < 4) return;
      moved = true;
      rec.el.classList.add('dragging');
      dropRow = this._rowFromY(ev.clientY);
      const rEl = this._rowEls[dropRow];
      const rRect = rEl.getBoundingClientRect();
      dropX = Math.max(0, (ev.clientX - rRect.left - grabDx) / s);
      rEl.appendChild(ghost);
      ghost.style.display = 'block';
      ghost.style.left = (dropX * s) + 'px';
      ghost.style.width = (rec.panelWmm * s) + 'px';
      ghost.style.height = (PANEL_H_MM * s) + 'px';
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      rec.el.classList.remove('dragging');
      ghost.style.display = 'none';
      if (moved) this._moveModule(rec, dropRow, dropX);
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
  _xUnderCursor(rowEl, clientX) {
    const rRect = rowEl.getBoundingClientRect();
    return Math.max(0, (clientX - rRect.left) / this.pxPerMm);
  }

  _onRowContextMenu(e, rowIndex) {
    if (e.target.closest('.rack-module')) return;
    e.preventDefault();
    const xMm = this._xUnderCursor(this._rowEls[rowIndex], e.clientX);
    const items = this.moduleTypes.map((t) => ({
      label: `Add ${t.name}`,
      action: () => this.addModule(t.descriptorId, rowIndex, xMm),
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
    let focusEl = null;

    const pad = 8;
    const vw = window.innerWidth, vh = window.innerHeight;
    let top = 0, minTop = 0, maxTop = 0;
    // Slide bounds always straddle the current position, so the menu glides from
    // where it sits toward fully on-screen — both when opened and after a group is
    // expanded/collapsed (which changes its height) — instead of snapping.
    const recomputeBounds = () => {
      const ch = menu.offsetHeight;
      minTop = Math.min(top, vh - pad - ch);
      maxTop = Math.max(top, pad);
    };

    let group = null;   // the current collapsible group's item container
    for (const it of items) {
      if (it.header) {
        const h = document.createElement('div');
        h.className = 'rack-menu-header';
        if (it.collapsible) {
          const caret = document.createElement('span');
          caret.className = 'rack-menu-caret';
          const lab = document.createElement('span');
          lab.textContent = it.label;
          h.appendChild(caret);
          h.appendChild(lab);
          h.classList.add('clickable');
          const g = document.createElement('div');
          g.className = 'rack-menu-group';
          const setOpen = (open) => { g.style.display = open ? '' : 'none'; caret.textContent = open ? '▾' : '▸'; };
          setOpen(!!it.open);
          // Clicking a module heading toggles its entries WITHOUT closing the menu,
          // then re-flows the slide bounds for the new height.
          h.addEventListener('click', (e) => {
            e.stopPropagation();
            setOpen(g.style.display === 'none');
            recomputeBounds();
            menu.style.top = top + 'px';
          });
          menu.appendChild(h);
          menu.appendChild(g);
          group = g;
        } else {
          h.textContent = it.label;
          menu.appendChild(h);
          group = null;
        }
        continue;
      }
      const item = document.createElement('div');
      item.className = 'rack-menu-item' + (it.dim ? ' dim' : '');
      const isOn = it.checkFn ? it.checkFn() : !!it.checked;
      if (it.checkFn || it.checked !== undefined) {
        const ck = document.createElement('span');
        ck.className = 'rack-menu-check';
        ck.textContent = isOn ? '✓' : '';
        item.appendChild(ck);
      }
      const lbl = document.createElement('span');
      lbl.textContent = it.label;
      item.appendChild(lbl);
      // A selection closes the menu, then runs — one pick is the common case.
      item.addEventListener('click', () => { this._closeMenu(); it.action(); });
      (group || menu).appendChild(item);
      // The first connected row is the focus: the menu opens with it under the
      // pointer and pre-highlighted, so a right-click shows the current connection.
      if (isOn && !focusEl) { focusEl = item; item.classList.add('current'); }
    }

    // Measure hidden, then open with the connected row exactly at the pointer —
    // even if that pushes part of the menu past a screen edge. A wheel scroll then
    // SLIDES the whole menu (rather than scrolling its contents) so anything off an
    // edge can be pulled into view; the slide is clamped to the screen edges.
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.style.maxHeight = 'none';
    menu.style.visibility = 'hidden';
    document.body.appendChild(menu);

    const mw = menu.offsetWidth;
    // Open just to the RIGHT of the pointer, so clicking the same terminal again
    // (without moving) lands off the menu's left edge and toggles it shut rather
    // than selecting the row under the cursor.
    const GAP = 8;
    let left = Math.min(x + GAP, vw - pad - mw);
    if (left < pad) left = pad;
    const focusCenter = focusEl ? focusEl.offsetTop + focusEl.offsetHeight / 2 : 0;
    top = focusEl ? (y - focusCenter) : y;
    recomputeBounds();
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';
    menu.style.visibility = '';
    menu.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      const d = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaMode === 2 ? ev.deltaY * 400 : ev.deltaY;
      top = Math.max(minTop, Math.min(maxTop, top - d));
      menu.style.top = top + 'px';
    }, { passive: false });
    this._menuEl = menu;
  }

  _closeMenu() {
    if (this._menuEl) { this._menuEl.remove(); this._menuEl = null; }
    this._menuJack = null;
  }
}
