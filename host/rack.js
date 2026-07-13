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

const PANEL_H_MM = FACE_H_MM;   // modules display only the cropped functional face
const ROW_GAP_MM = 0;           // vertical gap between rows (0 = flush, faceplates touch)
const GAP_MM = 4;               // horizontal margin at the right of the case, in mm
const SVG_NS = 'http://www.w3.org/2000/svg';
// Terminal-menu icons (shown left of the Scope / Listen / Upstream labels).
const SCOPE_ICON = '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.2" stroke-width="1.7"/><path d="M5 12 Q7 8 9 12 T13 12 T17 12 L19 12" stroke-width="1.9"/></g></svg>';
const NET_ICON = '<svg viewBox="0 0 24 24"><g stroke="currentColor" stroke-linecap="round"><line x1="12" y1="12" x2="20" y2="4.5" stroke-width="2.1"/><line x1="12" y1="12" x2="18.5" y2="21" stroke-width="2.1"/><circle cx="20" cy="4.5" r="3.2" fill="currentColor" stroke="none"/><circle cx="18.5" cy="21" r="3.2" fill="currentColor" stroke="none"/><line x1="3.5" y1="6" x2="12" y2="12" stroke-width="2.9"/><circle cx="3.5" cy="6" r="3.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="3.7" fill="currentColor" stroke="none"/></g></svg>';
// Help links open the repo docs in the user's browser (see _openExternal).
const DOCS_README_URL = 'https://github.com/chrisgr99/wCoast/blob/main/README.md';
const DOCS_GETTING_STARTED_URL = 'https://github.com/chrisgr99/wCoast/blob/main/docs/getting-started.md';
const EAR_ICON = '<svg viewBox="0 0 24 24"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">'
  + '<g stroke-width="2"><path d="M10 21c-1.2-1.6-2-3.2-2-5.9A6 6 0 0 1 20 15c0 2.5-1.8 3.6-3.5 3.6-1.4 0-2 .9-2 2 0 1.4-1 2.5-2.4 2.5-1.1 0-2.1-.9-2.1-2.1"/>'
  + '<path d="M11.4 14A2.6 2.6 0 0 1 16.2 14.4c0 1.6-1.5 2.1-1.5 3.5"/></g>'
  + '<g stroke-width="1.6"><path d="M7.4 10.4A6 6 0 0 1 11.5 6.7"/><path d="M4.1 9.3A9.5 9.5 0 0 1 10.5 3.3"/></g></g></svg>';

// Cable colour = signal family, matching the port bodies: audio yellow, CV/control
// orange, trigger blue, 1V/oct pitch green. A cord takes its DESTINATION port's
// colour (see patchbay familyOfPort). One thin weight for every cord — thin lines
// obscure less as they cross the panel, and colour separates them.
const STYLE_COLOR = { audio: '#f3c40b', control: '#ff7300', trigger: '#5aa0e6', pitch: '#39a85a' };
const domainStyle = (domain) => (domain === 'audio' ? 'audio' : domain === 'trigger' ? 'trigger' : 'control');
const CABLE_PX = 3.8;   // cord thickness in px at zoom 1 (scales up as you zoom in)
const CABLE_HOVER_FADE = 0.28;   // opacity a cable drops to while it obscures a control you're hovering
// Scope calibrated scales (1-2-5). Vertical = signal amplitude per division; time = seconds
// per division. A division is a fixed SCOPE_DIV_PX px on the face (absolute scaling), so resizing
// the frame reveals MORE/less of the wave at the same scale rather than magnifying the trace.
const SCOPE_VDIV = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10];                          // amplitude / division (full 1-2-5)
const SCOPE_TDIV = [0.0001, 0.0002, 0.0005, 0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5];      // seconds / division (full 1-2-5)
const SCOPE_DIV_PX = 12;   // a division is this many CSS px on the face
const SCOPE_RING_SEC = 4;  // seconds of raw samples kept so a slow sweep can still fill the window
const SCOPE_EDGE_CURSOR = { l: 'ew-resize', r: 'ew-resize', t: 'ns-resize', b: 'ns-resize', tl: 'nwse-resize', br: 'nwse-resize', tr: 'nesw-resize', bl: 'nesw-resize' };
const SCOPE_VALUES_DWELL_MS = 500;   // the pointer must LINGER this long over a scope before its values panel shows (a mere pass-through doesn't)
const SCOPE_VALUES_HIDE_MS = 3000;   // how long the panel lingers after the pointer leaves
const SCOPE_ROLL_FPS = 60;      // roll history is one peak per animation frame — used to label the slow time base
const SCOPE_TRACE = '#ffffff';  // trace 1 colour (white); the bright-orange second trace is phase 3
// The scope's little controls (transport + trigger) are orange for visibility on the dark face.
const SCOPE_CTRL = '#ff9d3a';
// Grid line brightness. Fine = every division; coarse = the decade lines (a power of 10 in the
// axis units, i.e. every 2/5/10 divisions for a 1-2-5 scale). The G button toggles the grid.
const SCOPE_GRID_FINE = 0.5, SCOPE_GRID_COARSE = 0.9;
// The zero-amplitude reference line: brighter than the grid so the signal's position about zero reads clearly.
const SCOPE_GRID_ZERO = 'rgba(205,215,205,0.98)';
// Transport button glyphs (shown = the ACTION a click performs). Running → pause bars; frozen → play triangle.
const SCOPE_PAUSE_ICON = `<svg viewBox="0 0 12 12"><rect x="3" y="2.4" width="2.2" height="7.2" fill="${SCOPE_CTRL}"/><rect x="6.8" y="2.4" width="2.2" height="7.2" fill="${SCOPE_CTRL}"/></svg>`;
const SCOPE_PLAY_ICON = `<svg viewBox="0 0 12 12"><path d="M3.2 2.2 L10 6 L3.2 9.8 Z" fill="${SCOPE_CTRL}"/></svg>`;
// Frequency button: two cycles of a sine wave (measures cycles-per-second + period).
const SCOPE_FREQ_ICON = `<svg viewBox="0 0 15 12"><path d="M1 6 Q2.75 1 4.5 6 T8 6 T11.5 6 T15 6" fill="none" stroke="${SCOPE_CTRL}" stroke-width="1.3" stroke-linecap="round"/></svg>`;
const JACK_DROP_MARGIN_MM = 2;   // a cable arms/drops within this much of a terminal's edge (a forgiving zone)
// Grabbing vs. new cable off a populated OUTPUT: a left move within this angle of an
// existing cord's departure grabs that cord; a move in a fresher direction starts a new
// one. Math.SQRT1_2 = cos(45°) — the half-angle of the "grab" cone. Tune to taste.
const GRAB_MAX_COS = Math.SQRT1_2;
// Terminals get an invisible hit-pad this many mm beyond their outer edge, so a click or
// drag is easier to land. 1.3mm is safe against the tightest jack pair (3mm apart → both
// grow, meeting only past 1.5mm). Push buttons grow adaptively up to the same cap.
const HIT_GROW_MM = 1.3;
// Ear-monitor volume knob: scroll with the same momentum feel as a panel knob.
const MON_VOL_STEP = 0.04, MON_VOL_DRAG = 6, MON_VOL_MAXV = 8;
// The monitor knob is a dB-LINEAR taper (like the mixer faders): unity at the top, down
// to MON_MIN_DB near the bottom, so scrolling feels perceptual. m.vol is the KNOB
// POSITION (0..1); the applied gain is _monGainMul(vol) = 10^(MIN_DB·(1−vol)/20).
const MON_MIN_DB = -60;
// Default POSITION ≈ 0.69 → ~-18 dB (gain ~0.12): monitored terminals are internal-level
// (~15–20 dB hotter than the line-level output), so the un-measured default must be low.
const MON_VOL_DEFAULT = 0.69;
// The monitor bus carries the same fixed makeup (+~20 dB) as the mixer's main output, so a
// monitored (quiet, internal-level) signal reaches a comparable loudness — otherwise the Listen
// tool is far quieter than the main out even at full volume.
const MON_MAKEUP = 10;
// Default monitor-master level (the mixer fader while the output radio is on Monitor). Matches the
// main master default so the fader sits at a comparable spot and the loudness lines up.
const MON_LEVEL_DEFAULT = 0.29;
// The live-ring pulse is scaled logarithmically (like a VU): signal RMS in dB, this floor mapped
// to no glow and 0 dBFS to full glow.
const MON_PULSE_FLOOR_DB = -48;
// Flow animation (on every cable, always): black dashes crawl each cord source->dest
// to show direction. Dash LENGTH (in cable-widths) encodes the DESTINATION family —
// audio shortest, CV/pitch medium, trigger longest — a shape cue on top of colour.
const FLOW_DASH = { audio: 1.6, control: 3.4, pitch: 3.4, trigger: 5.6 };
const FLOW_GAP = 2.6;        // gap between dashes, in cable-widths
const FLOW_SPEED = 5.5;      // crawl speed, mm/s (content space) — a slow drift

