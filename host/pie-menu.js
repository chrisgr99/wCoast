// pie-menu.js — radial "pie" menu. See design/pie-menus.md.
//
// A small icon-only radial menu with six fixed compass positions, opened by a
// RIGHT-click over a context (a terminal, a faceplate, a title). Each segment is a
// wedge that IS the button. Moving over the wedges only HIGHLIGHTS them. A CLICK on a
// wedge runs its action and leaves the menu open (a toggle — sound on/off, a scope
// shown/hidden); PRESSING a wedge and DRAGGING out through the circle instead pulls a
// new object out to place (scope / ear monitor). The menu closes on a click in the
// dead zone, Escape, a right-click, or the pointer leaving past the outer circle.
//
// The real OS cursor is HIDDEN but kept live (not pointer-locked) so a screen
// magnifier keeps following it; we draw our own cursor, offset by however far the
// pie had to be nudged inward to stay fully on-screen. In the common case the
// offset is zero and the rendered cursor sits exactly on the real one.
'use strict';

const SVG_NS = 'http://www.w3.org/2000/svg';
// Six directions (a hexagon): straight up and down, plus the four diagonals at ±30°
// from horizontal. Angle in deg; 0 = +x (right), clockwise since screen y grows down.
const DIR_ANGLE = { SE: 30, S: 90, SW: 150, NW: 210, N: 270, NE: 330 };
const SNAP_DIR = { 30: 'SE', 90: 'S', 150: 'SW', 210: 'NW', 270: 'N', 330: 'NE' };

let closeCurrent = null;

export function closePieMenu() { if (closeCurrent) closeCurrent(); }

