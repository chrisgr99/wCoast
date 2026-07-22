// Generator — renders panel.layout.js to the light + dark SVGs via the shared
// table-driven renderer (panel/render.js). See design/panel-editor.md.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderPanel } from '../../panel/render.js';
import layout from './panel.layout.js';

const dir = fileURLToPath(new URL('.', import.meta.url));
fs.writeFileSync(dir + 'panel.svg', renderPanel(layout, false));
fs.writeFileSync(dir + 'panel.dark.svg', renderPanel(layout, true));
console.log('wrote panel.svg + panel.dark.svg');
