// overrides.js — control-position overrides layered on a panel layout.
//
// The visual panel editor (the designer) saves control moves as a small, explicit
// data file — modules/<id>/panel.overrides.json — mapping a control id to its new
// { x, y }. This keeps the hand-authored panel.layout.js untouched: only the moved
// controls are recorded, and both the generator and the live designer apply them the
// same way before rendering, so a saved nudge shows up identically on disk and on
// screen. Controls that weren't moved aren't listed, so they render byte-identically.
// See design/panel-editor.md (Phase 3).

'use strict';

// Mutate a layout's items in place: for each item whose id appears in `overrides`,
// set its x/y to the override. Returns the same layout for chaining. Items without
// an id (labels, dividers, marks) aren't addressable and are left alone.
export function applyOverrides(layout, overrides) {
  if (!overrides) return layout;
  for (const it of layout.items) {
    const o = it.id && overrides[it.id];
    if (!o) continue;
    if (typeof o.x === 'number') it.x = o.x;
    if (typeof o.y === 'number') it.y = o.y;
  }
  return layout;
}
