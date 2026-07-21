// patch-notes.js — the "Patch notes" card.
//
// A small floating, parkable, resizable card (dressed with the same .tour-* chrome as the tutorial) that
// shows a patch's own free-text note and lets you edit it. The note is PLAIN TEXT — a reminder about how
// to play the patch, not markup — stored in the patch file (host/patch-io.js) via rack.patchNotes.
//
//   createPatchNotes({ getNotes, setNotes, getOpen, setOpen, isDark, onChange }) -> controller
//
// The controller exposes open() / close() / toggle() / refresh() / applyTheme(). State lives outside
// (on the rack, so it serializes); this module is only the view + editor.

'use strict';

const POS_KEY = 'wcoast.notesPos';
const SIZE_KEY = 'wcoast.notesSize';
const MIN_W = 240, MIN_H = 140, MAX_W = 640, MAX_H = 620;

export function createPatchNotes({ getNotes, setNotes, getOpen, setOpen, isDark, onChange }) {
  let el, bodyEl, editBtn, openCb, ta = null, editing = false;

  const readJSON = (k) => { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (_e) { return null; } };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_e) { /* private mode */ } };

  const clampOnScreen = () => {
    const r = el.getBoundingClientRect(), pad = 6;
    let x = Math.min(Math.max(pad, r.left), window.innerWidth - r.width - pad);
    let y = Math.min(Math.max(pad, r.top), window.innerHeight - r.height - pad);
    if (r.width > window.innerWidth - 2 * pad) x = pad;
    if (r.height > window.innerHeight - 2 * pad) y = pad;
    el.style.left = Math.round(x) + 'px'; el.style.top = Math.round(y) + 'px';
  };

  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest('button, input, textarea')) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => { el.style.left = Math.round(ev.clientX - dx) + 'px'; el.style.top = Math.round(ev.clientY - dy) + 'px'; };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); const b = el.getBoundingClientRect(); writeJSON(POS_KEY, { x: b.left, y: b.top }); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };

  const startResize = (e, mode) => {
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect(), sx = e.clientX, sy = e.clientY, w0 = r.width, h0 = r.height;
    const move = (ev) => {
      const h = Math.min(MAX_H, Math.max(MIN_H, h0 + (ev.clientY - sy)));
      el.style.height = Math.round(h) + 'px';
      if (mode === 'xy') { const w = Math.min(MAX_W, Math.max(MIN_W, w0 + (ev.clientX - sx))); el.style.width = Math.round(w) + 'px'; }
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); const b = el.getBoundingClientRect(); writeJSON(SIZE_KEY, { w: b.width, h: b.height }); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };

  function applyTheme() { if (el) el.classList.toggle('theme-dark', !!(isDark && isDark())); }

  function renderView() {
    editing = false; ta = null; if (editBtn) editBtn.textContent = 'Edit';
    bodyEl.innerHTML = '';
    const txt = (getNotes() || '').trim();
    const p = document.createElement('div');
    p.className = 'notes-text' + (txt ? '' : ' notes-empty');
    p.textContent = txt || 'No notes yet. Press Edit to describe this patch — what it does, how to play it, what to try.';
    bodyEl.appendChild(p);
  }
  function startEdit() {
    editing = true; editBtn.textContent = 'Done';
    bodyEl.innerHTML = '';
    ta = document.createElement('textarea');
    ta.className = 'notes-edit';
    ta.value = getNotes() || '';
    ta.placeholder = 'Notes about this patch — how to play it, what to try…';
    bodyEl.appendChild(ta);
    ta.focus();
  }
  function commitEdit() { if (editing && ta) { setNotes(ta.value); if (onChange) onChange(); } }

  function build() {
    el = document.createElement('div');
    el.className = 'tour-card notes-card';

    const head = document.createElement('div'); head.className = 'tour-head';
    const title = document.createElement('div'); title.className = 'tour-title'; title.textContent = 'Patch notes';
    const close = document.createElement('button'); close.className = 'tour-x'; close.textContent = '×'; close.title = 'Close';
    close.addEventListener('click', () => hide());
    head.appendChild(title); head.appendChild(close);
    head.addEventListener('pointerdown', startDrag);

    bodyEl = document.createElement('div'); bodyEl.className = 'tour-body';

    const foot = document.createElement('div'); foot.className = 'tour-foot';
    const left = document.createElement('div'); left.className = 'tour-left';
    editBtn = document.createElement('button'); editBtn.className = 'tour-btn'; editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => { if (editing) { commitEdit(); renderView(); } else startEdit(); });
    const openLbl = document.createElement('label'); openLbl.className = 'tour-never';
    openCb = document.createElement('input'); openCb.type = 'checkbox';
    openCb.addEventListener('change', () => { if (setOpen) setOpen(openCb.checked); if (onChange) onChange(); });
    openLbl.appendChild(openCb); openLbl.appendChild(document.createTextNode(' Open with patch'));
    openLbl.title = 'Show this note automatically when the patch opens';
    left.appendChild(editBtn); left.appendChild(openLbl);
    foot.appendChild(left);

    const ry = document.createElement('div'); ry.className = 'tour-resize-y'; ry.addEventListener('pointerdown', (e) => startResize(e, 'y'));
    const rxy = document.createElement('div'); rxy.className = 'tour-resize-xy'; rxy.addEventListener('pointerdown', (e) => startResize(e, 'xy'));

    el.appendChild(head); el.appendChild(bodyEl); el.appendChild(foot); el.appendChild(ry); el.appendChild(rxy);
    document.body.appendChild(el);
    applyTheme();

    const size = readJSON(SIZE_KEY); if (size) { el.style.width = Math.round(size.w) + 'px'; el.style.height = Math.round(size.h) + 'px'; }
    const pos = readJSON(POS_KEY); if (pos) { el.style.left = Math.round(pos.x) + 'px'; el.style.top = Math.round(pos.y) + 'px'; }
  }

  function show() {
    if (!el) build();
    el.style.display = 'flex';
    if (openCb) openCb.checked = !!(getOpen && getOpen());
    renderView();
    clampOnScreen();
  }
  function hide() { if (!el) return; commitEdit(); if (editing) renderView(); el.style.display = 'none'; }

  return {
    open: () => show(),
    close: () => hide(),
    toggle: () => { if (el && el.style.display !== 'none') hide(); else show(); },
    isOpen: () => !!(el && el.style.display !== 'none'),
    refresh: () => { if (el && el.style.display !== 'none') { if (!editing) renderView(); if (openCb) openCb.checked = !!(getOpen && getOpen()); } },
    applyTheme,
  };
}
