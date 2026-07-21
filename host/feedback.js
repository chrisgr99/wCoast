// feedback.js — the "Send feedback / Report a bug / Share a patch" composer.
//
// One small card (same .tour-* chrome as the tutorial and patch-notes cards) with a text box and a Send
// button. Send builds a PRE-FILLED GitHub compose page and opens it in the browser — a new Issue for a
// bug, a new Discussion for feedback or a shared patch — with the text (and, for bug/share, the current
// patch embedded in the body) already filled in. The app never posts on the user's behalf; they review
// and submit on GitHub, logged into their own account.
//
//   createComposer({ repo, isDark, getPatchJSON, openExternal, appVersion }) -> { feedback, reportBug, sharePatch }

'use strict';

const URL_LIMIT = 7000;   // keep the compose URL comfortably under browser/GitHub limits
const enc = encodeURIComponent;

const MODES = {
  feedback: { title: 'Send feedback', dest: 'discussion', category: 'general', prefTitle: 'Feedback', patch: false,
    prompt: 'A comment or suggestion. Send opens a GitHub discussion with your text — you review and post it there.' },
  bug: { title: 'Report a bug', dest: 'issue', label: 'bug', prefTitle: 'Bug: ', patch: true,
    prompt: 'Describe what went wrong and how to trigger it. Your current patch is attached so it can be reproduced.' },
  share: { title: 'Share this patch', dest: 'discussion', category: 'show-and-tell', prefTitle: 'Patch: ', patch: true,
    prompt: 'Tell people what’s interesting about it. Your current patch is attached so they can open it.' },
};

export function createComposer({ repo, isDark, getPatchJSON, openExternal, appName = 'DreamRack', appVersion, getBuild }) {
  let el, titleEl, promptEl, ta, mode = 'feedback';

  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest('button, input, textarea')) return;
    e.preventDefault(); e.stopPropagation();
    const r = el.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => { el.style.left = Math.round(ev.clientX - dx) + 'px'; el.style.top = Math.round(ev.clientY - dy) + 'px'; };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
  };

  const applyTheme = () => { if (el) el.classList.toggle('theme-dark', !!(isDark && isDark())); };

  function build() {
    el = document.createElement('div'); el.className = 'tour-card compose-card';
    const head = document.createElement('div'); head.className = 'tour-head';
    titleEl = document.createElement('div'); titleEl.className = 'tour-title';
    const x = document.createElement('button'); x.className = 'tour-x'; x.textContent = '×'; x.title = 'Close';
    x.addEventListener('click', hide);
    head.appendChild(titleEl); head.appendChild(x);
    head.addEventListener('pointerdown', startDrag);

    const body = document.createElement('div'); body.className = 'tour-body';
    promptEl = document.createElement('div'); promptEl.className = 'compose-prompt';
    ta = document.createElement('textarea'); ta.className = 'notes-edit compose-edit';
    body.appendChild(promptEl); body.appendChild(ta);

    const foot = document.createElement('div'); foot.className = 'tour-foot';
    const left = document.createElement('div'); left.className = 'tour-left';
    const send = document.createElement('button'); send.className = 'tour-btn'; send.textContent = 'Send';
    send.addEventListener('click', submit);
    const cancel = document.createElement('button'); cancel.className = 'tour-btn'; cancel.textContent = 'Cancel';
    cancel.addEventListener('click', hide);
    left.appendChild(send); left.appendChild(cancel);
    foot.appendChild(left);

    el.appendChild(head); el.appendChild(body); el.appendChild(foot);
    document.body.appendChild(el);
    applyTheme();
  }

  function centre() {
    const r = el.getBoundingClientRect();
    el.style.left = Math.round((window.innerWidth - r.width) / 2) + 'px';
    el.style.top = Math.round(Math.max(20, (window.innerHeight - r.height) / 3)) + 'px';
  }

  function open(m) {
    mode = m; const cfg = MODES[m];
    if (!el) build();
    el.style.display = 'flex';
    titleEl.textContent = cfg.title;
    promptEl.textContent = cfg.prompt;
    ta.value = '';
    ta.placeholder = m === 'bug' ? 'What happened, and the steps to make it happen…' : 'Your message…';
    centre();
    ta.focus();
  }
  function hide() { if (el) el.style.display = 'none'; }

  function composeUrl(cfg, text, patch) {
    const base = `https://github.com/${repo}`;
    let body = text || '';
    if (cfg === MODES.bug) {
      const b = typeof getBuild === 'function' ? getBuild() : null;
      const rev = b && b.short ? ` (${b.short}${b.dirty ? '-dirty' : ''})` : '';
      body += `\n\n---\nApp: ${appName}${appVersion ? ' ' + appVersion : ''}${rev}`;
    }
    // Embed the patch in a collapsed block, unless doing so would overflow the URL.
    if (cfg.patch && patch) {
      const withPatch = body + '\n\n<details><summary>Patch JSON</summary>\n\n```json\n' + patch + '\n```\n</details>\n';
      const probe = cfg.dest === 'issue'
        ? `${base}/issues/new?labels=${cfg.label}&title=${enc(cfg.prefTitle)}&body=${enc(withPatch)}`
        : `${base}/discussions/new?category=${cfg.category}&title=${enc(cfg.prefTitle)}&body=${enc(withPatch)}`;
      if (probe.length <= URL_LIMIT) body = withPatch;
      else body += '\n\n_(Patch too large to embed here — use File ▸ Save and drag the .drack file into this post.)_';
    }
    return cfg.dest === 'issue'
      ? `${base}/issues/new?labels=${cfg.label}&title=${enc(cfg.prefTitle)}&body=${enc(body)}`
      : `${base}/discussions/new?category=${cfg.category}&title=${enc(cfg.prefTitle)}&body=${enc(body)}`;
  }

  function submit() {
    const cfg = MODES[mode];
    const text = (ta.value || '').trim();
    if (!text && mode !== 'share') { ta.focus(); return; }   // feedback/bug want at least a line
    const patch = cfg.patch && getPatchJSON ? getPatchJSON() : null;
    const url = composeUrl(cfg, text, patch);
    if (openExternal) openExternal(url); else window.open(url, '_blank', 'noopener');
    hide();
  }

  return {
    feedback: () => open('feedback'),
    reportBug: () => open('bug'),
    sharePatch: () => open('share'),
    applyTheme,
  };
}
