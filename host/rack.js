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
import { Patchbay } from './patchbay.js';
import { openPieMenu, closePieMenu } from './pie-menu.js';

const PANEL_H_MM = FACE_H_MM;   // modules display only the cropped functional face
const ROW_GAP_MM = 0;           // vertical gap between rows (0 = flush, faceplates touch)
const GAP_MM = 4;               // horizontal margin at the right of the case, in mm
const SVG_NS = 'http://www.w3.org/2000/svg';
// Pie-wedge icons (match the toolbar buttons where there is one).
const SCOPE_ICON = '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.2" stroke-width="1.7"/><path d="M5 12 Q7 8 9 12 T13 12 T17 12 L19 12" stroke-width="1.9"/></g></svg>';
const APPMENU_ICON = '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="2.4" rx="1"/><rect x="4" y="11" width="16" height="2.4" rx="1"/><rect x="4" y="16" width="16" height="2.4" rx="1"/></svg>';
// A drooping orange cable between two terminals (left a touch higher) — the "pull a
// cable" wedge.
const CABLE_DROOP_ICON = '<svg style="width:16px;height:16px" viewBox="0 0 24 24">'
  + '<path d="M4 7.5 C 8.5 20, 15.5 20, 20 12.5" fill="none" stroke="#ff7300" stroke-width="2.7" stroke-linecap="round"/>'
  + '<circle cx="4" cy="7.5" r="3.5" fill="currentColor"/>'
  + '<circle cx="20" cy="12.5" r="3.5" fill="currentColor"/></svg>';
const NET_ICON = '<svg viewBox="0 0 24 24"><g stroke="currentColor" stroke-linecap="round"><line x1="12" y1="12" x2="20" y2="4.5" stroke-width="2.1"/><line x1="12" y1="12" x2="18.5" y2="21" stroke-width="2.1"/><circle cx="20" cy="4.5" r="3.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="21" r="3.2" fill="currentColor" stroke="none"/><line x1="3.5" y1="6" x2="12" y2="12" stroke-width="2.9"/><circle cx="3.5" cy="6" r="3.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="3.7" fill="currentColor" stroke="none"/></g></svg>';
const TRASH_ICON = '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9 7V5h6v2"/><path d="M7 7l1 12h8l1-12"/></g></svg>';
const EAR_ICON = '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
  + '<g stroke-width="2"><path d="M10 21c-1.2-1.6-2-3.2-2-5.9A6 6 0 0 1 20 15c0 2.5-1.8 3.6-3.5 3.6-1.4 0-2 .9-2 2 0 1.4-1 2.5-2.4 2.5-1.1 0-2.1-.9-2.1-2.1"/>'
  + '<path d="M11.4 14A2.6 2.6 0 0 1 16.2 14.4c0 1.6-1.5 2.1-1.5 3.5"/></g>'
  + '<g stroke-width="1.6"><path d="M7.4 10.4A6 6 0 0 1 11.5 6.7"/><path d="M4.1 9.3A9.5 9.5 0 0 1 10.5 3.3"/></g></g></svg>';