function r2(x) { return Math.round(x * 100) / 100; }
function unit(dx, dy) { const d = Math.hypot(dx, dy) || 1; return { x: dx / d, y: dy / d }; }
// Divisions between decade (coarse) grid lines for a per-division value: the smallest power of 10
// strictly greater than the value, divided by the value — 2, 5 or 10 for a 1-2-5 scale.
const decadeSpacing = (perDiv) => Math.max(1, Math.round(Math.pow(10, Math.floor(Math.log10(perDiv)) + 1) / perDiv));
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
        // A pie owns clicks over its own overlay (it may be showing the app-menu preview);
        // let the pie decide, don't yank the menu out from under it here.
        if (e.target && e.target.closest && e.target.closest('.pie-overlay')) { this._swallowClick = false; return; }
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
    // Same pass: fade any cable that's covering the control the pointer is over.
    this.container.addEventListener('pointermove', (e) => { this._updateCableHover(e); this._updateControlCableFade(e); });
    this.container.addEventListener('pointerleave', () => {
      let redraw = false;
      if (this._hoverCableEdgeId !== null) { this._hoverCableEdgeId = null; redraw = true; }
      if (this._fadedCables) { this._fadedCables = null; this._cableFadeCtrl = null; redraw = true; }
      if (redraw) this._drawCables();
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
          // Same rule as a module jack: drag along a cord grabs it, a fresh direction (or an
          // empty jack) pulls a new one. See _grabDecision.
          const dir = unit(ev.clientX - startX, ev.clientY - startY);
          const grab = this._grabDecision(this.mixer.key, portId, dir);
          if (grab) this._startRegrab(e, grab.edge, grab.grabbedEnd);
          else this._startCable(e, this.mixer.key, portId);
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
    for (const sc of [...this._scopes]) this._closeScope(sc);
    for (const m of [...this._monitors]) this._closeMonitor(m);
    for (const rec of [...this.records.values()]) {
      if (rec.pinned) this.patchbay.disconnectModule(rec.key);
      else this.deleteModule(rec);
    }
  }

  // ---- probes (scopes + ear monitors) as part of the saved patch ----
  // Only the PERMANENT ones (a temporary pie peek has showCallout === false). Endpoints
  // are module keys, which patch-io remaps to the fresh session keys on restore.
  serializeProbes() {
    const at = (el) => ({ x: Math.round(parseFloat(el.style.left) || 0), y: Math.round(parseFloat(el.style.top) || 0) });
    const out = [];
    for (const sc of this._scopes) {
      if (sc.showCallout === false || !sc.key) continue;
      out.push({ kind: 'scope', module: sc.key, port: sc.portId, ...at(sc.el), w: sc.cssW, h: sc.cssH, vIdx: sc.vIdx, tIdx: sc.tIdx, vOffset: r2(sc.vOffset || 0), hOffset: r2(sc.hOffset || 0), grid: sc.gridOn ? 1 : 0, trigger: !!sc.trigger, trigLevel: r2(sc.trigLevel || 0), frozen: !!sc.frozen });
    }
    for (const m of this._monitors) {
      if (m.showCallout === false || !m.key) continue;
      out.push({ kind: 'monitor', module: m.key, port: m.portId, ...at(m.el), vol: r2(m.vol), muted: !!m.muted });
    }
    return out;
  }
  // Recreate probes (called after modules + wiring exist, so an input probe finds its
  // feeding cord). Monitors restore their saved level rather than auto-levelling.
  restoreProbes(probes) {
    for (const p of probes || []) {
      if (!p || !p.module || !p.port) continue;
      const x = p.x || 60, y = p.y || 60;
      if (p.kind === 'scope') {
        const sc = this._createScope(p.module, p.port, x, y);
        if (!sc) continue;
        if (p.w) sc.cssW = Math.max(60, Math.min(640, Math.round(p.w)));
        if (p.h) sc.cssH = Math.max(24, Math.min(400, Math.round(p.h)));
        if (p.w || p.h) { this._sizeScopeCanvas(sc); this._placeScopeValues(sc); }   // re-place the affordance/panel for the restored size
        // A saved scale skips autoset; an older patch (no vIdx) autosets on first signal.
        if (p.vIdx != null) { sc.vIdx = Math.max(0, Math.min(SCOPE_VDIV.length - 1, p.vIdx | 0)); sc.autosetPending = false; }
        if (p.tIdx != null) { sc.tIdx = Math.max(0, Math.min(SCOPE_TDIV.length - 1, p.tIdx | 0)); }
        if (p.vOffset != null) sc.vOffset = p.vOffset;   // restore the panned trace position
        if (p.hOffset != null) sc.hOffset = p.hOffset;
        if (p.grid != null) sc.gridOn = !!p.grid;
        if (p.trigger != null) sc.trigger = !!p.trigger;
        if (p.trigLevel != null) sc.trigLevel = p.trigLevel;
        if (p.frozen != null) sc.frozen = !!p.frozen;
        this._updateCallout(sc);
      } else if (p.kind === 'monitor') {
        const m = this._createMonitor(p.module, p.port, x, y, true, { vol: p.vol, skipAutoLevel: true });
        if (m && p.muted) this._toggleMonMute(m);
      }
    }
  }
  // Apply one module param value (knob/switch), updating DSP and the panel.
  applyParam(rec, id, value) { this._setParam(rec, id, value); }
  // Connect two jacks by { key, portId }; returns the edge (for restoring bow).
  connectPatch(from, to) { return this._tryConnect(from, to); }
  redrawCables() { this._drawCables(); }
  reconcileLinks() { this._reconcileLinks(); }   // public: patch-io calls this after restoring wiring
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
    // A LINK cord (a "mult": input sharing another input's feed) hangs off the TARGET input it was
    // chained onto, not the far source it secretly carries — so it draws as the short cord you ran.
    const srcRef = e.link || e.src;
    const a = this._jackPosMm(srcRef.key, srcRef.portId);
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
      const o = this._isolateOrigin;
      const net = o.dir === 'down' ? this._downstreamOf(o.key, o.portId) : this._upstreamOf(o.key, o.portId);
      if (!this._sameSet(net.edges, this._isolateNet)) { this._isolateNet = net.edges; this._isolateSections = net.sections; this._buildIsolateSwells(); this._buildControlHalos(); }
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
      const faded = !!(this._fadedCables && this._fadedCables.has(e.id));   // covering a hovered control → see-through
      const op = faded ? Math.min(this._cableOpacity(e), CABLE_HOVER_FADE) : this._cableOpacity(e);
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
        const fd = mk(bodyD, '#000', wmm / 2, faded ? CABLE_HOVER_FADE : 1, null);
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

  // While the pointer sits on a control (knob/button/switch), fade any OPAQUE cable drawn over it
  // so the control shows through. The cable body is pointer-events:none, so the control already
  // receives the hover; we just find which cables cross its box and mark them for a lighter draw.
  _updateControlCableFade(e) {
    const ctrl = (e.target && e.target.closest) ? e.target.closest('[data-wcoast-param]') : null;
    if (ctrl === this._cableFadeCtrl) return;   // still on the same control (or still off any) → nothing changed
    this._cableFadeCtrl = ctrl;
    const faded = ctrl ? this._cablesOverControl(ctrl) : null;
    if (this._sameFadeSet(faded, this._fadedCables)) return;
    this._fadedCables = faded;
    this._drawCables();
  }
  _sameFadeSet(a, b) {
    if (a === b) return true;
    if (!a || !b || a.size !== b.size) return false;
    for (const x of a) if (!b.has(x)) return false;
    return true;
  }
  // The set of module-cable edge ids whose curve passes over `el`'s box (null if none). Samples each
  // cord's cubic every ~2mm and maps the points to screen space to test against the control's rect.
  _cablesOverControl(el) {
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const pad = 2, L = rect.left - pad, R = rect.right + pad, T = rect.top - pad, B = rect.bottom + pad;
    const cr = this.cables.getBoundingClientRect(), s = this.pxPerMm || 1;
    const set = new Set();
    for (const e of this.patchbay.list()) {
      if (this.mixer && (e.src.key === this.mixer.key || e.dst.key === this.mixer.key)) continue;   // mixer cords drawn elsewhere
      const g = this._cordGeom(e);
      if (!g) continue;
      const chord = Math.hypot(g.pB.x - g.pA.x, g.pB.y - g.pA.y);
      const n = Math.max(24, Math.ceil(chord / 2));   // a sample every ~2mm — finer than any control
      for (let i = 0; i <= n; i++) {
        const t = i / n, mt = 1 - t;
        const x = mt * mt * mt * g.pA.x + 3 * mt * mt * t * g.c1.x + 3 * mt * t * t * g.c2.x + t * t * t * g.pB.x;
        const y = mt * mt * mt * g.pA.y + 3 * mt * mt * t * g.c1.y + 3 * mt * t * t * g.c2.y + t * t * t * g.pB.y;
        const sx = cr.left + x * s, sy = cr.top + y * s;
        if (sx >= L && sx <= R && sy >= T && sy <= B) { set.add(e.id); break; }
      }
    }
    return set.size ? set : null;
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

  // Jack pointerdown (LEFT button only — the menu opens on a RIGHT click). The FIRST move
  // off the jack decides, by its DIRECTION, whether to grab an existing cord (drag along
  // its line — _grabDecision) or pull a new one (a fresh direction, or an empty jack). A
  // plain click (press-release, no move) doesn't commit: it ARMS the same decision, made on
  // the first move afterwards, then carried STICKY (no button held) until you click a jack.
  // stopPropagation keeps the press from starting a module drag. `key` is a rack module or
  // the mixer.
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
        // The move direction decides: along an existing cord grabs it (re-route its end),
        // a fresh direction (or an empty jack) pulls a new cord. See _grabDecision.
        const dir = unit(ev.clientX - startX, ev.clientY - startY);
        const grab = this._grabDecision(key, portId, dir);
        if (grab && grab.edge.link) this._startLinkRegrab(e, grab.edge, grab.linkEnd, false);
        else if (grab) this._startRegrab(e, grab.edge, grab.grabbedEnd);
        else this._startCable(e, key, portId);
      }
    };
    // A clean click (no drag) commits to nothing yet: it ARMS a sticky pick whose new-vs-grab
    // choice is made by the first move afterwards (_armStickyPick). It fires on release, so a
    // press that became a drag is already a cable and never reaches here.
    const onUp = (ev) => { cleanup(); this._armStickyPick(key, portId, ev.clientX, ev.clientY); };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // After a plain click on a jack, wait for the first pointer move and THEN decide, by its
  // direction, whether to carry an existing cord or a new one — both STICKY (no button held,
  // dropped by a later click). Before that first move a fresh click, a right-click, or Escape
  // cancels the armed pick, so a mis-click leaves nothing behind.
  _armStickyPick(key, portId, cx, cy) {
    const TH = 6;
    const cleanup = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', onCancel, true);
      document.removeEventListener('contextmenu', onCancel, true);
      document.removeEventListener('keydown', onKey, true);
    };
    const onMove = (ev) => {
      if (Math.hypot(ev.clientX - cx, ev.clientY - cy) < TH) return;
      cleanup();
      const dir = unit(ev.clientX - cx, ev.clientY - cy);
      const grab = this._grabDecision(key, portId, dir);
      if (grab && grab.edge.link) this._startLinkRegrab(null, grab.edge, grab.linkEnd, true, ev.clientX, ev.clientY);
      else if (grab) this._startStickyRegrab(grab.edge, grab.grabbedEnd, ev.clientX, ev.clientY);
      else this._startStickyCable(key, portId, ev.clientX, ev.clientY);
    };
    const onCancel = () => cleanup();   // a fresh click or right-click before moving abandons the pick
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); cleanup(); } };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', onCancel, true);
    document.addEventListener('contextmenu', onCancel, true);
    document.addEventListener('keydown', onKey, true);
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
    // Dragging FROM an input can also drop on another FED input to MULT it (share its signal).
    const originIsInput = meta.dir === 'in';
    this._highlightCandidates(meta.dir === 'out' ? 'in' : 'out', null, originIsInput);

    const wantDir = meta.dir === 'out' ? 'in' : 'out';
    const onMove = (ev) => {
      const m = this._clientToMm(ev.clientX, ev.clientY);
      tmp.setAttribute('d', this._cordPath(a, a.r, m, 0, wmm));
      this._armTarget(this._jackNear(ev.clientX, ev.clientY), wantDir, null, { key, portId }, originIsInput);
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
    const originIsInput = meta.dir === 'in';   // an input origin can also MULT onto another fed input
    this._highlightCandidates(meta.dir === 'out' ? 'in' : 'out', null, originIsInput);
    document.body.classList.add('grabbing-cable');
    const wantDir = meta.dir === 'out' ? 'in' : 'out';
    let lastX = cx, lastY = cy;
    const track = (clientX, clientY) => {
      lastX = clientX; lastY = clientY;
      tmp.setAttribute('d', this._cordPath(a, a.r, this._clientToMm(clientX, clientY), 0, wmm));
      this._armTarget(this._jackNear(clientX, clientY), wantDir, null, { key, portId }, originIsInput);
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
        this._reconcileLinks(); this._drawCables(); this.onChange();   // dropped on nothing → broken; links on the freed input fall away
        this._pushUR({ undo: () => this._restoreCable(origSnap), redo: () => this._removeCable(origSnap) });   // pull-off removal
      }
    };
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
  }

  // Sticky re-route: the button-up twin of _startRegrab. The grabbed end of an existing cord
  // FOLLOWS the cursor with no button held (scroll/zoom/roam freely); a later LEFT click drops
  // it — on a valid jack it moves there, on empty space it disconnects (leaves it broken). The
  // cord is broken the instant it's picked up, so you audition the patch without it while you
  // decide. Right-click or Escape ABORTS and restores the original connection (no net change).
  _startStickyRegrab(edge, grabbedEnd, cx, cy) {
    const fixed = grabbedEnd === 'src' ? edge.dst : edge.src;
    const grabbed = grabbedEnd === 'src' ? edge.src : edge.dst;
    const fixedEp = this._ep(fixed.key, fixed.portId);
    const fixedPos = this._jackPosMm(fixed.key, fixed.portId);
    if (!fixedEp || !fixedPos) return;
    const fixedMeta = fixedEp.meta;
    const wantDir = fixedMeta.dir === 'out' ? 'in' : 'out';
    const wmm = CABLE_PX / (this._fit || 1);
    const savedBow = edge.bow;
    const origSnap = this._edgeSnapshot(edge);

    this.patchbay.disconnect(edge);   // break immediately: hear the patch WITHOUT it while deciding
    this._drawCables();

    const tmp = document.createElementNS(SVG_NS, 'path');
    tmp.setAttribute('class', 'rack-cable rack-cable-temp');
    tmp.setAttribute('stroke', STYLE_COLOR[domainStyle(fixedMeta.domain)]);
    tmp.setAttribute('stroke-width', r2(wmm));
    this._tempCable = tmp;
    this.cables.appendChild(tmp);
    this._highlightCandidates(wantDir);
    document.body.classList.add('grabbing-cable');

    let lastX = cx, lastY = cy;
    const track = (clientX, clientY) => {
      lastX = clientX; lastY = clientY;
      tmp.setAttribute('d', this._cordPath(fixedPos, fixedPos.r, this._clientToMm(clientX, clientY), 0, wmm));
      this._armTarget(this._jackNear(clientX, clientY), wantDir, null, null);   // origin null: the cord is already off, so its own port re-arms
    };
    track(cx, cy);
    const onMove = (ev) => track(ev.clientX, ev.clientY);
    const onScroll = () => track(lastX, lastY);
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
    const restore = () => {   // put the cord back exactly as it was (abort / dropped-back / target-taken)
      const e = this._tryConnect({ key: fixed.key, portId: fixed.portId }, grabbed);
      if (e && savedBow != null) e.bow = savedBow;
      this._drawCables();
    };
    const onDrop = (ev) => {
      if (ev.button !== 0) return;   // right-click is handled by onCtx; middle is ignored
      ev.preventDefault(); ev.stopPropagation();
      const drop = this._jackNear(ev.clientX, ev.clientY);
      finish();
      const droppedBack = drop && drop.key === grabbed.key && drop.portId === grabbed.portId;
      const candidate = drop && this._isCandidate(drop, wantDir);
      const occupied = candidate && wantDir === 'in' && this.patchbay.inputOccupied(drop.key, drop.portId, null);
      if (droppedBack || (candidate && occupied)) {
        restore();                                       // back home, or target taken → no net change, no undo
      } else if (candidate) {
        const ne = this._tryConnect({ key: fixed.key, portId: fixed.portId }, drop);   // move to the new port
        if (ne) { const ns = this._edgeSnapshot(ne); this._pushUR({ undo: () => { this._removeCable(ns); this._restoreCable(origSnap); }, redo: () => { this._removeCable(origSnap); this._restoreCable(ns); } }); }
      } else {
        this._reconcileLinks(); this._drawCables(); this.onChange();   // clicked empty space → disconnect; dependent links fall away
        this._pushUR({ undo: () => this._restoreCable(origSnap), redo: () => this._removeCable(origSnap) });
      }
    };
    const onCtx = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish(); restore(); };   // right-click aborts → restore
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finish(); restore(); } };   // Escape aborts → restore
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', onDrop, true);
    document.addEventListener('contextmenu', onCtx, true);
    document.addEventListener('keydown', onKey, true);
    this.container.addEventListener('scroll', onScroll, true);
  }

  // Grab a LINK (mult) cord and pull it: it hangs from the ANCHOR input it taps (link.to), and the
  // shared-input end follows the cursor. Drop it on another empty input to re-target the share, back
  // on nothing to remove it (dependents fall away). `sticky` picks the no-button-held twin. The
  // cord is broken immediately so you hear the patch without it while you decide.
  _startLinkRegrab(e, edge, linkEnd, sticky, cx, cy) {
    const anchor = { key: edge.link.key, portId: edge.link.portId };   // the tapped input (A)
    const dstRef = { key: edge.dst.key, portId: edge.dst.portId };     // the sharing input (B)
    const grabAnchor = linkEnd === 'anchor';   // grabbed the A end (re-tap) vs the B end (re-share)
    const fixedRef = grabAnchor ? dstRef : anchor;                     // the end that stays put
    const fixedPos = this._jackPosMm(fixedRef.key, fixedRef.portId);
    if (!fixedPos) return;
    const wmm = CABLE_PX / (this._fit || 1);
    const origSnap = this._edgeSnapshot(edge);
    this.patchbay.disconnect(edge);
    this._reconcileLinks(); this._drawCables();

    const tmp = document.createElementNS(SVG_NS, 'path');
    tmp.setAttribute('class', 'rack-cable rack-cable-temp');
    tmp.setAttribute('stroke', STYLE_COLOR[edge.style] || STYLE_COLOR.control);
    tmp.setAttribute('stroke-width', r2(wmm));
    this._tempCable = tmp; this.cables.appendChild(tmp);
    // Re-tap targets a FED input (a new signal to share); re-share targets an EMPTY input.
    if (grabAnchor) this._highlightFedInputs(dstRef.key, dstRef.portId); else this._highlightCandidates('in');
    if (sticky) document.body.classList.add('grabbing-cable');

    const armAt = (clientX, clientY) => {
      tmp.setAttribute('d', this._cordPath(fixedPos, fixedPos.r, this._clientToMm(clientX, clientY), 0, wmm));
      if (grabAnchor) this._armTarget(this._jackNear(clientX, clientY), 'out', null, dstRef, true);   // linkMode arms fed inputs
      else this._armTarget(this._jackNear(clientX, clientY), 'in', null, anchor);
    };
    const teardown = () => {
      tmp.remove(); this._tempCable = null; this._disarmTarget(); this._clearHighlights();
      if (sticky) document.body.classList.remove('grabbing-cable');
    };
    const pushMove = (ne) => { const ns = this._edgeSnapshot(ne); this._pushUR({ undo: () => { this._removeCable(ns); this._restoreCable(origSnap); }, redo: () => { this._removeCable(origSnap); this._restoreCable(ns); } }); };
    const remove = () => {
      this._reconcileLinks(); this._drawCables(); this.onChange();   // dropped on nothing → removed (dependents fall away)
      this._pushUR({ undo: () => this._restoreCable(origSnap), redo: () => this._removeCable(origSnap) });
    };
    const commit = (drop) => {
      if (grabAnchor) {
        // re-tap: drop on another FED input; the sharing input B stays
        const fed = drop && this._isLinkTarget(drop) && !(drop.key === dstRef.key && drop.portId === dstRef.portId);
        if (fed) { const ne = this._tryConnect(drop, dstRef); if (ne) pushMove(ne); else this._restoreCable(origSnap); }
        else remove();
      } else {
        // re-share: drop on an EMPTY input; the tapped input A stays
        const empty = drop && this._isCandidate(drop, 'in') && !this.patchbay.inputOccupied(drop.key, drop.portId, null)
          && !(drop.key === anchor.key && drop.portId === anchor.portId);
        if (empty) { const ne = this._tryConnect(anchor, drop); if (ne) pushMove(ne); else this._restoreCable(origSnap); }
        else remove();
      }
    };

    if (sticky) {
      let lastX = cx, lastY = cy;
      const track = (x, y) => { lastX = x; lastY = y; armAt(x, y); };
      track(cx, cy);
      const onMove = (ev) => track(ev.clientX, ev.clientY);
      const onScroll = () => track(lastX, lastY);
      const finish = () => {
        document.removeEventListener('pointermove', onMove, true); document.removeEventListener('pointerdown', onDrop, true);
        document.removeEventListener('contextmenu', onCtx, true); document.removeEventListener('keydown', onKey, true);
        this.container.removeEventListener('scroll', onScroll, true); teardown();
      };
      const onDrop = (ev) => { if (ev.button !== 0) return; ev.preventDefault(); ev.stopPropagation(); const drop = this._jackNear(ev.clientX, ev.clientY); finish(); commit(drop); };
      const onCtx = (ev) => { ev.preventDefault(); ev.stopPropagation(); finish(); this._restoreCable(origSnap); };
      const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); finish(); this._restoreCable(origSnap); } };
      document.addEventListener('pointermove', onMove, true); document.addEventListener('pointerdown', onDrop, true);
      document.addEventListener('contextmenu', onCtx, true); document.addEventListener('keydown', onKey, true);
      this.container.addEventListener('scroll', onScroll, true);
    } else {
      if (e) this._gripCursor();
      const onMove = (ev) => armAt(ev.clientX, ev.clientY);
      const onUp = (ev) => {
        document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
        const drop = this._jackNear(ev.clientX, ev.clientY); teardown(); commit(drop);
      };
      document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
    }
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
  // An input that already carries a signal — a valid MULT target (drag from an empty input onto it
  // to share its feed).
  _isLinkTarget(jack) {
    const ep = this._ep(jack.key, jack.portId);
    return !!ep && ep.meta.dir === 'in' && !!this._incomingEdge(jack.key, jack.portId);
  }

  // Swell every FED input (a re-tap target while re-anchoring a link), skipping one port.
  _highlightFedInputs(exceptKey, exceptPort) {
    this._clearHighlights();
    this._highlights = [];
    const delta = 2 / (this.pxPerMm || 1);
    for (const rec of this.records.values()) {
      for (const [portId, port] of rec.panel.ports) {
        if (port.meta.dir !== 'in' || !this._incomingEdge(rec.key, portId)) continue;
        if (rec.key === exceptKey && portId === exceptPort) continue;
        const ring = port.element.querySelector('circle');
        if (!ring) continue;
        const orig = ring.getAttribute('stroke-width');
        ring.setAttribute('stroke-width', r2((parseFloat(orig) || 0) + delta));
        this._highlights.push({ ring, orig });
      }
    }
  }

  _highlightCandidates(wantDir, exceptEdge, linkMode) {
    this._clearHighlights();
    this._highlights = [];
    const delta = 2 / (this.pxPerMm || 1);   // 2 screen px expressed in panel mm
    const swell = (rec, portId, port) => {
      const ring = port.element.querySelector('circle');   // the outer coloured ring
      if (!ring) return;
      const orig = ring.getAttribute('stroke-width');
      ring.setAttribute('stroke-width', r2((parseFloat(orig) || 0) + delta));
      this._highlights.push({ ring, orig });
    };
    for (const rec of this.records.values()) {
      for (const [portId, port] of rec.panel.ports) {
        if (port.meta.dir === wantDir) {
          if (wantDir === 'in' && this.patchbay.inputOccupied(rec.key, portId, exceptEdge)) continue;
          swell(rec, portId, port);
        } else if (linkMode && port.meta.dir === 'in' && this._incomingEdge(rec.key, portId)) {
          swell(rec, portId, port);   // a FED input is a mult target
        }
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
      // pA is the src side for a normal cord, the ANCHOR side for a link (see _cordGeom); pB is the dst.
      const atStart = edge.link ? (edge.link.key === key && edge.link.portId === portId)
                                : (edge.src.key === key && edge.src.portId === portId);
      const dep = atStart ? g.uA : g.uB;
      const d = dep.x * dragDir.x + dep.y * dragDir.y;
      if (d > bestDot) { bestDot = d; best = edge; }
    }
    return { edge: best, dot: bestDot };   // dot = cosine of the angle between the move and that cord's departure
  }

  // Decide what a LEFT drag/move off a jack should do, given the move DIRECTION (a unit
  // screen vector). Returns { edge, grabbedEnd } to grab an existing cord and carry its
  // end, or null to start a NEW cord.
  //   - no cords on the jack        → null (new)
  //   - an INPUT holds one cord     → grab it to re-route, whatever the direction
  //   - an OUTPUT can fan out       → grab the best-matching cord only within GRAB_MAX_COS;
  //                                    a move in a fresh direction returns null (new cord)
  _grabDecision(key, portId, dir) {
    // A LINK cord is drawn from the input it TAPS (its ANCHOR) to the sharing input — never touching
    // its hidden source jack. So drop links at their source, but ADD links whose anchor is this jack
    // (they end here visually and must be grabbable here, chosen by drag direction against any main
    // cable also landing on this input).
    const main = this.patchbay.edgesAtJack(key, portId).filter((e) => !(e.link && e.src.key === key && e.src.portId === portId));
    const anchored = this.patchbay.list().filter((e) => e.link && e.link.key === key && e.link.portId === portId);
    const edges = [...main, ...anchored];
    if (!edges.length) return null;
    const ep = this._ep(key, portId);
    const isInput = ep && ep.meta.dir === 'in';
    const { edge, dot } = this._pickByDirection(key, portId, edges, dir);
    if (!edge) return null;
    if (!isInput && dot < GRAB_MAX_COS) return null;   // output + off-axis → new cable
    if (edge.link) {   // a link: which drawn end did we grab — the anchor (tap) or the shared input?
      const atAnchor = edge.link.key === key && edge.link.portId === portId;
      return { edge, grabbedEnd: 'dst', linkEnd: atAnchor ? 'anchor' : 'dst' };
    }
    const grabbedEnd = (edge.src.key === key && edge.src.portId === portId) ? 'src' : 'dst';
    return { edge, grabbedEnd };
  }

  // The SVG element of a jack (rack module or mixer), for the receive-cue enlarge.
  _jackElement(key, portId) {
    if (this.mixer && key === this.mixer.key) return this.mixer.jacks.get(portId) || null;
    const rec = this.records.get(key);
    const port = rec && rec.panel.ports.get(portId);
    return port ? port.element : null;
  }

  // The screen rect of the TERMINAL itself (its coloured circle), not the wider invisible
  // hit-pad — so the scope/monitor connection loop hugs the jack, not the padded click zone.
  _jackClientRect(jel) {
    const c = (jel && jel.querySelector && jel.querySelector('circle:not(.hit-pad)')) || jel;
    return c.getBoundingClientRect();
  }

  // Receive cue while dragging: the valid target under the pointer swells and gains
  // a bold outline in its own family colour ("ready to receive"). Only opposite-
  // direction, unoccupied jacks arm — never the origin or an occupied input.
  _armTarget(target, wantDir, exceptEdge, origin, linkMode) {
    const onSelf = target && origin && target.key === origin.key && target.portId === origin.portId;
    let ok = target && !onSelf && this._isCandidate(target, wantDir)
      && !(wantDir === 'in' && this.patchbay.inputOccupied(target.key, target.portId, exceptEdge));
    if (!ok && linkMode && target && !onSelf && this._isLinkTarget(target)) ok = true;   // fed input → mult target
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
  // Isolate a terminal's subnet in one direction: 'up' = what FEEDS it (upstream), 'down' =
  // what it DRIVES (downstream). The direction is remembered on _isolateOrigin so the live
  // recompute in _drawCables walks the same way as the patch changes.
  _isolateSubnet(key, portId, dir = 'up') {
    this._exitIsolate();
    const net = dir === 'down' ? this._downstreamOf(key, portId) : this._upstreamOf(key, portId);
    if (!net.edges.size) return;   // nothing in that direction — nothing to isolate
    this._isolateOrigin = { key, portId, dir };
    this._isolateNet = net.edges;
    this._isolateSections = net.sections;
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
    // Downstream: the mixer is the sink — light the cord reaching it but don't swell its jack.
    const skipSink = !!(this._isolateOrigin && this._isolateOrigin.dir === 'down');
    const swell = (k, p) => { if (skipSink && this._isSink(k)) return; const tag = k + '|' + p; if (!seen.has(tag)) { seen.add(tag); this._swellJack(k, p); } };
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

  // While isolating, DIM every control whose section doesn't affect the terminal, leaving the
  // relevant ones at normal opacity — the focus comes from the fade alone, no ring around
  // knobs. Per-section: on a quad, only the feeding channel's controls stay lit, not the module.
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
        // affect the terminal stay lit.
        const gate = inNet ? this._controlGatePort(rec, b) : null;
        const lit = inNet && !(gate && !this._portOccupied(rec.key, gate));
        if (!lit) {
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
      if (h.dimEl) h.dimEl.style.opacity = h.prev || '';
    }
    this._controlHalos = null;
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

  // The master sink — the pinned mixer module, the end of every downstream chain.
  _isSink(key) { const rec = this.records.get(key); return !!(rec && rec.pinned); }

  // The mirror of _upstreamOf: the set of edge ids this port transitively DRIVES (its
  // downstream fan-out). The clicked port is precise — for an output, only the cords out of
  // THAT port seed it; an input drives its whole module. From there, downstream is followed
  // per module/channel section (a module is a black box: all its inputs drive all its
  // outputs). Returns { edges, sections } — the driven cords AND the sections the signal
  // flows through.
  _downstreamOf(key, portId) {
    const edges = this.patchbay.list();
    const result = new Set();
    const toExpand = [];        // sections whose output cords we still need to gather
    const visited = new Set();  // sections already expanded
    const ep = this._ep(key, portId);
    // The mixer is the master SINK: a cord reaching it is the last link, so light that cord
    // but never expand INTO the mixer (its jacks/controls stay un-highlighted).
    const isSink = (k) => this._isSink(k);
    if (ep && ep.meta.dir === 'in') {
      if (!isSink(key)) toExpand.push(this._sectionKey(key, portId));   // an input drives its module's outputs
    } else {
      for (const e of edges) {                          // an output: only the cords out of this exact port
        if (e.src.key === key && e.src.portId === portId) {
          result.add(e.id);
          if (!isSink(e.dst.key)) toExpand.push(this._sectionKey(e.dst.key, e.dst.portId));
        }
      }
    }
    while (toExpand.length) {
      const S = toExpand.pop();
      if (visited.has(S)) continue;
      visited.add(S);
      for (const e of edges) {
        if (this._sectionKey(e.src.key, e.src.portId) !== S) continue;   // cords OUT of section S
        result.add(e.id);
        if (isSink(e.dst.key)) continue;                                  // stop at the mixer
        const dstS = this._sectionKey(e.dst.key, e.dst.portId);
        if (!visited.has(dstS)) toExpand.push(dstS);
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

  // "Browse networks" mode: the pointer keeps its arrow but wears the network badge, and
  // hovering ANY terminal live-shows its subnet — upstream for an input, downstream for an
  // output. A way to roam the whole patch and read every connection pattern. A click
  // anywhere (or Escape) cancels the mode.
  _startBrowseNet() {
    if (this._browsing) return;
    this._browsing = true;
    this._browseTag = null;                 // the terminal currently previewed, so we rebuild only on change
    const badge = document.createElement('div');   // the net glyph riding just off the arrow tip
    badge.className = 'net-browse-badge';
    badge.innerHTML = NET_ICON;
    document.body.appendChild(badge);
    this._browseBadge = badge;
    const onMove = (ev) => {
      badge.style.left = ev.clientX + 'px';
      badge.style.top = ev.clientY + 'px';
      const j = this._jackNear(ev.clientX, ev.clientY);
      const tag = j ? j.key + '|' + j.portId : null;
      if (tag === this._browseTag) return;   // same terminal (or still empty space): nothing to redo
      this._browseTag = tag;
      if (!j) { this._exitIsolate(); return; }
      const ep = this._ep(j.key, j.portId);
      const dir = (ep && ep.meta.dir === 'out') ? 'down' : 'up';   // outputs look forward, inputs back
      this._isolateSubnet(j.key, j.portId, dir);   // clears any previous; blank if nothing that way
    };
    const onDown = (ev) => { ev.preventDefault(); ev.stopPropagation(); this._stopBrowseNet(); };   // any click cancels
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); this._stopBrowseNet(); } };
    this._browseMove = onMove; this._browseDown = onDown; this._browseKey = onKey;
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
  }

  _stopBrowseNet() {
    if (!this._browsing) return;
    this._browsing = false;
    document.removeEventListener('pointermove', this._browseMove, true);
    document.removeEventListener('pointerdown', this._browseDown, true);
    document.removeEventListener('keydown', this._browseKey, true);
    this._browseMove = this._browseDown = this._browseKey = null;
    if (this._browseBadge) { this._browseBadge.remove(); this._browseBadge = null; }
    this._browseTag = null;
    this._exitIsolate();
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
  // Right-click a terminal → a plain menu: Scope, Listen, Upstream. It's an "active" menu:
  // stopping the pointer on an item shows that item's PREVIEW (a live scope beside the pointer;
  // the tapped signal played through a hidden auto-levelled monitor; the upstream subnet
  // highlighted), torn down when you move off. Clicking an item does what the old pie wedge did:
  // Scope/Listen carry a real one that follows the cursor and drops on the next click; Upstream
  // latches the highlight (it survives the menu close). (Left-click still pulls a cable.)
  _onJackContextMenu(e, key, portId) {
    e.preventDefault(); e.stopPropagation();
    const ox = e.clientX, oy = e.clientY;
    let tempScope = null, tempMon = null;
    // The subnet item follows the signal's natural direction for this terminal: an OUTPUT looks
    // forward ("Show downstream"), an INPUT looks back ("Show upstream"). It's greyed when there's
    // nothing to show (an unconnected terminal, or one with no cords in that direction).
    const ep = this._ep(key, portId);
    const isOut = !!ep && ep.meta.dir === 'out';
    const netDir = isOut ? 'down' : 'up';
    const netLabel = isOut ? 'Show downstream' : 'Show upstream';
    const hasNet = (isOut ? this._downstreamOf(key, portId) : this._upstreamOf(key, portId)).edges.size > 0;
    // Scope preview handoff: while the preview is up, a document watcher lets the pointer walk
    // OFF the menu item and ONTO the floating scope — entering it makes the scope permanent (as
    // if dragged out and dropped there) and closes the menu. scopeItemEl is the Scope row, so the
    // watcher can tell "heading right toward the scope" from "wandered back into the menu".
    let scopeWatch = null, scopeItemEl = null, scopeClick = null, scopeCommitted = false;
    const dropScopePreview = () => {
      if (scopeWatch) { document.removeEventListener('pointermove', scopeWatch, true); scopeWatch = null; }
      if (scopeClick) { document.removeEventListener('pointerdown', scopeClick, true); scopeClick = null; }
      if (tempScope) { this._closeScope(tempScope); tempScope = null; }
    };
    // A CLICK is what commits the scope — either on the Scope item or on the peeked preview's face.
    // It makes the preview permanent (or creates one) and carries it so the next click drops it where
    // you want. Merely peeking and moving away creates nothing.
    const takeScope = (ev, carryMode) => {
      if (scopeCommitted) return; scopeCommitted = true;
      let sc = tempScope; tempScope = null;
      if (scopeWatch) { document.removeEventListener('pointermove', scopeWatch, true); scopeWatch = null; }
      if (scopeClick) { document.removeEventListener('pointerdown', scopeClick, true); scopeClick = null; }
      if (sc) this._promoteScope(sc); else sc = this._createScope(key, portId, ev.clientX, ev.clientY, true);
      this._closeMenu();
      this._carryScope(sc, { clientX: ev.clientX, clientY: ev.clientY }, carryMode || 'up');
    };
    this._openMenu(ox, oy, [
      {
        label: 'Monitor', icon: EAR_ICON,
        onDwell: () => {
          if (tempMon) return;
          tempMon = this._createMonitor(key, portId, ox, oy, false);   // audio only
          tempMon.el.style.display = 'none';                          // heard, not seen
          this._autoLevelMonitor(tempMon);
        },
        onLeave: () => { if (tempMon) { this._closeMonitor(tempMon); tempMon = null; } },
        action: (ev) => this._carryMonitor(this._createMonitor(key, portId, ev.clientX, ev.clientY), { clientX: ev.clientX, clientY: ev.clientY }, 'up'),
      },
      {
        label: 'Scope', icon: SCOPE_ICON,
        onDwell: () => {
          if (tempScope) return;
          scopeItemEl = this._hoverItem;                // the Scope row, for the watcher's geometry
          const a = this._dwellAnchor || { x: ox, y: oy };
          tempScope = this._createScope(key, portId, a.x, a.y, false);
          tempScope.el.style.zIndex = 3100;             // over the menu
          tempScope.el.style.pointerEvents = 'none';    // a visual preview; the menu owns the pointer
          const h = tempScope.el.offsetHeight || 80;
          tempScope.el.style.left = Math.round(a.x + 3 * (this.pxPerMm || 1)) + 'px';   // 3mm right of the pointer
          tempScope.el.style.top = Math.round(a.y - h / 2) + 'px';                       // vertically centred on it
          scopeWatch = (ev) => {
            if (!tempScope) return;
            if (!this._menuEl) { dropScopePreview(); return; }   // menu closed some other way → drop the peek
            const r = tempScope.el.getBoundingClientRect();
            const overScope = ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom;
            if (overScope) return;   // hovering the preview keeps it up — a CLICK on it is what commits it
            const ir = scopeItemEl ? scopeItemEl.getBoundingClientRect() : { left: 0, right: 0, top: 0, bottom: 0 };
            const overItem = ev.clientX >= ir.left && ev.clientX <= ir.right && ev.clientY >= ir.top && ev.clientY <= ir.bottom;
            const bridging = ev.clientX > ir.right && ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8;   // in the gap heading toward the scope
            if (!overItem && !bridging) dropScopePreview();   // moved away from BOTH the item and the peek → close
          };
          scopeClick = (ev) => {   // click on the peeked face → commit and carry it to reposition
            if (!tempScope || ev.button !== 0) return;
            const r = tempScope.el.getBoundingClientRect();
            if (ev.clientX >= r.left && ev.clientX <= r.right && ev.clientY >= r.top && ev.clientY <= r.bottom) {
              ev.preventDefault(); ev.stopPropagation(); takeScope(ev, 'auto');   // held-button: drag drops on release, click keeps carrying
            }
          };
          document.addEventListener('pointermove', scopeWatch, true);
          document.addEventListener('pointerdown', scopeClick, true);
        },
        // A plain item-leave is handled by the watcher (it may still be heading to the scope); only
        // a genuine menu teardown tears the preview down here.
        onLeave: () => { if (this._menuClosing) dropScopePreview(); },
        action: (ev) => takeScope(ev),
      },
      {
        label: netLabel, icon: NET_ICON, disabled: !hasNet,
        onDwell: () => this._isolateSubnet(key, portId, netDir),
        onLeave: () => this._exitIsolate(),
        latch: true,                                    // a click keeps the highlight past the menu close
        action: () => this._isolateSubnet(key, portId, netDir),
      },
      {
        label: 'Browse networks', icon: NET_ICON,       // roam the patch: hover any terminal to see its subnet
        action: () => this._startBrowseNet(),
      },
    ]);
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
      const jr = this._jackClientRect(jel);   // the terminal itself, NOT its wider hit-pad
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
    el.appendChild(canvas);
    document.body.appendChild(el);

    const an = this.host.ctx.createAnalyser();
    an.fftSize = 16384; an.smoothingTimeConstant = 0;   // ~340ms per read; stitched into the ring below
    const sr0 = (this.host.ctx && this.host.ctx.sampleRate) || 48000;
    const sc = {
      key, portId, el, canvas, g2: canvas.getContext('2d'), analyser: an,
      buf: new Float32Array(an.fftSize), hist: new Array(200).fill(null), histIdx: 0,
      // Long raw-sample ring so a slow time base can fill the whole window (the analyser alone holds
      // only ~340ms). Each frame stitches the newest samples in, counted off the audio clock.
      ringBuf: new Float32Array(Math.round(SCOPE_RING_SEC * sr0)), ringPos: 0, ringFilled: 0, lastCapTime: null,
      hi: null, lo: null, fastVotes: 0, tap: null,
      cssW: 120, cssH: 37, dpr: 1,   // logical CSS size; backing store is scaled to the display DPR
      vIdx: 7, tIdx: 6, vOffset: 0, hOffset: 0, autosetPending: true, autosetBudget: 180,   // 0.2 /div, 10 ms/div, centred on 0 until autoset frames it; hOffset = horizontal trace pan (px)
      valuesEl: null, playBtn: null, trigBtn: null, valEls: {}, valuesTimer: null, dwellTimer: null,
      gridOn: true,   // the G button toggles the grid on/off
      trigger: true, trigLevel: 0, frozen: false, forceMode: 'auto',
      armed: false, recFrames: 0, prevPeak: null, showCallout,
      ring: document.createElementNS(SVG_NS, 'circle'), line: document.createElementNS(SVG_NS, 'line'),
      dot: document.createElement('div'),
    };
    this._sizeScopeCanvas(sc);
    this._scopeTapConnect(sc);
    const ov = this._scopeOverlay();
    sc.line.setAttribute('fill', 'none'); ov.appendChild(sc.line);
    sc.ring.setAttribute('fill', 'none'); sc.ring.style.pointerEvents = 'none'; ov.appendChild(sc.ring);
    // The grab handle is a white dot where the line meets the loop — a reliable HTML
    // target (an SVG hit-ring in a pointer-events:none overlay proved unhittable).
    sc.dot.className = 'scope-dot'; document.body.appendChild(sc.dot);

    // Only a genuine HOVER (a short dwell) reveals the panel — a pointer merely crossing the scope
    // on its way elsewhere shouldn't summon it.
    el.addEventListener('pointerenter', () => { clearTimeout(sc.dwellTimer); sc.dwellTimer = setTimeout(() => this._showScopeValues(sc), SCOPE_VALUES_DWELL_MS); });
    el.addEventListener('pointerleave', () => { clearTimeout(sc.dwellTimer); sc.dwellTimer = null; this._hideScopeValuesSoon(sc); el.style.cursor = ''; });
    el.addEventListener('contextmenu', (ev) => this._scopeMenu(ev, sc));
    // Drag ANY edge of the face to resize; drag the INTERIOR to move the whole scope (like a
    // monitor). Controls stop propagation / sit outside, so they keep priority where they are.
    el.addEventListener('pointerdown', (ev) => { this._exitFreqMode(sc); this._hideScopeValues(sc); const e = this._scopeEdgeAt(sc, ev); if (e) this._resizeScopeEdge(ev, sc, e); else this._moveScope(ev, sc); });
    el.addEventListener('pointermove', (ev) => {
      if (sc._resizing) return;
      if (ev.target !== sc.canvas) { el.style.cursor = ''; return; }   // over the settings panel/buttons → no resize/move affordance
      const e = this._scopeEdgeAt(sc, ev); el.style.cursor = e ? SCOPE_EDGE_CURSOR[e] : 'move';
    });
    // Scroll over the face to PAN the trace: vertical scroll shifts it up/down, horizontal scroll
    // shifts it left/right, and cmd+vertical shifts left/right too (for mice with no h-scroll).
    sc.canvas.addEventListener('wheel', (ev) => this._scopePanWheel(ev, sc), { passive: false });
    sc.dot.addEventListener('pointerdown', (ev) => this._regrabScope(ev, sc));
    this._buildScopeValues(sc);   // the values panel (hover-shown)

    sc.trigger = true; this._scopeAutoset(sc);   // a new scope auto-scales and triggers → a useful view at once
    this._updateScopeTrigBtn(sc);
    this._scopes.add(sc);
    if (showCallout) this.onChange();   // a placed scope is part of the patch (not the temporary peek)
    this._updateCallout(sc);
    this._startScopeLoop();
    return sc;
  }

  // Promote a hover-preview scope into a permanent one, in place — as if it had been dragged
  // out of the terminal and dropped where it's sitting. Restores its interactivity, draws the
  // connection loop, and enrolls it in the patch.
  _promoteScope(sc) {
    if (!sc) return;
    sc.showCallout = true;
    sc.el.style.pointerEvents = '';
    sc.el.style.zIndex = '';
    if (sc.dot) sc.dot.style.display = '';
    this._updateCallout(sc);
    this.onChange();
  }

  // Carry an already-live scope so it follows the pointer and drops. It hangs by the middle of its
  // LEFT edge, so it trails down-and-right of the pointer (matching how the hover preview popped up).
  //   'up'   — drops on the next CLICK (committed from a release, e.g. clicking the menu item).
  //   'down' — drops on the next RELEASE (dragged out holding a button).
  //   'auto' — committed with the button held: if you DRAG it into place it drops on release;
  //            if you merely clicked (no drag) it keeps following and drops on the next click.
  // Escape (or clicking back on the origin terminal) cancels — the scope is removed.
  _carryScope(sc, e, mode) {
    const h = sc.el.offsetHeight || 80;
    const place = (px, py) => { sc.el.style.left = Math.round(px) + 'px'; sc.el.style.top = Math.round(py - h / 2) + 'px'; this._updateCallout(sc); };
    place(e.clientX, e.clientY);
    const downX = e.clientX, downY = e.clientY; let dragged = false;
    const onMove = (ev) => { if (!dragged && Math.hypot(ev.clientX - downX, ev.clientY - downY) > 4) dragged = true; place(ev.clientX, ev.clientY); };
    const finish = () => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointerdown', onClick, true);
      document.removeEventListener('keydown', onKey, true);
    };
    // Dropping back on the terminal it came from cancels the creation (deletes it) — the same
    // "changed my mind" escape a cable drag has when dropped back on its port.
    const cancelIfOrigin = (ev) => {
      const drop = this._jackNear(ev.clientX, ev.clientY);
      if (drop && drop.key === sc.key && drop.portId === sc.portId) { this._closeScope(sc); return true; }
      return false;
    };
    const onUp = (ev) => {
      if (mode === 'auto' && !dragged) {   // a click, not a drag → keep carrying, drop on the NEXT click
        document.removeEventListener('pointerup', onUp, true);
        document.addEventListener('pointerdown', onClick, true);
        return;
      }
      cancelIfOrigin(ev); finish();        // dragged into place ('auto') or 'down' mode → drop here
    };
    const onClick = (ev) => { ev.preventDefault(); ev.stopPropagation(); cancelIfOrigin(ev); finish(); };
    const onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this._closeScope(sc); finish(); } };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('keydown', onKey, true);
    if (mode === 'up') document.addEventListener('pointerdown', onClick, true);
    else document.addEventListener('pointerup', onUp, true);   // 'down' and 'auto' watch the release
  }

  _scopeTapConnect(sc) {
    // Resume the (no-autoplay) context so the analyser actually receives samples — the modules only
    // process while it's running. Read-only: the engine still gates the speakers, so no sound.
    if (this.host.ctx.resume) this.host.ctx.resume();
    const tap = this._probeTap(sc.key, sc.portId);
    if (tap && tap.node) { try { tap.node.connect(sc.analyser, tap.index || 0); sc.tap = tap; } catch (_e) { sc.tap = null; } }
    sc.ringPos = 0; sc.ringFilled = 0; sc.lastCapTime = null; sc.vOffset = 0; sc.hOffset = 0;   // fresh source → discard stale samples, re-centre on 0
  }
  _scopeTapDisconnect(sc) {
    if (sc.tap && sc.tap.node) { try { sc.tap.node.disconnect(sc.analyser, sc.tap.index || 0); } catch (_e) { /* already gone */ } }
    sc.tap = null;
  }

  // Drives scopes AND keeps every viewer's callout (ring/line/dot) pinned to its terminal each
  // frame, so a monitor's loop tracks layout/zoom/focus changes instead of only snapping on
  // interaction. Runs while any scope OR monitor exists.
  _startScopeLoop() {
    if (this._scopeRaf) return;
    const tick = () => {
      if (!this._scopes.size && !this._monitors.size) { this._scopeRaf = null; return; }
      for (const sc of this._scopes) {
        // One-shot autoset: frame the signal once it's present (or give up after the budget),
        // then hold — the trace is free to grow and shrink so its dynamics stay readable.
        if (sc.autosetPending) {
          // Frame the signal the moment it's present. Only spend the give-up budget while the
          // context is RUNNING (else a scope created before sound-on would exhaust it on silence
          // and never auto-scale once sound starts).
          if (this._autosetScope(sc)) sc.autosetPending = false;
          else if (this.host.ctx.state === 'running' && --sc.autosetBudget <= 0) sc.autosetPending = false;
        }
        this._drawScope(sc); if (!sc.regrabbing) this._updateCallout(sc);
        if (sc.freqMode && sc.valuesEl && sc.valuesEl.classList.contains('show')) this._refreshScopeValues(sc);   // live CPS/period
      }
      for (const m of this._monitors) if (!m.regrabbing) this._updateCallout(m);
      this._scopeRaf = requestAnimationFrame(tick);
    };
    this._scopeRaf = requestAnimationFrame(tick);
  }

  // Size the canvas backing store to the logical size × the display DPR (style stays logical),
  // so the trace renders at true device resolution instead of a blurry 1× upscale.
  _sizeScopeCanvas(sc) {
    const dpr = window.devicePixelRatio || 1;
    sc.dpr = dpr;
    sc.canvas.width = Math.round(sc.cssW * dpr);
    sc.canvas.height = Math.round(sc.cssH * dpr);
    sc.canvas.style.width = sc.cssW + 'px';
    sc.canvas.style.height = sc.cssH + 'px';
  }

  _drawScope(sc) {
    const an = sc.analyser, buf = sc.buf, n = buf.length;
    if (!sc.frozen) { an.getFloatTimeDomainData(buf); this._captureRing(sc, buf, n); }   // frozen: keep the ring, still redraw so scroll re-scales it
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (let i = 0; i < n; i++) { const v = buf[i]; if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
    const mean = sum / n;
    let cross = 0, prev = buf[0] - mean;
    for (let i = 1; i < n; i++) { const d = buf[i] - mean; if ((d >= 0) !== (prev >= 0)) cross++; prev = d; }
    if (!sc.frozen) {
      sc.fastVotes = Math.max(-8, Math.min(8, sc.fastVotes + (cross >= 2 ? 1 : -1)));   // at least one full cycle → triggerable waveform; else roll
    }
    const fast = sc.forceMode === 'wave' ? true : sc.forceMode === 'roll' ? false : sc.fastVotes > 0;
    // One-shot: armed, wait for the level to rise through an auto threshold, capture
    // one sweep, then freeze. Fast signals capture a single buffer; slow signals
    // record forward for the full history window so the whole shape is held.
    if (sc.armed) {
      const curPeak = Math.max(Math.abs(hi), Math.abs(lo));
      const level = Math.max(0.02, 0.25 * curPeak);
      if (sc.recFrames > 0) { if (--sc.recFrames <= 0) { sc.armed = false; sc.frozen = true; } }
      else if (sc.prevPeak != null && sc.prevPeak < level && curPeak >= level) {
        if (fast) { sc.armed = false; sc.frozen = true; }
        else { sc.recFrames = sc.hist.length; sc.hist.fill(null); sc.histIdx = 0; }
      }
      sc.prevPeak = curPeak;
    }
    // Draw in CSS px with the context scaled to the display DPR, so the trace is razor-sharp on
    // Retina rather than a 1× bitmap upscaled by the browser.
    const W = sc.cssW, H = sc.cssH, g = sc.g2;
    g.setTransform(sc.dpr, 0, 0, sc.dpr, 0, 0);
    // Absolute vertical scale: amplitude/division across H/DIV_PX rows, centred on the vertical
    // OFFSET (0 for a bipolar signal; the midpoint for a DC-offset one, so autoset can centre it).
    // A taller window shows MORE divisions at the same amp/div (it doesn't magnify the trace).
    const halfV = SCOPE_VDIV[sc.vIdx] * (H / SCOPE_DIV_PX) / 2;
    const rlo = (sc.vOffset || 0) - halfV, rhi = (sc.vOffset || 0) + halfV;
    const yOf = (v) => H - ((v - rlo) / (rhi - rlo)) * H;
    g.clearRect(0, 0, W, H);
    this._drawGraticule(sc, g, W, H, yOf);
    g.strokeStyle = SCOPE_TRACE; g.lineWidth = 1.2; g.beginPath();
    if (fast) {
      // Absolute time base: each sample advances the trace by DIV_PX/(tDiv·sr) px, so a wider window
      // shows MORE cycles at the same time/div. Samples come from the long ring so even a slow sweep
      // fills the whole width; the trace ends at the newest sample (right edge), left-aligned to a
      // rising crossing for a stable lock.
      const sr = (this.host.ctx && this.host.ctx.sampleRate) || 48000;
      const pxPerSamp = SCOPE_DIV_PX / (SCOPE_TDIV[sc.tIdx] * sr);
      const R = sc.ringBuf, RL = R.length, filled = sc.ringFilled;
      const need = Math.min(filled, Math.ceil(W / pxPerSamp) + 1);
      const base = (sc.ringPos - filled + RL) % RL;      // logical 0 = oldest available, filled-1 = newest
      const at = (j) => R[(base + j) % RL];
      let start = Math.max(0, filled - need);            // default: window ends at the newest sample
      if (sc.trigger && need > 0) {                      // walk back to the most recent rising crossing (stable phase)
        const L = sc.trigLevel || 0, lo2 = Math.max(1, start - need);
        for (let i = start; i > lo2; i--) { if (at(i - 1) < L && at(i) >= L) { start = i; break; } }
      }
      const step = Math.max(1, Math.round(0.5 / pxPerSamp));       // decimate to ~2 pts/px
      // Horizontal pan: the trigger sample sits at x = off (0 = left edge). Draw around it, i<0
      // reaching back into earlier ring samples so the left fills when the trace is shoved right.
      const off = sc.hOffset || 0;
      let iMin = Math.floor((0 - off) / pxPerSamp) - 1, iMax = Math.ceil((W - off) / pxPerSamp) + 1;
      if (iMin < -start) iMin = -start;
      if (iMax > filled - 1 - start) iMax = filled - 1 - start;
      let first = true;
      for (let i = iMin; i <= iMax; i += step) {
        const x = i * pxPerSamp + off;
        const y = yOf(at(start + i)); if (first) { g.moveTo(x, y); first = false; } else g.lineTo(x, y);
      }
    } else {
      if (!sc.frozen) { const peak = Math.abs(hi) >= Math.abs(lo) ? hi : lo; sc.hist[sc.histIdx] = peak; sc.histIdx = (sc.histIdx + 1) % sc.hist.length; }
      const L = sc.hist.length, pxPerFrame = SCOPE_DIV_PX / (SCOPE_TDIV[sc.tIdx] * SCOPE_ROLL_FPS);
      const show = Math.max(2, Math.min(L, Math.ceil(W / pxPerFrame) + 1));
      const off = sc.hOffset || 0;
      let started = false;
      for (let i = 0; i < show; i++) {
        const v = sc.hist[((sc.histIdx - show + i) % L + L) % L]; if (v == null) { started = false; continue; }
        const px = W - (show - i) * pxPerFrame + off; if (px < 0 || px > W) { started = false; continue; }   // newest frame at the right edge
        const y = yOf(v); if (!started) { g.moveTo(px, y); started = true; } else g.lineTo(px, y);
      }
    }
    g.stroke();
    this._updateTrigLine(sc);   // keep the trigger line on its level as the vertical scale changes
  }

  // Append the newest samples of an analyser read into the scope's long ring buffer. How many are
  // "new" is counted off the audio clock (ctx.currentTime × sampleRate) since the last capture, so
  // consecutive overlapping reads stitch together gaplessly. A first read (or a long stall) takes
  // the whole buffer.
  _captureRing(sc, buf, n) {
    const ctx = this.host.ctx; if (!ctx) return;
    const t = ctx.currentTime;
    let newN = (sc.lastCapTime == null) ? n : Math.round((t - sc.lastCapTime) * ctx.sampleRate);
    sc.lastCapTime = t;
    if (newN <= 0) return;
    if (newN > n) newN = n;                 // stall longer than the buffer: take what we can
    const R = sc.ringBuf, RL = R.length;
    for (let i = n - newN; i < n; i++) { R[sc.ringPos] = buf[i]; sc.ringPos = (sc.ringPos + 1) % RL; }
    sc.ringFilled = Math.min(RL, sc.ringFilled + newN);
  }

  // Full division grid at a fixed SCOPE_DIV_PX pitch, with brighter coarse (decade) time lines.
  // Toggled by the G button.
  _drawGraticule(sc, g, W, H, yOf) {
    if (!sc.gridOn) return;
    const D = SCOPE_DIV_PX, y0 = H / 2;   // graticule is fixed to the face (screen centre), independent of the signal offset
    const fine = `rgba(160,170,160,${SCOPE_GRID_FINE})`, coarse = `rgba(160,170,160,${SCOPE_GRID_COARSE})`;
    g.lineWidth = 0.75;
    // Vertical (time) lines: fine every division, coarse on the decade lines (a power of 10 in the
    // time units — every `spacing` divisions), so a wider window keeps a readable decade grid.
    const spacing = decadeSpacing(SCOPE_TDIV[sc.tIdx]);
    for (let i = 0; i * D <= W + 0.5; i++) {
      const xr = Math.round(i * D) + 0.5;
      g.strokeStyle = (i % spacing === 0) ? coarse : fine;
      g.beginPath(); g.moveTo(xr, 0); g.lineTo(xr, H); g.stroke();
    }
    // Horizontal (amplitude) lines: uniform fine, out from the centre.
    g.strokeStyle = fine;
    for (let k = 0; y0 - k * D >= -0.5 || y0 + k * D <= H + 0.5; k++) {
      for (const y of (k === 0 ? [y0] : [y0 - k * D, y0 + k * D])) {
        if (y < -0.5 || y > H + 0.5) continue;
        const yr = Math.round(y) + 0.5; g.beginPath(); g.moveTo(0, yr); g.lineTo(W, yr); g.stroke();
      }
    }
    // Zero reference: the amplitude line at value 0, drawn BRIGHTER than the rest of the grid so the
    // user can see how the signal sits about zero. It tracks the vertical offset (via yOf), unlike
    // the centre-fixed graticule above, so it stays true to zero as the trace is panned.
    const yz = yOf(0);
    if (yz >= -0.5 && yz <= H + 0.5) {
      g.strokeStyle = SCOPE_GRID_ZERO; g.lineWidth = 1;
      const yr = Math.round(yz) + 0.5; g.beginPath(); g.moveTo(0, yr); g.lineTo(W, yr); g.stroke();
    }
  }

  // Read a short window and frame the signal into the 1-2-5 scales with headroom: the peak-to-peak
  // fills ~80% of the screen and is CENTRED on the face (the vertical offset removes any DC), the
  // time base shows ~3 cycles. Returns true once it has seen a real signal (so the caller stops
  // retrying); false on silence.
  _autosetScope(sc) {
    const buf = sc.buf, n = buf.length;
    sc.analyser.getFloatTimeDomainData(buf);
    let lo = Infinity, hi = -Infinity, sum = 0;
    for (let i = 0; i < n; i++) { const v = buf[i]; if (v < lo) lo = v; if (v > hi) hi = v; sum += v; }
    const peak = Math.max(Math.abs(hi), Math.abs(lo));
    if (peak < 1e-4) return false;   // silence — keep waiting
    // The analyser's window (~340ms) fills only after the tap connects: until then its FRONT is
    // still zeros while only the tail carries signal. Framing on that half-filled window mis-reads
    // the period (the zero front adds no crossings ⇒ a far-too-slow time base) and locks it in. So
    // wait until the signal has filled the whole window — the front carries signal too — which is
    // exactly the full-buffer state that pressing Autoset (A) sees, so the two frame identically.
    let fLo = Infinity, fHi = -Infinity; const fN = n >> 2;   // first quarter of the window
    for (let i = 0; i < fN; i++) { const v = buf[i]; if (v < fLo) fLo = v; if (v > fHi) fHi = v; }
    if (Math.max(Math.abs(fHi), Math.abs(fLo)) < 0.25 * peak) return false;   // window not yet full — keep waiting
    const mid = (lo + hi) / 2, halfSpan = Math.max(1e-4, (hi - lo) / 2);
    sc.hOffset = 0;   // reframing re-centres the trace horizontally too
    // Centre the display on the signal's midpoint — a unipolar envelope (0..1) or any DC-offset
    // signal then sits in the middle of the face rather than pushed to one half.
    sc.vOffset = mid;
    // Trigger at the midpoint — the steepest, most repeatable crossing, so the trace locks stably.
    sc.trigLevel = mid;
    // Vertical: fit the peak-to-peak into ~80% of the FULL height (halfSpan into 80% of a half-screen).
    const halfRows = (sc.cssH / SCOPE_DIV_PX) / 2;
    sc.vIdx = this._nearestStep(SCOPE_VDIV, (halfSpan / 0.8) / halfRows, 'up');
    const mean = sum / n; let cross = 0, prev = buf[0] - mean;
    for (let i = 1; i < n; i++) { const d = buf[i] - mean; if ((d >= 0) !== (prev >= 0)) cross++; prev = d; }
    if (cross >= 2) {
      const sr = (this.host.ctx && this.host.ctx.sampleRate) || 48000;
      const period = (n / (cross / 2)) / sr;                       // seconds per cycle
      sc.tIdx = this._nearestStep(SCOPE_TDIV, period / 2, 'near');  // ~2 divisions per cycle
    }
    this._refreshScopeValues(sc);   // keep the values panel current after a re-frame
    return true;
  }

  // Index into a 1-2-5 table: 'up' = the first step at or above `want` (so the signal fits);
  // 'near' = the closest step in log space.
  _nearestStep(arr, want, mode) {
    if (!(want > 0)) return Math.floor(arr.length / 2);
    if (mode === 'up') { for (let i = 0; i < arr.length; i++) if (arr[i] >= want) return i; return arr.length - 1; }
    let bi = 0, bd = Infinity;
    for (let i = 0; i < arr.length; i++) { const d = Math.abs(Math.log(arr[i] / want)); if (d < bd) { bd = d; bi = i; } }
    return bi;
  }

  // Step a scale one stop; 'v' = vertical (amplitude/div), 't' = time base. dir +1 coarser.
  _stepScope(sc, axis, dir) {
    if (axis === 'v') sc.vIdx = Math.max(0, Math.min(SCOPE_VDIV.length - 1, sc.vIdx + dir));
    else sc.tIdx = Math.max(0, Math.min(SCOPE_TDIV.length - 1, sc.tIdx + dir));
    this._refreshScopeValues(sc);   // update the (pinned) bottom panel if it's open
  }

  // Open the bottom values panel and keep it up (no auto-hide) — used while the pointer is over the
  // scope or its panel, and during any adjustment.
  _showScopeValues(sc) {
    const el = sc.valuesEl; if (!el) return;
    this._placeScopeValues(sc);
    el.classList.add('show');            // make it visible BEFORE measuring — scrollWidth is 0 while display:none
    this._refreshScopeValues(sc);        // now equalise the two number widths so the arrows don't overlap them
    clearTimeout(sc.valuesTimer); sc.valuesTimer = null;
  }
  // Start the countdown to hide the panel (after the pointer leaves the scope + panel). The
  // frequency readout is the exception — it stays PINNED so you can watch it while setting a
  // frequency on some panel knob elsewhere; only clicking a scope control or its face dismisses it.
  _hideScopeValuesSoon(sc) {
    const el = sc.valuesEl; if (!el || sc.freqMode) return;
    clearTimeout(sc.valuesTimer);
    sc.valuesTimer = setTimeout(() => el.classList.remove('show'), SCOPE_VALUES_HIDE_MS);
  }
  // Hide the panel at once — a click on the scope face dismisses it (and cancels any pending dwell).
  _hideScopeValues(sc) {
    clearTimeout(sc.dwellTimer); sc.dwellTimer = null;
    clearTimeout(sc.valuesTimer); sc.valuesTimer = null;
    if (sc.valuesEl) sc.valuesEl.classList.remove('show');
  }

  // One axis's value, e.g. "0.1 /div" or "2 ms/div".
  _scopeAxisText(sc, axis) {
    if (axis === 'v') return `${SCOPE_VDIV[sc.vIdx]} /div`;
    const t = SCOPE_TDIV[sc.tIdx];
    return t >= 1 ? `${t} s/div` : t >= 0.001 ? `${Math.round(t * 1e5) / 100} ms/div` : `${Math.round(t * 1e6)} µs/div`;
  }
  // Both scales for the menu label, e.g. "0.1 /div   2 ms/div".
  _scopeScaleText(sc) { return `${this._scopeAxisText(sc, 'v')}   ${this._scopeAxisText(sc, 't')}`; }

  // Build the value UI: a panel below the display showing the two scale numbers, shown while the
  // pointer is over the scope. Scrolling over the H or V number steps that scale (accumulated so a
  // flick is gentle; scroll-up = zoom IN). Scrolling over the T button nudges the trigger level.
  _buildScopeValues(sc) {
    const panel = document.createElement('div'); panel.className = 'scope-values';
    // Mirrored panel: [num][arrows]H | V[arrows][num] — H and V hug the centred divider, the
    // arrows just beyond them, the numbers beyond the arrows. Up = more magnification (value falls).
    const arrowsFor = (axis) => {
      const arrows = document.createElement('span'); arrows.className = 'scope-arrows';
      const up = document.createElement('button'); up.textContent = '\u25B2'; up.tabIndex = -1;
      const dn = document.createElement('button'); dn.textContent = '\u25BC'; dn.tabIndex = -1;
      up.addEventListener('click', (e) => { e.stopPropagation(); this._stepScope(sc, axis, -1); this._showScopeValues(sc); });
      dn.addEventListener('click', (e) => { e.stopPropagation(); this._stepScope(sc, axis, 1); this._showScopeValues(sc); });
      arrows.appendChild(up); arrows.appendChild(dn); return arrows;
    };
    const valEl = (axis) => { const v = document.createElement('span'); v.className = 'scope-val'; sc.valEls[axis] = v; return v; };
    const label = (t) => { const l = document.createElement('span'); l.className = 'scope-splabel'; l.textContent = t; return l; };
    const left = document.createElement('span'); left.className = 'scope-half scope-half-l';
    left.appendChild(valEl('t')); left.appendChild(arrowsFor('t')); left.appendChild(label('H'));   // H = horizontal (time)
    const divEl = document.createElement('span'); divEl.className = 'scope-vdiv'; divEl.textContent = '\u2502';
    const right = document.createElement('span'); right.className = 'scope-half scope-half-r';
    right.appendChild(label('V')); right.appendChild(arrowsFor('v')); right.appendChild(valEl('v'));   // V = vertical
    panel.appendChild(left); panel.appendChild(divEl); panel.appendChild(right);
    // Frequency readout: replaces the scale halves while the wave (CPS) button is active —
    // cycles-per-second on the left, the period on the right, same mirrored layout.
    const freq = document.createElement('span'); freq.className = 'scope-freq';
    const fCps = document.createElement('span'); fCps.className = 'scope-val';
    const fDiv = document.createElement('span'); fDiv.className = 'scope-vdiv'; fDiv.textContent = '│';
    const fPer = document.createElement('span'); fPer.className = 'scope-val';
    freq.appendChild(fCps); freq.appendChild(fDiv); freq.appendChild(fPer);
    freq.style.display = 'none';
    panel.appendChild(freq);
    sc._valHalves = { left, div: divEl, right }; sc.freqEls = { wrap: freq, cps: fCps, per: fPer };
    panel.addEventListener('pointerdown', (e) => e.stopPropagation());   // never starts a face gesture
    // Scroll over the H/V group to step that scale, accumulated so a trackpad flick is gentle.
    this._attachValueWheel(left, sc, 't');
    this._attachValueWheel(right, sc, 'v');
    // (The scope is repositioned by dragging the white move-dot on its edge — see _createScope.)
    // Lower-left transport button: pause/resume the trace. Only visible on hover over the scope.
    const play = document.createElement('div'); play.className = 'scope-playpause';
    play.addEventListener('pointerdown', (e) => e.stopPropagation());
    play.addEventListener('click', (e) => { e.stopPropagation(); this._exitFreqMode(sc); sc.frozen = !sc.frozen; this._updateScopePlayPause(sc); });
    // Upper-left trigger button: T (triggered) / F (free running). Only visible on hover.
    const trig = document.createElement('div'); trig.className = 'scope-trigbtn';
    trig.addEventListener('pointerdown', (e) => e.stopPropagation());
    trig.addEventListener('click', (e) => { e.stopPropagation(); this._exitFreqMode(sc); sc.trigger = !sc.trigger; this._updateScopeTrigBtn(sc); });
    trig.addEventListener('wheel', (e) => this._trigWheel(e, sc), { passive: false });   // scroll = trigger level
    // Autoset button (a momentary "A" just right of the transport button): re-frames on press,
    // showing a pressed state while held.
    const auto = document.createElement('div'); auto.className = 'scope-autobtn'; auto.textContent = 'A';
    auto.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); auto.setPointerCapture && auto.setPointerCapture(e.pointerId); auto.classList.add('pressed'); this._exitFreqMode(sc); this._scopeAutoset(sc); });
    const autoUp = () => auto.classList.remove('pressed');
    auto.addEventListener('pointerup', autoUp); auto.addEventListener('pointercancel', autoUp);
    // Grid button (a momentary "G" right of "A"): toggles the grid on/off.
    const grid = document.createElement('div'); grid.className = 'scope-gridbtn'; grid.textContent = 'G';
    grid.addEventListener('pointerdown', (e) => { e.stopPropagation(); e.preventDefault(); grid.setPointerCapture && grid.setPointerCapture(e.pointerId); grid.classList.add('pressed'); sc.gridOn = !sc.gridOn; });
    const gridUp = () => grid.classList.remove('pressed');
    grid.addEventListener('pointerup', gridUp); grid.addEventListener('pointercancel', gridUp);
    // Frequency button (the two-cycle sine wave, right of "G"): put the readout box into frequency
    // mode — live cycles-per-second and period — until another control or the face is clicked.
    const fbtn = document.createElement('div'); fbtn.className = 'scope-freqbtn'; fbtn.innerHTML = SCOPE_FREQ_ICON;
    fbtn.addEventListener('pointerdown', (e) => e.stopPropagation());
    fbtn.addEventListener('click', (e) => { e.stopPropagation(); sc.freqMode = !sc.freqMode; fbtn.classList.toggle('on', sc.freqMode); this._showScopeValues(sc); });
    // Close button (upper-right ×): remove the scope. Only visible on hover.
    const close = document.createElement('div'); close.className = 'scope-closebtn'; close.textContent = '×';
    close.addEventListener('pointerdown', (e) => e.stopPropagation());
    close.addEventListener('click', (e) => { e.stopPropagation(); this._closeScope(sc); });
    // Trigger-level line: an orange horizontal line (shown only while triggered) you drag up/down.
    // Trigger-level line: purely a readout (pointer-events:none in CSS), adjusted only by scrolling
    // over the T button — so even when it sits at the top, over T, the scroll reaches T.
    const trigLine = document.createElement('div'); trigLine.className = 'scope-triglevel';
    sc.trigLine = trigLine;
    // Reliable custom tooltips (native title is flaky over small hover-revealed controls).
    this._attachScopeTip(play, 'run/freeze');
    this._attachScopeTip(trig, 'triggered mode · scroll = level');
    this._attachScopeTip(auto, 'auto scale');
    this._attachScopeTip(grid, 'grid');
    this._attachScopeTip(fbtn, 'frequency (CPS + period)');
    this._attachScopeTip(close, 'close');
    sc.el.appendChild(panel); sc.el.appendChild(play); sc.el.appendChild(trig); sc.el.appendChild(auto); sc.el.appendChild(grid); sc.el.appendChild(fbtn); sc.el.appendChild(close); sc.el.appendChild(trigLine);
    sc.valuesEl = panel; sc.playBtn = play; sc.trigBtn = trig; sc.freqBtn = fbtn;
    this._updateScopePlayPause(sc); this._updateScopeTrigBtn(sc);
    this._placeScopeValues(sc);
    this._refreshScopeValues(sc);
  }
  // Hang the values panel just below the scope's OUTER bottom edge (canvas + 1px border). It's out
  // of flow, so it never grows the frame.
  _placeScopeValues(sc) {
    const outer = sc.cssH + 1;   // scope's outer bottom edge with zero padding (canvas + 1px border)
    if (sc.valuesEl) {
      sc.valuesEl.style.top = (outer + 5) + 'px';   // font is a fixed size (CSS) — it never scales with the scope
    }
  }
  // The bottom values panel is manual only: clicking the affordance pins it open (both scales),
  // and it updates live while pinned. Transient feedback during a change is the pointer HUD.
  // In frequency mode it instead shows the live cycles-per-second and period readout.
  _refreshScopeValues(sc) {
    const vt = sc.valEls && sc.valEls.t, vv = sc.valEls && sc.valEls.v; if (!vt || !vv) return;
    const half = sc._valHalves, fq = sc.freqEls;
    if (sc.freqMode && half && fq) {
      half.left.style.display = 'none'; half.div.style.display = 'none'; half.right.style.display = 'none';
      fq.wrap.style.display = 'flex';
      const m = this._measureScopeFreq(sc);
      fq.cps.textContent = m ? this._fmtCps(m.hz) : '—';       // em dash on no measurable pitch
      fq.per.textContent = m ? this._fmtPeriod(m.periodSec) : '—';
      return;
    }
    if (half && fq) { fq.wrap.style.display = 'none'; half.left.style.display = ''; half.div.style.display = ''; half.right.style.display = ''; }
    vt.style.width = ''; vv.style.width = '';
    vt.textContent = this._scopeAxisText(sc, 't');
    vv.textContent = this._scopeAxisText(sc, 'v');
    // Give both numbers the width of the wider one, so the two halves match and the divider stays
    // centred — while the panel is still only as wide as the current values need.
    const w = Math.max(vt.scrollWidth, vv.scrollWidth);
    vt.style.width = w + 'px'; vv.style.width = w + 'px';
  }
  // Leave frequency mode and restore the scale readout (a click on any other control or the face).
  _exitFreqMode(sc) {
    if (!sc.freqMode) return;
    sc.freqMode = false;
    if (sc.freqBtn) sc.freqBtn.classList.remove('on');
    this._refreshScopeValues(sc);
  }
  // Dismiss EVERY pinned frequency readout at once and hide its panel — used when a click lands on a
  // panel background (you're done watching the frequency), since the pointer is nowhere near the scope.
  _exitAllFreqMode() {
    if (!this._scopes) return;
    for (const sc of this._scopes) if (sc.freqMode) { this._exitFreqMode(sc); this._hideScopeValues(sc); }
  }
  _fmtCps(hz) {
    const v = hz >= 1000 ? Math.round(hz) : hz >= 100 ? Math.round(hz * 10) / 10 : Math.round(hz * 100) / 100;
    return `${v} CPS`;
  }
  _fmtPeriod(sec) {
    return sec >= 1 ? `${Math.round(sec * 100) / 100} s`
      : sec >= 1e-3 ? `${Math.round(sec * 1e5) / 100} ms`
      : `${Math.round(sec * 1e7) / 10} µs`;
  }
  // Measure the signal's fundamental over the scope's sample RING (a window of the last ~1.5s, longer
  // than the analyser alone so slow clock/LFO rates still show two cycles). Cross at the amplitude
  // MIDPOINT, not the mean: a low-duty pulse's mean hugs its baseline, so a mean threshold never gets
  // crossed and it reads nothing. Count RISING edges only — exactly one per period and evenly spaced —
  // so a narrow pulse measures the same as a sine (counting every crossing would bunch a pulse's rise
  // and fall together and misread it). Hysteresis (arm below, fire above) rejects noise wiggle.
  // Throttled to ~10Hz since it sweeps the whole window. Returns { hz, periodSec } or null.
  _measureScopeFreq(sc) {
    const R = sc.ringBuf, RL = R.length, filled = sc.ringFilled;
    if (filled < 8) return null;
    const now = (typeof performance !== 'undefined') ? performance.now() : 0;
    if (sc._freqT != null && (now - sc._freqT) < 100) return sc._freqCache || null;   // reuse the recent reading
    sc._freqT = now;
    const sr = (this.host.ctx && this.host.ctx.sampleRate) || 48000;
    const N = Math.min(filled, Math.round(sr * 1.5));         // most recent ~1.5s: slow enough for clocks, responsive enough to watch
    const base = ((sc.ringPos - N) % RL + RL) % RL;
    let lo = Infinity, hi = -Infinity;
    for (let j = 0; j < N; j++) { const v = R[(base + j) % RL]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo;
    if (span < 1e-3) { sc._freqCache = null; return null; }   // silence / DC — no amplitude to cross
    const mid = (lo + hi) / 2, band = span * 0.1;
    let armed = false, rises = 0, firstRise = -1, lastRise = -1;
    for (let j = 0; j < N; j++) {
      const d = R[(base + j) % RL] - mid;
      if (d < -band) armed = true;
      else if (d > band && armed) { rises++; if (firstRise < 0) firstRise = j; lastRise = j; armed = false; }
    }
    if (rises < 2 || lastRise <= firstRise) { sc._freqCache = null; return null; }   // need two rising edges (one period)
    const periodSec = ((lastRise - firstRise) / sr) / (rises - 1);
    const res = (periodSec > 0) ? { hz: 1 / periodSec, periodSec } : null;
    sc._freqCache = res;
    return res;
  }
  // The transport button shows the ACTION: pause bars while running, play triangle while frozen.
  // The trigger button is hidden while frozen (triggering is moot on a held trace).
  _updateScopePlayPause(sc) {
    if (!sc.playBtn) return;
    sc.playBtn.innerHTML = sc.frozen ? SCOPE_PLAY_ICON : SCOPE_PAUSE_ICON;
    if (sc.trigBtn) sc.trigBtn.style.display = sc.frozen ? 'none' : '';
  }
  // A reliable custom tooltip for a scope control: shows immediately on hover, follows the
  // pointer, and clears on leave (native title tooltips are unreliable over these small controls).
  _attachScopeTip(el, text) {
    const show = (e) => {
      let tip = this._scopeTip;
      if (!tip) { tip = document.createElement('div'); tip.className = 'scope-tip'; document.body.appendChild(tip); this._scopeTip = tip; }
      tip.textContent = text;
      tip.style.left = Math.round(e.clientX + 10) + 'px';
      tip.style.top = Math.round(e.clientY + 16) + 'px';
      tip.classList.add('show');
    };
    el.addEventListener('pointerenter', show);
    el.addEventListener('pointermove', show);
    el.addEventListener('pointerleave', () => { if (this._scopeTip) this._scopeTip.classList.remove('show'); });
  }

  // Re-frame the signal (the Autoset action): resume if frozen, and re-run the one-shot framing.
  _scopeAutoset(sc) {
    sc.autosetPending = true; sc.autosetBudget = 180; sc.frozen = false;
    this._updateScopePlayPause(sc);
  }
  // The trigger button always reads "T": highlighted (orange) when triggered, dimmed when free.
  _updateScopeTrigBtn(sc) {
    if (!sc.trigBtn) return;
    sc.trigBtn.textContent = 'T';
    sc.trigBtn.classList.toggle('on', !!sc.trigger);
  }
  // Amplitude at the top/bottom edge for the current vertical scale (half the screen height).
  _scopeHalfV(sc) { return SCOPE_VDIV[sc.vIdx] * (sc.cssH / SCOPE_DIV_PX) / 2; }
  // Position/show the orange trigger-level line — visible only while triggered and running.
  _updateTrigLine(sc) {
    const line = sc.trigLine; if (!line) return;
    if (!sc.trigger || sc.frozen) { line.style.display = 'none'; return; }
    const halfV = this._scopeHalfV(sc), off = sc.vOffset || 0;
    const lv = Math.max(off - halfV, Math.min(off + halfV, sc.trigLevel || 0));   // clamp to the visible range around the offset
    line.style.display = 'block';
    line.style.top = Math.round(sc.cssH * (0.5 - (lv - off) / (2 * halfV))) + 'px';   // centred on the offset, same as the trace
  }
  // Which edge (if any) the pointer is within the grab margin of — 'l'/'r'/'t'/'b', else null.
  // The stretch of the edge under the move-tab is excluded (no resize there).
  // Which resize spot (if any) the pointer is on: 'l'/'r'/'t'/'b' edges, or a corner 'tl'/'tr'/'bl'/'br'
  // (a little roomier, resizing both dimensions). The area BELOW the face is excluded — that's the
  // settings panel, which isn't resizable — so its top border never reads as the scope's bottom edge.
  _scopeEdgeAt(sc, ev) {
    const r = sc.canvas.getBoundingClientRect(), M = 7, CM = 11;
    const x = ev.clientX - r.left, y = ev.clientY - r.top;
    if (x < -M || x > r.width + M || y < -M || y > r.height) return null;   // no bottom overhang (settings panel)
    const nL = x <= M, nR = x >= r.width - M, nT = y <= M, nB = y >= r.height - M;
    const cL = x <= CM, cR = x >= r.width - CM, cT = y <= CM, cB = y >= r.height - CM;
    if (cT && cL) return 'tl';
    if (cT && cR) return 'tr';
    if (cB && cL) return 'bl';
    if (cB && cR) return 'br';
    return nL ? 'l' : nR ? 'r' : nT ? 't' : nB ? 'b' : null;   // interior → null (it drags to move)
  }

  // Drag an edge (one dimension) or a corner (both) to resize; the OPPOSITE edge stays put, so
  // dragging a left/top edge also shifts the scope's origin. Resizing clears the canvas; the loop redraws.
  _resizeScopeEdge(ev, sc, edge) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const startX = ev.clientX, startY = ev.clientY, startW = sc.cssW, startH = sc.cssH;
    const startLeft = parseFloat(sc.el.style.left) || 0, startTop = parseFloat(sc.el.style.top) || 0;
    const cW = (w) => Math.round(Math.max(60, Math.min(640, w)));
    const cH = (h) => Math.round(Math.max(24, Math.min(400, h)));
    const hasL = edge.includes('l'), hasR = edge.includes('r'), hasT = edge.includes('t'), hasB = edge.includes('b');
    sc._resizing = true;
    const onMove = (e2) => {
      const dx = e2.clientX - startX, dy = e2.clientY - startY;
      if (hasR) sc.cssW = cW(startW + dx);
      else if (hasL) { const w = cW(startW - dx); sc.el.style.left = Math.round(startLeft + (startW - w)) + 'px'; sc.cssW = w; }
      if (hasB) sc.cssH = cH(startH + dy);
      else if (hasT) { const h = cH(startH - dy); sc.el.style.top = Math.round(startTop + (startH - h)) + 'px'; sc.cssH = h; }
      this._sizeScopeCanvas(sc);    // re-scale the backing store to the new logical size
      this._placeScopeValues(sc);   // keep the values panel placed as the display resizes
      this._updateCallout(sc);
    };
    const onUp = () => { sc._resizing = false; document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
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
    const jr = this._jackClientRect(jel);   // the terminal itself, NOT its wider hit-pad
    const px = jr.left + jr.width / 2, py = jr.top + jr.height / 2;
    const rr = Math.max(jr.width, jr.height) / 2 + 3;
    sc.ring.setAttribute('cx', r2(px)); sc.ring.setAttribute('cy', r2(py)); sc.ring.setAttribute('r', r2(rr));
    sc.ring.setAttribute('stroke', col); sc.ring.setAttribute('stroke-width', lw);
    // Line from the loop to the CENTRE of the control's side that's closest to the
    // terminal — dynamic, so it re-picks the facing side as the control moves. The four
    // candidates are the mid-points of the box's sides (for the circular monitor, its
    // cardinal edge points); nearest to the loop wins. The carry/drag grab point stays
    // the left-centre regardless — this only steers the drawn line.
    const sr = sc.el.getBoundingClientRect();
    const midX = sr.left + sr.width / 2, midY = sr.top + sr.height / 2;
    // The line ends at the mid-point of whichever scope side faces the terminal, re-picked as the
    // scope moves.
    const sides = [[sr.left, midY], [sr.right, midY], [midX, sr.top], [midX, sr.bottom]];
    let cx = sr.left, cy = midY, bd = Infinity;
    for (const [sx, sy] of sides) { const d = (sx - px) * (sx - px) + (sy - py) * (sy - py); if (d < bd) { bd = d; cx = sx; cy = sy; } }
    const u = unit(cx - px, cy - py);
    const jx = px + u.x * rr, jy = py + u.y * rr;   // where the line meets the loop
    sc.line.setAttribute('x1', r2(jx)); sc.line.setAttribute('y1', r2(jy));
    sc.line.setAttribute('x2', r2(cx)); sc.line.setAttribute('y2', r2(cy));
    sc.line.setAttribute('stroke', col); sc.line.setAttribute('stroke-width', lw);
    if (sc.dot) { sc.dot.style.left = r2(jx) + 'px'; sc.dot.style.top = r2(jy) + 'px'; }
  }

  // Scroll over the H/V number group to step that scale. Clicking or scrolling the scope FACE
  // itself does nothing — scale is set only from the numbers.
  _attachValueWheel(elm, sc, axis) {
    elm.addEventListener('wheel', (ev) => { ev.preventDefault(); ev.stopPropagation(); this._wheelStep(sc, axis, ev, 'val_' + axis); }, { passive: false });
  }

  // Shared accumulated wheel stepping (one 1-2-5 stop per STEP of scroll). Each `key` keeps its own
  // accumulator, and a >250 ms pause discards any partial motion so the next stop is always the
  // same distance away. Scroll up (deltaY < 0) = zoom IN (finer).
  _wheelStep(sc, axis, ev, key) {
    const now = performance.now();
    sc._wLast = sc._wLast || {}; sc._wAcc = sc._wAcc || {};
    if (now - (sc._wLast[key] || 0) > 250) sc._wAcc[key] = 0;
    sc._wLast[key] = now;
    const norm = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    sc._wAcc[key] = (sc._wAcc[key] || 0) + ev.deltaY * norm;
    const STEP = 60;   // scroll distance per 1-2-5 stop
    while (Math.abs(sc._wAcc[key]) >= STEP) {
      const s = sc._wAcc[key] < 0 ? -1 : 1; sc._wAcc[key] -= s * STEP;
      this._stepScope(sc, axis, s);   // scroll up (s = -1) → finer
    }
    this._showScopeValues(sc);
  }

  // Scroll over the T button to nudge the trigger level (the orange line follows). Scroll up raises
  // the level; clamped to the visible half-screen.
  _trigWheel(ev, sc) {
    ev.preventDefault(); ev.stopPropagation();
    const norm = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const halfV = this._scopeHalfV(sc), off = sc.vOffset || 0;
    sc.trigLevel = Math.max(off - halfV, Math.min(off + halfV, (sc.trigLevel || 0) - ev.deltaY * norm * halfV * 0.0015));
    this._updateTrigLine(sc);
    this._showScopeValues(sc);
  }

  // Reposition the scope by dragging the white move-dot on its edge (where the line attaches).
  _moveScope(ev, sc) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const r = sc.el.getBoundingClientRect();
    const ox = ev.clientX - r.left, oy = ev.clientY - r.top, sx = ev.clientX, sy = ev.clientY;
    let moved = false;
    const onMove = (e2) => {
      if (!moved && Math.hypot(e2.clientX - sx, e2.clientY - sy) < 4) return;   // ignore a click's micro-jitter
      moved = true;
      sc.el.style.left = Math.round(e2.clientX - ox) + 'px'; sc.el.style.top = Math.round(e2.clientY - oy) + 'px'; this._updateCallout(sc);
    };
    const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }

  // Pan the trace with the wheel over the face: vertical scroll shifts it up/down, horizontal
  // scroll shifts it left/right, and cmd+vertical shifts left/right too (for mice with no
  // horizontal wheel). Scale is still set only from the H/V numbers, which swallow their own scroll.
  _scopePanWheel(ev, sc) {
    ev.preventDefault(); ev.stopPropagation();
    const scale = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
    const dy = ev.deltaY * scale, dx = ev.deltaX * scale;
    if (ev.metaKey) this._panScopeH(sc, dy);                       // cmd + vertical → horizontal
    else if (Math.abs(dx) > Math.abs(dy)) this._panScopeH(sc, dx); // native horizontal scroll
    else this._panScopeV(sc, dy);                                  // vertical scroll
  }
  // Vertical pan: scroll up moves the trace up, ~20% of the visible window per wheel notch.
  _panScopeV(sc, d) {
    const halfV = SCOPE_VDIV[sc.vIdx] * (sc.cssH / SCOPE_DIV_PX) / 2;   // half the window, in signal units
    sc.vOffset = (sc.vOffset || 0) + (d / 100) * 0.2 * (2 * halfV);
  }
  // Horizontal pan: positive delta shifts the trace right; clamp to ~one width each way.
  _panScopeH(sc, d) {
    const lim = sc.cssW;
    sc.hOffset = Math.max(-lim, Math.min(lim, (sc.hOffset || 0) + d * 0.35));
  }

  // Right-click a scope: trigger mode, display override, reset scaling. (Freeze is a
  // click on the face, not a menu item.)
  _scopeMenu(ev, sc) {
    ev.preventDefault(); ev.stopPropagation();
    const mode = (m, label) => ({ label, checkFn: () => sc.forceMode === m, action: () => { sc.forceMode = m; } });
    const step = (axis, label, dir) => ({ label, action: () => this._stepScope(sc, axis, dir) });
    this._openMenu(ev.clientX, ev.clientY, [
      { label: 'Autoset', action: () => this._scopeAutoset(sc) },
      { label: sc.frozen ? 'Run' : 'Freeze', action: () => { sc.frozen = !sc.frozen; this._updateScopePlayPause(sc); } },
      { label: 'Scale', submenu: [
        { label: this._scopeScaleText(sc), disabled: true },
        step('v', 'Vertical  finer', -1), step('v', 'Vertical  coarser', 1),
        step('t', 'Time base  faster', -1), step('t', 'Time base  slower', 1),
      ] },
      { label: 'Trigger', submenu: [
        { label: sc.armed ? 'Cancel single' : 'Single (arm)', action: () => {
            if (sc.armed) { sc.armed = false; }
            else { sc.armed = true; sc.frozen = false; sc.recFrames = 0; sc.prevPeak = null; sc.hist.fill(null); sc.histIdx = 0; }
          } },
        { label: sc.trigger ? 'Free-running' : 'Triggered', action: () => { sc.trigger = !sc.trigger; this._updateScopeTrigBtn(sc); } },
      ] },
      { label: 'Display', submenu: [mode('auto', 'Auto'), mode('wave', 'Waveform'), mode('roll', 'Roll')] },
    ]);
  }

  // Drag the ring off its port and onto another to re-probe that port; drop it on
  // empty space (not a port) to DISCONNECT the scope from its port.
  _regrabScope(ev, sc) {
    if (ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    const sx = ev.clientX, sy = ev.clientY; let moved = false;   // the dot: DRAG to re-probe, plain CLICK to close
    sc.regrabbing = true;                  // stop the loop resetting the loop/dot to the old port
    sc.dot.style.pointerEvents = 'none';   // so the drop hit-test finds the jack, not this dot
    const onMove = (e2) => {
      if (!moved && Math.hypot(e2.clientX - sx, e2.clientY - sy) > 4) moved = true;
      const px = e2.clientX, py = e2.clientY;
      sc.ring.setAttribute('cx', r2(px)); sc.ring.setAttribute('cy', r2(py));
      sc.line.setAttribute('x1', r2(px)); sc.line.setAttribute('y1', r2(py));
      sc.dot.style.left = r2(px) + 'px'; sc.dot.style.top = r2(py) + 'px';
    };
    const onUp = (e2) => {
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
      if (!moved) { sc.dot.style.pointerEvents = ''; sc.regrabbing = false; this._closeScope(sc); return; }   // a plain click on the dot closes the scope
      const drop = this._jackFromPoint(e2.clientX, e2.clientY);   // hit-test while the dot is still pe:none, so it finds the jack, not the dot
      sc.dot.style.pointerEvents = '';
      if (!drop) { this._closeScope(sc); return; }   // loop dropped on the panel → delete it (like a cable pulled off a terminal)
      this._scopeTapDisconnect(sc); sc.hist.fill(null); sc.histIdx = 0;
      sc.frozen = false; sc.armed = false; this._updateScopePlayPause(sc);   // moving to a new terminal resumes live display
      sc.autosetPending = true; sc.autosetBudget = 180;   // re-frame for the newly probed signal
      sc.key = drop.key; sc.portId = drop.portId; this._scopeTapConnect(sc);
      sc.regrabbing = false;
      this._updateCallout(sc);
    };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }

  _closeScope(sc) {
    this._scopeTapDisconnect(sc);
    if (this._scopeTip) this._scopeTip.classList.remove('show');   // the button vanishes before its pointerleave → hide the stuck tooltip
    sc.el.remove(); sc.ring.remove(); sc.line.remove(); sc.dot.remove();
    this._scopes.delete(sc);
    if (sc.showCallout !== false) this.onChange();   // removing a placed scope changes the patch
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
      // Monitor master: the mixer's master fader drives this while the output radio is on Monitor
      // (its own remembered level, independent of the main master).
      if (this._monLevel == null) this._monLevel = MON_LEVEL_DEFAULT;
      const monMaster = ctx.createGain(); monMaster.gain.value = this._monLevel;
      this._monMasterGain = monMaster;
      // Monitor VU tap: post-fader, so the meter shows the monitor level regardless of the enable/
      // engine (scaled by MON_MAKEUP in monVuLevel() to read comparably to the master meter).
      const monVu = ctx.createAnalyser(); monVu.fftSize = 256; monVu.smoothingTimeConstant = 0;
      this._monVuAnalyser = monVu; this._monVuBuf = new Float32Array(monVu.fftSize);
      monMaster.connect(monVu);
      // Mode gate: audible only while the radio is on Monitor (0 on Master).
      const monRec = this._mixerRec(); const modeGate = ctx.createGain();
      modeGate.gain.value = (monRec && monRec.values.get('monitorEnable') === 'on') ? 1 : 0;
      this._monModeGate = modeGate;
      // Engine gate: monitors follow the master engine on/off (0 while the engine is off).
      const engineGate = ctx.createGain(); engineGate.gain.value = this.isPlaying() ? 1 : 0;
      this._monEngineGate = engineGate;
      const makeup = ctx.createGain(); makeup.gain.value = MON_MAKEUP;   // match the main output's makeup
      const lim = ctx.createDynamicsCompressor();
      lim.threshold.value = -1; lim.knee.value = 0; lim.ratio.value = 20; lim.attack.value = 0.003; lim.release.value = 0.12;
      this._monBus.connect(monMaster); monMaster.connect(modeGate); modeGate.connect(engineGate);
      engineGate.connect(makeup); makeup.connect(lim); lim.connect(ctx.destination);
      // Preview injection: the momentary "Listen" hover joins here, AFTER the mode/engine gates, so a
      // terminal can always be auditioned regardless of the Monitor enable or the engine. A fixed
      // level (like the default monitor fader) keeps it comparable to a placed monitor.
      const preview = ctx.createGain(); preview.gain.value = MON_LEVEL_DEFAULT;
      this._monPreviewGain = preview; preview.connect(makeup);
    }
    if (this.host.ctx.resume) this.host.ctx.resume();
    return this._monBus;
  }

  // Gate the monitor bus by the master engine on/off (called when the mixer's masterMute changes).
  _setMonEngineGate(on) {
    if (this._monEngineGate) this._monEngineGate.gain.setTargetAtTime(on ? 1 : 0, this.host.ctx.currentTime, 0.008);
  }

  // The pinned mixer's record (the output stage).
  _mixerRec() {
    for (const rec of this.records.values()) if (rec.descriptorId === 'mixer') return rec;
    return null;
  }

  // Turn the monitor bus on/off by setting the mixer's monitorEnable param (updates the lamp and,
  // via _setParam, applies the routing).
  _enableMonitorBus(on) {
    const rec = this._mixerRec();
    if (rec) this.applyParam(rec, 'monitorEnable', on ? 'on' : 'off');
    else this._applyBusEnables();
  }

  // Apply the two INDEPENDENT bus enables: masterEnable gates the main output, monitorEnable gates
  // the monitor bus (both, neither, or one can play). Both are still gated by the engine. The
  // channel faders gray while the master bus is off (they don't reach the speakers then).
  _applyBusEnables() {
    const rec = this._mixerRec(); if (!rec) return;
    const masterOn = rec.values.get('masterEnable') !== 'off';
    const monitorOn = rec.values.get('monitorEnable') === 'on';
    const mix = this._mixerInstance();
    if (mix && mix.setSolo) mix.setSolo(!masterOn);   // soloDuck ducks the main output when master is disabled
    if (this._monModeGate) this._monModeGate.gain.setTargetAtTime(monitorOn ? 1 : 0, this.host.ctx.currentTime, 0.008);
    this._setChannelsGrayed(!masterOn);
    this._refreshMonHighlights();
  }

  // A monitor is "live" — green ring, pulsing — while the monitor bus is enabled and it isn't muted.
  // Toggle the class here; the pulse loop drives the glow.
  _refreshMonHighlights() {
    const rec = this._mixerRec();
    const on = !!(rec && rec.values.get('monitorEnable') === 'on');
    let any = false;
    for (const m of this._monitors) {
      const live = on && !m.muted;
      m.el.classList.toggle('mon-live', live);
      if (!live) { m.el.style.boxShadow = ''; m.pulse = 0; }   // hand the ring back to CSS (muted red, or none)
      else any = true;
    }
    if (any) this._startMonPulse(); // else the loop stops itself when nothing is live
  }

  // Log-scaled (VU-style) level of a monitor's SOURCE signal, 0..1.
  _monSignalLevel(m) {
    if (!m.pulseAn || !m.tap) return 0;
    m.pulseAn.getFloatTimeDomainData(m.pulseBuf);
    let s = 0; for (let i = 0; i < m.pulseBuf.length; i++) s += m.pulseBuf[i] * m.pulseBuf[i];
    const rms = Math.sqrt(s / m.pulseBuf.length);
    if (rms <= 0) return 0;
    const db = 20 * Math.log10(rms);
    return Math.max(0, Math.min(1, (db - MON_PULSE_FLOOR_DB) / -MON_PULSE_FLOOR_DB));
  }

  _startMonPulse() {
    if (this._monPulseRaf) return;
    const tick = () => {
      let any = false;
      for (const m of this._monitors) {
        if (!m.el.classList.contains('mon-live')) continue;
        any = true;
        const target = this._monSignalLevel(m);
        m.pulse = (m.pulse || 0) * 0.6 + target * 0.4;   // smooth the breathe
        const g = m.pulse;
        const blur = (3 + g * 11).toFixed(1), spread = (g * 3).toFixed(1), alpha = (0.2 + g * 0.6).toFixed(2);
        m.el.style.boxShadow = `inset 0 0 0 2px #3ad16b, 0 0 ${blur}px ${spread}px rgba(58,209,107,${alpha}), 0 4px 12px rgba(0,0,0,0.5)`;
      }
      if (any) this._monPulseRaf = requestAnimationFrame(tick);
      else this._monPulseRaf = null;
    };
    this._monPulseRaf = requestAnimationFrame(tick);
  }

  // RMS level (0..~1) of the monitor bus, for its VU meter (scaled to match the master meter).
  monVuLevel() {
    const an = this._monVuAnalyser; if (!an) return 0;
    an.getFloatTimeDomainData(this._monVuBuf);
    let s = 0; for (let i = 0; i < this._monVuBuf.length; i++) s += this._monVuBuf[i] * this._monVuBuf[i];
    return Math.min(1, Math.sqrt(s / this._monVuBuf.length) * MON_MAKEUP);
  }

  // The monitor-bus master gain, driven by the mixer's Monitor fader.
  _setMonMaster(v) {
    this._monLevel = v;
    if (this._monMasterGain) this._monMasterGain.gain.setTargetAtTime(v, this.host.ctx.currentTime, 0.02);
  }

  // Dim the mixer's channel faders while the monitor bus is the output (they don't feed it).
  _setChannelsGrayed(on) {
    const rec = this._mixerRec();
    if (rec && rec.el) rec.el.classList.toggle('mixer-monitor-mode', !!on);
  }

  // Route a terminal's tap into the monitor bus at a level that respects the master
  // output gain; the bus limiter guards against anything much hotter (ear/speaker
  // safety). Muted monitors carry no tap.
  _monTapConnect(m) {
    m.gain.gain.value = this._monGainMul(m.vol != null ? m.vol : MON_VOL_DEFAULT);   // per-monitor level; the monitor master (fader) scales the whole bus
    const tap = this._probeTap(m.key, m.portId);
    if (tap && tap.node) {
      try { tap.node.connect(m.gain, tap.index || 0); m.tap = tap; } catch (_e) { m.tap = null; }
      // A read-only analyser on the SOURCE, so the live-ring can pulse with the terminal's signal.
      if (m.tap) {
        if (!m.pulseAn) { m.pulseAn = this.host.ctx.createAnalyser(); m.pulseAn.fftSize = 256; m.pulseAn.smoothingTimeConstant = 0; m.pulseBuf = new Float32Array(m.pulseAn.fftSize); }
        try { tap.node.connect(m.pulseAn, tap.index || 0); } catch (_e) { /* fan-out only */ }
      }
    }
    return m.tap;
  }
  _monTapDisconnect(m) {
    if (m.tap && m.tap.node) {
      try { m.tap.node.disconnect(m.gain, m.tap.index || 0); } catch (_e) { /* gone */ }
      try { if (m.pulseAn) m.tap.node.disconnect(m.pulseAn, m.tap.index || 0); } catch (_e) { /* gone */ }
    }
    m.tap = null;
  }

  // A placed ear monitor: a small circle with an ear icon and an X, a callout ring/
  // line back to its terminal, and its tap summed into the monitor bus.
  _createMonitor(key, portId, x, y, showCallout = true, opts = {}) {
    const el = document.createElement('div');
    el.className = 'mon'; el.title = 'Click to mute · drag to move';
    el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
    el.innerHTML = EAR_ICON;
    el.insertAdjacentHTML('afterbegin', this._monArcSvg());   // volume-ramp wedge + limit ticks, behind the ear icon
    document.body.appendChild(el);
    // A momentary hover-preview (showCallout === false) injects AFTER the mode/engine gates so it
    // always auditions; a placed monitor sums into the gated monitor bus.
    const g = this.host.ctx.createGain(); this._monitorBus();
    g.connect(showCallout === false ? this._monPreviewGain : this._monBus);
    // The monitor doubles as a volume knob: an inward tick sweeps min (lower-left) up
    // over the top to max (lower-right); the scroll wheel turns it with knob momentum.
    const tick = document.createElement('div'); tick.className = 'mon-tick'; el.appendChild(tick);
    const m = {
      key, portId, el, gain: g, tap: null, muted: false, showCallout, tick,
      vol: (opts.vol != null ? clamp01(opts.vol) : MON_VOL_DEFAULT),
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
    if (showCallout && !opts.skipAutoLevel) this._autoLevelMonitor(m);   // placed monitor opens at a comfortable level (not the quick hover preview or a restore)
    el.addEventListener('pointerdown', (ev) => this._dragMonitor(ev, m));
    el.addEventListener('wheel', (ev) => this._onMonWheel(m, ev), { passive: false });
    m.dot.addEventListener('pointerdown', (ev) => this._regrabMonitor(ev, m));
    // Close badge (upper-right ×), shown on hover — like the scope. Removes the monitor.
    const close = document.createElement('div'); close.className = 'mon-close'; close.textContent = '×'; close.title = 'close';
    close.addEventListener('pointerdown', (e) => e.stopPropagation());   // don't start a mute/drag
    close.addEventListener('click', (e) => { e.stopPropagation(); this._closeMonitor(m); });
    el.appendChild(close);
    this._monitors.add(m);
    if (showCallout) this.onChange();   // a placed monitor is part of the patch (not the temporary peek)
    this._updateCallout(m);
    if (showCallout) this._enableMonitorBus(true);   // PLACING a monitor turns the bus on; a hover preview must not
    this._startScopeLoop();         // keep this monitor's callout pinned each frame (fixes the startup/focus displacement)
    return m;
  }

  // Knob position (0..1) <-> gain multiplier, a dB-linear taper (unity at 1, MON_MIN_DB
  // floor at 0), so the monitor knob turns like a real fader.
  _monGainMul(vol) { return vol <= 0 ? 0 : Math.pow(10, (MON_MIN_DB * (1 - clamp01(vol))) / 20); }
  _monVolFromMul(mul) { return mul <= 0 ? 0 : clamp01(1 - (20 * Math.log10(Math.min(1, mul))) / MON_MIN_DB); }

  // Set the monitor's volume by knob POSITION (0..1): gain = master base × taper(pos).
  _setMonVol(m, vol) {
    m.vol = clamp01(vol);
    if (!m.muted) { try { m.gain.gain.value = this._monGainMul(m.vol); } catch (_e) { /* node gone */ } }
    this._drawMonTick(m);
  }
  _drawMonTick(m) {
    if (m.tick) m.tick.style.transform = `rotate(${r2(-135 + m.vol * 270)}deg)`;   // min lower-left → max lower-right
  }
  // Open a freshly-placed monitor at a comfortable level: measure the tapped signal's RMS
  // briefly (while silent), then set the knob so it plays at ~75% of the loudest the main
  // output has reached this session. Fixed fallback if there's no reference yet; if the
  // signal is essentially silent, keep the default.
  _autoLevelMonitor(m) {
    if (!m.tap || !m.tap.node) return;
    const ctx = this.host.ctx;
    let an; try { an = ctx.createAnalyser(); } catch (_e) { return; }
    an.fftSize = 1024; an.smoothingTimeConstant = 0;
    const buf = new Float32Array(an.fftSize);
    try { m.tap.node.connect(an, m.tap.index || 0); } catch (_e) { return; }
    try { m.gain.gain.value = 0; } catch (_e) { /* node gone */ }   // silent while measuring
    let peak = 0, frames = 0;
    const step = () => {
      if (!this._monitors.has(m) || !m.tap || !m.tap.node) { try { m.tap && m.tap.node.disconnect(an); } catch (_e) { /* gone */ } return; }
      an.getFloatTimeDomainData(buf);
      for (let i = 0; i < buf.length; i++) { const a = Math.abs(buf[i]); if (a > peak) peak = a; }   // PEAK, not RMS — controls the loudest instant
      if (++frames < 24) { requestAnimationFrame(step); return; }   // ~400ms window
      try { m.tap.node.disconnect(an); } catch (_e) { /* gone */ }
      if (!m.muted) this._setMonVol(m, this._autoMonVol(peak));
    };
    requestAnimationFrame(step);
  }
  // Knob value that lands a signal whose PEAK is `sigPeak` at ~75% of the loudest PEAK the
  // main output has reached this session. Silent signal or no master gain → default knob.
  _autoMonVol(sigPeak) {
    if (sigPeak < 0.008) return MON_VOL_DEFAULT;
    const mix = this._mixerInstance();
    const base = mix && mix.getParam && mix.getParam('master') ? mix.getParam('master').value : 0.7;
    if (base <= 0) return MON_VOL_DEFAULT;
    // The reference is the main output's PEAK, which is LINE level (~0.02–0.08), not
    // internal-signal level. Returns a knob POSITION (via the dB taper), but NEVER above
    // the safe default — auto-level only turns a hot terminal DOWN from the quiet default,
    // it never makes a placed monitor louder than the hover preview.
    const ref = (this._sessionMaxMaster > 0.006) ? this._sessionMaxMaster : 0.05;
    return Math.min(MON_VOL_DEFAULT, this._monVolFromMul((0.75 * ref) / (sigPeak * base)));
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
    const sx = ev.clientX, sy = ev.clientY; let moved = false;   // the dot is the re-probe handle; closing is the × badge
    m.regrabbing = true;
    m.dot.style.pointerEvents = 'none';
    const onMove = (e2) => {
      if (!moved && Math.hypot(e2.clientX - sx, e2.clientY - sy) > 4) moved = true;
      const px = e2.clientX, py = e2.clientY;
      m.ring.setAttribute('cx', r2(px)); m.ring.setAttribute('cy', r2(py));
      m.line.setAttribute('x1', r2(px)); m.line.setAttribute('y1', r2(py));
      m.dot.style.left = r2(px) + 'px'; m.dot.style.top = r2(py) + 'px';
    };
    const onUp = (e2) => {
      document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp);
      if (!moved) { m.dot.style.pointerEvents = ''; m.regrabbing = false; return; }   // a plain click on the dot does nothing (use the × to close)
      const drop = this._jackFromPoint(e2.clientX, e2.clientY);   // hit-test while the dot is still pe:none, so it finds the jack, not the dot
      m.dot.style.pointerEvents = '';
      if (!drop) { this._closeMonitor(m); return; }   // loop dropped on the panel → delete it (like a cable pulled off a terminal)
      this._monTapDisconnect(m);
      m.key = drop.key; m.portId = drop.portId; if (!m.muted) this._monTapConnect(m);
      m.regrabbing = false;
      this._updateCallout(m);
      this._enableMonitorBus(true);   // re-probing keeps the monitor bus on
    };
    document.addEventListener('pointermove', onMove); document.addEventListener('pointerup', onUp);
  }

  _closeMonitor(m) {
    if (m.volRaf) { cancelAnimationFrame(m.volRaf); m.volRaf = null; }
    this._monTapDisconnect(m);
    try { m.gain.disconnect(); } catch (_e) { /* gone */ }
    m.el.remove(); m.ring.remove(); m.line.remove(); m.dot.remove();
    this._monitors.delete(m);
    if (m.showCallout !== false) this.onChange();   // removing a placed monitor changes the patch
    if (m.showCallout !== false && this._monitors.size === 0) this._enableMonitorBus(false);   // last PLACED monitor gone → bus off (a preview never touches it)
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
    if (!m.muted) this._enableMonitorBus(true);   // un-muting a monitor turns the monitor bus on
    this._refreshMonHighlights();                 // muted → drop the green ring (unmute already refreshes via enable)
  }

  // Carry a freshly-placed monitor circle out to be dropped (see _carryScope): the
  // pointer touches the LEFT of its circumference, so it hangs down-and-right, centred
  // vertically. Escape cancels — the monitor is removed.
  _carryMonitor(m, e, mode) {
    const h = m.el.offsetHeight || 34;
    const place = (px, py) => { m.el.style.left = Math.round(px) + 'px'; m.el.style.top = Math.round(py - h / 2) + 'px'; this._updateCallout(m); };
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
  // The edge feeding an input (or null). Every edge — real or link — records the ROOT source
  // output as its src, so this edge's src IS the actual signal, even when it's itself a link.
  _incomingEdge(key, portId) {
    return this.patchbay.list().find((e) => e.dst.key === key && e.dst.portId === portId) || null;
  }

  _tryConnect(jackA, jackB) {
    const A = this._ep(jackA.key, jackA.portId);
    const B = this._ep(jackB.key, jackB.portId);
    if (!A || !B) return;
    // INPUT-to-INPUT → a LINK (mult): the empty input picks up the fed input's signal. Exactly one
    // end must already carry a signal (the target); the other (empty) end becomes the shared input.
    if (A.meta.dir === 'in' && B.meta.dir === 'in') return this._tryLink(A, B);
    let src, dst;
    if (A.meta.dir === 'out' && B.meta.dir === 'in') { src = A; dst = B; }
    else if (A.meta.dir === 'in' && B.meta.dir === 'out') { src = B; dst = A; }
    else return;   // output-to-output: not a valid cord

    // An input takes one cable: patchbay.connect rejects a drop onto an occupied
    // input (moving a cord is done by grabbing its stub, not by dropping over it).
    const initialDepth = (dst.meta.via && dst.rec) ? dst.rec.values.get(dst.meta.via) : undefined;
    const res = this.patchbay.connect(
      { key: src.key, instance: src.instance, descriptorId: src.descriptorId, portId: src.portId },
      { key: dst.key, instance: dst.instance, descriptorId: dst.descriptorId, portId: dst.portId },
      initialDepth,
    );
    if (res.ok) { this._reconcileLinks(); this._drawCables(); this.onChange(); return res.edge; }
    return null;
  }

  // Create a LINK between two inputs — the empty one shares the fed one's signal. Under the hood
  // it's a normal fan-out from the shared SOURCE to the empty input, tagged so it draws off (and
  // lives and dies with) the target input.
  _tryLink(A, B) {
    const aFed = !!this._incomingEdge(A.key, A.portId);
    const bFed = !!this._incomingEdge(B.key, B.portId);
    if (aFed === bFed) return null;             // both fed, or both empty → no single signal to share
    const target = aFed ? A : B;                // the already-fed input we chain onto
    const input = aFed ? B : A;                 // the empty input that will share its signal
    const feed = this._incomingEdge(target.key, target.portId);
    const src = this._ep(feed.src.key, feed.src.portId);
    if (!src) return null;
    const edge = this._connectResolved(src, input);
    if (!edge) return null;
    edge.link = { key: target.key, portId: target.portId };   // draws off / depends on the target input
    edge.style = feed.style;                                    // and looks like the target's own cable
    this._reconcileLinks(); this._drawCables(); this.onChange();
    return edge;
  }

  // Wire src-output → dst-input in the patchbay (the raw connect links reuse), returning the edge.
  _connectResolved(src, dst) {
    const initialDepth = (dst.meta.via && dst.rec) ? dst.rec.values.get(dst.meta.via) : undefined;
    const res = this.patchbay.connect(
      { key: src.key, instance: src.instance, descriptorId: src.descriptorId, portId: src.portId },
      { key: dst.key, instance: dst.instance, descriptorId: dst.descriptorId, portId: dst.portId },
      initialDepth,
    );
    return res.ok ? res.edge : null;
  }

  // Keep every LINK true to its target: prune links whose target lost its feed (which cascades down
  // the chain), and re-point a link's hidden fan-out when its target's SOURCE changes. Idempotent,
  // looping until stable so a whole chain (C→B→A) settles in one call.
  _reconcileLinks() {
    let changed = true, guard = 0;
    while (changed && guard++ < 64) {
      changed = false;
      for (const e of this.patchbay.list()) {
        if (!e.link) continue;
        const feed = this._incomingEdge(e.link.key, e.link.portId);
        if (!feed) { this.patchbay.disconnect(e); changed = true; continue; }   // target unfed → link gone (cascades)
        if (feed.src.key !== e.src.key || feed.src.portId !== e.src.portId) {
          const src = this._ep(feed.src.key, feed.src.portId), dst = this._ep(e.dst.key, e.dst.portId);
          const link = e.link, bow = e.bow;
          this.patchbay.disconnect(e);
          if (src && dst) { const ne = this._connectResolved(src, dst); if (ne) { ne.link = link; ne.style = feed.style; if (bow != null) ne.bow = bow; } }
          changed = true;
        } else if (e.style !== feed.style) { e.style = feed.style; changed = true; }
      }
    }
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

  // How far each single push button may grow its hit-pad without touching a neighbour, keyed
  // by param id (mm). A button (one small lamp, radius < KNOB_MIN_R) grows up to HIT_GROW_MM,
  // but capped by its nearest neighbour: a fixed control (knob/selector) → the full gap; a jack
  // → the gap minus the jack's own 1.3mm growth; another button → half the gap (both grow).
  // Knobs and multi-lamp selectors don't grow; they're obstacles only.
  _buttonGrowMap(svg) {
    const KNOB_MIN_R = 3.0, MINSIG = 1.0;
    const items = [];   // { id, kind:'jack'|'btn'|'fixed', sig:[{cx,cy,r}], body:{cx,cy,r} }
    for (const g of svg.querySelectorAll('[data-wcoast-port],[data-wcoast-param]')) {
      const isPort = g.hasAttribute('data-wcoast-port');
      const id = isPort ? g.getAttribute('data-wcoast-port') : g.getAttribute('data-wcoast-param');
      const sig = [...g.querySelectorAll('circle')]
        .map((c) => ({ cx: parseFloat(c.getAttribute('cx')), cy: parseFloat(c.getAttribute('cy')), r: parseFloat(c.getAttribute('r')) }))
        .filter((c) => isFinite(c.cx) && isFinite(c.cy) && c.r >= MINSIG);
      if (!sig.length) continue;
      const bodyR = Math.max(...sig.map((c) => c.r));
      const kind = isPort ? 'jack' : (bodyR >= KNOB_MIN_R || sig.length > 1) ? 'fixed' : 'btn';
      items.push({ id, kind, sig, body: sig.reduce((a, b) => (b.r > a.r ? b : a)) });
    }
    const obs = [];
    for (const it of items) for (const c of it.sig) obs.push({ kind: it.kind, id: it.id, ...c });
    const grow = new Map();
    for (const it of items) {
      if (it.kind !== 'btn') continue;
      let cap = HIT_GROW_MM;
      const B = it.body;
      for (const o of obs) {
        if (o.id === it.id) continue;
        const gap = Math.hypot(o.cx - B.cx, o.cy - B.cy) - B.r - o.r;
        const c = o.kind === 'jack' ? gap - HIT_GROW_MM : o.kind === 'btn' ? gap / 2 : gap;
        if (c < cap) cap = c;
      }
      grow.set(it.id, Math.max(0, Math.round(cap * 1000) / 1000));
    }
    return grow;
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
    const btnGrow = this._buttonGrowMap(svg);   // adaptive hit-pad size per single push button
    for (const b of panel.controls.values()) {
      const v = rec.values.get(b.id);
      if (v !== undefined) showValue(b, v);
      const isMasterEnable = rec.pinned && b.id === 'masterMute';   // the mixer's master lamp
      attachControlInteraction(b, {
        get: () => rec.values.get(b.id),
        // The master enable and the transport are one state: route the lamp through
        // setSound so toggling it here also flips the pie/toolbar (and vice versa).
        set: (val) => { if (isMasterEnable) this.setSound(val === 'on'); else this._setParam(rec, b.id, val); },
      }, { hitGrowMm: btnGrow.get(b.id) || 0 });
      b.group.addEventListener('pointerdown', (e) => e.stopPropagation());
      if (b.kind === 'knob') {                      // double-click a knob → back to its default
        b.group.addEventListener('dblclick', (e) => {
          e.preventDefault(); e.stopPropagation();
          const def = this._paramDefault(rec, b.id);
          if (def !== undefined) this._setParam(rec, b.id, def);
        });
      }
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
      // An invisible hit-pad HIT_GROW_MM beyond the outer edge, appended LAST so the outer
      // circle stays the first-match for the paint/geometry queries. Clicks on it bubble to
      // the group's handlers above.
      const outer = port.element.querySelector('circle');
      if (outer) {
        const pad = svg.ownerDocument.createElementNS(SVG_NS, 'circle');
        pad.setAttribute('cx', outer.getAttribute('cx')); pad.setAttribute('cy', outer.getAttribute('cy'));
        pad.setAttribute('r', r2((parseFloat(outer.getAttribute('r')) || 3) + HIT_GROW_MM));
        pad.setAttribute('fill', 'none'); pad.setAttribute('pointer-events', 'all'); pad.setAttribute('class', 'hit-pad');
        port.element.appendChild(pad);
      }
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
    if (rec.pinned && id === 'masterMute') this._setMonEngineGate(value === 'on');   // engine gates the monitor bus too
    if (rec.pinned && id === 'monitorLevel') this._setMonMaster(value);              // the Monitor fader
    if (rec.pinned && (id === 'masterEnable' || id === 'monitorEnable')) this._applyBusEnables();   // per-bus routing
    this.onChange();                              // a knob/switch change dirties the patch
  }

  deleteModule(rec) {
    if (this._hoverRec === rec) this._hoverRec = null;
    if (this._netOrigin && this._netOrigin.split(':')[0] === rec.key) this._netOrigin = null;
    this.patchbay.disconnectModule(rec.key);   // pull its cords before the nodes go
    this._reconcileLinks();                     // links onto inputs this module fed now fall away
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
    return { src: { key: e.src.key, portId: e.src.portId }, dst: { key: e.dst.key, portId: e.dst.portId }, bow: e.bow, link: e.link ? { key: e.link.key, portId: e.link.portId } : null };
  }
  // Reconnect a snapshotted cable. Its depth follows the destination knob (untouched
  // by undo/redo); the bow is carried back. A link snap re-tags the edge and reconciles.
  _restoreCable(snap) {
    const e = this._tryConnect(snap.src, snap.dst);
    if (e) {
      if (snap.link) { e.link = { ...snap.link }; this._reconcileLinks(); }
      if (snap.bow != null) e.bow = snap.bow;
      this._drawCables();
    }
    return e;
  }
  // Remove the live cable matching a snapshot's endpoints (then let any links depending on the
  // freed input fall away).
  _removeCable(snap) {
    const e = this.patchbay.list().find((x) => x.src.key === snap.src.key && x.src.portId === snap.src.portId && x.dst.key === snap.dst.key && x.dst.portId === snap.dst.portId);
    if (e) { this.patchbay.disconnect(e); this._reconcileLinks(); this._drawCables(); this.onChange(); }
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
    // Real cables before links, so a link's target input is already fed when it restores.
    for (const c of [...snap.cables].sort((a, b) => (a.link ? 1 : 0) - (b.link ? 1 : 0))) this._restoreCable(c);
    this._reconcileLinks(); this._drawCables();
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
  // The descriptor default for one control (used by the double-click reset).
  _paramDefault(rec, id) {
    const type = this.moduleTypes.find((t) => t.descriptorId === rec.descriptorId);
    const p = type && type.descriptor.params.find((q) => q.id === id);
    return p ? p.default : undefined;
  }
  // Reset ONE module's controls to their descriptor defaults (undoable), leaving every cable
  // connected. Used by the title menu's "Reset" item.
  _resetModuleWithUndo(rec) {
    const type = this.moduleTypes.find((t) => t.descriptorId === rec.descriptorId);
    if (!type) return;
    const before = new Map(rec.values);
    for (const p of type.descriptor.params) if (rec.values.get(p.id) !== p.default) this._setParam(rec, p.id, p.default);
    if (this.onControlsReset) this.onControlsReset();   // resync toolbar mirrors (mixer master)
    const after = new Map(rec.values);
    let changed = false; for (const [id, v] of after) if (before.get(id) !== v) { changed = true; break; }
    if (!changed) return;
    const key = rec.key;
    const apply = (vals) => { const r = this.records.get(key); if (!r) return; for (const [id, v] of vals) this._setParam(r, id, v); if (this.onControlsReset) this.onControlsReset(); };
    this._pushUR({ undo: () => apply(before), redo: () => apply(after) });
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
    this._exitAllFreqMode();   // a click on a panel background also dismisses any pinned frequency readout
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
      if (this._isolateNet) { this._exitIsolate(); }   // a left click on empty faceplate leaves isolate mode
      // The panel and title pies open on a RIGHT click now (see the contextmenu
      // bindings); a clean left click does nothing else.
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

  // Right-click a panel → the main menu, a plain list (File / Edit / Engine / Dark mode /
  // Help). It's no longer a pie. Delete lives on the module's vertical title (see
  // _onTitleContextMenu). rack-app fills the items via onAppMenu.
  _onModuleContextMenu(e, rec) {
    e.preventDefault();
    e.stopPropagation();
    if (e.target.closest && e.target.closest('[data-wcoast-param]')) return;   // no menu over a knob or any control
    this.onAppMenu(e.clientX, e.clientY);
  }

  // Right-click a module's vertical title (its left edge) → a small menu: reset its controls
  // (cables untouched) and, for a non-pinned module, delete it.
  _onTitleContextMenu(e, rec) {
    e.preventDefault();
    e.stopPropagation();
    const items = [
      { label: `Reset ${rec.name}`, action: () => this._resetModuleWithUndo(rec) },
    ];
    if (!rec.pinned) items.push({ label: `Delete ${rec.name}`, action: () => this._deleteModuleWithUndo(rec) });
    this._openMenu(e.clientX, e.clientY, items);
  }

  // items: { label, action } clickable rows, plus optional { header:true } group
  // labels and optional { checked, dim } for the connect menu's checkmark/dimming.
  _openMenu(x, y, items) {
    this._closeMenu();
    // A main item activates (opens its submenu / closes the open one) only after the pointer
    // has stayed essentially STILL — within STILL_RADIUS px — for DWELL_MS. Any real drift
    // restarts the countdown, so while you're moving — down, across, or diagonally toward an
    // open submenu — no neighbour you pass through activates; the highlight follows, but the
    // submenu waits until you actually stop. (Both constants are tunable.)
    this._dwellAnchor = null;
    this._menuMoveHandler = (ev) => {
      const STILL_RADIUS = 4, a = this._dwellAnchor;
      if (!a || Math.hypot(ev.clientX - a.x, ev.clientY - a.y) > STILL_RADIUS) {
        this._dwellAnchor = { x: ev.clientX, y: ev.clientY };
        this._armDwell();                       // real movement → restart the "stayed put" countdown
      }
    };
    document.addEventListener('pointermove', this._menuMoveHandler, true);
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
      if (it.icon) { const ic = document.createElement('span'); ic.className = 'rack-menu-icon'; ic.innerHTML = it.icon; item.appendChild(ic); }   // left of the label
      const lbl = document.createElement('span');
      lbl.textContent = it.label;
      item.appendChild(lbl);
      // A checkable item (Engine, Dark mode, a connection): the tick sits at the RIGHT
      // edge, so the label isn't indented and lines up with the submenu labels.
      if (it.checkFn || it.checked !== undefined) {
        const ck = document.createElement('span');
        ck.className = 'rack-menu-check';
        ck.textContent = isOn ? '✓' : '';
        item.appendChild(ck);
      }
      if (it.submenu) {
        // A heading with a submenu (File/Edit/View): a right arrow, and hovering (or
        // clicking) it opens its submenu to the side, Electron-style.
        item.classList.add('has-sub');
        const arrow = document.createElement('span');
        arrow.className = 'rack-menu-arrow'; arrow.textContent = '›';
        item.appendChild(arrow);
        item.addEventListener('mouseenter', (e) => this._hoverMainItem(item, () => this._openSubmenu(item, it.submenu), null, e));
        item.addEventListener('mouseleave', () => this._leaveMainItem(item));
        item.addEventListener('click', (e) => { e.stopPropagation(); this._openSubmenu(item, it.submenu); });
      } else if (it.disabled) {
        item.classList.add('disabled');
        item.addEventListener('mouseenter', (e) => this._hoverMainItem(item, () => this._closeSubs(), null, e));
        item.addEventListener('mouseleave', () => this._leaveMainItem(item));
      } else {
        // A leaf. A preview item (onDwell/onLeave) shows its preview once the pointer settles on
        // it and tears it down on leave/close; a plain item just dismisses any open submenu. A
        // click closes the menu and runs the action; `latch` keeps the preview alive past the
        // close (the upstream highlight).
        const onDwell = it.onDwell ? () => { this._closeSubs(); it.onDwell(); } : () => this._closeSubs();
        item.addEventListener('mouseenter', (e) => this._hoverMainItem(item, onDwell, it.onLeave || null, e));
        item.addEventListener('mouseleave', () => this._leaveMainItem(item));
        item.addEventListener('click', (e) => { if (it.latch) this._peekLatched = true; this._closeMenu(); if (it.action) it.action(e); });
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
    this._menuClosing = true;   // lets a preview's onLeave tell a menu teardown from a plain item-leave
    if (this._hoverLeave && !this._peekLatched) this._hoverLeave();   // tear down a live preview (unless a click latched it)
    this._menuClosing = false;
    if (this._menuMoveHandler) { document.removeEventListener('pointermove', this._menuMoveHandler, true); this._menuMoveHandler = null; }
    clearTimeout(this._menuDwellTimer); this._menuDwellTimer = null;
    this._hoverItem = null; this._hoverSwitch = null; this._hoverLeave = null; this._dwellAnchor = null; this._peekLatched = false;
    if (this._menuEl) { this._menuEl.remove(); this._menuEl = null; }
  }

  // The pointer is over a top-level item: remember it and its action (open its submenu, or
  // close the open one), anchor the dwell at the entry point, and start the countdown — it
  // activates only if the pointer then stays essentially still for DWELL_MS.
  _hoverMainItem(item, doSwitch, onLeave, ev) {
    this._hoverItem = item; this._hoverSwitch = doSwitch; this._hoverLeave = onLeave;
    if (ev) this._dwellAnchor = { x: ev.clientX, y: ev.clientY };
    this._armDwell();
  }
  _leaveMainItem(item) {
    if (this._hoverItem !== item) return;
    if (this._hoverLeave) this._hoverLeave();   // tear down the item's preview, if any
    this._hoverItem = null; this._hoverSwitch = null; this._hoverLeave = null;
  }
  // (Re)start the "pointer has stopped" countdown; when it elapses the hovered item activates.
  _armDwell() {
    const DWELL_MS = 200;
    clearTimeout(this._menuDwellTimer);
    this._menuDwellTimer = setTimeout(() => { this._menuDwellTimer = null; this._maybeSwitch(); }, DWELL_MS);
  }
  // Activate the hovered item once the dwell elapses (the pointer stayed still). A neighbour
  // merely passed through never dwells, so it's never activated.
  _maybeSwitch() {
    const item = this._hoverItem, fn = this._hoverSwitch;
    if (item && fn && item !== this._subParent) fn();
  }

  // The Help submenu items (used by the main menu): doc links opened in the browser.
  helpMenuItems() {
    return [
      { label: 'README', action: () => this._openExternal(DOCS_README_URL) },
      { label: 'Getting Started', action: () => this._openExternal(DOCS_GETTING_STARTED_URL) },
      { label: 'Reference — coming soon', disabled: true },
    ];
  }
  // The Engine menu item's glyph: the same reddish push-button as the mixer's master lamp
  // (and the old panel-pie sound wedge). A flat medium-gray disc when the engine is OFF; the
  // red `ledLit` dome plus its glossy highlight when ON — so the button reads as PRESSED while
  // sound is running. Self-contained (its own gradient) so it drops straight into a menu icon.
  engineButtonIcon(on) {
    const led = on
      ? '<defs><radialGradient id="engLed" cx="42%" cy="38%" r="65%">'
        + '<stop offset="0" stop-color="#ff7a5a"/><stop offset="0.5" stop-color="#ee2a10"/>'
        + '<stop offset="0.82" stop-color="#d21010"/><stop offset="1" stop-color="#8f0c0c"/></radialGradient></defs>'
        + '<circle cx="12" cy="12" r="8.6" fill="url(#engLed)" stroke="#3a0808" stroke-width="0.7"/>'
        + '<ellipse cx="10.4" cy="8.6" rx="3.4" ry="2.1" fill="#ffb4b4" opacity="0.85"/>'
      : '<circle cx="12" cy="12" r="8.6" fill="#505055" stroke="#77777c" stroke-width="1.1"/>';
    return '<svg viewBox="0 0 24 24">' + led + '</svg>';
  }
  // Open a URL in the user's default browser: the Electron bridge if present, else a new
  // browser tab.
  _openExternal(url) {
    if (window.wcoast && window.wcoast.openExternal) window.wcoast.openExternal(url);
    else window.open(url, '_blank', 'noopener');
  }
  _closeSubs() { for (const s of this._openSubs) s.remove(); this._openSubs = []; this._subParent = null; }

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
      const lbl = document.createElement('span'); lbl.textContent = it.label; item.appendChild(lbl);
      if (it.checkFn || it.checked !== undefined) { const ck = document.createElement('span'); ck.className = 'rack-menu-check'; ck.textContent = on ? '✓' : ''; item.appendChild(ck); }
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
    this._subParent = item;   // whose submenu is showing (so re-entering it is a no-op)
  }
}
