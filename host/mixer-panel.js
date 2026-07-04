// mixer-panel.js — the output Mixer's floating control panel.
//
// Opened/closed by the toolbar Mixer button, this is a draggable frameless
// window (black rounded border, no title bar) holding a Buchla-style faceplate:
// four channel strips (A–D), each with a level FADER (mouse-drag), a pan KNOB
// (scroll wheel), and a mute button; two live stereo VU meters; and a master
// fader kept in sync with the toolbar master. It has no jacks — patching stays
// in the toolbar — so it never touches the cable system. It drives the mixer
// instance's params directly. Position is remembered across closes (localStorage).

'use strict';

const SVG = 'http://www.w3.org/2000/svg';
const POS_KEY = 'wcoast.mixerPanel.pos';

function el(tag, attrs, parent) {
  const n = document.createElementNS(SVG, tag);
  for (const k in attrs) n.setAttribute(k, attrs[k]);
  if (parent) parent.appendChild(n);
  return n;
}
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// Faceplate layout (viewBox units) — compact, four channels, tightly packed.
const VB_W = 132, VB_H = 94;
const STRIP_X0 = 15, STRIP_DX = 21;                 // channel strip centres
const KNOB_Y = 18, KNOB_R = 6.8;
const FADER_TOP = 30, FADER_BOT = 72;               // handle centre travel
const MUTE_Y = 82.5, MUTE_R = 4.2;                  // group centred between slider bottom (75) and panel bottom (94)
const VU_X_L = 97, VU_X_R = 105, VU_SEGS = 8;
const MASTER_X = 120;
const DIV_Y0 = 12, DIV_Y1 = VB_H - 4, TOP_Y = 10;   // dividers / label row

export class MixerPanel {
  // opts: { instance, descriptor, onMaster(value) }
  constructor(opts) {
    this.inst = opts.instance;
    this.desc = opts.descriptor;
    this.onMaster = opts.onMaster || (() => {});
    this.onChange = opts.onChange || (() => {});
    this.channels = this.desc.channels;
    this.faders = new Map();     // paramId -> { handle, track, min, max, value }
    this.knobs = new Map();      // paramId -> { pointer, cx, cy, min, max, value }
    this.mutes = new Map();      // paramId -> { lamp, on }
    this.vu = { l: [], r: [] };
    this._raf = null;
    this._build();
  }

  _paramDefault(id) { const p = this.desc.params.find((x) => x.id === id); return p ? p.default : 0; }
  _paramMeta(id) { return this.desc.params.find((x) => x.id === id); }

