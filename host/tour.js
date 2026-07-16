// tour.js — the getting-started tour: a sequence of MODELESS floating cards.
//
// Every step of the guide is a "try this now" step, so the card must NOT block the thing it
// describes: there is no backdrop, no focus trap, and no Escape binding (Escape already cancels
// a cable pull and closes the overview — a card must not steal it). The reader drives with Next
// and Previous; nothing advances on its own, so a step can never trap someone who did the action
// slightly differently than we expected.
//
// The card is chrome, not rack content: it is position:fixed, so the rack zooms and pans beneath
// it. It sits above the scopes/monitors band but BELOW menus and the overview navigator — the
// overview is a full-window opaque picture and is meant to cover this, so any step that sends the
// reader there must tell them how to come back.
//
// Steps are plain data (see tour-steps.js) — { title, body } — so the copy can be rewritten
// without touching any of this. A step's body is a list of parts: a string is prose, and
// { try: '...' } is a "Do this" block. They render in the order written and scroll together,
// because a step often has more than one thing to try and each belongs next to the prose that
// sets it up — not parked in one fixed slot at the bottom.

'use strict';

const POS_KEY = 'wcoast.tourPos';    // remembered card position: the reader parks it out of the way once
const SEEN_KEY = 'wcoast.introSeen';  // set only by "Don't show on startup" — a plain close still returns next run

const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (_e) { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch (_e) { /* no storage */ } };

export function tourSeen() { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (_e) { return false; } }

