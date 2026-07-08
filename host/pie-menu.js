// pie-menu.js — radial "pie" menu. See design/pie-menus.md.
//
// A small icon-only radial menu with eight fixed compass positions, opened on
// right-click over a context (a terminal, a faceplate, the title strip). Each
// segment is a wedge that IS the button; selection is by moving out of the centre
// dead zone into a wedge, then pressing — or one fluid press-drag. A press in the
// dead zone (or Escape, or right-click) cancels with no action.
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

// segments: [{ dir, icon (SVG/HTML string), label, highlighted,
//              onPeek(e), onUnpeek(e), onCommit(e, mode) }].
// Positions are fixed by `dir` (muscle memory). A peekable segment supplies onPeek /
// onUnpeek (the reversible preview) and onCommit (crossing the outer circle, mode
// 'down'|'up' for release- vs click-to-drop). A one-shot segment supplies just
// onCommit (or legacy onSelect), which fires on the same cross-out.
export function openPieMenu({ x, y, segments = [], innerR = 11, outerR = 30, iconR = 19, tickLen = 5, pad = 12 } = {}) {
  closePieMenu();
  const W = window.innerWidth, H = window.innerHeight;
  const cx = Math.max(outerR + pad, Math.min(W - outerR - pad, x));
  const cy = Math.max(outerR + pad, Math.min(H - outerR - pad, y));
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
    g.setAttribute('class', 'pie-wedge' + (seg.highlighted ? ' toggled' : ''));
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
    overlay.appendChild(icon);
  }
  const cursor = document.createElement('div');
  cursor.className = 'pie-cursor';
  overlay.appendChild(cursor);

  // Peek model. Moving into a segment PEEKS it — a reversible preview (sound starts,
  // a scope appears). Moving to the dead zone or to another segment UN-peeks it,
  // undoing the preview. The menu does NOT close on entering or clicking a segment.
  // It closes only two ways: crossing the outer circle COMMITS the peeked segment
  // (its preview stays / a drag hands off), or returning to the centre and releasing
  // or clicking CANCELS. Commit mode 'down' (a button was held) hands off a release-
  // to-drop tool; mode 'up' (no button) hands off a click-to-drop tool.
  let peeked = null, done = false, pressed = false;
  const setHover = (dir) => {
    if (peeked && wedgeEls.get(peeked)) wedgeEls.get(peeked).classList.remove('hover');
    peeked = dir;
    if (peeked && wedgeEls.get(peeked)) wedgeEls.get(peeked).classList.add('hover');
  };
  const peekTo = (dir, e) => {
    if (dir === peeked) return;
    if (peeked) { const s = byDir.get(peeked); if (s && s.onUnpeek) s.onUnpeek(e); }
    const s = dir && byDir.get(dir);
    setHover(dir);
    if (s && s.onPeek) s.onPeek(e);
  };
  const zoneOf = (px, py) => {
    const rx = px + offX, ry = py + offY;
    cursor.style.left = rx + 'px'; cursor.style.top = ry + 'px';
    const dx = rx - cx, dy = ry - cy, dist = Math.hypot(dx, dy);
    if (dist < innerR) return { zone: 'center', dir: null };
    let ang = Math.atan2(dy, dx) * 180 / Math.PI; if (ang < 0) ang += 360;
    const dir = SNAP_DIR[60 * Math.floor(ang / 60) + 30];
    return { zone: dist > outerR ? 'outside' : 'seg', dir: byDir.has(dir) ? dir : null };
  };
  const commit = (dir, e) => {
    const seg = byDir.get(dir);
    done = true;
    const mode = e.buttons ? 'down' : 'up';
    closePieMenu();
    const run = seg && (seg.onCommit || seg.onSelect);
    if (run) run(e, mode);
  };
  zoneOf(x, y);   // seat the rendered cursor at the centre
  const onMove = (e) => {
    if (done) return;
    const z = zoneOf(e.clientX, e.clientY);
    if (z.zone === 'center') { peekTo(null, e); return; }
    if (z.zone === 'seg') { peekTo(z.dir, e); return; }
    if (!z.dir) { peekTo(null, e); closePieMenu(); return; }   // out toward an empty direction → close
    if (peeked !== z.dir) peekTo(z.dir, e);                    // a fast drag can skip the ring: peek then commit
    commit(z.dir, e);
  };
  const onDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.button === 2) { peekTo(null, e); closePieMenu(); return; }   // a fresh right-click cancels
    pressed = true;                                                     // a press on a segment does NOT act; the gesture continues
  };
  // Release/click closes ONLY back in the centre (cancel). A release on a segment
  // leaves the menu up so the peek stays. `pressed` guards the release of the opening
  // right-click, which never pressed the overlay.
  const onUp = (e) => {
    if (done || !pressed) return;
    if (zoneOf(e.clientX, e.clientY).zone === 'center') { peekTo(null, e); closePieMenu(); }
  };
  const onKey = (e) => { if (e.key === 'Escape') { e.preventDefault(); peekTo(null); closePieMenu(); } };
  document.addEventListener('pointermove', onMove, true);
  overlay.addEventListener('pointerdown', onDown, true);
  overlay.addEventListener('pointerup', onUp, true);
  overlay.addEventListener('contextmenu', (e) => { e.preventDefault(); closePieMenu(); }, true);
  document.addEventListener('keydown', onKey, true);

  closeCurrent = () => {
    closeCurrent = null;
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('keydown', onKey, true);
    overlay.remove();
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