  _build() {
    const win = document.createElement('div');
    win.id = 'mixer-panel';
    win.style.display = 'none';
    const svg = el('svg', { viewBox: `0 0 ${VB_W} ${VB_H}`, width: '100%', height: '100%' });
    win.appendChild(svg);
    this.win = win;
    this.svg = svg;

    // ---- defs ----
    const defs = el('defs', {}, svg);
    const kg = el('radialGradient', { id: 'mxKnob', cx: '0.42', cy: '0.38', r: '0.75' }, defs);
    el('stop', { offset: '0', 'stop-color': '#f0f6fc' }, kg);
    el('stop', { offset: '0.55', 'stop-color': '#7ea8d8' }, kg);
    el('stop', { offset: '1', 'stop-color': '#173e66' }, kg);
    const lg = el('radialGradient', { id: 'mxLed' }, defs);
    el('stop', { offset: '0', 'stop-color': '#ff7a7a' }, lg);
    el('stop', { offset: '0.6', 'stop-color': '#e00000' }, lg);
    el('stop', { offset: '1', 'stop-color': '#7c0000' }, lg);

    // ---- face ----
    el('rect', { x: 0, y: 0, width: VB_W, height: VB_H, rx: 3, fill: '#cfcfcf' }, svg);

    // ---- channel strips ----
    for (let i = 0; i < this.channels.length; i++) {
      const L = this.channels[i];
      const x = STRIP_X0 + i * STRIP_DX;
      // divider
      if (i > 0) el('line', { x1: x - STRIP_DX / 2, y1: DIV_Y0, x2: x - STRIP_DX / 2, y2: DIV_Y1, stroke: '#163a69', 'stroke-width': 0.25, opacity: 0.5 }, svg);
      // label
      el('text', { x, y: TOP_Y, 'text-anchor': 'middle', 'font-family': 'Arial Narrow, Helvetica, sans-serif', 'font-size': '5.5', 'font-weight': '700', 'font-style': 'italic', fill: '#163a69' }, svg).textContent = L;
      this._knob(svg, x, KNOB_Y, `pan${L}`, this.desc.vcPan.includes(L));
      this._fader(svg, x, `level${L}`);
      this._mute(svg, x, MUTE_Y, `mute${L}`);
    }

    // ---- VU meters ----
    el('line', { x1: VU_X_L - 8, y1: DIV_Y0, x2: VU_X_L - 8, y2: DIV_Y1, stroke: '#163a69', 'stroke-width': 0.25, opacity: 0.5 }, svg);
    el('text', { x: (VU_X_L + VU_X_R) / 2, y: TOP_Y, 'text-anchor': 'middle', 'font-family': 'Arial Narrow, Helvetica, sans-serif', 'font-size': '4', fill: '#163a69' }, svg).textContent = 'VU';
    this.vu.l = this._vuLadder(svg, VU_X_L);
    this.vu.r = this._vuLadder(svg, VU_X_R);
    el('text', { x: VU_X_L, y: 80, 'text-anchor': 'middle', 'font-family': 'Arial Narrow, sans-serif', 'font-size': '4', fill: '#163a69' }, svg).textContent = 'L';
    el('text', { x: VU_X_R, y: 80, 'text-anchor': 'middle', 'font-family': 'Arial Narrow, sans-serif', 'font-size': '4', fill: '#163a69' }, svg).textContent = 'R';

    // ---- master ----
    el('line', { x1: MASTER_X - 12, y1: DIV_Y0, x2: MASTER_X - 12, y2: DIV_Y1, stroke: '#163a69', 'stroke-width': 0.25, opacity: 0.5 }, svg);
    this._fader(svg, MASTER_X, 'master');
    this._mute(svg, MASTER_X, MUTE_Y, 'masterMute');
    el('text', { x: MASTER_X, y: TOP_Y, 'text-anchor': 'middle', 'font-family': 'Arial Narrow, Helvetica, sans-serif', 'font-size': '4.6', 'font-weight': '700', 'font-style': 'italic', fill: '#163a69' }, svg).textContent = 'MAIN';

    // ---- window chrome + interactions ----
    this._makeDraggable();
    this._restorePos();
    document.body.appendChild(win);
  }

