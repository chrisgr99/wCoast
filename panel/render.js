// render.js — the shared, table-driven faceplate renderer.
//
// Turns a module's LAYOUT (a plain, theme-independent list of typed items) into a
// panel SVG string, painting it from the light or dark theme table. This is the
// half of gen-panel that stays: modules provide the layout data; this renders it.
// The primitives fix the house look; the theme table fixes the colours; the layout
// fixes where each control sits and what it binds to. See design/panel-editor.md.
//
//   renderPanel(layout, dark) -> svg string
//
// A layout is { faceW, faceH, faceLeft, faceTop, wrap, items }. `wrap` (mixer-style)
// wraps the body in a translate to the cropped face and draws the face + frame; a
// module that lays out in absolute face coordinates (259t-style) sets wrap:false and
// supplies its own frame as items. Each item is a typed record; the renderer injects
// the theme the primitive needs, so the layout itself carries no colours.

'use strict';

import { THEME } from './theme.js';
import { defs, jack, knob, slider, button, vuMeter, label, radioGroup, bipolarMark, attachedLabel, ledLamp, stepButton } from './primitives.js';

// A control's opts carry no colour in the layout; inject the theme the primitive
// needs — `theme` for the ones that take it, and the ink into an attached `label`
// object (a string label, e.g. a VU's, is left alone).
function themed(opts, th, addTheme) {
  let o = opts || {};
  if (o.label && typeof o.label === 'object' && o.label.fill === undefined) o = { ...o, label: { ...o.label, fill: th.ink } };
  if (addTheme) o = { ...o, theme: th };
  return o;
}

function renderItem(it, th, dark) {
  switch (it.t) {
    case 'label':        return label(it.x, it.y, it.text, { fill: th.ink, ...(it.opts || {}) });
    case 'jack':         return jack(it.id, it.x, it.y, themed(it.opts, th, false));
    case 'knob':         return knob(it.id, it.x, it.y, themed(it.opts, th, true));
    case 'slider':       return slider(it.id, it.x, themed(it.opts, th, true));
    case 'button':       return button(it.id, it.x, it.y, themed(it.opts, th, false));
    case 'vu':           return vuMeter(it.role, it.x, it.y, themed(it.opts, th, true));
    case 'radio':        return radioGroup(it.id, it.x, it.y, themed(it.opts, th, true));
    case 'stepButton':   return stepButton(it.id, it.x, it.y, themed(it.opts, th, true));
    case 'bipolarMark':  return bipolarMark(it.x, it.y, it.r, { color: th.ink, ...(it.opts || {}) });
    case 'attachedLabel':return attachedLabel(it.x, it.y, it.hw, it.hh, { fill: th.ink, ...(it.opts || {}) });
    case 'line':         return `  <line x1="${it.x1}" y1="${it.y1}" x2="${it.x2}" y2="${it.y2}" stroke="${th.frame}" stroke-width="${it.w}"/>`;
    // A themed rect (face background / frame border). fill/stroke of 'face'/'frame' resolve from the
    // theme; rx and stroke are optional so both scaffold styles (with/without rounded face) round-trip.
    case 'rect': {
      const rxA = it.rx != null ? ` rx="${it.rx}"` : '';
      const fill = it.fill === 'face' ? th.face : it.fill;
      const strokeA = it.stroke ? ` stroke="${it.stroke === 'frame' ? th.frame : it.stroke}" stroke-width="${it.sw}"` : '';
      const dashA = it.dash ? ` stroke-dasharray="${it.dash}"` : '';
      return `  <rect x="${it.x}" y="${it.y}" width="${it.w}" height="${it.h}"${rxA} fill="${fill}"${strokeA}${dashA}/>`;
    }
    // A hand-built lamp group (e.g. a stepped param drawn as flanked lamps): a wrapping
    // <g data-wcoast-param="…"> around child labels (ink-themed) and ledLamps.
    case 'lampGroup': {
      let s = `  <g data-wcoast-param="${it.param}">`;
      for (const c of it.children) {
        const child = c.kind === 'label'
          ? label(c.x, c.y, c.text, { size: c.size, fill: th.ink })
          : ledLamp(c.x, c.y, { r: c.r, role: c.role, step: c.step });
        s += `\n    ${child}`;
      }
      return s + `\n  </g>`;
    }
    // A plain indicator LED (not a bound control). `ledRed` resolves per theme; any other value is a literal colour.
    case 'indLed': {
      const c = it.color === 'ledRed' ? (dark ? '#d33' : '#c00') : it.color;
      return `  <circle cx="${it.x}" cy="${it.y}" r="1.15" fill="${c}" stroke="#00000055" stroke-width="0.2" filter="url(#softShadow)"/>`;
    }
    case 'raw':          return it.svg;
    default: throw new Error(`render: unknown item type "${it.t}"`);
  }
}

function renderPanel(layout, dark) {
  const th = THEME[dark ? 'dark' : 'light'];
  const { faceW, faceH, faceLeft, faceTop, wrap, items } = layout;
  const p = [];
  p.push(`<?xml version="1.0" encoding="utf-8"?>`);
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${faceW}mm" height="128.5mm" viewBox="0 0 ${faceW} 128.5" font-family="Arial Narrow, Helvetica, Arial, sans-serif">`);
  p.push(defs(th));
  const wi = layout.wrapIndent != null ? layout.wrapIndent : '  ';
  if (wrap) p.push(`${wi}<g transform="translate(${faceLeft} ${faceTop})">`);
  for (const it of items) p.push(renderItem(it, th, dark));
  if (wrap) p.push(`${wi}</g>`);
  p.push(`</svg>`);
  return p.join('\n') + '\n';
}

export { renderPanel, renderItem };
