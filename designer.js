// designer.js — Panel editor, Phase 2: a live, read-only panel view.
//
// Renders a module's layout (panel.layout.js data) through the shared renderer in
// the BROWSER, then decorates it with the real panel loader (jack colours, identity
// band, vertical title) so the preview matches the shipped panel exactly. A module
// picker and a light/dark toggle drive a re-render. Read-only for now; selecting,
// dragging, and editing arrive in the later phases. See design/panel-editor.md.

import { renderPanel } from './panel/render.js';
import { loadPanel } from './host/panel-loader.js';

import oscLayout from './modules/complex-oscillator-259t/panel.layout.js';
import oscDesc from './modules/complex-oscillator-259t/descriptor.js';
import lpgLayout from './modules/lpg-292/panel.layout.js';
import lpgDesc from './modules/lpg-292/descriptor.js';
import fnLayout from './modules/function-gen-281t/panel.layout.js';
import fnDesc from './modules/function-gen-281t/descriptor.js';
import mixerLayout from './modules/mixer/panel.layout.js';
import mixerDesc from './modules/mixer/descriptor.js';
import galleryLayout from './modules/gallery/panel.layout.js';
import galleryDesc from './modules/gallery/descriptor.js';

const MODULES = [
  { name: 'Complex Oscillator', layout: oscLayout, desc: oscDesc },
  { name: 'Quad Low Pass Gate', layout: lpgLayout, desc: lpgDesc },
  { name: 'Quad Function Generator', layout: fnLayout, desc: fnDesc },
  { name: 'Mixer / Output', layout: mixerLayout, desc: mixerDesc },
  { name: 'Control Gallery', layout: galleryLayout, desc: galleryDesc },
];

const stage = document.getElementById('stage');
const picker = document.getElementById('picker');
const darkBtn = document.getElementById('darkBtn');
const status = document.getElementById('status');
let dark = true;

MODULES.forEach((m, i) => {
  const o = document.createElement('option');
  o.value = String(i); o.textContent = m.name; picker.appendChild(o);
});

async function render() {
  const m = MODULES[Number(picker.value)];
  try {
    const svgText = renderPanel(m.layout, dark);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    const { svg } = await loadPanel(url, m.desc, { dark });   // real loader: crop, colour jacks, identity band, title
    const vb = (svg.getAttribute('viewBox') || '0 0 1 1').trim().split(/\s+/).map(Number);
    const H = 560;
    svg.style.height = `${H}px`;
    svg.style.width = `${(H * vb[2]) / vb[3]}px`;
    svg.style.boxShadow = '0 8px 30px rgba(0,0,0,0.45)';
    stage.replaceChildren(svg);
    status.textContent = `${m.name} — ${m.layout.items.length} items, rendered live from panel.layout.js`;
    document.body.dataset.dark = String(dark);
  } catch (e) {
    stage.replaceChildren();
    status.textContent = `Error rendering ${m.name}: ${e.message}`;
    console.error(e);
  }
}

picker.addEventListener('change', render);
darkBtn.addEventListener('click', () => { dark = !dark; darkBtn.textContent = dark ? 'Dark' : 'Light'; render(); });
render();