// `steps`: the card copy, in order. `onExternal(url)`: open a link outside the app (Electron needs
// this routed through the shell, so the caller supplies it). `isDark()`: the app's current mode —
// the card is dressed as a faceplate, so it follows View ▸ Light/Dark mode like the panels do.
export function createTour({ steps, onExternal, isDark }) {
  let el = null, idx = 0;
  let titleEl, bodyEl, countEl, prevBtn, nextBtn, neverCb;

  // Keep the card fully on screen. A remembered position can fall outside the window after a
  // resize (or a move between displays), which would strand the card where it can't be reached.
  // If the window can't be measured yet, DON'T clamp: a zero viewport would pin the card into the
  // top-left corner, which is worse than leaving it where it was asked to go.
  const clampIntoView = (x, y) => {
    const vw = window.innerWidth || 0, vh = window.innerHeight || 0;
    if (vw <= 0 || vh <= 0) return { x, y };
    const w = el.offsetWidth || 340, h = el.offsetHeight || 200;
    return {
      x: Math.max(4, Math.min(vw - w - 4, x)),
      y: Math.max(4, Math.min(vh - h - 4, y)),
    };
  };

  const place = (x, y) => {
    const p = clampIntoView(x, y);
    el.style.left = Math.round(p.x) + 'px';
    el.style.top = Math.round(p.y) + 'px';
    return p;
  };

  // Drag by the header only, so a press on the body or the buttons still does its own job.
  const startDrag = (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect();
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const onMove = (ev) => place(ev.clientX - dx, ev.clientY - dy);
    const onUp = (ev) => {
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      const p = place(ev.clientX - dx, ev.clientY - dy);
      write(POS_KEY, JSON.stringify(p));   // park it once, find it there next time
    };
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
  };

  const build = () => {
    el = document.createElement('div');
    el.className = 'tour-card';

    const head = document.createElement('div');
    head.className = 'tour-head';
    titleEl = document.createElement('div'); titleEl.className = 'tour-title';
    const close = document.createElement('button');
    close.className = 'tour-x'; close.textContent = '×';
    close.title = 'Close (Help ▸ Interactive tutorial brings it back)';
    close.setAttribute('aria-label', 'Close');
    close.addEventListener('click', () => hide());
    head.appendChild(titleEl); head.appendChild(close);
    head.addEventListener('pointerdown', startDrag);

    bodyEl = document.createElement('div'); bodyEl.className = 'tour-body';

    const foot = document.createElement('div'); foot.className = 'tour-foot';
    // Leaving must be obvious: a plain Close button, not just the ×.
    const closeBtn = document.createElement('button');
    closeBtn.className = 'tour-btn'; closeBtn.textContent = 'Close';
    closeBtn.addEventListener('click', () => hide());
    // "Don't show on startup" is a TOGGLE of the auto-open setting, not an exit: it shows its own
    // state and can be turned back off. It deliberately does NOT close the card — that's Close's job.
    // Named for what it does: Help ▸ Interactive tutorial reopens the card either way, so this only
    // ever governs whether a new session greets you with it.
    const never = document.createElement('label'); never.className = 'tour-never';
    neverCb = document.createElement('input'); neverCb.type = 'checkbox';
    neverCb.addEventListener('change', () => write(SEEN_KEY, neverCb.checked ? '1' : '0'));
    never.appendChild(neverCb);
    never.appendChild(document.createTextNode(" Don't show on startup"));
    never.title = 'Stop the tutorial opening by itself on a new session';
    const left = document.createElement('div'); left.className = 'tour-left';
    left.appendChild(closeBtn); left.appendChild(never);
    countEl = document.createElement('span'); countEl.className = 'tour-count';
    prevBtn = document.createElement('button'); prevBtn.className = 'tour-btn'; prevBtn.textContent = '‹ Back';
    nextBtn = document.createElement('button'); nextBtn.className = 'tour-btn tour-next'; nextBtn.textContent = 'Next ›';
    prevBtn.addEventListener('click', () => go(idx - 1));
    nextBtn.addEventListener('click', () => (idx >= steps.length - 1 ? hide() : go(idx + 1)));
    const nav = document.createElement('div'); nav.className = 'tour-nav';
    nav.appendChild(countEl); nav.appendChild(prevBtn); nav.appendChild(nextBtn);
    foot.appendChild(left); foot.appendChild(nav);

    el.appendChild(head); el.appendChild(bodyEl); el.appendChild(foot);
    document.body.appendChild(el);
  };

  // One part of a step: prose, or a "Do this" block. The label is inline rather than a heading —
  // a stacked one would cost a line every time, and a step may carry several.
  const renderPart = (part) => {
    if (typeof part === 'string') {
      const p = document.createElement('div');
      p.className = 'tour-p';
      p.innerHTML = part;                   // copy is ours, not user input — it may carry <b> and links
      return p;
    }
    const box = document.createElement('div');
    box.className = 'tour-try';
    const lab = document.createElement('b');
    lab.className = 'tour-try-label';
    lab.textContent = part.label || 'Do this';
    box.appendChild(lab);
    box.appendChild(document.createTextNode(' — ' + part.try));
    return box;
  };

  const go = (i) => {
    idx = Math.max(0, Math.min(steps.length - 1, i));
    const s = steps[idx];
    titleEl.textContent = s.title;
    bodyEl.textContent = '';
    const parts = Array.isArray(s.body) ? s.body : [s.body];
    for (const part of parts) bodyEl.appendChild(renderPart(part));
    bodyEl.scrollTop = 0;                   // a long step left scrolled down must not start the next one part-read
    countEl.textContent = `${idx + 1} of ${steps.length}`;
    prevBtn.disabled = idx === 0;
    nextBtn.textContent = idx >= steps.length - 1 ? 'Done' : 'Next ›';
    // Route any link in the copy through the caller (Electron opens these in the real browser).
    if (onExternal) for (const a of bodyEl.querySelectorAll('a[href]')) {
      a.addEventListener('click', (e) => { e.preventDefault(); onExternal(a.getAttribute('href')); });
    }
  };

  const hide = () => { if (el) el.style.display = 'none'; };

  // Match the app's faceplate mode. Called on open, and pushed by the app when the mode is switched
  // while the card is up (same `theme-dark` convention the context menus use).
  const applyTheme = () => { if (el) el.classList.toggle('theme-dark', !!(isDark && isDark())); };

  // Put the card where it was left, or low-centre on a first run. At boot the window can still
  // measure 0 (Electron opens hidden until ready-to-show; a browser settles its flex layout a beat
  // later) — placing then would strand the card in a corner, so wait for a real measurement.
  const placeInitial = (tries = 0) => {
    const saved = readJSON(POS_KEY);
    if (saved && typeof saved.x === 'number' && typeof saved.y === 'number') { place(saved.x, saved.y); return; }
    if ((!window.innerWidth || !el.offsetWidth) && tries < 10) { requestAnimationFrame(() => placeInitial(tries + 1)); return; }
    place((window.innerWidth - (el.offsetWidth || 340)) / 2, window.innerHeight * 0.62);
  };

  return {
    isOpen: () => !!el && el.style.display !== 'none',
    open(i = 0) {
      if (!steps.length) return;
      if (!el) build();
      el.style.display = '';
      applyTheme();
      neverCb.checked = tourSeen();   // the toggle shows the live setting, however it was last left
      go(i);
      placeInitial();
    },
    close: hide,
    applyTheme,
  };
}
