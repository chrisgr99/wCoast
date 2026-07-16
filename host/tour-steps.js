// tour-steps.js — the interactive tutorial's copy, in order.
//
// This file is ONLY words. The card that shows them is tour.js; adding, cutting, or reordering a
// step means editing this array and nothing else.
//
// Shape of a step:
//   title — a short heading (the card's drag handle sits next to it)
//   body  — a LIST of parts, rendered in order and scrolled together:
//             'prose…'        a paragraph. Our own copy, so <b> and <a href> are fine.
//             { try: '…' }    a "Do this" block — one thing to do right now.
//           A step can carry several try blocks; put each one beside the prose that sets it up
//           rather than saving them all for the end. Don't start a try with a dash: the label
//           already reads "Do this — …".
//           (A plain string body still works, for a step with nothing to do.)
//           { try: '…', label: '…' } overrides the label, if a step ever needs different wording.
//
// House style, per the plan in GETTING-STARTED.md: the reader already knows modular synthesis, so
// we don't teach the basics — we map their instincts onto this interface and flag the few things
// with no hardware equivalent. Get a sound out early; explain conventions once there's something
// to apply them to. The card body scrolls, so a step can breathe — but it caps at 70% of the
// window height, so keep each one to what's worth reading before acting.

'use strict';

const README_URL = 'https://github.com/chrisgr99/wCoast/blob/main/README.md';

export const TOUR_STEPS = [
  {
    title: 'Welcome to wCoast',
    body: [
      'A West-Coast modular you patch in the browser — a real instrument, not a preset player. '
        + 'Your modular instincts transfer; this short tutorial just maps them onto the few things '
        + 'here that have no hardware equivalent. It stays open while you work, so you can try each '
        + 'step as you read it.',
      { try: 'Drag this card by its title bar and park it somewhere out of your way. It will stay there.' },
      '<b>One thing first: please turn off any browser extension that recolours pages — Dark Reader '
        + 'and the like — for this site. wCoast has its own light and dark modes, and those extensions '
        + 'distort its panels.</b>',
      '<a href="' + README_URL + '">Read the README</a>',
    ],
  },
  {
    title: 'Panels and menus',
    body: [
      'A <b>panel</b> is the faceplate of a module — the background behind its knobs and jacks.',
      'Right-click asks whatever is under the pointer what it can do. Right-click a panel and you '
        + 'get the main menu: Engine, File, Edit, View and Help.',
      { try: 'Right-click a panel to open the main menu, then click any panel to dismiss it.' },
      'Right-click a <b>terminal</b> instead and you get what that signal can do — a scope, a monitor, '
        + 'or a look at what it feeds.',
      { try: 'Right-click a terminal and see how the menu differs. Dismiss it the same way.' },
      'If you\'d rather click than right-click, the hamburger in the top corner opens that same main menu.',
    ],
  },
];
