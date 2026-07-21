// about.js — the "About DreamRack" dialog.
//
// A small centred card (dressed with the same .tour-* chrome as the tutorial and patch notes) that
// names the product, shows its version and the exact source revision it is running, a one-line
// description, and links out to the repository and the tutorial. Read-only: the provenance
// (commit / dirty) comes from rack.buildInfo — the same value host/patch-io.js stamps into saved
// patches — so a user can read the revision straight from About without saving a file.
//
//   createAbout({ appName, appVersion, getBuild, isDark, openExternal, repoUrl, onTutorial }) -> controller
//
// The controller exposes open() / close() / toggle() / isOpen() / applyTheme().

'use strict';

export function createAbout({ appName, appVersion, getBuild, isDark, openExternal, repoUrl, onTutorial }) {
  let el;

  function applyTheme() { if (el) el.classList.toggle('theme-dark', !!(isDark && isDark())); }

  function centre() {
    const r = el.getBoundingClientRect();
    el.style.left = Math.round((window.innerWidth - r.width) / 2) + 'px';
    el.style.top = Math.round(Math.max(6, (window.innerHeight - r.height) / 2)) + 'px';
  }

  // The head is a drag handle (matching the other cards), but clicks on the close button or a
  // link must not start a drag.
  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest('button, a')) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => { el.style.left = Math.round(ev.clientX - dx) + 'px'; el.style.top = Math.round(ev.clientY - dy) + 'px'; };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };

  function extLink(text, url) {
    const a = document.createElement('a');
    a.className = 'about-link'; a.textContent = text; a.href = url;
    a.addEventListener('click', (e) => { e.preventDefault(); if (openExternal) openExternal(url); });
    return a;
  }

  function build() {
    el = document.createElement('div');
    el.className = 'tour-card about-card';

    const head = document.createElement('div'); head.className = 'tour-head';
    const title = document.createElement('div'); title.className = 'tour-title'; title.textContent = 'About ' + appName;
    const close = document.createElement('button'); close.className = 'tour-x'; close.textContent = '×'; close.title = 'Close';
    close.addEventListener('click', () => hide());
    head.appendChild(title); head.appendChild(close);
    head.addEventListener('pointerdown', startDrag);

    const body = document.createElement('div'); body.className = 'tour-body about-body';

    const name = document.createElement('div'); name.className = 'about-name'; name.textContent = appName;
    const ver = document.createElement('div'); ver.className = 'about-ver'; ver.textContent = 'Version ' + appVersion;
    const desc = document.createElement('div'); desc.className = 'about-desc';
    desc.textContent = 'An exploration of ideas for an easier-to-use, more powerful modular synthesis environment.';
    body.appendChild(name); body.appendChild(ver); body.appendChild(desc);

    // The running revision, when known (Electron-from-source). Absent in the browser build.
    const b = typeof getBuild === 'function' ? getBuild() : null;
    if (b && b.short) {
      const rev = document.createElement('div'); rev.className = 'about-rev';
      const bits = [b.short + (b.dirty ? ' (modified)' : '')];
      if (b.branch) bits.push(b.branch);
      rev.textContent = 'Build ' + bits.join(' · ');
      if (b.commit) rev.title = b.commit;
      body.appendChild(rev);
    }

    const links = document.createElement('div'); links.className = 'about-links';
    if (repoUrl) links.appendChild(extLink('Project on GitHub', repoUrl));
    if (onTutorial) {
      const t = document.createElement('a'); t.className = 'about-link'; t.href = '#'; t.textContent = 'Interactive tutorial';
      t.addEventListener('click', (e) => { e.preventDefault(); hide(); onTutorial(); });
      links.appendChild(t);
    }
    if (links.childElementCount) body.appendChild(links);

    el.appendChild(head); el.appendChild(body);
    document.body.appendChild(el);
    applyTheme();
  }

  function show() { if (!el) build(); el.style.display = 'flex'; centre(); }
  function hide() { if (el) el.style.display = 'none'; }

  return {
    open: () => show(),
    close: () => hide(),
    toggle: () => { if (el && el.style.display !== 'none') hide(); else show(); },
    isOpen: () => !!(el && el.style.display !== 'none'),
    applyTheme,
  };
}
