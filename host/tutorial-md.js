// tutorial-md.js — reads tutorial.md and turns it into the tour's step data.
//
// One file serves two masters: tutorial.md is a readable document on its own (on GitHub, in any
// editor) AND the exact copy the app shows in its cards. There is no build step — the app fetches
// the .md and parses it here, which works in Electron (the app:// protocol is registered with
// supportFetchAPI + corsEnabled and serves any file under the app directory) and unchanged over
// http for browser users.
//
// THE FORMAT — a deliberately small subset, so the file stays a document rather than a config:
//
//   # Title            the document's own title. Not a card; ignored here.
//   ## Heading         starts a CARD. The heading text becomes the card's title.
//   paragraph          a paragraph of the current card. Write it on ONE line — the card wraps it.
//   - item             consecutive items become one bulleted list.
//   > **Do this** — …  a "Do this" block. The bold text is its label, so a card can say something
//                      else ("> **Now play** — …") and the document still reads right.
//   <!-- … -->         ignored, including across lines.
//
// Inline: **bold**, *italic*, [text](url), `code`. Anything before the first ## is preamble for a
// human reader and is skipped.
//
// The markdown is OURS, not user input, but it's escaped before the inline rules run anyway — so
// a stray angle bracket in the copy shows up as text instead of silently becoming markup.

'use strict';

export const TUTORIAL_URL = new URL('./tutorial.md', import.meta.url);

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline markdown → the small HTML the card renders. Order matters: links before emphasis, so a
// URL containing an underscore or asterisk isn't mangled.
const inline = (s) => escapeHtml(s)
  .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  .replace(/`([^`]+)`/g, '<code>$1</code>');

// `> **Do this** — text` → { try: text, label: 'Do this' }. The dash after the label is optional
// and may be an em dash or a hyphen; without a label the block still works and takes the default.
const LABELLED = /^\*\*(.+?)\*\*\s*(?:—|–|--|-)?\s*([\s\S]*)$/;

export function parseTutorial(md) {
  const steps = [];
  let step = null;          // the card being filled
  let para = [];            // lines of the paragraph being gathered
  let list = [];            // consecutive `- ` items
  let quote = [];           // consecutive `> ` lines

  const flushPara = () => {
    if (!para.length) return;
    if (step) step.body.push(inline(para.join(' ')));
    para = [];
  };
  const flushList = () => {
    if (!list.length) return;
    if (step) step.body.push('<ul>' + list.map((i) => '<li>' + inline(i) + '</li>').join('') + '</ul>');
    list = [];
  };
  const flushQuote = () => {
    if (!quote.length) return;
    const text = quote.join(' ').trim();
    const m = LABELLED.exec(text);
    if (step) step.body.push(m ? { try: inline(m[2]), label: m[1] } : { try: inline(text) });
    quote = [];
  };
  const flushAll = () => { flushPara(); flushList(); flushQuote(); };

  // Strip comments first so a `##` or `>` inside one can't be read as content.
  const lines = md.replace(/<!--[\s\S]*?-->/g, '').split('\n');

  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') { flushAll(); continue; }
    if (line.startsWith('## ')) {
      flushAll();
      step = { title: line.slice(3).trim(), body: [] };
      steps.push(step);
      continue;
    }
    if (line.startsWith('# ')) { flushAll(); continue; }         // document title
    if (line.startsWith('>')) { flushPara(); flushList(); quote.push(line.replace(/^>\s?/, '')); continue; }
    if (/^[-*+]\s/.test(line)) { flushPara(); flushQuote(); list.push(line.replace(/^[-*+]\s+/, '')); continue; }
    flushList(); flushQuote();
    para.push(line);
  }
  flushAll();
  return steps.filter((s) => s.body.length);
}

export async function loadTutorial(url = TUTORIAL_URL) {
  const res = await fetch(url);
  if (!res.ok) throw new Error('tutorial.md ' + res.status);
  return parseTutorial(await res.text());
}