// segments: [{ dir, icon (SVG/HTML string), label, highlighted, plain, capture,
//              onPeekStart(ctx), onPeekMove(ctx), onPeekEnd(ctx), commit(ctx) }].
// Positions are fixed by `dir` (muscle memory). Moving the pointer INTO a segment
// activates it: a `peek` segment (one with onPeekStart) runs onPeekStart while the
// pointer stays inside and onPeekEnd when it leaves (to the centre, another segment,
// outside, or on close) — a momentary preview. A segment COMMITS on a CLICK, running
// seg.commit and closing the pie (create a scope/monitor, latch the subnet, toggle the
// sound, open the app menu). Crossing the outer circle just CLOSES the pie — never
// commits — so an accidental slide off the edge does nothing. A `capture` wedge is the
// exception: once entered it owns the interaction (its onPeekMove preview follows the
// cursor across the whole ring) and commits when the pointer crosses the outer edge in
// ANY direction, or cancels back at the centre — the pull-a-cable puller. ctx passed to
// callbacks is { x, y, cx, cy, outerR }: the rendered cursor position plus the pie's centre and
// radius, so a commit/peek can place things relative to the pie.
export function openPieMenu({ x, y, segments = [], onClose, innerR = 11, outerR = 30, iconR = 19, tickLen = 5, pad = 12, topReserve = 0 } = {}) {
  closePieMenu();
  const W = window.innerWidth, H = window.innerHeight;
  const cx = Math.max(outerR + pad, Math.min(W - outerR - pad, x));
  // topReserve keeps extra clearance ABOVE the pie (for a menu that peeks up behind the
  // top wedge) — near the top of the window the pie shifts down to make room.
  const cy = Math.max(outerR + pad + topReserve, Math.min(H - outerR - pad, y));
  const offX = cx - x, offY = cy - y;                    // rendered cursor = real pointer + this
  const byDir = new Map(segments.filter((s) => s && s.dir).map((s) => [s.dir, s]));
  const vtx = (r) => Array.from({ length: 6 }, (_, k) => { const a = (k * 60) * Math.PI / 180; return [outerR + Math.cos(a) * r, outerR + Math.sin(a) * r]; });
  const hexD = (r) => 'M ' + vtx(r).map(([px, py], i) => `${i ? 'L ' : ''}${px.toFixed(2)} ${py.toFixed(2)}`).join(' ') + ' Z';

  const overlay = document.createElement('div');
  overlay.className = 'pie-overlay';
  document.body.appendChild(overlay);

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'pie-svg');
  svg.setAttribute('width', outerR * 2); svg.setAttribute('height', outerR * 2);
  svg.setAttribute('viewBox', `0 0 ${outerR * 2} ${outerR * 2}`);
  svg.style.left = (cx - outerR) + 'px'; svg.style.top = (cy - outerR) + 'px';
  overlay.appendChild(svg);

  // The menu body — an opaque disc with a HEXAGONAL HOLE in the middle (circle outer
  // boundary, hexagon inner boundary), one even-odd path so the hexagon is cut out.
  const circleD = `M ${2 * outerR} ${outerR} A ${outerR} ${outerR} 0 1 1 0 ${outerR} A ${outerR} ${outerR} 0 1 1 ${2 * outerR} ${outerR} Z`;
  const bg = document.createElementNS(SVG_NS, 'path');
  bg.setAttribute('class', 'pie-bg');
  bg.setAttribute('fill-rule', 'evenodd');
  bg.setAttribute('d', circleD + ' ' + hexD(innerR));
  svg.appendChild(bg);

  // Hover wedges (invisible until hovered) tiling the ring from the hexagon hole out
  // to the circle.
  const wedgeEls = new Map();
  for (const [dir, seg] of byDir) {
    const g = document.createElementNS(SVG_NS, 'g');
    g.setAttribute('class', 'pie-wedge' + (seg.highlighted ? ' toggled' : '') + (seg.plain ? ' plain' : ''));
    g.appendChild(wedgePath(outerR, innerR, DIR_ANGLE[dir]));
    svg.appendChild(g);
    wedgeEls.set(dir, g);
  }

  // Outlines (all half-width): the outer circle, the hexagon hole, and the six spokes
  // from the hexagon vertices out to the circle — dividing the pie into six segments.
  const circle = document.createElementNS(SVG_NS, 'circle');
  circle.setAttribute('class', 'pie-line');
  circle.setAttribute('cx', outerR); circle.setAttribute('cy', outerR); circle.setAttribute('r', outerR);
  svg.appendChild(circle);
  const inner = document.createElementNS(SVG_NS, 'path');
  inner.setAttribute('class', 'pie-line');
  inner.setAttribute('d', hexD(innerR));
  svg.appendChild(inner);
  for (const [vx, vy] of vtx(innerR)) {
    const a = Math.atan2(vy - outerR, vx - outerR);
    const sp = document.createElementNS(SVG_NS, 'line');
    sp.setAttribute('class', 'pie-line');
    sp.setAttribute('x1', vx.toFixed(2)); sp.setAttribute('y1', vy.toFixed(2));
    sp.setAttribute('x2', (outerR + Math.cos(a) * outerR).toFixed(2)); sp.setAttribute('y2', (outerR + Math.sin(a) * outerR).toFixed(2));
    svg.appendChild(sp);
  }

  // Icons on the faces of the outer hexagon (HTML, in viewport coords).
  for (const [dir, seg] of byDir) {
    const a = DIR_ANGLE[dir] * Math.PI / 180;
    const icon = document.createElement('div');
    icon.className = 'pie-icon';
    icon.style.left = (cx + Math.cos(a) * iconR) + 'px';
    icon.style.top = (cy + Math.sin(a) * iconR) + 'px';
    icon.innerHTML = seg.icon || '';
    if (seg.label) icon.title = seg.label;
    seg.iconEl = icon;   // so a peek can re-render the wedge's glyph live (e.g. the sound LED)
    overlay.appendChild(icon);
  }
  const cursor = document.createElement('div');
  cursor.className = 'pie-cursor';
  overlay.appendChild(cursor);

  // Hover-activate. The rendered cursor roams the wedges; entering one makes it the
  // `activeSeg` and runs its onPeekStart (a momentary preview), onPeekEnd on leaving
  // (to the centre, another segment, outside, or on close). A segment COMMITS two ways,
  // which do the same thing: CLICK it, or move the pointer OUT through its edge (cross
  // the outer circle in that wedge's direction). Committing closes the pie and runs
  // seg.commit — the lasting form (open the app menu, latch the subnet, carry out a
  // scope/monitor, toggle the sound). Crossing out through an EMPTY direction, Escape,
  // a right-click, or a click in the dead zone just closes the pie.
  let hovered = null, activeSeg = null, peeking = false, done = false, pressed = false;
  let lastCtx = { x: cx, y: cy, cx, cy, outerR };
  const setHover = (dir) => {
    if (hovered && wedgeEls.get(hovered)) wedgeEls.get(hovered).classList.remove('hover');
    hovered = dir;
    if (hovered && wedgeEls.get(hovered)) wedgeEls.get(hovered).classList.add('hover');
  };
  const endPeek = () => { if (activeSeg && peeking && activeSeg.onPeekEnd) activeSeg.onPeekEnd(lastCtx); peeking = false; };
  const zoneOf = (px, py) => {
    const rx = px + offX, ry = py + offY;
    cursor.style.left = rx + 'px'; cursor.style.top = ry + 'px';
    lastCtx = { x: rx, y: ry, cx, cy, outerR };
    const dx = rx - cx, dy = ry - cy, dist = Math.hypot(dx, dy);
    let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang < 0) ang += 360;
    return { dist, dir: SNAP_DIR[60 * Math.floor(ang / 60) + 30] };
  };
  zoneOf(x, y);   // seat the rendered cursor at the centre
  // Run a segment's commit and close the pie. `peeking` is cleared first so close won't
  // tear the peek down — the commit owns the lasting state.
  const commitSeg = (seg) => { done = true; peeking = false; const c = lastCtx; closePieMenu(); if (seg.commit) seg.commit(c); };
  // Move the active segment as the pointer roams: end the old peek, then start the new one.
  const enter = (seg) => {
    if (seg === activeSeg) return;
    endPeek();
    activeSeg = seg;
    if (!seg) return;
    if (seg.onPeekStart) { seg.onPeekStart(lastCtx); peeking = true; }
  };
  const onMove = (e) => {
    if (done) return;
    const { dist, dir } = zoneOf(e.clientX, e.clientY);
    // A `capture` peek (the pull-a-cable wedge) owns the interaction once entered: its
    // preview follows the cursor across the whole ring; back to the CENTRE cancels it,
    // and crossing the outer edge in ANY direction commits it (starts the real cord).
    if (activeSeg && activeSeg.capture && peeking) {
      if (dist < innerR) { enter(null); return; }              // centre → cancel
      if (dist > outerR) { commitSeg(activeSeg); return; }       // out any direction → commit
      if (activeSeg.onPeekMove) activeSeg.onPeekMove(lastCtx);   // follow the cursor
      return;
    }
    if (dist <= outerR) {
      const inSeg = (dist >= innerR && byDir.has(dir)) ? byDir.get(dir) : null;
      setHover(inSeg ? dir : null);
      enter(inSeg);
      if (inSeg && inSeg === activeSeg && peeking && inSeg.onPeekMove) inSeg.onPeekMove(lastCtx);
      return;
    }
    // Crossing the outer circle otherwise just CLOSES the pie — creation/latching happens
    // on a click, never on an accidental cross-out.
    closePieMenu();
  };
  const onDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.button === 2) { closePieMenu(); return; }   // a fresh right-click cancels
    pressed = true;
  };
  // A click ON a wedge with a commit runs it and closes; a click in the dead zone
  // closes. `pressed` guards the opening click's release.
  const onUp = (e) => {
    if (done) return;
    const { dist, dir } = zoneOf(e.clientX, e.clientY);
    if (dist < innerR) { if (pressed) { done = true; closePieMenu(); } return; }
    if (dist <= outerR && byDir.has(dir)) {
      const seg = byDir.get(dir);
      if (seg && seg.commit) { commitSeg(seg); }
    }
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); closePieMenu(); } };
  document.addEventListener('pointermove', onMove, true);
  overlay.addEventListener('pointerdown', onDown, true);
  overlay.addEventListener('pointerup', onUp, true);
  overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); closePieMenu(); }, true);
  document.addEventListener('keydown', onKey, true);

  closeCurrent = () => {
    closeCurrent = null;
    endPeek();                    // tear down a live momentary command (a commit clears peeking first)
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
    if (onClose) onClose();   // fired however the menu closes — clears temporary peek viewers as a safety net
  };
}

// One hover wedge: a segment of the ring — the hexagon's flat side (inner), two
// radial spokes (sides), and the circle arc (outer). Centred in the svg's local box
// (R,R). span 60 tiles the ring with no gaps.
function wedgePath(R, r, angleDeg, span = 60) {
  const a0 = (angleDeg - span / 2) * Math.PI / 180, a1 = (angleDeg + span / 2) * Math.PI / 180;
  const p = (rad, ang) => `${(R + Math.cos(ang) * rad).toFixed(2)} ${(R + Math.sin(ang) * rad).toFixed(2)}`;
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', `M ${p(r, a0)} L ${p(R, a0)} A ${R} ${R} 0 0 1 ${p(R, a1)} L ${p(r, a1)} Z`);
  return path;
}

