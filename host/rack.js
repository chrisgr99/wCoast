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

import { loadPanel, showValue, attachControlInteraction, FACE_H_MM } from './panel-loader.js';

const HP_MM = 5.08;
const PANEL_H_MM = FACE_H_MM;   // modules display only the cropped functional face
const GAP_MM = 4;               // gap between rows / around the case, in mm (scales too)

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

    this.container.classList.add('rack');
    this.content = document.createElement('div');
    this.content.className = 'rack-content';
    this.container.appendChild(this.content);
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
  }

  // ---- geometry / scaling ----
  relayout() {
    const vpH = this.container.clientHeight || 600;
    const vpW = this.container.clientWidth || 800;
    const contentHmm = this.rowCount * PANEL_H_MM + (this.rowCount + 1) * GAP_MM;
    const fit = vpH / contentHmm;           // fill the viewport height at zoom 1
    this.pxPerMm = fit * this.zoom;
    const s = this.pxPerMm;

    let maxRightMm = 0;
    for (const r of this.rows) for (const rec of r) maxRightMm = Math.max(maxRightMm, (rec.hp + rec.hpWidth) * HP_MM);
    const contentWmm = Math.max(maxRightMm + GAP_MM, vpW / s);

    this.content.style.width = (contentWmm * s) + 'px';
    this.content.style.height = (contentHmm * s) + 'px';
    for (let i = 0; i < this.rowCount; i++) {
      const el = this._rowEls[i];
      el.style.top = ((GAP_MM + i * (PANEL_H_MM + GAP_MM)) * s) + 'px';
      el.style.height = (PANEL_H_MM * s) + 'px';
      el.style.width = (contentWmm * s) + 'px';
    }
    for (const rec of this.records.values()) this._placeEl(rec);
  }

  _placeEl(rec) {
    const s = this.pxPerMm;
    rec.el.style.left = (rec.hp * HP_MM * s) + 'px';
    rec.el.style.width = (rec.panelWmm * s) + 'px';
    rec.el.style.height = (PANEL_H_MM * s) + 'px';
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
  }

  deleteModule(rec) {
    if (this._hoverRec === rec) this._hoverRec = null;
    if (this._focusRec === rec) { this._focusRec = null; this.zoom = 1; }
    const row = this.rows[rec.row];
    const i = row.indexOf(rec);
    if (i >= 0) row.splice(i, 1);
    rec.el.remove();
    this.host.dispose(rec.instanceId);
    this.records.delete(rec.key);
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

  _openMenu(x, y, items) {
    this._closeMenu();
    const menu = document.createElement('div');
    menu.className = 'rack-menu';
    for (const it of items) {
      const item = document.createElement('div');
      item.className = 'rack-menu-item';
      item.textContent = it.label;
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