// The sound/transport button: a big ROUND button in the lower-left, LIT (filled) when
// sound is on — matching the mixer's master-enable lamp — and a hollow ring when off,
// with partial arcs radiating up-right to say "this controls the sound".
function SOUND_BTN_ICON(on) {
  // The button matches the mixer's master-enable lamp: a gray disc when off, the red
  // ledLit dome with a glossy highlight when on. Rendered ~1mm larger than the other
  // wedge icons (18px vs 13px), circle centred low-left so the up-right ink arcs (the
  // "controls sound" cue) tuck into the free corner.
  const cx = 10, cy = 14, r = 7;
  const grad = on ? '<defs><radialGradient id="pieLed" cx="0.5" cy="0.4" r="0.62">'
    + '<stop offset="0" stop-color="#ff7a5a"/><stop offset="0.5" stop-color="#ee2a10"/>'
    + '<stop offset="0.82" stop-color="#d21010"/><stop offset="1" stop-color="#8f0c0c"/>'
    + '</radialGradient></defs>' : '';
  const body = on
    ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="url(#pieLed)" stroke="#141414" stroke-width="0.5"/>`
    : `<circle cx="${cx}" cy="${cy}" r="${r}" fill="#505055" stroke="#141414" stroke-width="0.9"/>`;
  const gloss = on ? `<ellipse cx="${cx - 1.7}" cy="${cy - 2.7}" rx="2.5" ry="1.6" fill="#ffb4b4" opacity="0.85"/>` : '';
  const arcs = '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7">'
    + '<path d="M15 6 A5 5 0 0 1 20 11"/>'
    + '<path d="M15 2.5 A8.5 8.5 0 0 1 23.5 11"/></g>';
  return `<svg style="width:18px;height:18px" viewBox="0 0 24 24">${grad}${arcs}${body}${gloss}</svg>`;
}

// Cable colour = signal family, matching the port bodies: audio yellow, CV/control
// orange, trigger blue, 1V/oct pitch green. A cord takes its DESTINATION port's
// colour (see patchbay familyOfPort). One thin weight for every cord — thin lines
// obscure less as they cross the panel, and colour separates them.
const STYLE_COLOR = { audio: '#f3c40b', control: '#ff7300', trigger: '#5aa0e6', pitch: '#39a85a' };
const domainStyle = (domain) => (domain === 'audio' ? 'audio' : domain === 'trigger' ? 'trigger' : 'control');
const CABLE_PX = 3.8;   // cord thickness in px at zoom 1 (scales up as you zoom in)
const JACK_DROP_MARGIN_MM = 2;   // a cable arms/drops within this much of a terminal's edge (a forgiving zone)
// Ear-monitor volume knob: scroll with the same momentum feel as a panel knob.
const MON_VOL_STEP = 0.04, MON_VOL_DRAG = 6, MON_VOL_MAXV = 8, MON_VOL_DEFAULT = 0.75;
// Flow animation (on every cable, always): black dashes crawl each cord source->dest
// to show direction. Dash LENGTH (in cable-widths) encodes the DESTINATION family —
// audio shortest, CV/pitch medium, trigger longest — a shape cue on top of colour.
const FLOW_DASH = { audio: 1.6, control: 3.4, pitch: 3.4, trigger: 5.6 };
const FLOW_GAP = 2.6;        // gap between dashes, in cable-widths
const FLOW_SPEED = 5.5;      // crawl speed, mm/s (content space) — a slow drift

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
    this.onSelect = opts.onSelect || (() => {});   // module the pointer entered (deixis)
    this.onNetMode = opts.onNetMode || (() => {});  // net-explore mode toggled (for the toolbar button)
    this.onScopeArm = opts.onScopeArm || (() => {});  // "add scope" armed/disarmed (for the toolbar button)
    // Panel-pie hooks into app-level actions the rack doesn't own (set by rack-app).
    this.onAppMenu = opts.onAppMenu || (() => {});    // open the app (File) menu at (x,y)
    this.onTransport = opts.onTransport || (() => {}); // toggle start/stop sound
    this.isPlaying = opts.isPlaying || (() => false); // current sound-on state (LED + wedge highlight)
    this.setTransport = opts.setTransport || ((on) => { if (this.isPlaying() !== on) this.onTransport(); }); // set sound explicitly
    this.setSound = opts.setSound || ((on) => this.setTransport(on)); // latch overall sound on/off (unified with the mixer master enable)
    this.soundPeek = opts.soundPeek || (() => {}); // momentary audition: soundPeek(true) plays, soundPeek(false) restores
    this._scopes = new Set();       // live floating signal scopes (transient, not saved)
    this._monitors = new Set();     // live ear monitors — solo-listen taps (transient, not saved)
    this.dark = !!opts.dark;                        // dark-mode faceplates
    this.rowCount = opts.rowCount || 2;
    this.rows = [];
    for (let i = 0; i < this.rowCount; i++) this.rows.push([]);
    this.records = new Map();     // key -> record
    this.pxPerMm = 1;
    this.zoom = 1;
    this._hoverRec = null;   // module under the pointer
    this._isolateNet = null; // Set of edge ids when isolating one terminal's subnet (else null)
    this._isolateOrigin = null; // { key, portId } of the isolated terminal, for live recompute
    this._undoStack = [];    // { undo, redo } ops for cable/module topology changes (not knob values)
    this._redoStack = [];
    this._openSubs = [];     // open submenu elements of the current pop-up menu
    this._isolateSwells = []; // enlarged jack records (el + live tap) to restore when isolate mode ends
    this._isolateJackByTag = new Map();
    this._isolateOffsets = new Map();
    this._seq = 0;
    this._rowEls = [];
    this._menuEl = null;
    this._ghostEl = null;
    this._hoverCableEdgeId = null;  // cable under the pointer (reveals its reshape handle)
    this._reshaping = false;   // a middle-handle reshape drag is in progress
    this._tempCable = null;    // live cord element while dragging a new/regrabbed cable
    this._dragEdgeId = null;   // edge whose end is being dragged (hidden meanwhile)
    this._highlights = null;   // candidate rings thickened during a drag
    this._gripTimer = null;    // pending (delayed) grab cursor
    this._contentWmm = 0;
    this._contentHmm = 0;
    this.mixer = null;         // LEGACY/UNUSED: the old toolbar output mixer. The mixer
                               // is a pinned rack module now (setMixer is never called),
                               // so `this.mixer` stays null and its branches are dead.
    this._toolbarCords = [];   // legacy: cords to the old toolbar mixer (unused)

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
    this._startFlow();   // animated flow-dashes run continuously on every cable

    window.addEventListener('resize', () => this.relayout());
    // Suppress the native right-click menu everywhere. Our right-click pies and menus
    // run on their own elements first (and preventDefault themselves); this is the
    // catch-all for areas without one (controls, empty space).
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    // A press outside an open pop-up menu (the app/File menu, a scope menu) just
    // DISMISSES it — that click must not also open a pie or nudge a control. Capture
    // phase + stopPropagation keeps it from reaching the faceplate/jack/knob handlers;
    // `_swallowClick` blocks the trailing click that the backdrop pie listens for.
    document.addEventListener('pointerdown', (e) => {
      if (this._menuEl && !this._menuEl.contains(e.target) && !this._openSubs.some((s) => s.contains(e.target))) {
        this._closeMenu();
        this._swallowClick = true;
        e.preventDefault(); e.stopPropagation();
      } else {
        this._swallowClick = false;
      }
    }, true);
    // Pinch / ctrl-wheel to zoom (capture phase, so it beats a knob's wheel).
    this.container.addEventListener('wheel', (e) => {
      if (e.ctrlKey) this._onPinch(e);
    }, { passive: false, capture: true });
    // (Legacy: the old toolbar-mixer cords tracked scroll here; `this.mixer` is
    // always null now, so this is a no-op.)
    this.container.addEventListener('scroll', () => { if (this.mixer) this._drawCables(); });
    // Any pointer release ends a cable drag; clear the grip cursor (and cancel a
    // pending grip so a quick click never flashes it).
    document.addEventListener('pointerup', () => {
      if (this._gripTimer) { clearTimeout(this._gripTimer); this._gripTimer = null; }
      document.body.classList.remove('grabbing-cable');
    }, true);
    // A cable body is click-through, so it fires no hover events of its own.
    // Detect a hovered cable by proximity and reveal its middle reshape handle.
    this.container.addEventListener('pointermove', (e) => this._updateCableHover(e));
    this.container.addEventListener('pointerleave', () => {
      if (this._hoverCableEdgeId !== null) { this._hoverCableEdgeId = null; this._drawCables(); }
    });
  }

  // LEGACY / UNUSED. Registered the old toolbar output mixer as a patch endpoint
  // back when the mixer's jacks lived on the toolbar. The mixer is a pinned rack
  // module now and this is never called; kept only until the dead `this.mixer`
  // branches are stripped out.
  setMixer(mixer) {
    this.mixer = mixer;
    for (const [portId, svg] of mixer.jacks) {
      const el = (svg.closest && svg.closest('.toolbar-jack')) || svg;
      // data-jack-* lets a dropped cord hit-test this jack. The mixer end of a
      // cord has no stub, so pressing a connected mixer jack GRABS its cord (drag
      // off to move or delete); an empty jack starts a new one. A plain click is
      // reserved for the connection list. A small move threshold separates them.
      el.dataset.jackKey = this.mixer.key;
      el.dataset.jackPort = portId;
      el.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        e.preventDefault();
        const startX = e.clientX, startY = e.clientY;
        let started = false;
        const cleanup = () => {
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
        };
        const onMove = (ev) => {
          if (started || Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
          started = true;
          cleanup();
          const edges = this.patchbay.edgesAtJack(this.mixer.key, portId);
          if (edges.length) {   // grab the existing cord (drag off to move/delete)
            const edge = edges[edges.length - 1];
            this._startRegrab(e, edge, edge.dst.key === this.mixer.key ? 'dst' : 'src');
          } else {
            this._startCable(e, this.mixer.key, portId);   // else start a new cord
          }
        };
        const onUp = () => { cleanup(); };   // a clean click does nothing
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
      });
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

  moduleCount() { return this.records.size; }
  moduleRecords() { return [...this.records.values()]; }

  // ---- save/load support (host/patch-io.js drives these) ----
  // Remove every module (which pulls its cords first), leaving an empty rack.
  // Clear the rack for a fresh patch. Pinned records (the singleton mixer) are
  // kept — they're recreated once at boot, not per patch — but their cords are
  // pulled so a restore rewires from a clean slate.
  clear() {
    for (const rec of [...this.records.values()]) {
      if (rec.pinned) this.patchbay.disconnectModule(rec.key);
      else this.deleteModule(rec);
    }
  }
  // Apply one module param value (knob/switch), updating DSP and the panel.
  applyParam(rec, id, value) { this._setParam(rec, id, value); }
  // Connect two jacks by { key, portId }; returns the edge (for restoring bow).
  connectPatch(from, to) { return this._tryConnect(from, to); }
  redrawCables() { this._drawCables(); }
  // Open the shared pop-up menu at (x, y) — reused by the toolbar hamburger.
  openMenu(x, y, items) { this._openMenu(x, y, items); }

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

  // The cord's geometry as a CUBIC. Each end sits in the MIDDLE of the jack's
  // coloured band (a.ring), so the cord blends into the colour rather than running
  // into the black hole, and departs radially toward the belly P. uA/uB are those
  // departure directions — also used to pick which fan-out cord a drag grabs.
  _cordGeom(e) {
    const a = this._jackPosMm(e.src.key, e.src.portId);
    const b = this._jackPosMm(e.dst.key, e.dst.portId);
    if (!a || !b) return null;
    const w = CABLE_PX / (this._fit || 1);
    const P = this._bellyPoint(a, b, e.bow);
    const uA = unit(P.x - a.x, P.y - a.y);
    const uB = unit(P.x - b.x, P.y - b.y);
    const pA = { x: a.x + uA.x * a.ring, y: a.y + uA.y * a.ring };
    const pB = { x: b.x + uB.x * b.ring, y: b.y + uB.y * b.ring };
    const L = Math.hypot(pB.x - pA.x, pB.y - pA.y) * 0.4;
    const c1 = { x: pA.x + uA.x * L, y: pA.y + uA.y * L };
    const c2 = { x: pB.x + uB.x * L, y: pB.y + uB.y * L };
    return { a, b, w, uA, uB, pA, pB, c1, c2 };
  }

  _drawCables() {
    if (!this.cables) return;
    // While isolating a subnet, the hover-driven net highlight is suppressed, and the
    // subnet itself is recomputed live so it tracks patch edits (a new feeding cord
    // joins at once; a removed one leaves). Rebuild the enlarged jacks only on a change.
    if (this._isolateOrigin) {
      const up = this._upstreamOf(this._isolateOrigin.key, this._isolateOrigin.portId);
      if (!this._sameSet(up.edges, this._isolateNet)) { this._isolateNet = up.edges; this._isolateSections = up.sections; this._buildIsolateSwells(); this._buildControlHalos(); }
    }
    this._netEdges = (!this._isolateNet && this._netOrigin) ? this._computeNet(this._netOrigin) : null;   // recompute so it tracks patch edits
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
      if (e.id === this._dragEdgeId) continue; // hidden while its end is being dragged
      if (this.mixer && (e.src.key === this.mixer.key || e.dst.key === this.mixer.key)) {
        this._drawMixerEdge(e, wmm, mk);
        continue;
      }
      const g = this._cordGeom(e);
      if (!g) continue;
      const color = STYLE_COLOR[e.style] || STYLE_COLOR.control;
      const op = this._cableOpacity(e);
      // The cable body is pointer-events:none, so a press falls through to the jack
      // behind it — a cord is grabbed and re-routed from the PORT it ends on, not
      // from the cord itself. Its only grab point is the middle reshape handle.
      const bodyD = `M${r2(g.pA.x)},${r2(g.pA.y)} C${r2(g.c1.x)},${r2(g.c1.y)} ${r2(g.c2.x)},${r2(g.c2.y)} ${r2(g.pB.x)},${r2(g.pB.y)}`;
      mk(bodyD, color, wmm, op, null);
      // Flow direction: black dashes crawl source->dest (path runs pA=src -> pB=dst),
      // full-opacity black so they read over any cable. EVERY cord gets them normally;
      // while isolating a subnet only the SUBNET's cords do — the others are shown just
      // dimmed, no dashes. Dash length is per destination family; the crawl offset is
      // driven by a clock in _startFlow so it survives the frequent redraws.
      if (!this._isolateNet || this._isolateNet.has(e.id)) {
        const fd = mk(bodyD, '#000', wmm / 2, 1, null);
        fd.setAttribute('class', 'flow-dash');
        fd.dataset.edge = e.id;
        fd.dataset.src = e.src.key + '|' + e.src.portId;   // source jack tag → its live level drives this cable's crawl in isolate mode
        fd.setAttribute('stroke-linecap', 'butt');
        fd.setAttribute('stroke-dasharray', `${r2((FLOW_DASH[e.style] || FLOW_DASH.control) * wmm)} ${r2(FLOW_GAP * wmm)}`);
        fd.setAttribute('stroke-dashoffset', r2(this._flowOffset()));
      }
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
    if (this._tempCable) {
      this._tempCable.setAttribute('stroke-width', r2(wmm));
      this.cables.appendChild(this._tempCable);
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
    if (this._isolateNet) return this._isolateNet.has(e.id) ? 1 : 0.25;    // isolate: subnet bright, the rest dimmed (no dashes)
    if (this._netEdges) return this._netEdges.has(e.id) ? 1 : 0.5;          // net highlight: members full, rest as normal
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
    if (this._tempCable || this._reshaping) return;
    const near = this._nearestCable(this._clientToMm(ev.clientX, ev.clientY));
    const id = near ? near.id : null;
    if (id !== this._hoverCableEdgeId) { this._hoverCableEdgeId = id; this._drawCables(); }
  }

  // Rack cord for a toolbar edge. It leaves T straight down, PAST the seam by a
  // fixed drop, so at the seam the cord is vertical — tangent to the toolbar
  // line — before it curves to M's rim aiming at M's centre.
  _toolbarCordPath(T, M, w) {
    const u = unit(M.x - T.x, M.y - T.y);           // T -> M
    const p3 = { x: M.x - u.x * M.ring, y: M.y - u.y * M.ring };   // middle of M's coloured band
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

  // ---- drag-to-patch ----
  // Resolve the DOM element under the cursor to a { key, portId } jack. Cables are
  // drawn pointer-events:none, so the jack beneath a dragged cord still hit-tests.
  _jackFromPoint(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    const jack = el && el.closest && el.closest('[data-jack-key]');
    if (!jack) return null;
    return { key: jack.dataset.jackKey, portId: jack.dataset.jackPort };
  }

  // The jack within reach of a screen point — a FORGIVING cable drop/arm zone: the
  // terminal's radius plus JACK_DROP_MARGIN_MM. Nearest wins if a couple overlap.
  // Positions are pure arithmetic (no layout), so scanning every jack per move is cheap.
  _jackNear(clientX, clientY) {
    const m = this._clientToMm(clientX, clientY);
    let best = null, bestD = Infinity;
    for (const rec of this.records.values()) {
      for (const [portId] of rec.panel.ports) {
        const pos = this._jackPosMm(rec.key, portId);
        if (!pos) continue;
        const d = Math.hypot(m.x - pos.x, m.y - pos.y);
        const reach = Math.max(pos.r || 0, pos.ring || 0) + JACK_DROP_MARGIN_MM;
        if (d <= reach && d < bestD) { bestD = d; best = { key: rec.key, portId }; }
      }
    }
    return best;
  }

  // Straight cord from a jack centre (cA, radius rA) to a free point (cB, rB=0):
  // the live cord shown while dragging. It stops at rimA so the round cap butts
  // the hole without covering it.
  _cordPath(cA, rA, cB, rB, w) {
    const dx = cB.x - cA.x, dy = cB.y - cA.y, d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const p0 = { x: cA.x + ux * (rA + w / 2), y: cA.y + uy * (rA + w / 2) };
    const p3 = { x: cB.x - ux * (rB + w / 2), y: cB.y - uy * (rB + w / 2) };
    return `M${r2(p0.x)},${r2(p0.y)} L${r2(p3.x)},${r2(p3.y)}`;
  }

  // Show the cable-grab cursor, but only after a short delay — so a quick click
  // never flashes it, while a real drag (held past the delay) gets it. The pending
  // timer is cancelled on pointerup.
  _gripCursor() {
    if (this._gripTimer) clearTimeout(this._gripTimer);
    this._gripTimer = setTimeout(() => {
      this._gripTimer = null;
      document.body.classList.add('grabbing-cable');
    }, 150);
  }

  // Jack pointerdown. A left press that moves past a small threshold starts a NEW
  // cable dragged from this jack; an existing cord is instead grabbed by its stub
  // (see _startRegrab). A plain click (press-release, no move) does nothing.
  // stopPropagation on the press keeps it from starting a module drag. `key` is a
  // rack module or the mixer.
  _onJackPointerDown(e, key, portId) {
    e.stopPropagation();
    if (e.button !== 0) return;
    e.preventDefault();
    // "Add scope" armed: press a port and drag off; on release a scope drops there,
    // probing this port. Never touches the cable logic.
    if (this._scopeArm) { this._placeScope(e, key, portId); return; }
    const startX = e.clientX, startY = e.clientY;
    const TH = 6;                       // px of movement that means "drag", not "click" (trackball-tolerant)
    let dragging = false;
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    };
    const onMove = (ev) => {
      if (dragging) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) >= TH) {
        dragging = true;
        cleanup();
        // A port already carrying cable(s): grab one and re-route its end here.
        // The DRAG DIRECTION picks which cord (the one leaving this port most that
        // way) so a fan-out can be disambiguated. An empty port starts a new cord.
        const edges = this.patchbay.edgesAtJack(key, portId);
        if (edges.length) {
          const dragDir = unit(ev.clientX - startX, ev.clientY - startY);
          const edge = this._pickByDirection(key, portId, edges, dragDir);
          const grabbedEnd = (edge.src.key === key && edge.src.portId === portId) ? 'src' : 'dst';
          this._startRegrab(e, edge, grabbedEnd);
        } else {
          this._startCable(e, key, portId);
        }
      }
    };
    // A clean click (no drag) OPENS the terminal pie — same as a right-click. It fires
    // on release, so a press that becomes a drag is unambiguously a cable and never a
    // menu. (Pulling a cord by click is now the pie's lower-right "pull a cable" wedge.)
    const onUp = (ev) => { cleanup(); this._onJackContextMenu(ev, key, portId); };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // Start a NEW cable by dragging from a jack. A live straight cord trails the
  // pointer; on release over an opposite-direction jack it connects (the patchbay
  // orients output->input). Anything can patch into anything (DESIGN §2), so every
  // opposite-direction jack is a candidate regardless of domain.
  _startCable(e, key, portId) {
    if (e.button !== 0) return;
    e.preventDefault();
    this._gripCursor();
    const ep = this._ep(key, portId);
    const a = this._jackPosMm(key, portId);
    if (!ep || !a) return;
    const meta = ep.meta;
    const wmm = CABLE_PX / (this._fit || 1);
    const tmp = document.createElementNS(SVG_NS, 'path');
    tmp.setAttribute('class', 'rack-cable rack-cable-temp');
    tmp.setAttribute('stroke', STYLE_COLOR[domainStyle(meta.domain)]);
    tmp.setAttribute('stroke-width', r2(wmm));
    this._tempCable = tmp;
    this.cables.appendChild(tmp);
    this._highlightCandidates(meta.dir === 'out' ? 'in' : 'out');

    const wantDir = meta.dir === 'out' ? 'in' : 'out';
    const onMove = (ev) => {
      const m = this._clientToMm(ev.clientX, ev.clientY);
      tmp.setAttribute('d', this._cordPath(a, a.r, m, 0, wmm));
      this._armTarget(this._jackNear(ev.clientX, ev.clientY), wantDir, null, { key, portId });
    };
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      tmp.remove();
      this._tempCable = null;
      this._disarmTarget();
      this._clearHighlights();
      const drop = this._jackNear(ev.clientX, ev.clientY);
      if (drop && (drop.key === key && drop.portId === portId)) {
        /* released back on the origin jack: it was really a click — do nothing */
      } else if (drop) {
        this._recordCableAdd(this._tryConnect({ key, portId }, drop));
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // Sticky (click-to-pick-up, click-to-drop) cabling: a plain click on a jack starts a
  // cord that FOLLOWS the cursor with NO button held — so you can scroll, zoom, and
  // roam freely to find the target instead of dragging the whole way. A second LEFT
  // click drops it: on a jack it connects, elsewhere it cancels. Escape or a right
  // click also cancel. Coexists with press-drag cabling.
  _startStickyCable(key, portId, cx, cy) {
    const ep = this._ep(key, portId);
    const a = this._jackPosMm(key, portId);
    if (!ep || !a) return;
    const meta = ep.meta;
    const wmm = CABLE_PX / (this._fit || 1);
    const tmp = document.createElementNS(SVG_NS, 'path');
    tmp.setAttribute('class', 'rack-cable rack-cable-temp');
    tmp.setAttribute('stroke', STYLE_COLOR[domainStyle(meta.domain)]);
    tmp.setAttribute('stroke-width', r2(wmm));
    this._tempCable = tmp;
    this.cables.appendChild(tmp);
    this._highlightCandidates(meta.dir === 'out' ? 'in' : 'out');
    document.body.classList.add('grabbing-cable');
    const wantDir = meta.dir === 'out' ? 'in' : 'out';
    let lastX = cx, lastY = cy;
    const track = (clientX, clientY) => {
      lastX = clientX; lastY = clientY;
      tmp.setAttribute('d', this._cordPath(a, a.r, this._clientToMm(clientX, clientY), 0, wmm));
      this._armTarget(this._jackNear(clientX, clientY), wantDir, null, { key, portId });
    };
    track(cx, cy);
    const onMove = (ev) => track(ev.clientX, ev.clientY);
    const onScroll = () => track(lastX, lastY);   // keep the end under the cursor after a scroll with no move
    const finish = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', onDrop, true);
      document.removeEventListener('contextmenu', onCtx, true);
      document.removeEventListener('keydown', onKey, true);
      this.container.removeEventListener('scroll', onScroll, true);
      tmp.remove(); this._tempCable = null;
      this._disarmTarget(); this._clearHighlights();
      document.body.classList.remove('grabbing-cable');
    };
    const onDrop = (ev) => {
      if (ev.button !== 0) return;   // right-click is handled by onCtx; middle is ignored
      ev.preventDefault(); ev.stopPropagation();
      const drop = this._jackNear(ev.clientX, ev.clientY);
      finish();
      if (drop && !(drop.key === key && drop.portId === portId)) this._recordCableAdd(this._tryConnect({ key, portId }, drop));
    };
    const onCtx = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish(); };   // right click cancels (no pie)
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finish(); } };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', onDrop, true);
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', onKey, true);
    this.container.addEventListener('scroll', onScroll, true);
  }

  // A non-committal PREVIEW cord from a terminal to the cursor, shown while hovering the
  // pie's "pull a cable" wedge — a hint that a real drag will start. Drawn in a top-layer
  // viewport overlay (ABOVE the pie) so it stays visible right up to the cursor tip
  // instead of vanishing behind the opaque pie disc.
  _startCablePreview(key, portId) {
    this._endCablePreview();
    const ep = this._ep(key, portId);
    const rec = this.records.get(key);
    const port = rec && rec.panel && rec.panel.ports.get(portId);
    if (!ep || !port || !port.element) return;
    const jr = port.element.getBoundingClientRect();
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'cable-preview');
    svg.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;z-index:3100;pointer-events:none;overflow:visible;';
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', STYLE_COLOR[domainStyle(ep.meta.domain)]);
    path.setAttribute('stroke-width', String(Math.max(3, CABLE_PX)));
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
    document.body.appendChild(svg);
    this._previewCable = { svg, path, jx: jr.left + jr.width / 2, jy: jr.top + jr.height / 2 };
  }
  _updateCablePreview(clientX, clientY) {
    const p = this._previewCable; if (!p) return;
    const sag = 8 + Math.abs(clientX - p.jx) * 0.18;                 // a gentle droop
    const mx = (p.jx + clientX) / 2, my = Math.max(p.jy, clientY) + sag;
    p.path.setAttribute('d', `M ${r2(p.jx)} ${r2(p.jy)} Q ${r2(mx)} ${r2(my)} ${r2(clientX)} ${r2(clientY)}`);
  }
  _endCablePreview() {
    if (this._previewCable) { this._previewCable.svg.remove(); this._previewCable = null; }
  }

  // Re-route an existing cable: grabbed at one of its ports (grabbedEnd), drag that
  // end to another valid port to move it, or onto nothing to delete. Fixed end stays.
  _startRegrab(ev, edge, grabbedEnd) {
    if (ev.button !== 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    this._gripCursor();
    const fixed = grabbedEnd === 'src' ? edge.dst : edge.src;
    const grabbed = grabbedEnd === 'src' ? edge.src : edge.dst;
    const fixedEp = this._ep(fixed.key, fixed.portId);
    const fixedPos = this._jackPosMm(fixed.key, fixed.portId);
    if (!fixedEp || !fixedPos) return;
    const fixedMeta = fixedEp.meta;
    const wantDir = fixedMeta.dir === 'out' ? 'in' : 'out';
    const wmm = CABLE_PX / (this._fit || 1);
    const savedBow = edge.bow;
    const origSnap = this._edgeSnapshot(edge);   // for undo of a move/remove

    // Break the connection IMMEDIATELY, so pulling a cord off a terminal mutes its
    // effect the moment you drag it — you hear the patch WITHOUT it while you decide
    // where (or whether) to re-drop it. Dropping it back on its port restores it (depth
    // comes from the input's own knob; bow is carried over).
    this.patchbay.disconnect(edge);
    this._drawCables();
    const reconnect = (jp) => {
      const e = this._tryConnect({ key: fixed.key, portId: fixed.portId }, jp);
      if (e && savedBow != null && jp.key === grabbed.key && jp.portId === grabbed.portId) { e.bow = savedBow; this._drawCables(); }
    };

    const tmp = document.createElementNS(SVG_NS, 'path');
    tmp.setAttribute('class', 'rack-cable rack-cable-temp');
    tmp.setAttribute('stroke', STYLE_COLOR[domainStyle(fixedMeta.domain)]);
    tmp.setAttribute('stroke-width', r2(wmm));
    this._tempCable = tmp;
    this.cables.appendChild(tmp);
    this._highlightCandidates(wantDir);

    const onMove = (e2) => {
      const m = this._clientToMm(e2.clientX, e2.clientY);
      tmp.setAttribute('d', this._cordPath(fixedPos, fixedPos.r, m, 0, wmm));
      this._armTarget(this._jackNear(e2.clientX, e2.clientY), wantDir, null, null);   // origin null: the cord is already disconnected, so its OWN port is a valid re-drop and should arm
    };
    const onUp = (e2) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      tmp.remove();
      this._tempCable = null;
      this._disarmTarget();
      this._clearHighlights();
      const drop = this._jackNear(e2.clientX, e2.clientY);
      const droppedBack = drop && drop.key === grabbed.key && drop.portId === grabbed.portId;
      const candidate = drop && this._isCandidate(drop, wantDir);
      const occupied = candidate && wantDir === 'in' && this.patchbay.inputOccupied(drop.key, drop.portId, null);
      if (droppedBack || (candidate && occupied)) {
        reconnect(grabbed);                              // dropped back, or target taken → put it back (no net change, no undo)
      } else if (candidate) {
        const ne = this._tryConnect({ key: fixed.key, portId: fixed.portId }, drop);   // reconnect to the new port (a move)
        if (ne) { const ns = this._edgeSnapshot(ne); this._pushUR({ undo: () => { this._removeCable(ns); this._restoreCable(origSnap); }, redo: () => { this._removeCable(origSnap); this._restoreCable(ns); } }); }
      } else {
        this.onChange();                                 // dropped on nothing → leave it broken
        this._pushUR({ undo: () => this._restoreCable(origSnap), redo: () => this._removeCable(origSnap) });   // pull-off removal
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // A jack is a valid drop target if it faces opposite the fixed end. Domain is
  // NOT checked — anything can patch into anything (DESIGN §2).
  _isCandidate(jack, wantDir) {
    const ep = this._ep(jack.key, jack.portId);
    return !!ep && ep.meta.dir === wantDir;
  }

  // While a cable is dragging, thicken the outer ring of every valid target port
  // (opposite direction) by ~2 px so candidates stand out. An input already
  // carrying a cable is NOT a valid target, so it's left at normal size — a subtle
  // cue that you can't drop there. (exceptEdge: for a regrab, the moving cable's
  // own edge doesn't count its current input as occupied.)
  _highlightCandidates(wantDir, exceptEdge) {
    this._clearHighlights();
    this._highlights = [];
    const delta = 2 / (this.pxPerMm || 1);   // 2 screen px expressed in panel mm
    for (const rec of this.records.values()) {
      for (const [portId, port] of rec.panel.ports) {
        if (port.meta.dir !== wantDir) continue;
        if (wantDir === 'in' && this.patchbay.inputOccupied(rec.key, portId, exceptEdge)) continue;
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

  // Of the cords on a port, the one whose departure direction (uA at its src end,
  // uB at its dst end) best matches the drag — so a drag lifts the cord heading
  // that way. dragDir is a screen-px vector; zoom is uniform so the angle matches.
  _pickByDirection(key, portId, edges, dragDir) {
    let best = edges[0], bestDot = -Infinity;
    for (const edge of edges) {
      const g = this._cordGeom(edge);
      if (!g) continue;
      const dep = (edge.src.key === key && edge.src.portId === portId) ? g.uA : g.uB;
      const d = dep.x * dragDir.x + dep.y * dragDir.y;
      if (d > bestDot) { bestDot = d; best = edge; }
    }
    return best;
  }

  // The SVG element of a jack (rack module or mixer), for the receive-cue enlarge.
  _jackElement(key, portId) {
    if (this.mixer && key === this.mixer.key) return this.mixer.jacks.get(portId) || null;
    const rec = this.records.get(key);
    const port = rec && rec.panel.ports.get(portId);
    return port ? port.element : null;
  }

  // Receive cue while dragging: the valid target under the pointer swells and gains
  // a bold outline in its own family colour ("ready to receive"). Only opposite-
  // direction, unoccupied jacks arm — never the origin or an occupied input.
  _armTarget(target, wantDir, exceptEdge, origin) {
    const onSelf = target && origin && target.key === origin.key && target.portId === origin.portId;
    const ok = target && !onSelf && this._isCandidate(target, wantDir)
      && !(wantDir === 'in' && this.patchbay.inputOccupied(target.key, target.portId, exceptEdge));
    const tag = ok ? target.key + '|' + target.portId : null;
    if (tag === this._armedTag) return;
    this._disarmTarget();
    this._armedTag = tag;
    if (!ok) return;
    const el = this._jackElement(target.key, target.portId);
    const circle = el && el.querySelector('circle');
    if (!el || !circle) { this._armedTag = null; return; }
    const ro = parseFloat(circle.getAttribute('r')) || 3;
    const cx = parseFloat(circle.getAttribute('cx')) || 0;
    const cy = parseFloat(circle.getAttribute('cy')) || 0;
    // A bold outline ring in the jack's own family colour, then swell the whole jack
    // via the SVG transform attribute — composed with any existing transform and
    // scaled about the jack centre, so positioning is preserved.
    const ring = el.ownerDocument.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', 'jack-arm-ring');
    ring.setAttribute('cx', r2(cx)); ring.setAttribute('cy', r2(cy)); ring.setAttribute('r', r2(ro));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', circle.getAttribute('fill') || STYLE_COLOR.control);
    ring.setAttribute('stroke-width', r2(ro * 0.24));
    ring.style.pointerEvents = 'none';
    el.appendChild(ring);
    const tf = el.getAttribute('transform');
    const swell = `translate(${r2(cx)} ${r2(cy)}) scale(1.18) translate(${r2(-cx)} ${r2(-cy)})`;
    el.setAttribute('transform', tf ? `${tf} ${swell}` : swell);
    this._armed = { el, tf };
  }

  _disarmTarget() {
    const a = this._armed;
    if (a) {
      if (a.tf == null) a.el.removeAttribute('transform'); else a.el.setAttribute('transform', a.tf);
      const ring = a.el.querySelector('.jack-arm-ring');
      if (ring) ring.remove();
      this._armed = null;
    }
    this._armedTag = null;
  }

  // ---- signal-net highlight ----
  // A patch node key for net tracing. A whole module by default; a "sectioned"
  // module (the quads) splits into per-channel nodes (key:A …) from the port's
  // trailing letter, so one channel's net never bleeds into its neighbours. Shared
  // ports (quad/sum/clock) form their own node; the mixer/unknown is one node.
  _sectionKey(key, portId) {
    const rec = this.records.get(key);
    if (!rec) return key;
    const desc = this.host.registry.descriptor(rec.descriptorId);
    if (!desc || !desc.sectioned) return key;
    const port = rec.panel.ports.get(portId);
    const sec = port && port.meta && port.meta.section;
    const ch = /([A-D])$/.exec(portId);
    return (sec === 'channel' && ch) ? `${key}:${ch[1]}` : `${key}:${sec || 'x'}`;
  }

  // The origin node under a pointer over a module: the whole module, or (for a
  // sectioned quad) the CHANNEL it's on. The channel is chosen by nearest per-
  // channel jack CENTROID — a Voronoi partition of the panel — so anywhere in a
  // channel's region maps to it, and shared (non-channel) ports never hijack it.
  _netOriginAt(rec, clientX, clientY) {
    const desc = this.host.registry.descriptor(rec.descriptorId);
    if (!desc || !desc.sectioned) return rec.key;
    const m = this._clientToMm(clientX, clientY);
    const cen = new Map();   // channel letter -> { x, y, n }
    for (const [portId, port] of rec.panel.ports) {
      if (!port.meta || port.meta.section !== 'channel') continue;
      const ch = /([A-D])$/.exec(portId);
      if (!ch) continue;
      const p = this._jackPosMm(rec.key, portId);
      if (!p) continue;
      const c = cen.get(ch[1]) || { x: 0, y: 0, n: 0 };
      c.x += p.x; c.y += p.y; c.n++;
      cen.set(ch[1], c);
    }
    let best = null, bestD = Infinity;
    for (const [letter, c] of cen) {
      const d = Math.hypot(c.x / c.n - m.x, c.y / c.n - m.y);
      if (d < bestD) { bestD = d; best = letter; }
    }
    return best ? `${rec.key}:${best}` : rec.key;
  }

  // The set of cable ids in `origin`'s net: every cord downstream of it (to the
  // outputs) plus every cord upstream (its feeders/modulators), traced over the
  // section graph so a quad channel stays clean even where sections reconverge.
  _computeNet(origin) {
    const edges = this.patchbay.list();
    const fwd = new Map(), bwd = new Map();
    const link = (map, a, b) => { if (!map.has(a)) map.set(a, new Set()); map.get(a).add(b); };
    const pair = edges.map((e) => ({ e, s: this._sectionKey(e.src.key, e.src.portId), d: this._sectionKey(e.dst.key, e.dst.portId) }));
    for (const { s, d } of pair) { link(fwd, s, d); link(bwd, d, s); }
    const closure = (start, adj) => {
      const seen = new Set([start]), stack = [start];
      while (stack.length) { for (const n of (adj.get(stack.pop()) || [])) if (!seen.has(n)) { seen.add(n); stack.push(n); } }
      return seen;
    };
    const down = closure(origin, fwd), up = closure(origin, bwd);
    const net = new Set();
    for (const { e, s, d } of pair) if (down.has(s) || up.has(d)) net.add(e.id);
    return net;
  }

  // Signal-net EXPLORE MODE. While on, whatever module (or quad channel) you HOVER
  // lights its net — the whole downstream chain to the outputs plus everything
  // upstream that feeds or modulates it — full-opaque, the rest at their normal
  // 50%. It's a mode, not a per-click pin: the hovered scope drives the highlight,
  // not where you invoked it. Off by default, so the plain overview is never
  // dimmed. Toggle from the panel right-click menu; Escape also exits.
  // Public toggle (the toolbar button); the origin follows hover, so none is needed.
  toggleNetMode() { if (this._netMode) this._exitNetMode(); else this._enterNetMode(null); }
  isNetMode() { return !!this._netMode; }

  _enterNetMode(origin) {
    this._netMode = true;
    this._netOrigin = origin || null;
    this.onNetMode(true);
    this._drawCables();
  }

  _exitNetMode() {
    this._netMode = false;
    this._netOrigin = null;
    this.onNetMode(false);
    this._drawCables();
  }

  // ---- isolate a terminal's UPSTREAM (from its pie's "view subnet" wedge) ----
  // Show the cables that transitively feed this terminal — everything that AFFECTS the
  // signal here — bright with the signal-reactive dashes and enlarged/breathing jacks;
  // the rest of the patch stays visible but DIMMED (and dash-less). The subnet tracks
  // the patch live (add/remove a feeding cord and it joins/leaves at once). Persistent;
  // ends on Escape or a left click on empty faceplate.
  _isolateSubnet(key, portId) {
    this._exitIsolate();
    const up = this._upstreamOf(key, portId);
    if (!up.edges.size) return;   // nothing feeds this terminal — nothing to isolate
    this._isolateOrigin = { key, portId };
    this._isolateNet = up.edges;
    this._isolateSections = up.sections;
    this._isolateOffsets = new Map();     // edge id -> its own accumulated dash offset
    this._buildIsolateSwells();
    this._buildControlHalos();
    this._isolateEsc = (ev) => { if (ev.key === 'Escape') this._exitIsolate(); };
    document.addEventListener('keydown', this._isolateEsc);
    this._drawCables();
  }

  // (Re)build the enlarged/tapped jacks for the current `_isolateNet` + origin.
  _buildIsolateSwells() {
    this._clearIsolateSwells();
    this._isolateJackByTag = new Map();   // jack tag -> swell record (for the per-cable dash source level)
    const seen = new Set();
    const swell = (k, p) => { const tag = k + '|' + p; if (!seen.has(tag)) { seen.add(tag); this._swellJack(k, p); } };
    if (this._isolateOrigin) swell(this._isolateOrigin.key, this._isolateOrigin.portId);   // always the clicked port
    for (const e of this.patchbay.list()) {
      if (!this._isolateNet.has(e.id)) continue;
      swell(e.src.key, e.src.portId);
      swell(e.dst.key, e.dst.portId);
    }
  }

  // Restore every enlarged jack and disconnect its tap.
  _clearIsolateSwells() {
    for (const a of this._isolateSwells) {
      if (a.tf == null) a.el.removeAttribute('transform'); else a.el.setAttribute('transform', a.tf);
      const ring = a.el.querySelector('.jack-net-ring');
      if (ring) ring.remove();
      if (a.analyser && a.tapNode) { try { a.tapNode.disconnect(a.analyser, a.tapIndex); } catch (_e) { /* gone */ } }
    }
    this._isolateSwells = [];
  }

  // While isolating, ring every control whose SECTION affects the terminal with a cyan
  // halo, and dim the rest — so the user can focus on just the relevant knobs/switches.
  // Per-section: on a quad, only the feeding channel's controls light up, not the module.
  _buildControlHalos() {
    this._clearControlHalos();
    if (!this._isolateSections) return;
    this._controlHalos = [];
    for (const rec of this.records.values()) {
      if (!rec.panel || !rec.panel.controls) continue;
      for (const b of rec.panel.controls.values()) {
        const inNet = this._isolateSections.has(this._controlSectionKey(rec, b));
        // A control that only shapes ONE input (a CV/FM attenuator, phase lock) is inert
        // when that input is unpatched — dim it too, so only controls that can actually
        // affect the terminal light up.
        const gate = inNet ? this._controlGatePort(rec, b) : null;
        if (inNet && !(gate && !this._portOccupied(rec.key, gate))) {
          const halo = this._makeControlHalo(b);
          if (halo) this._controlHalos.push({ halo });
        } else {
          this._controlHalos.push({ dimEl: b.group, prev: b.group.style.opacity });
          b.group.style.opacity = '0.46';   // dimmed, but not too faint (fade reduced ~25%)
        }
      }
    }
  }
  // The input port that GATES a control (it's inert unless that port is patched), or
  // null. From an explicit param.needsPort, or from a CV input whose `via` attenuator IS
  // this control. Base knobs (freq, level, …) gate nothing and always count.
  _controlGatePort(rec, b) {
    const desc = this.host.registry.descriptor(rec.descriptorId);
    if (!desc) return null;
    const param = desc.params && desc.params.find((p) => p.id === b.id);
    if (param && param.needsPort) return param.needsPort;
    const port = desc.ports && desc.ports.find((p) => p.via === b.id);
    return port ? port.id : null;
  }
  _portOccupied(key, portId) {
    return this.patchbay.list().some((e) => (e.dst.key === key && e.dst.portId === portId) || (e.src.key === key && e.src.portId === portId));
  }
  _clearControlHalos() {
    if (!this._controlHalos) return;
    for (const h of this._controlHalos) {
      if (h.halo) h.halo.remove();
      if (h.dimEl) h.dimEl.style.opacity = h.prev || '';
    }
    this._controlHalos = null;
  }
  // A cyan ring hugging one control's bounds (in the panel's mm space, so it scales with
  // zoom). rx = half the short side, so a knob/button reads as a circle and a fader as a
  // stadium. Inserted as the control's first child to share its coordinate system.
  _makeControlHalo(b) {
    let bb; try { bb = b.group.getBBox(); } catch (_e) { return null; }
    if (!bb || !bb.width || !bb.height) return null;
    const pad = 0.9;
    const x = bb.x - pad, y = bb.y - pad, w = bb.width + 2 * pad, h = bb.height + 2 * pad;
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('class', 'control-halo');
    rect.setAttribute('x', r2(x)); rect.setAttribute('y', r2(y));
    rect.setAttribute('width', r2(w)); rect.setAttribute('height', r2(h));
    const rr = r2(Math.min(w, h) / 2);
    rect.setAttribute('rx', rr); rect.setAttribute('ry', rr);
    rect.setAttribute('fill', 'none');
    rect.setAttribute('stroke', '#2ad4e6');
    rect.setAttribute('stroke-width', '0.7');
    rect.setAttribute('opacity', '0.9');
    rect.setAttribute('pointer-events', 'none');
    b.group.insertBefore(rect, b.group.firstChild);
    return rect;
  }

  _sameSet(a, b) {
    if (!a || !b || a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  }

  // The set of edge ids that transitively FEED a specific port (its upstream supply
  // chain). The clicked port is precise — for an input, only the cord plugged into
  // THAT port seeds it (not its siblings on the same module); an output is fed by its
  // whole module. From there, upstream is followed per module/channel section (a
  // module is a black box: all its inputs feed all its outputs). Returns { edges, sections }
  // — the feeding cords AND the section keys whose CONTROLS shape the signal here.
  _upstreamOf(key, portId) {
    const edges = this.patchbay.list();
    const result = new Set();
    const toExpand = [];        // sections whose input cords we still need to gather
    const visited = new Set();  // sections already expanded (== the sections that affect the terminal)
    const ep = this._ep(key, portId);
    if (ep && ep.meta.dir === 'out') {
      toExpand.push(this._sectionKey(key, portId));   // an output depends on its module's inputs
    } else {
      for (const e of edges) {                          // an input: only the cord into this exact port
        if (e.dst.key === key && e.dst.portId === portId) {
          result.add(e.id);
          toExpand.push(this._sectionKey(e.src.key, e.src.portId));
        }
      }
    }
    while (toExpand.length) {
      const S = toExpand.pop();
      if (visited.has(S)) continue;
      visited.add(S);
      for (const e of edges) {
        if (this._sectionKey(e.dst.key, e.dst.portId) !== S) continue;   // cords INTO section S
        result.add(e.id);
        const srcS = this._sectionKey(e.src.key, e.src.portId);
        if (!visited.has(srcS)) toExpand.push(srcS);
      }
    }
    return { edges: result, sections: visited };
  }

  // A control's section key, mirroring _sectionKey (which does it for ports): a whole
  // module unless the module is sectioned, in which case a per-channel param (id ending
  // A–D, section 'channel') is its channel, and everything else its named section. Lets
  // control highlighting line up exactly with the cable/section graph.
  _controlSectionKey(rec, b) {
    const desc = this.host.registry.descriptor(rec.descriptorId);
    if (!desc || !desc.sectioned) return rec.key;
    const param = desc.params && desc.params.find((p) => p.id === b.id);
    const sec = (b.meta && b.meta.section) || (param && param.section);
    const ch = /([A-D])$/.exec(b.id);
    return (sec === 'channel' && ch) ? `${rec.key}:${ch[1]}` : `${rec.key}:${sec || 'x'}`;
  }

  // Enlarge one jack (the drop-cue swell + family-colour ring) AND open a live tap on
  // its signal, so the swell can breathe with the signal level. Remembered so
  // _exitIsolate can restore the jack and disconnect the tap.
  _swellJack(key, portId) {
    const el = this._jackElement(key, portId);
    const circle = el && el.querySelector('circle');
    if (!el || !circle) return;
    const ro = parseFloat(circle.getAttribute('r')) || 3;
    const cx = parseFloat(circle.getAttribute('cx')) || 0;
    const cy = parseFloat(circle.getAttribute('cy')) || 0;
    const ring = el.ownerDocument.createElementNS(SVG_NS, 'circle');
    ring.setAttribute('class', 'jack-net-ring');
    ring.setAttribute('cx', r2(cx)); ring.setAttribute('cy', r2(cy)); ring.setAttribute('r', r2(ro));
    ring.setAttribute('fill', 'none');
    ring.setAttribute('stroke', circle.getAttribute('fill') || STYLE_COLOR.control);
    ring.setAttribute('stroke-width', r2(ro * 0.24));
    ring.style.pointerEvents = 'none';
    el.appendChild(ring);
    const rec = { el, cx, cy, tf: el.getAttribute('transform'), level: 0, analyser: null, buf: null, tapNode: null, tapIndex: 0 };
    const tap = this._probeTap(key, portId);
    if (tap && tap.node) {
      try {
        const an = this.host.ctx.createAnalyser(); an.fftSize = 256; an.smoothingTimeConstant = 0;
        tap.node.connect(an, tap.index || 0);
        rec.analyser = an; rec.buf = new Float32Array(an.fftSize); rec.tapNode = tap.node; rec.tapIndex = tap.index || 0;
      } catch (_e) { rec.analyser = null; }
    }
    this._isolateSwells.push(rec);
    this._isolateJackByTag.set(key + '|' + portId, rec);
    this._applyJackSwell(rec);
  }

  // RMS of a jack's tapped signal, softly saturated to 0..1 (audio loudness, |CV|, and
  // a trigger's brief spike all land on this scale).
  _jackLevel(rec) {
    if (!rec.analyser) return 0;
    rec.analyser.getFloatTimeDomainData(rec.buf);
    let s = 0; for (let i = 0; i < rec.buf.length; i++) s += rec.buf[i] * rec.buf[i];
    const rms = Math.sqrt(s / rec.buf.length);
    return rms / (rms + 0.25);
  }

  // Scale a swelled jack about its centre: a base swell plus a signal-driven bump.
  _applyJackSwell(rec) {
    const scale = 1.12 + rec.level * 0.55;
    const swell = `translate(${r2(rec.cx)} ${r2(rec.cy)}) scale(${r2(scale)}) translate(${r2(-rec.cx)} ${r2(-rec.cy)})`;
    rec.el.setAttribute('transform', rec.tf ? `${rec.tf} ${swell}` : swell);
  }

  // Per frame while isolating (called from the flow loop): breathe every terminal by
  // its live level, and crawl each cable's dashes at a speed set by its SOURCE signal —
  // so CV flow and trigger pulses track the real signal, not the fixed clock.
  _tickIsolate(dt) {
    for (const rec of this._isolateSwells) {
      const target = this._jackLevel(rec);
      rec.level = rec.level * 0.7 + target * 0.3;   // smooth the breathe
      this._applyJackSwell(rec);
    }
    for (const p of this.cables.querySelectorAll('.flow-dash')) {
      const src = this._isolateJackByTag.get(p.dataset.src);
      const lvl = src ? src.level : 0;
      const off = (this._isolateOffsets.get(p.dataset.edge) || 0) - FLOW_SPEED * (0.15 + lvl * 1.8) * dt;
      this._isolateOffsets.set(p.dataset.edge, off);
      p.setAttribute('stroke-dashoffset', r2(off));
    }
  }

  isIsolating() { return !!this._isolateNet; }

  _exitIsolate() {
    if (!this._isolateNet && !this._isolateSwells.length) return;
    this._clearIsolateSwells();
    this._clearControlHalos();
    this._isolateJackByTag = new Map();
    this._isolateOffsets = new Map();
    this._isolateNet = null;
    this._isolateSections = null;
    this._isolateOrigin = null;
    if (this._isolateEsc) { document.removeEventListener('keydown', this._isolateEsc); this._isolateEsc = null; }
    this._drawCables();
  }

  // The crawl offset (content mm) from one running clock, so the dashes drift
  // continuously even though _drawCables rebuilds the dash paths constantly.
  _flowOffset() {
    if (this._flowT0 == null) this._flowT0 = performance.now();
    return -((performance.now() - this._flowT0) / 1000) * FLOW_SPEED;
  }

  // The flow-dashes animate on every cable, always, so this loop runs continuously
  // once started (from the constructor) — not gated on net-explore mode.
  _startFlow() {
    if (this._flowRaf) return;
    this._flowT0 = performance.now();
    this._flowLast = this._flowT0;
    const tick = (now) => {
      const t = now || performance.now();
      const dt = Math.min(0.05, (t - this._flowLast) / 1000);
      this._flowLast = t;
      if (this._isolateNet) {
        this._tickIsolate(dt);   // isolate: per-terminal breathe + per-cable signal-driven crawl
      } else {
        const off = r2(this._flowOffset());
        for (const p of this.cables.querySelectorAll('.flow-dash')) p.setAttribute('stroke-dashoffset', off);
      }
      this._flowRaf = requestAnimationFrame(tick);
    };
    this._flowRaf = requestAnimationFrame(tick);
  }

  // ---- floating signal scopes (transient probes) ----
  // A small oscilloscope you attach to a port to watch its signal. Armed from the
  // toolbar, then a drag off a port drops one there. Auto-ranging (no controls);
  // it auto-switches between a triggered audio waveform and a scrolling history for
  // slow CV/envelopes/gates. Callout: a ring around the port + a line to the scope.
  // Not part of the patch — never serialized.
  setScopeArm(on) { this._scopeArm = !!on; document.body.classList.toggle('arming-scope', this._scopeArm); this.onScopeArm(this._scopeArm); }
  toggleScopeArm() { this.setScopeArm(!this._scopeArm); }

  // Where a click-shown viewer (scope / ear monitor) lands: immediately RIGHT of the
  // menu, vertically centred on the pointer, so the middle of its left edge sits as
  // close to the pointer as it can without the menu obscuring it. Flips to the left if
  // there's no room on the right; clamped to stay on-screen. (px,py) = pie centre.
  _viewerSpot(px, py, w, h) {
    const pad = 6, clear = 34;   // just past the pie's outer edge (~30)
    let x = px + clear;                       // right of the menu
    const y = py - h / 2;                     // vertically centred on the pointer
    if (x + w > window.innerWidth - pad) x = px - clear - w;   // no room right → left of the menu
    x = Math.max(pad, x);
    return { x, y: Math.max(pad, Math.min(window.innerHeight - pad - h, y)) };
  }

  // A click on a terminal → the terminal pie (scope NE, listen SE). A CLICK on a wedge
  // shows a TEMPORARY viewer (a live scope / ear monitor) beside the menu — a quick
  // look that is removed when the menu closes (a second click also hides it). The only
  // way to keep one is to PRESS the wedge and drag out through the circle, which drops
  // a permanent instance where you release.
  _onJackContextMenu(e, key, portId) {
    e.preventDefault(); e.stopPropagation();
    const ox = e.clientX, oy = e.clientY;
    let tempScope = null, tempMon = null;
    openPieMenu({
      x: ox, y: oy,
      onClose: () => {   // temporary views never outlive the menu
        if (tempScope) { this._closeScope(tempScope); tempScope = null; }
        if (tempMon) { this._closeMonitor(tempMon); tempMon = null; }
      },
      segments: [
        {
          // Hover: a temporary scope beside the menu. Commit (click or cross-out): carry
          // a permanent one out, following the pointer, dropped on the next click.
          dir: 'NE', icon: SCOPE_ICON, label: 'scope',
          onPeekStart: () => { if (!tempScope) { const p = this._viewerSpot(ox, oy, 246, 92); tempScope = this._createScope(key, portId, p.x, p.y, false); } },
          onPeekEnd: () => { if (tempScope) { this._closeScope(tempScope); tempScope = null; } },
          commit: (ctx) => this._carryScope(this._createScope(key, portId, ctx.x, ctx.y), { clientX: ctx.x, clientY: ctx.y }, 'up', ox),
        },
        {
          // Hover: a temporary ear monitor (plays). Commit: carry a permanent one out.
          dir: 'S', icon: EAR_ICON, label: 'listen',
          onPeekStart: () => { if (!tempMon) { const p = this._viewerSpot(ox, oy, 34, 34); tempMon = this._createMonitor(key, portId, p.x, p.y, false); } },
          onPeekEnd: () => { if (tempMon) { this._closeMonitor(tempMon); tempMon = null; } },
          commit: (ctx) => this._carryMonitor(this._createMonitor(key, portId, ctx.x, ctx.y), { clientX: ctx.x, clientY: ctx.y }, 'up'),
        },
        // What feeds this (top): hover shows the upstream subnet momentarily; a click
        // latches it (peeking is cleared on commit so it isn't torn down).
        { dir: 'N', icon: NET_ICON, label: 'what feeds this',
          onPeekStart: () => this._isolateSubnet(key, portId),
          onPeekEnd: () => this._exitIsolate(),
          commit: () => {} },
        // Pull a cable (lower-left): entering shows a PREVIEW cord from the terminal to
        // the cursor. Pull it OUT past the pie's edge (any direction but back to centre)
        // and it becomes a real sticky cord that follows the cursor (click a jack to
        // connect, Escape/right-click to cancel). Back to the centre cancels.
        { dir: 'SW', icon: CABLE_DROOP_ICON, label: 'pull a cable', capture: true,
          onPeekStart: (ctx) => { this._startCablePreview(key, portId); this._updateCablePreview(ctx.x, ctx.y); },
          onPeekMove: (ctx) => this._updateCablePreview(ctx.x, ctx.y),
          onPeekEnd: () => this._endCablePreview(),
          commit: (ctx) => { this._endCablePreview(); this._startStickyCable(key, portId, ctx.x, ctx.y); } },
      ],
    });
  }

  // The audio node + output index to tap for a port: an output taps itself; an
  // input taps whatever source feeds it (the incoming cable), else nothing.
  _probeTap(key, portId) {
    const ep = this._ep(key, portId);
    if (!ep || !ep.instance) return null;
    if (ep.meta.dir === 'out') return ep.instance.getOutput ? ep.instance.getOutput(portId) : null;
    const edge = this.patchbay.list().find((e) => e.dst.key === key && e.dst.portId === portId);
    return edge ? edge.out : null;
  }

  _scopeOverlay() {
    if (!this._scopeOv) {
      const svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('class', 'scope-callouts');
      document.body.appendChild(svg);
      this._scopeOv = svg;
    }
    return this._scopeOv;
  }

  // Armed drag off a port: track to a drop point, drop a scope probing this port.
  // Mouse-down on a port while armed: loop the port and drag out a scope-sized frame
  // (with its callout) so you can see where the scope will land; it appears there on
  // release.
  // Drag a scope frame out and drop it. mode 'down' places it on the next pointer
  // RELEASE (dragged out with a button held); mode 'up' places it on the next
  // CLICK (hovered out of the pie with no button, tool now follows the cursor).
  _placeScope(e, key, portId, mode = 'down') {
    let cx = e.clientX, cy = e.clientY;
    const ov = this._scopeOverlay();
    const col = this.dark ? '#ffffff' : '#000000';
    const ring = document.createElementNS(SVG_NS, 'circle'); ring.setAttribute('fill', 'none'); ring.setAttribute('stroke', col); ring.setAttribute('stroke-width', '1.8'); ov.appendChild(ring);
    const line = document.createElementNS(SVG_NS, 'line'); line.setAttribute('stroke', col); line.setAttribute('stroke-width', '1.8'); ov.appendChild(line);
    const frame = document.createElement('div'); frame.className = 'scope scope-preview';
    frame.style.width = '246px'; frame.style.height = '80px'; document.body.appendChild(frame);
    const jel = this._jackElement(key, portId);
    const place = (fx, fy) => {
      frame.style.left = Math.round(fx) + 'px'; frame.style.top = Math.round(fy) + 'px';
      if (!jel) return;
      const jr = jel.getBoundingClientRect();
      const px = jr.left + jr.width / 2, py = jr.top + jr.height / 2, rr = Math.max(jr.width, jr.height) / 2 + 3;
      ring.setAttribute('cx', r2(px)); ring.setAttribute('cy', r2(py)); ring.setAttribute('r', r2(rr));
      const fr = frame.getBoundingClientRect();
      const ex = px < fr.left + fr.width / 2 ? fr.left : fr.right, ey = py < fr.top + fr.height / 2 ? fr.top : fr.bottom;
      const u = unit(ex - px, ey - py);
      line.setAttribute('x1', r2(px + u.x * rr)); line.setAttribute('y1', r2(py + u.y * rr));
      line.setAttribute('x2', r2(ex)); line.setAttribute('y2', r2(ey));
    };
    place(cx, cy);
    const onMove = (ev) => { cx = ev.clientX; cy = ev.clientY; place(cx, cy); };
    const finish = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointerdown', onClick, true);
      ring.remove(); line.remove(); frame.remove();
      this._createScope(key, portId, cx, cy);
      this.setScopeArm(false);   // one scope per arm
    };
    const onUp = () => finish();
    const onClick = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish(); };
    document.addEventListener('pointermove', onMove, true);
    if (mode === 'up') document.addEventListener('pointerdown', onClick, true);
    else document.addEventListener('pointerup', onUp, true);
  }

  _createScope(key, portId, x, y, showCallout = true) {
    const el = document.createElement('div');
    el.className = 'scope';
    el.style.left = Math.round(x) + 'px';
    el.style.top = Math.round(y) + 'px';
    const canvas = document.createElement('canvas');
    canvas.className = 'scope-canvas';
    canvas.width = 240; canvas.height = 74;
    const close = document.createElement('button');
    close.className = 'scope-close'; close.textContent = '×'; close.title = 'Close';
    const resize = document.createElement('div');
    resize.className = 'scope-resize'; resize.title = 'Drag to resize';
    el.appendChild(canvas); el.appendChild(resize); el.appendChild(close);
    document.body.appendChild(el);

    const an = this.host.ctx.createAnalyser();
    an.fftSize = 16384; an.smoothingTimeConstant = 0;   // ~340ms so low audio-rate waves still hold a few cycles to trigger on
    const sc = {
      key, portId, el, canvas, g2: canvas.getContext('2d'), analyser: an,
      buf: new Float32Array(an.fftSize), hist: new Array(200).fill(null), histIdx: 0,
      hi: null, lo: null, fastVotes: 0, tap: null,
      gainMul: 1, timeMul: 1, gainVel: 0, timeVel: 0, trigger: true, frozen: false, forceMode: 'auto',
      armed: false, recFrames: 0, prevPeak: null, showCallout,
      ring: document.createElementNS(SVG_NS, 'circle'), line: document.createElementNS(SVG_NS, 'line'),
      dot: document.createElement('div'),
    };
    this._scopeTapConnect(sc);
    const ov = this._scopeOverlay();
    sc.line.setAttribute('fill', 'none'); ov.appendChild(sc.line);
    sc.ring.setAttribute('fill', 'none'); sc.ring.style.pointerEvents = 'none'; ov.appendChild(sc.ring);
    // The grab handle is a white dot where the line meets the loop — a reliable HTML
    // target (an SVG hit-ring in a pointer-events:none overlay proved unhittable).
    sc.dot.className = 'scope-dot'; document.body.appendChild(sc.dot);

    close.addEventListener('click', (ev) => { ev.stopPropagation(); this._closeScope(sc); });
    el.addEventListener('pointerdown', (ev) => this._dragScope(ev, sc));
    el.addEventListener('contextmenu', (ev) => this._scopeMenu(ev, sc));
    sc.dot.addEventListener('pointerdown', (ev) => this._regrabScope(ev, sc));
    resize.addEventListener('pointerdown', (ev) => this._resizeScope(ev, sc));
    canvas.addEventListener('wheel', (ev) => this._scopeWheel(ev, sc), { passive: false });

    this._scopes.add(sc);
    this._updateCallout(sc);
    this._startScopeLoop();
    return sc;
  }

  // Carry an already-live scope (created on a pie peek) so it follows the pointer and
  // drops. It hangs by the middle of its LEFT side when the drag went out to the right
  // (scope trails to the right), or by the middle of its RIGHT side when the drag went
  // left — decided by the cross-out direction relative to the pie origin. mode 'down'
  // drops on the next RELEASE (dragged out holding a button); mode 'up' drops on the
  // next CLICK. Escape cancels — the scope is removed.
  _carryScope(sc, e, mode, originX) {
    const w = sc.el.offsetWidth || 246, h = sc.el.offsetHeight || 80;
    const ax = e.clientX >= originX ? 0 : -w;   // right-going: grab left-centre; left-going: grab right-centre
    const place = (px, py) => { sc.el.style.left = Math.round(px + ax) + 'px'; sc.el.style.top = Math.round(py - h / 2) + 'px'; this._updateCallout(sc); };
    place(e.clientX, e.clientY);
    const onMove = (ev) => place(ev.clientX, ev.clientY);
    const finish = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointerdown', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const onUp = () => finish();
    // Clicking back on the terminal it came from cancels the creation (deletes it) —
    // the same "changed my mind" escape a cable drag has when dropped back on its port.
    const onClick = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const drop = this._jackNear(ev.clientX, ev.clientY);
      if (drop && drop.key === sc.key && drop.portId === sc.portId) { this._closeScope(sc); finish(); return; }
      finish();
    };
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this._closeScope(sc); finish(); } };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('keydown', onKey, true);
    if (mode === 'up') document.addEventListener('pointerdown', onClick, true);
    else document.addEventListener('pointerup', onUp, true);
  }

  _scopeTapConnect(sc) {
    const tap = this._probeTap(sc.key, sc.portId);
    if (tap && tap.node) { try { tap.node.connect(sc.analyser, tap.index || 0); sc.tap = tap; } catch (_e) { sc.tap = null; } }
  }
  _scopeTapDisconnect(sc) {
    if (sc.tap && sc.tap.node) { try { sc.tap.node.disconnect(sc.analyser, sc.tap.index || 0); } catch (_e) { /* already gone */ } }
    sc.tap = null;
  }

  _startScopeLoop() {
    if (this._scopeRaf) return;
    const tick = () => {
      if (!this._scopes.size) { this._scopeRaf = null; return; }
      for (const sc of this._scopes) {
        // Momentum wheel: integrate velocity into the multiplier (log space so it
        // zooms evenly), then damp it. Snaps to rest below a floor so it settles.
        if (sc.gainVel) { sc.gainMul = Math.max(0.1, Math.min(24, sc.gainMul * Math.exp(sc.gainVel / 60))); sc.gainVel *= 0.9; if (Math.abs(sc.gainVel) < 2e-3) sc.gainVel = 0; }
        if (sc.timeVel) { sc.timeMul = Math.max(0.25, Math.min(12, sc.timeMul * Math.exp(sc.timeVel / 60))); sc.timeVel *= 0.9; if (Math.abs(sc.timeVel) < 2e-3) sc.timeVel = 0; }
        this._drawScope(sc); if (!sc.regrabbing) this._updateCallout(sc);
      }
      this._scopeRaf = requestAnimationFrame(tick);
    };
    this._scopeRaf = requestAnimationFrame(tick);
  }

  _drawScope(sc) {
    const an = sc.analyser, buf = sc.buf, n = buf.length;
    if (!sc.frozen) an.getFloatTimeDomainData(buf);   // frozen: keep the captured buffer, still redraw so scroll re-scales it
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (let i = 0; i < n; i++) { const v = buf[i]; if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
    const mean = sum / n;
    let cross = 0, prev = buf[0] - mean;
    for (let i = 1; i < n; i++) { const d = buf[i] - mean; if ((d >= 0) !== (prev >= 0)) cross++; prev = d; }
    if (!sc.frozen) {
      sc.fastVotes = Math.max(-8, Math.min(8, sc.fastVotes + (cross >= 2 ? 1 : -1)));   // at least one full cycle → triggerable waveform; else roll
      const DEC = 0.985;
      sc.hi = sc.hi == null ? hi : Math.max(hi, sc.hi * DEC);
      sc.lo = sc.lo == null ? lo : Math.min(lo, sc.lo * DEC);
    }
    const fast = sc.forceMode === 'wave' ? true : sc.forceMode === 'roll' ? false : sc.fastVotes > 0;
    // One-shot: armed, wait for the level to rise through an auto threshold, capture
    // one sweep, then freeze. Fast signals capture a single buffer; slow signals
    // record forward for the full history window so the whole shape is held.
    if (sc.armed) {
      const curPeak = Math.max(Math.abs(hi), Math.abs(lo));
      const ref = sc.hi != null ? Math.max(Math.abs(sc.hi), Math.abs(sc.lo)) : curPeak;
      const level = Math.max(0.02, 0.25 * ref);
      if (sc.recFrames > 0) { if (--sc.recFrames <= 0) { sc.armed = false; sc.frozen = true; } }
      else if (sc.prevPeak != null && sc.prevPeak < level && curPeak >= level) {
        if (fast) { sc.armed = false; sc.frozen = true; }
        else { sc.recFrames = sc.hist.length; sc.hist.fill(null); sc.histIdx = 0; }
      }
      sc.prevPeak = curPeak;
    }
    let rlo = sc.lo != null ? sc.lo : lo, rhi = sc.hi != null ? sc.hi : hi;
    if (rhi - rlo < 1e-3) { rhi = 0.05; rlo = -0.05; }
    const pad = (rhi - rlo) * 0.14; rlo -= pad; rhi += pad;
    const mid = (rlo + rhi) / 2, halfR = (rhi - rlo) / 2 / sc.gainMul;   // vertical-scroll gain zoom
    rlo = mid - halfR; rhi = mid + halfR;
    const W = sc.canvas.width, H = sc.canvas.height, g = sc.g2;
    const yOf = (v) => H - ((v - rlo) / (rhi - rlo)) * H;
    g.clearRect(0, 0, W, H);
    g.strokeStyle = 'rgba(150,160,150,0.28)'; g.lineWidth = 1;
    g.beginPath(); const y0 = yOf(0); g.moveTo(0, y0); g.lineTo(W, y0); g.stroke();
    g.strokeStyle = '#66ffa6'; g.lineWidth = 1.4; g.beginPath();
    if (fast) {
      // Auto timebase: estimate the period from crossings, show ~3 cycles, and
      // trigger on the first rising zero-crossing of the mean so the trace locks.
      const perSamp = n / Math.max(1, cross / 2);                 // samples per cycle (estimate)
      let span = Math.round(perSamp * 3 / sc.timeMul);
      span = Math.max(48, Math.min(n, span));
      let start = 0;
      if (sc.trigger) { const limit = Math.max(1, n - span); for (let i = 1; i < limit; i++) { if (buf[i - 1] - mean < 0 && buf[i] - mean >= 0) { start = i; break; } } }
      const step = Math.max(1, Math.floor(span / (W * 2)));       // decimate to ~2 pts/px
      let first = true;
      for (let i = 0; i < span; i += step) { const x = (i / (span - 1)) * W, y = yOf(buf[start + i]); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y); }
    } else {
      if (!sc.frozen) { const peak = Math.abs(hi) >= Math.abs(lo) ? hi : lo; sc.hist[sc.histIdx] = peak; sc.histIdx = (sc.histIdx + 1) % sc.hist.length; }
      const L = sc.hist.length, show = Math.max(8, Math.min(L, Math.round(L / sc.timeMul)));
      let started = false;
      for (let i = 0; i < show; i++) {
        const v = sc.hist[((sc.histIdx - show + i) % L + L) % L]; if (v == null) continue;
        const x = (i / (show - 1)) * W, y = yOf(v); if (!started) { g.moveTo(x, y); started = true; } else g.lineTo(x, y);
      }
    }
    g.stroke();
  }

  // Scroll on the face feeds a flywheel: vertical spins the gain, horizontal (or
  // shift+wheel) the scan. The scope loop integrates the velocity and bleeds it off,
  // so a flick coasts smoothly to a stop. Rate kept gentle for fine control.
  _scopeWheel(ev, sc) {
    ev.preventDefault(); ev.stopPropagation();
    const norm = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;   // lines/pages → px
    const K = 0.006;
    if (Math.abs(ev.deltaX) > Math.abs(ev.deltaY) || ev.shiftKey) {
      const d = (ev.shiftKey ? ev.deltaY : ev.deltaX) * norm;
      sc.timeVel = Math.max(-3, Math.min(3, sc.timeVel - d * K));
    } else {
      sc.gainVel = Math.max(-3, Math.min(3, sc.gainVel - ev.deltaY * norm * K));
    }
  }

  // Drag the right edge to set the canvas width (resizing clears it; the loop redraws).
  _resizeScope(ev, sc) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const startX = ev.clientX, startW = sc.canvas.width;
    const onMove = (e2) => { sc.canvas.width = Math.round(Math.max(120, Math.min(640, startW + (e2.clientX - startX)))); this._updateCallout(sc); };
    const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }

  _updateCallout(sc) {
    // Click-shown (temporary) viewers show no connection loop or line — the callout
    // running behind the menu reads as clutter. Only dragged-out ones are "connected".
    if (sc.showCallout === false) { sc.ring.setAttribute('r', '0'); sc.line.setAttribute('stroke', 'none'); if (sc.dot) sc.dot.style.display = 'none'; return; }
    const jel = this._jackElement(sc.key, sc.portId);
    const col = this.dark ? '#ffffff' : '#000000';
    const lw = 1.8;
    if (!jel) { sc.ring.setAttribute('r', '0'); sc.line.setAttribute('stroke', 'none'); return; }
    const jr = jel.getBoundingClientRect();
    const px = jr.left + jr.width / 2, py = jr.top + jr.height / 2;
    const rr = Math.max(jr.width, jr.height) / 2 + 3;
    sc.ring.setAttribute('cx', r2(px)); sc.ring.setAttribute('cy', r2(py)); sc.ring.setAttribute('r', r2(rr));
    sc.ring.setAttribute('stroke', col); sc.ring.setAttribute('stroke-width', lw);
    // Line from the loop's scope-facing point to the nearest corner of the scope box.
    const sr = sc.el.getBoundingClientRect();
    const cx = px < sr.left + sr.width / 2 ? sr.left : sr.right;
    const cy = py < sr.top + sr.height / 2 ? sr.top : sr.bottom;
    const u = unit(cx - px, cy - py);
    const jx = px + u.x * rr, jy = py + u.y * rr;   // where the line meets the loop
    sc.line.setAttribute('x1', r2(jx)); sc.line.setAttribute('y1', r2(jy));
    sc.line.setAttribute('x2', r2(cx)); sc.line.setAttribute('y2', r2(cy));
    sc.line.setAttribute('stroke', col); sc.line.setAttribute('stroke-width', lw);
    if (sc.dot) { sc.dot.style.left = r2(jx) + 'px'; sc.dot.style.top = r2(jy) + 'px'; }
  }

  // Press the scope body: a drag repositions it (the callout follows); a click with
  // no drag toggles FREEZE, so you can hold a trace to study it and click to resume.
  _dragScope(ev, sc) {
    if (ev.button !== 0 || ev.target.classList.contains('scope-close') || ev.target.classList.contains('scope-resize')) return;
    ev.preventDefault(); ev.stopPropagation();
    const r = sc.el.getBoundingClientRect();
    const ox = ev.clientX - r.left, oy = ev.clientY - r.top, sx = ev.clientX, sy = ev.clientY;
    let moved = false;
    const onMove = (e2) => {
      if (!moved && Math.hypot(e2.clientX - sx, e2.clientY - sy) < 4) return;
      moved = true;
      sc.el.style.left = Math.round(e2.clientX - ox) + 'px'; sc.el.style.top = Math.round(e2.clientY - oy) + 'px'; this._updateCallout(sc);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
      if (!moved) sc.frozen = !sc.frozen;
    };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }

  // Right-click a scope: trigger mode, display override, reset scaling. (Freeze is a
  // click on the face, not a menu item.)
  _scopeMenu(ev, sc) {
    ev.preventDefault(); ev.stopPropagation();
    const mode = (m, label) => ({ label, checkFn: () => sc.forceMode === m, action: () => { sc.forceMode = m; } });
    this._openMenu(ev.clientX, ev.clientY, [
      { label: sc.armed ? 'Cancel single' : 'Single (arm)', action: () => {
          if (sc.armed) { sc.armed = false; }
          else { sc.armed = true; sc.frozen = false; sc.recFrames = 0; sc.prevPeak = null; sc.hi = sc.lo = null; sc.hist.fill(null); sc.histIdx = 0; }
        } },
      { label: sc.trigger ? 'Free-running' : 'Triggered', action: () => { sc.trigger = !sc.trigger; } },
      { header: true, label: 'Display' },
      mode('auto', 'Auto'), mode('wave', 'Waveform'), mode('roll', 'Roll'),
      { label: 'Reset scaling', action: () => { sc.gainMul = 1; sc.timeMul = 1; sc.gainVel = 0; sc.timeVel = 0; sc.hi = sc.lo = null; } },
    ]);
  }

  // Drag the ring off its port and onto another to re-probe that port; drop it on
  // empty space (not a port) to DISCONNECT the scope from its port.
  _regrabScope(ev, sc) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    sc.regrabbing = true;                  // stop the loop resetting the loop/dot to the old port
    sc.dot.style.pointerEvents = 'none';   // so the drop hit-test finds the jack, not this dot
    const onMove = (e2) => {
      const px = e2.clientX, py = e2.clientY;
      sc.ring.setAttribute('cx', r2(px)); sc.ring.setAttribute('cy', r2(py));
      sc.line.setAttribute('x1', r2(px)); sc.line.setAttribute('y1', r2(py));
      sc.dot.style.left = r2(px) + 'px'; sc.dot.style.top = r2(py) + 'px';
    };
    const onUp = (e2) => {
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
      const drop = this._jackFromPoint(e2.clientX, e2.clientY);
      sc.dot.style.pointerEvents = '';
      if (!drop) { this._closeScope(sc); return; }   // loop dropped on the panel → delete it (like a cable pulled off a terminal)
      this._scopeTapDisconnect(sc); sc.hi = sc.lo = null; sc.hist.fill(null);
      sc.key = drop.key; sc.portId = drop.portId; this._scopeTapConnect(sc);
      sc.regrabbing = false;
      this._updateCallout(sc);
    };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }

  _closeScope(sc) {
    this._scopeTapDisconnect(sc);
    sc.el.remove(); sc.ring.remove(); sc.line.remove(); sc.dot.remove();
    this._scopes.delete(sc);
    if (!this._scopes.size && this._scopeRaf) { cancelAnimationFrame(this._scopeRaf); this._scopeRaf = null; }
  }

  // ---- Ear monitors: solo-listen to one terminal, muting the normal output ----

  _mixerInstance() {
    for (const rec of this.records.values()) if (rec.descriptorId === 'mixer' && rec.instance) return rec.instance;
    return null;
  }

  // The monitor bus: every active ear tap sums here, through a brick-wall limiter that
  // protects ears/speakers from a hot tap, straight to the destination (independent of
  // the mixer, so a terminal can be auditioned even with the master muted).
  _monitorBus() {
    if (!this._monBus) {
      const ctx = this.host.ctx;
      this._monBus = ctx.createGain();
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -6; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.12;
      this._monBus.connect(lim); lim.connect(ctx.destination);
    }
    if (this.host.ctx.resume) this.host.ctx.resume();
    return this._monBus;
  }

  // Duck the mixer's normal output while any monitor is actively listening (connected
  // to a port and not muted), so you hear only the soloed terminal(s).
  _refreshSolo() {
    const mix = this._mixerInstance();
    const active = [...this._monitors].some((m) => m.tap && !m.muted);
    if (mix && mix.setSolo) mix.setSolo(active);
  }

  // Route a terminal's tap into the monitor bus at a level that respects the master
  // output gain; the bus limiter guards against anything much hotter (ear/speaker
  // safety). Muted monitors carry no tap.
  _monTapConnect(m) {
    const mix = this._mixerInstance();
    const base = mix && mix.getParam && mix.getParam('master') ? mix.getParam('master').value : 0.7;
    m.gain.gain.value = base * (m.vol != null ? m.vol : MON_VOL_DEFAULT);
    const tap = this._probeTap(m.key, m.portId);
    if (tap && tap.node) { try { tap.node.connect(m.gain, tap.index || 0); m.tap = tap; } catch (_e) { m.tap = null; } }
    return m.tap;
  }
  _monTapDisconnect(m) {
    if (m.tap && m.tap.node) { try { m.tap.node.disconnect(m.gain, m.tap.index || 0); } catch (_e) { /* gone */ } }
    m.tap = null;
  }

  // A placed ear monitor: a small circle with an ear icon and an X, a callout ring/
  // line back to its terminal, and its tap summed into the monitor bus.
  _createMonitor(key, portId, x, y, showCallout = true) {
    const el = document.createElement('div');
    el.className = 'mon'; el.title = 'Click to mute · drag to move';
    el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
    el.innerHTML = EAR_ICON;
    el.insertAdjacentHTML('afterbegin', this._monArcSvg());   // volume-ramp wedge + limit ticks, behind the ear icon
    const close = document.createElement('button');
    close.className = 'mon-close'; close.textContent = '×'; close.title = 'Remove';
    el.appendChild(close);
    document.body.appendChild(el);
    const g = this.host.ctx.createGain(); g.connect(this._monitorBus());
    // The monitor doubles as a volume knob: an inward tick sweeps min (lower-left) up
    // over the top to max (lower-right); the scroll wheel turns it with knob momentum.
    const tick = document.createElement('div'); tick.className = 'mon-tick'; el.appendChild(tick);
    const m = {
      key, portId, el, gain: g, tap: null, muted: false, showCallout, vol: MON_VOL_DEFAULT, tick,
      volVel: 0, volRaf: null, volLast: 0,
      ring: document.createElementNS(SVG_NS, 'circle'), line: document.createElementNS(SVG_NS, 'line'),
      dot: document.createElement('div'),
    };
    const ov = this._scopeOverlay();
    m.line.setAttribute('fill', 'none'); ov.appendChild(m.line);
    m.ring.setAttribute('fill', 'none'); m.ring.style.pointerEvents = 'none'; ov.appendChild(m.ring);
    m.dot.className = 'scope-dot'; document.body.appendChild(m.dot);   // grab handle at the loop
    this._monTapConnect(m);
    this._drawMonTick(m);
    close.addEventListener('click', (ev) => { ev.stopPropagation(); this._closeMonitor(m); });
    el.addEventListener('pointerdown', (ev) => this._dragMonitor(ev, m));
    el.addEventListener('wheel', (ev) => this._onMonWheel(m, ev), { passive: false });
    m.dot.addEventListener('pointerdown', (ev) => this._regrabMonitor(ev, m));
    this._monitors.add(m);
    this._updateCallout(m);
    this._refreshSolo();
    return m;
  }

  // Set the monitor's volume (0..1): gain = master base × vol, and turn the tick.
  _setMonVol(m, vol) {
    m.vol = clamp01(vol);
    if (!m.muted) {
      const mix = this._mixerInstance();
      const base = mix && mix.getParam && mix.getParam('master') ? mix.getParam('master').value : 0.7;
      try { m.gain.gain.value = base * m.vol; } catch (_e) { /* node gone */ }
    }
    this._drawMonTick(m);
  }
  _drawMonTick(m) {
    if (m.tick) m.tick.style.transform = `rotate(${r2(-135 + m.vol * 270)}deg)`;   // min lower-left → max lower-right
  }
  // The static "this is a volume control" decoration inside a monitor: a wedge hugging
  // the ring's inner edge that tapers from zero thickness at the lower-left limit up over
  // the top to ~2mm at the lower-right limit, plus a tick at each limit of the sweep.
  _monArcSvg() {
    const cx = 17, cy = 17, Rout = 15.3, maxThick = 6, A0 = -135, A1 = 135, N = 36;
    const pt = (deg, r) => { const t = deg * Math.PI / 180; return [cx + r * Math.sin(t), cy - r * Math.cos(t)]; };
    const outer = [], inner = [];
    for (let i = 0; i <= N; i++) { const deg = A0 + (A1 - A0) * i / N; outer.push(pt(deg, Rout)); inner.push(pt(deg, Rout - maxThick * (i / N))); }
    let d = 'M ' + outer.map(([x, y], i) => (i ? 'L ' : '') + r2(x) + ' ' + r2(y)).join(' ');
    for (let i = inner.length - 1; i >= 0; i--) d += ' L ' + r2(inner[i][0]) + ' ' + r2(inner[i][1]);
    d += ' Z';
    const tick = (deg) => { const [x1, y1] = pt(deg, Rout + 1.3); const [x2, y2] = pt(deg, Rout - 3.4); return `M ${r2(x1)} ${r2(y1)} L ${r2(x2)} ${r2(y2)}`; };
    return `<svg class="mon-arc" viewBox="0 0 34 34"><path d="${d}" fill="#bfe6cd" opacity="0.62"/>`
      + `<path d="${tick(A0)} ${tick(A1)}" stroke="#dfeee3" stroke-width="1.5" stroke-linecap="round"/></svg>`;
  }
  // Scroll over a monitor turns its volume knob, with the same momentum/coast as a panel
  // knob (velocity integrated by a rAF loop, bled off by drag).
  _onMonWheel(m, e) {
    if (e.ctrlKey) return;                      // ctrl+wheel is a rack pinch-zoom, not a knob turn
    e.preventDefault(); e.stopPropagation();
    const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
    m.volVel += (-d / 100) * MON_VOL_STEP * MON_VOL_DRAG;   // up (negative delta) raises
    if (m.volVel > MON_VOL_MAXV) m.volVel = MON_VOL_MAXV; else if (m.volVel < -MON_VOL_MAXV) m.volVel = -MON_VOL_MAXV;
    if (!m.volRaf) { m.volLast = performance.now(); m.volRaf = requestAnimationFrame((t) => this._tickMonVol(m, t)); }
  }
  _tickMonVol(m, t) {
    const now = t || performance.now();
    const dt = Math.min(0.05, (now - m.volLast) / 1000);
    m.volLast = now;
    const next = clamp01(m.vol + m.volVel * dt);
    this._setMonVol(m, next);
    m.volVel *= Math.exp(-MON_VOL_DRAG * dt);
    const pinned = (next <= 0 && m.volVel < 0) || (next >= 1 && m.volVel > 0);
    if (Math.abs(m.volVel) > 1e-3 && !pinned) m.volRaf = requestAnimationFrame((tt) => this._tickMonVol(m, tt));
    else { m.volRaf = null; m.volVel = 0; }
  }

  // Drag the ear monitor's loop off its port and onto another to re-listen there; drop
  // it on empty space (not a port) to DISCONNECT the monitor from its port.
  _regrabMonitor(ev, m) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    m.regrabbing = true;
    m.dot.style.pointerEvents = 'none';
    const onMove = (e2) => {
      const px = e2.clientX, py = e2.clientY;
      m.ring.setAttribute('cx', r2(px)); m.ring.setAttribute('cy', r2(py));
      m.line.setAttribute('x1', r2(px)); m.line.setAttribute('y1', r2(py));
      m.dot.style.left = r2(px) + 'px'; m.dot.style.top = r2(py) + 'px';
    };
    const onUp = (e2) => {
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
      const drop = this._jackFromPoint(e2.clientX, e2.clientY);
      m.dot.style.pointerEvents = '';
      if (!drop) { this._closeMonitor(m); return; }   // loop dropped on the panel → delete it (like a cable pulled off a terminal)
      this._monTapDisconnect(m);
      m.key = drop.key; m.portId = drop.portId; if (!m.muted) this._monTapConnect(m);
      m.regrabbing = false;
      this._updateCallout(m);
      this._refreshSolo();
    };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }

  _closeMonitor(m) {
    if (m.volRaf) { cancelAnimationFrame(m.volRaf); m.volRaf = null; }
    this._monTapDisconnect(m);
    try { m.gain.disconnect(); } catch (_e) { /* gone */ }
    m.el.remove(); m.ring.remove(); m.line.remove(); m.dot.remove();
    this._monitors.delete(m);
    this._refreshSolo();
  }

  // Click the circle (no drag) → mute/unmute (pull its tap from the mix); a drag
  // repositions it, the callout following.
  _dragMonitor(ev, m) {
    if (ev.button !== 0 || ev.target.classList.contains('mon-close')) return;
    ev.preventDefault(); ev.stopPropagation();
    const r = m.el.getBoundingClientRect();
    const ox = ev.clientX - r.left, oy = ev.clientY - r.top, sx = ev.clientX, sy = ev.clientY;
    let moved = false;
    const onMove = (e2) => {
      if (!moved && Math.hypot(e2.clientX - sx, e2.clientY - sy) < 4) return;
      moved = true;
      m.el.style.left = Math.round(e2.clientX - ox) + 'px'; m.el.style.top = Math.round(e2.clientY - oy) + 'px'; this._updateCallout(m);
    };
    const onUp = () => {
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
      if (!moved) this._toggleMonMute(m);
    };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }

  _toggleMonMute(m) {
    m.muted = !m.muted;
    m.el.classList.toggle('mon-muted', m.muted);
    if (m.muted) this._monTapDisconnect(m); else this._monTapConnect(m);
  }

  // Carry a freshly-placed monitor circle out to be dropped (see _carryScope): it
  // follows the pointer by its centre. Escape cancels — the monitor is removed.
  _carryMonitor(m, e, mode) {
    const w = m.el.offsetWidth || 34, h = m.el.offsetHeight || 34;
    const place = (px, py) => { m.el.style.left = Math.round(px - w / 2) + 'px'; m.el.style.top = Math.round(py - h / 2) + 'px'; this._updateCallout(m); };
    place(e.clientX, e.clientY);
    const onMove = (ev) => place(ev.clientX, ev.clientY);
    const finish = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointerdown', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const onUp = () => finish();
    // Clicking back on its terminal cancels the creation (deletes it) — as a cable drag
    // does when dropped back on its port.
    const onClick = (ev) => {
      ev.preventDefault(); ev.stopPropagation();
      const drop = this._jackNear(ev.clientX, ev.clientY);
      if (drop && drop.key === m.key && drop.portId === m.portId) { this._closeMonitor(m); finish(); return; }
      finish();
    };
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this._closeMonitor(m); finish(); } };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('keydown', onKey, true);
    if (mode === 'up') document.addEventListener('pointerdown', onClick, true);
    else document.addEventListener('pointerup', onUp, true);
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

    // An input takes one cable: patchbay.connect rejects a drop onto an occupied
    // input (moving a cord is done by grabbing its stub, not by dropping over it).
    const initialDepth = (dst.meta.via && dst.rec) ? dst.rec.values.get(dst.meta.via) : undefined;
    const res = this.patchbay.connect(
      { key: src.key, instance: src.instance, descriptorId: src.descriptorId, portId: src.portId },
      { key: dst.key, instance: dst.instance, descriptorId: dst.descriptorId, portId: dst.portId },
      initialDepth,
    );
    if (res.ok) { this._drawCables(); this.onChange(); return res.edge; }
    return null;
  }

  _onPinch(e) {
    e.preventDefault();
    e.stopPropagation();
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

  // The panel URL for the current mode: dark modules load the generated
  // <name>.dark.svg beside the light <name>.svg.
  _panelUrl(type) {
    return this.dark ? type.panelUrl.replace(/\.svg$/, '.dark.svg') : type.panelUrl;
  }

  // Put a freshly loaded panel into a record's element and (re)bind its controls
  // and jacks. Used both when a module is created and when its skin is swapped
  // for a mode change — the audio instance and the record identity persist, so
  // only the faceplate and its per-element handlers are replaced.
  _skinModule(rec, panel) {
    const el = rec.el;
    while (el.firstChild) el.removeChild(el.firstChild);
    const svg = document.adoptNode(panel.svg);
    const vb = (svg.getAttribute('viewBox') || '0 0 171 128.5').split(/\s+/).map(Number);
    rec.panelWmm = vb[2];
    svg.removeAttribute('width');
    svg.removeAttribute('height');
    svg.style.width = '100%';
    svg.style.height = '100%';
    svg.style.display = 'block';
    el.appendChild(svg);
    rec.panel = panel;
    for (const b of panel.controls.values()) {
      const v = rec.values.get(b.id);
      if (v !== undefined) showValue(b, v);
      const isMasterEnable = rec.pinned && b.id === 'masterMute';   // the mixer's master lamp
      attachControlInteraction(b, {
        get: () => rec.values.get(b.id),
        // The master enable and the transport are one state: route the lamp through
        // setSound so toggling it here also flips the pie/toolbar (and vice versa).
        set: (val) => { if (isMasterEnable) this.setSound(val === 'on'); else this._setParam(rec, b.id, val); },
      });
      b.group.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    // Jacks: pointerdown drags a cord (patching). The data-jack-* attributes let
    // a dropped cord hit-test the jack it lands on. stopPropagation (in the
    // handler) keeps a jack press from starting a module drag.
    for (const [portId, port] of panel.ports) {
      port.element.style.cursor = 'crosshair';
      port.element.dataset.jackKey = rec.key;
      port.element.dataset.jackPort = portId;
      port.element.addEventListener('pointerdown', (e) => this._onJackPointerDown(e, rec.key, portId));
      port.element.addEventListener('contextmenu', (e) => this._onJackContextMenu(e, rec.key, portId));
    }
    // The vertical title up the left edge: right-click it for the delete pie.
    const title = svg.querySelector('.module-title');
    if (title) {
      title.style.cursor = 'context-menu';
      title.addEventListener('contextmenu', (e) => this._onTitleContextMenu(e, rec));
    }
  }

  // opts.pinned marks a singleton the user can drag but not delete (the mixer),
  // and opts.key forces its record key (so it stays the stable "mixer" patch
  // endpoint across sessions).
  async addModule(descriptorId, rowIndex, xMm, opts = {}) {
    const type = this.moduleTypes.find((t) => t.descriptorId === descriptorId);
    if (!type) return null;
    rowIndex = Math.max(0, Math.min(this.rowCount - 1, rowIndex | 0));

    const { instanceId, instance } = await this.host.instantiate(descriptorId);
    const panel = await loadPanel(this._panelUrl(type), type.descriptor, { dark: this.dark });

    const el = document.createElement('div');
    el.className = 'rack-module';
    const rec = {
      key: opts.key || ('m' + (this._seq++)), descriptorId, name: type.name,
      x: Math.max(0, xMm || 0), row: rowIndex, pinned: !!opts.pinned,
      instanceId, instance, panel: null, el, panelWmm: 0, values: new Map(),
    };
    el.dataset.key = rec.key;
    for (const p of type.descriptor.params) rec.values.set(p.id, p.default);
    this._skinModule(rec, panel);
    for (const [id, v] of rec.values) if (instance.supports(id)) instance.setParam(id, v);

    // Module-level handlers live on the wrapper element, so they survive a skin swap.
    el.addEventListener('pointerdown', (e) => this._startDrag(e, rec));
    el.addEventListener('contextmenu', (e) => this._onModuleContextMenu(e, rec));
    el.addEventListener('pointerenter', (ev) => { this._hoverRec = rec; this.onSelect(rec); if (this._netMode && !this._isolateNet) this._netOrigin = this._netOriginAt(rec, ev.clientX, ev.clientY); this._drawCables(); });
    // Moving within a module retargets the hover net highlight to the module (or the
    // quad channel) under the pointer — suspended while isolating a subnet.
    el.addEventListener('pointermove', (ev) => { if (!this._netMode || this._isolateNet) return; const o = this._netOriginAt(rec, ev.clientX, ev.clientY); if (o !== this._netOrigin) { this._netOrigin = o; this._drawCables(); } });
    el.addEventListener('pointerleave', () => { if (this._hoverRec === rec) { this._hoverRec = null; if (this._netMode && !this._isolateNet) this._netOrigin = null; this._drawCables(); } });

    this.records.set(rec.key, rec);
    this.rows[rowIndex].push(rec);
    this._resolveRow(this.rows[rowIndex]);
    this._rowEls[rowIndex].appendChild(el);
    this.relayout();
    this.onChange();
    return rec;
  }

  isDark() { return this.dark; }

  // Swap every module's faceplate to the given mode, preserving audio, wiring,
  // and every knob value (only the skin and its per-element handlers change).
  async setDarkMode(dark) {
    dark = !!dark;
    if (dark === this.dark) return;
    this.dark = dark;
    for (const rec of this.records.values()) {
      const type = this.moduleTypes.find((t) => t.descriptorId === rec.descriptorId);
      if (!type) continue;
      const panel = await loadPanel(this._panelUrl(type), type.descriptor, { dark });
      this._skinModule(rec, panel);
    }
    this.relayout();
    this._drawCables();
  }

  _setParam(rec, id, value) {
    rec.values.set(id, value);
    if (rec.instance.supports(id)) rec.instance.setParam(id, value);
    const b = rec.panel.controls.get(id);
    if (b) showValue(b, value);
    this.patchbay.setDepth(rec.key, id, value);   // if this knob is a cord's depth control
    this.onChange();                              // a knob/switch change dirties the patch
  }

  deleteModule(rec) {
    if (this._hoverRec === rec) this._hoverRec = null;
    if (this._netOrigin && this._netOrigin.split(':')[0] === rec.key) this._netOrigin = null;
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

  // ---- undo / redo: cable connect/disconnect + module add/delete (NOT knob values) ----
  // Each user action pushes a { undo, redo } pair; undo()/redo() move entries between
  // the two stacks and a fresh action clears the redo stack. Ops work from snapshots
  // and keys (not live record refs), so an entry can be replayed in either direction.

  _pushUR(entry) { this._undoStack.push(entry); this._redoStack = []; }
  canUndo() { return this._undoStack.length > 0; }
  canRedo() { return this._redoStack.length > 0; }
  async undo() { const e = this._undoStack.pop(); if (!e) return; await e.undo(); this._redoStack.push(e); }
  async redo() { const e = this._redoStack.pop(); if (!e) return; await e.redo(); this._undoStack.push(e); }

  _edgeSnapshot(e) {
    return { src: { key: e.src.key, portId: e.src.portId }, dst: { key: e.dst.key, portId: e.dst.portId }, bow: e.bow };
  }
  // Reconnect a snapshotted cable. Its depth follows the destination knob (untouched
  // by undo/redo); the bow is carried back.
  _restoreCable(snap) {
    const e = this._tryConnect(snap.src, snap.dst);
    if (e && snap.bow != null) { e.bow = snap.bow; this._drawCables(); }
    return e;
  }
  // Remove the live cable matching a snapshot's endpoints.
  _removeCable(snap) {
    const e = this.patchbay.list().find((x) => x.src.key === snap.src.key && x.src.portId === snap.src.portId && x.dst.key === snap.dst.key && x.dst.portId === snap.dst.portId);
    if (e) { this.patchbay.disconnect(e); this._drawCables(); this.onChange(); }
  }
  _disconnectAll() {
    for (const e of [...this.patchbay.list()]) this.patchbay.disconnect(e);
    this._exitIsolate(); this._drawCables(); this.onChange();
  }
  _cablesOf(key) {
    return this.patchbay.list().filter((e) => e.src.key === key || e.dst.key === key).map((e) => this._edgeSnapshot(e));
  }
  _moduleSnap(rec) {
    return { key: rec.key, descriptorId: rec.descriptorId, row: rec.row, x: rec.x, params: new Map(rec.values), cables: this._cablesOf(rec.key) };
  }
  async _reAddModule(snap) {
    const re = await this.addModule(snap.descriptorId, snap.row, snap.x, { key: snap.key });
    if (re) for (const [id, v] of snap.params) this._setParam(re, id, v);
    for (const c of snap.cables) this._restoreCable(c);
    return re;
  }

  // Record that a cable was just created.
  _recordCableAdd(edge) {
    if (!edge) return edge;
    const s = this._edgeSnapshot(edge);
    this._pushUR({ undo: () => this._removeCable(s), redo: () => this._restoreCable(s) });
    return edge;
  }

  // Delete a module (with its cables + own knob values restorable). Pinned = no-op.
  _deleteModuleWithUndo(rec) {
    if (rec.pinned) return;
    let snap = this._moduleSnap(rec);
    this.deleteModule(rec);
    this._pushUR({
      undo: async () => { await this._reAddModule(snap); },
      redo: () => { const r = this.records.get(snap.key); if (r) { snap = this._moduleSnap(r); this.deleteModule(r); } },
    });
  }

  // Add a module (user action) and record it.
  async _addModuleWithUndo(descriptorId, rowIndex, xMm) {
    const rec = await this.addModule(descriptorId, rowIndex, xMm);
    if (!rec) return rec;
    const key = rec.key;
    let snap = null;
    this._pushUR({
      undo: () => { const r = this.records.get(key); if (r) { snap = this._moduleSnap(r); this.deleteModule(r); } },
      redo: async () => { if (snap) await this._reAddModule(snap); },
    });
    return rec;
  }

  // ---- control (knob/switch) reset, used by the clear-patch command ----
  // Every module is reset, the pinned mixer included. onControlsReset lets the host
  // resync its toolbar mirrors (master knob) and reconcile the master mute with the
  // On/Off transport, so resetting masterMute can't leave the audio and button out of
  // step.
  _paramSnapshotAll() {
    const out = [];
    for (const rec of this.records.values()) out.push({ key: rec.key, values: new Map(rec.values) });
    return out;
  }
  _restoreParams(snaps) {
    for (const s of snaps) { const rec = this.records.get(s.key); if (rec) for (const [id, v] of s.values) this._setParam(rec, id, v); }
    if (this.onControlsReset) this.onControlsReset();
  }
  // Set every control back to its descriptor default. Returns whether anything moved.
  _resetAllControls() {
    let changed = false;
    for (const rec of this.records.values()) {
      const type = this.moduleTypes.find((t) => t.descriptorId === rec.descriptorId);
      if (!type) continue;
      for (const p of type.descriptor.params) if (rec.values.get(p.id) !== p.default) { this._setParam(rec, p.id, p.default); changed = true; }
    }
    if (this.onControlsReset) this.onControlsReset();
    return changed;
  }
  _anyControlChanged() {
    for (const rec of this.records.values()) {
      const type = this.moduleTypes.find((t) => t.descriptorId === rec.descriptorId);
      if (!type) continue;
      for (const p of type.descriptor.params) if (rec.values.get(p.id) !== p.default) return true;
    }
    return false;
  }

  // Fresh-start the patch in one undoable step: pull EVERY cable AND reset every
  // (non-pinned) knob/switch to its default. Guarded by confirmDeleteAllCables().
  deleteAllCables() {
    const cableSnaps = this.patchbay.list().map((e) => this._edgeSnapshot(e));
    const paramSnaps = this._paramSnapshotAll();
    this._disconnectAll();
    const knobsChanged = this._resetAllControls();
    if (!cableSnaps.length && !knobsChanged) return;   // nothing happened → no undo entry
    this._pushUR({
      undo: () => { for (const s of cableSnaps) this._restoreCable(s); this._restoreParams(paramSnaps); },
      redo: () => { this._disconnectAll(); this._resetAllControls(); },
    });
  }
  confirmDeleteAllCables() {
    if (!this.patchbay.list().length && !this._anyControlChanged()) return;
    this._confirm('Delete all connections and reset every control to its default?', 'Reset all', () => this.deleteAllCables());
  }

  // A small centred confirm dialog for destructive commands. Enter/click Yes runs it;
  // Escape / click-away / Cancel dismisses.
  _confirm(message, yesLabel, onYes) {
    const overlay = document.createElement('div'); overlay.className = 'confirm-overlay';
    const box = document.createElement('div'); box.className = 'confirm-box';
    const msg = document.createElement('div'); msg.className = 'confirm-msg'; msg.textContent = message;
    const btns = document.createElement('div'); btns.className = 'confirm-btns';
    const no = document.createElement('button'); no.className = 'confirm-btn'; no.textContent = 'Cancel';
    const yes = document.createElement('button'); yes.className = 'confirm-btn confirm-danger'; yes.textContent = yesLabel;
    btns.appendChild(no); btns.appendChild(yes);
    box.appendChild(msg); box.appendChild(btns); overlay.appendChild(box); document.body.appendChild(overlay);
    const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } else if (e.key === 'Enter') { e.preventDefault(); close(); onYes(); } };
    no.addEventListener('click', close);
    yes.addEventListener('click', () => { close(); onYes(); });
    overlay.addEventListener('pointerdown', (e) => { if (e.target === overlay) close(); });
    document.addEventListener('keydown', onKey, true);
    yes.focus();
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
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
      rec.el.classList.remove('dragging');
      ghost.style.display = 'none';
      if (moved) { this._moveModule(rec, dropRow, dropX); return; }
      if (this._isolateNet) { this._exitIsolate(); return; }   // a left click on empty faceplate leaves isolate mode
      // A clean left click opens the pie (same as a right-click): the title strip's
      // delete pie, otherwise the panel pie.
      if (ev.target && ev.target.closest && ev.target.closest('.module-title')) this._onTitleContextMenu(ev, rec);
      else this._onModuleContextMenu(ev, rec);
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
    const cursorX = this._xUnderCursor(this._rowEls[rowIndex], e.clientX);
    const xMm = this._snapLeftX(rowIndex, cursorX);
    const items = this.moduleTypes.filter((t) => !t.hidden).map((t) => ({
      label: `Add ${t.name}`,
      action: () => this._addModuleWithUndo(t.descriptorId, rowIndex, xMm),
    }));
    this._openMenu(e.clientX, e.clientY, items);
  }

  // A newly added module packs against the nearest module to the left of the
  // cursor (its right edge), or the row's left edge if there's none — no manual
  // sliding to close the gap.
  _snapLeftX(rowIndex, cursorX) {
    let x = 0;
    for (const rec of this.moduleRecords()) {
      if (rec.row !== rowIndex) continue;
      const right = rec.x + (rec.panelWmm || 0);
      if (right <= cursorX && right > x) x = right;
    }
    return x;
  }

  // The panel pie: global actions only. Start/stop (bottom) toggles the transport
  // when activated; the app menu (upper-left) opens. Delete lives on the module's
  // vertical title (see _onTitleContextMenu).
  _onModuleContextMenu(e, rec) {
    e.preventDefault();
    e.stopPropagation();
    if (e.target.closest && e.target.closest('[data-wcoast-param]')) return;   // no pie over a knob or any control
    // The sound wedge mirrors the mixer's master-enable: read it straight from the mixer
    // record each time the pie opens, so the LED always matches the mixer's button.
    const mixEnable = this.records.get('mixer');
    const pre = mixEnable ? mixEnable.values.get('masterMute') === 'on' : this.isPlaying();
    // Sound (S): hover auditions the patch momentarily; a click latches sound on/off
    // (unified with the mixer master enable). The button LED lights whenever sound is
    // actually playing — the latched on-state AND during a hover-peek (sound plays then
    // too), so its illumination always tracks the audio. `plain`: the wedge itself never
    // tints (black pie background); only the LED shows state.
    const soundSeg = {
      dir: 'S', icon: SOUND_BTN_ICON(pre), label: pre ? 'sound on' : 'sound off', plain: true,
      // Hover previews the TOGGLE (the opposite of the latched state): the LED and the
      // audio both show what clicking would do — light+play when off, dim+silence when on.
      onPeekStart: () => { this.soundPeek(!pre); if (soundSeg.iconEl) soundSeg.iconEl.innerHTML = SOUND_BTN_ICON(!pre); },
      onPeekEnd: () => { this.soundPeek(pre); if (soundSeg.iconEl) soundSeg.iconEl.innerHTML = SOUND_BTN_ICON(pre); },
      commit: () => this.setSound(!this.isPlaying()),
    };
    openPieMenu({
      x: e.clientX, y: e.clientY,
      segments: [
        // App menu (N, top): hovering pops the menu beside the pointer, over the pie;
        // moving onto it (or a click) commits and the pie closes, back-to-centre cancels.
        { dir: 'N', icon: APPMENU_ICON, label: 'menu',
          onPeekStart: (ctx) => this._appMenuPeek(ctx),
          onPeekEnd: () => this._appMenuPeekEnd(),
          commit: () => this._finalizeAppMenu() },
        soundSeg,
      ],
    });
  }

  // Right-click a module's vertical title (its left edge) → delete. It only fires on
  // cross-out (a deliberate drag past the rim), so a stray hover can't remove it. The
  // pinned mixer can't be deleted, so no pie.
  _onTitleContextMenu(e, rec) {
    e.preventDefault();
    e.stopPropagation();
    if (rec.pinned) return;
    openPieMenu({
      x: e.clientX, y: e.clientY,
      // Delete has no peek — it only fires on a deliberate click, never on hover.
      segments: [{ dir: 'NE', icon: TRASH_ICON, label: `delete ${rec.name}`, commit: () => this._deleteModuleWithUndo(rec) }],
    });
  }

  // items: { label, action } clickable rows, plus optional { header:true } group
  // labels and optional { checked, dim } for the connect menu's checkmark/dimming.
  _openMenu(x, y, items) {
    this._closeMenu();
    const menu = document.createElement('div');
    menu.className = 'rack-menu' + (this.isDark() ? ' theme-dark' : '');   // border: dark line in light mode, light line in dark
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
      if (it.submenu) {
        // A heading with a submenu (File/Edit/View): a right arrow, and hovering (or
        // clicking) it opens its submenu to the side, Electron-style.
        item.classList.add('has-sub');
        const arrow = document.createElement('span');
        arrow.className = 'rack-menu-arrow'; arrow.textContent = '›';
        item.appendChild(arrow);
        item.addEventListener('mouseenter', () => this._openSubmenu(item, it.submenu));
        item.addEventListener('click', (e) => { e.stopPropagation(); this._openSubmenu(item, it.submenu); });
      } else if (it.disabled) {
        item.classList.add('disabled');
        item.addEventListener('mouseenter', () => this._closeSubs());
      } else {
        // A selection closes the menu, then runs — one pick is the common case.
        item.addEventListener('click', () => { this._closeMenu(); it.action(); });
        item.addEventListener('mouseenter', () => this._closeSubs());
      }
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
    top = y;   // anchor the menu at the click; never centre a checked row at the pointer (it can push the top off-screen)
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
    this._closeSubs();
    if (this._menuEl) { this._menuEl.remove(); this._menuEl = null; }
  }

  // ---- app menu as a pie peek (panel-pie top wedge) ----
  // Hovering the top wedge previews the app menu just to the side of the pointer, drawn
  // OVER the pie (leaving the pie centre visible). Moving the pointer onto the menu (its
  // pointerenter) commits — the pie closes and the menu stays live where it is; moving
  // back to the pie centre cancels (onPeekEnd). A click on the wedge also commits.
  _appMenuPeek(ctx) {
    this._appMenuHeld = false;
    this.onAppMenu(0, 0);                 // build+open (rack-app fills the items); we reposition
    const el = this._menuEl; if (!el) return;
    el.classList.add('app-menu-peek');    // raised above the pie, but still a preview
    this._positionAppMenuBeside(el, ctx);
    el.addEventListener('pointerenter', () => this._finalizeAppMenu(), { once: true });   // move onto it → keep it
    this._appMenuPeekEl = el;
  }
  // Cancel: only tears the menu down if it wasn't committed (pointer went back to centre).
  _appMenuPeekEnd() {
    if (this._appMenuHeld) { this._appMenuPeekEl = null; return; }
    if (this._appMenuPeekEl) { this._closeMenu(); this._appMenuPeekEl = null; }
  }
  // Commit: keep the menu, drop its preview styling (so it's a normal live menu), and
  // close the pie. Setting _appMenuHeld first makes the pie's onPeekEnd leave it alone.
  _finalizeAppMenu() {
    if (!this._appMenuPeekEl) return;
    this._appMenuHeld = true;
    this._appMenuPeekEl.classList.remove('app-menu-peek');
    this._appMenuPeekEl = null;
    closePieMenu();
  }
  // Place the menu ~2mm to the RIGHT of the pointer (flipping LEFT if it won't fit),
  // clamped fully on-screen, drawn over the pie.
  _positionAppMenuBeside(el, ctx) {
    const pad = 8, gap = 8, vw = window.innerWidth, vh = window.innerHeight;   // gap ~2mm
    const mw = el.offsetWidth, mh = el.offsetHeight;
    let left = ctx.x + gap;
    if (left + mw > vw - pad) left = ctx.x - gap - mw;   // no room right → go left
    left = Math.max(pad, Math.min(vw - pad - mw, left));
    let top = Math.round(ctx.y - 6);                     // pointer near the first row
    top = Math.max(pad, Math.min(vh - pad - mh, top));
    el.style.left = Math.round(left) + 'px';
    el.style.top = top + 'px';
    el.style.clipPath = '';
  }

  _closeSubs() { for (const s of this._openSubs) s.remove(); this._openSubs = []; }

  // Build (but don't place) a submenu of leaf items — check marks, disabled state, and
  // a click that runs the item and closes the whole menu.
  _buildSubmenu(items) {
    const sub = document.createElement('div');
    sub.className = 'rack-menu rack-submenu' + (this.isDark() ? ' theme-dark' : '');
    for (const it of items) {
      if (it.header) { const h = document.createElement('div'); h.className = 'rack-menu-header'; h.textContent = it.label; sub.appendChild(h); continue; }
      const item = document.createElement('div');
      item.className = 'rack-menu-item';
      const on = it.checkFn ? it.checkFn() : !!it.checked;
      if (it.checkFn || it.checked !== undefined) { const ck = document.createElement('span'); ck.className = 'rack-menu-check'; ck.textContent = on ? '✓' : ''; item.appendChild(ck); }
      const lbl = document.createElement('span'); lbl.textContent = it.label; item.appendChild(lbl);
      if (it.disabled) item.classList.add('disabled');
      else item.addEventListener('click', () => { this._closeMenu(); it.action(); });
      sub.appendChild(item);
    }
    return sub;
  }

  // Open one submenu at a time, to the right of its parent heading (flips left / rides
  // up if it would run off-screen).
  _openSubmenu(item, items) {
    this._closeSubs();
    const sub = this._buildSubmenu(items);
    sub.style.left = '0px'; sub.style.top = '0px'; sub.style.visibility = 'hidden';
    document.body.appendChild(sub);
    this._openSubs.push(sub);
    const pad = 8, vw = window.innerWidth, vh = window.innerHeight;
    const r = item.getBoundingClientRect();
    const sw = sub.offsetWidth, sh = sub.offsetHeight;
    let sl = r.right - 2; if (sl + sw > vw - pad) sl = Math.max(pad, r.left - sw + 2);
    let st = r.top; if (st + sh > vh - pad) st = Math.max(pad, vh - pad - sh);
    sub.style.left = sl + 'px'; sub.style.top = st + 'px'; sub.style.visibility = '';
  }
}