  _knob(svg, cx, cy, paramId, vcPan) {
    const m = this._paramMeta(paramId);
    const g = el('g', { 'data-knob': paramId }, svg);
    el('circle', { cx, cy, r: KNOB_R + 0.6, fill: '#0d1a28', opacity: 0.35 }, g);
    el('circle', { cx, cy, r: KNOB_R, fill: 'url(#mxKnob)', stroke: '#0d2038', 'stroke-width': 0.4 }, g);
    const pointer = el('line', { x1: cx, y1: cy, x2: cx, y2: cy - KNOB_R + 1.2, stroke: '#0d2038', 'stroke-width': 1, 'stroke-linecap': 'round' }, g);
    if (vcPan) el('text', { x: cx, y: cy + KNOB_R + 4, 'text-anchor': 'middle', 'font-family': 'Arial Narrow, sans-serif', 'font-size': '3.2', fill: '#1f7fe0' }, svg).textContent = 'cv';
    const rec = { pointer, cx, cy, min: m.min, max: m.max, value: this._paramDefault(paramId) };
    this.knobs.set(paramId, rec);
    this._showKnob(paramId);
    // scroll to turn
    g.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const pos = clamp01((rec.value - rec.min) / (rec.max - rec.min) - d / 100 * 0.12);
      this._setParam(paramId, rec, pos);
    }, { passive: false });
    g.style.cursor = 'ns-resize';
  }

  _fader(svg, cx, paramId) {
    const m = this._paramMeta(paramId);
    const g = el('g', { 'data-fader': paramId }, svg);
    el('rect', { x: cx - 1.1, y: FADER_TOP - 3, width: 2.2, height: (FADER_BOT - FADER_TOP) + 6, rx: 1.1, fill: '#20242a' }, g);
    const track = el('rect', { x: cx - 6, y: FADER_TOP - 4, width: 12, height: (FADER_BOT - FADER_TOP) + 8, fill: 'transparent' }, g);  // hit area
    const handle = el('g', {}, g);
    el('rect', { x: cx - 7, y: -2.6, width: 14, height: 5.2, rx: 1.4, fill: '#3c4653', stroke: '#0d1218', 'stroke-width': 0.4 }, handle);
    el('line', { x1: cx - 5.5, y1: 0, x2: cx + 5.5, y2: 0, stroke: '#e0e6ee', 'stroke-width': 0.7 }, handle);
    const rec = { handle, track, min: m.min, max: m.max, value: this._paramDefault(paramId) };
    this.faders.set(paramId, rec);
    this._showFader(paramId);
    // drag to move
    const onMove = (e) => {
      const r = track.getBoundingClientRect();
      const pos = clamp01((r.bottom - e.clientY) / r.height);
      this._setParam(paramId, rec, pos, true);
    };
    const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      onMove(e);
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
    // scroll as an alternative to dragging (like the knobs)
    g.addEventListener('wheel', (e) => {
      e.preventDefault(); e.stopPropagation();
      const d = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
      const pos = clamp01((rec.value - rec.min) / (rec.max - rec.min) - d / 100 * 0.12);
      this._setParam(paramId, rec, pos, true);
    }, { passive: false });
    g.style.cursor = 'ns-resize';
  }

  _mute(svg, cx, cy, paramId) {
    const g = el('g', { 'data-mute': paramId }, svg);
    const lamp = el('circle', { cx, cy, r: MUTE_R, fill: '#f6eccf', stroke: '#d00000', 'stroke-width': 0.5 }, g);
    el('text', { x: cx, y: cy + MUTE_R + 4, 'text-anchor': 'middle', 'font-family': 'Arial Narrow, Helvetica, sans-serif', 'font-size': '4', fill: '#163a69' }, svg).textContent = 'mute';
    const rec = { lamp, on: this._paramDefault(paramId) === 'on' };
    this.mutes.set(paramId, rec);
    this._showMute(paramId);
    g.style.cursor = 'pointer';
    g.addEventListener('pointerdown', (e) => {
      e.stopPropagation(); e.preventDefault();
      rec.on = !rec.on;
      this.inst.setParam(paramId, rec.on ? 'on' : 'off');
      this._showMute(paramId);
      this.onChange();
    });
  }

  _vuLadder(svg, cx) {
    const segs = [];
    const h = (FADER_BOT - FADER_TOP);
    const segH = h / VU_SEGS;
    for (let i = 0; i < VU_SEGS; i++) {
      const y = FADER_BOT - (i + 1) * segH + 0.6;
      // colour: bottom green -> yellow -> red
      const frac = i / (VU_SEGS - 1);
      const onColor = frac > 0.85 ? '#ff3b30' : frac > 0.6 ? '#ffcc00' : '#3ad13a';
      const r = el('rect', { x: cx - 2.6, y, width: 5.2, height: segH - 1.2, rx: 0.6, fill: '#20242a' }, svg);
      segs.push({ el: r, on: onColor });
    }
    return segs;
  }

  // ---- value -> visual ----
  _pos(rec) { return (rec.value - rec.min) / (rec.max - rec.min); }
  _showFader(paramId) {
    const rec = this.faders.get(paramId);
    const y = FADER_BOT - this._pos(rec) * (FADER_BOT - FADER_TOP);
    rec.handle.setAttribute('transform', `translate(0 ${y.toFixed(2)})`);
  }
  _showKnob(paramId) {
    const rec = this.knobs.get(paramId);
    const a = -150 + this._pos(rec) * 300;   // -150..+150 deg
    rec.pointer.setAttribute('transform', `rotate(${a.toFixed(1)} ${rec.cx} ${rec.cy})`);
  }
  _showMute(paramId) {
    const rec = this.mutes.get(paramId);
    rec.lamp.setAttribute('fill', rec.on ? 'url(#mxLed)' : '#f6eccf');
    rec.lamp.setAttribute('stroke', rec.on ? '#7c0000' : '#d00000');
    rec.lamp.setAttribute('stroke-width', rec.on ? '0.24' : '0.5');
  }

  _setParam(paramId, rec, pos, fromDrag) {
    rec.value = rec.min + clamp01(pos) * (rec.max - rec.min);
    if (paramId === 'master') { this.onMaster(rec.value); this._showFader(paramId); return; }
    this.inst.setParam(paramId, rec.value);
    if (this.faders.has(paramId)) this._showFader(paramId); else this._showKnob(paramId);
    this.onChange();
  }

  // Update the master fader's shown value without echoing back (toolbar changed it).
  setMaster(value) {
    const rec = this.faders.get('master');
    if (!rec) return;
    rec.value = value;
    this._showFader('master');
  }

  // ---- save/load: read/write every control value by param id ----
  getValues() {
    const out = {};
    for (const [id, r] of this.faders) out[id] = r.value;
    for (const [id, r] of this.knobs) out[id] = r.value;
    for (const [id, r] of this.mutes) out[id] = r.on ? 'on' : 'off';
    return out;
  }

  setValue(id, v) {
    const f = this.faders.get(id);
    if (f) { this._setParam(id, f, (v - f.min) / (f.max - f.min), false); return; }
    const k = this.knobs.get(id);
    if (k) { this._setParam(id, k, (v - k.min) / (k.max - k.min), false); return; }
    const m = this.mutes.get(id);
    if (m) { m.on = v === 'on'; this.inst.setParam(id, v); this._showMute(id); }
  }

  // ---- VU animation ----
  _tick = () => {
    const m = this.inst.meters ? this.inst.meters() : { l: 0, r: 0 };
    this._paintVu(this.vu.l, m.l);
    this._paintVu(this.vu.r, m.r);
    this._raf = requestAnimationFrame(this._tick);
  };
  _paintVu(segs, level) {
    const lit = Math.round(clamp01(level * 1.6) * segs.length);
    for (let i = 0; i < segs.length; i++) segs[i].el.setAttribute('fill', i < lit ? segs[i].on : '#20242a');
  }

  // ---- window: drag, toggle, persist ----
  _makeDraggable() {
    this.win.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = this.win.getBoundingClientRect();
      const dx = e.clientX - r.left, dy = e.clientY - r.top;
      const onMove = (ev) => {
        this.win.style.left = Math.max(0, ev.clientX - dx) + 'px';
        this.win.style.top = Math.max(0, ev.clientY - dy) + 'px';
      };
      const onUp = () => {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        this._savePos();
      };
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
    });
  }
  _restorePos() {
    let p = null;
    try { p = JSON.parse(localStorage.getItem(POS_KEY)); } catch (_e) { /* none */ }
    if (p && Number.isFinite(p.left) && Number.isFinite(p.top)) {
      this.win.style.left = p.left + 'px'; this.win.style.top = p.top + 'px';
    } else {
      this.win.style.left = '20px'; this.win.style.top = '52px';
    }
  }
  _savePos() {
    const r = this.win.getBoundingClientRect();
    try { localStorage.setItem(POS_KEY, JSON.stringify({ left: Math.round(r.left), top: Math.round(r.top) })); } catch (_e) { /* ignore */ }
  }

  // Size the window to a target height (px), keeping the faceplate aspect ratio.
  setHeight(px) {
    if (!px || px < 40) return;
    this.win.style.height = px + 'px';
    this.win.style.width = (px * VB_W / VB_H) + 'px';
  }

  toggle() { (this.win.style.display === 'none') ? this.show() : this.hide(); }
  show() {
    this.win.style.display = 'block';
    if (!this._raf) this._raf = requestAnimationFrame(this._tick);
    // Click-away to close: any pointerdown outside the panel (empty faceplate,
    // rack, etc.) hides it. The Mixer button is exempt so its own toggle runs.
    if (!this._onOutside) {
      this._onOutside = (e) => {
        if (this.win.contains(e.target)) return;
        if (e.target.closest && e.target.closest('#mixer-open')) return;
        this.hide();
      };
      document.addEventListener('pointerdown', this._onOutside, true);
    }
  }
  hide() {
    this.win.style.display = 'none';
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; }
    if (this._onOutside) { document.removeEventListener('pointerdown', this._onOutside, true); this._onOutside = null; }
  }
}
