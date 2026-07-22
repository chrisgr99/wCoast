// Generator for the Mixer / Output faceplate.
//
// The layout now lives as data in panel.layout.js; this just renders it to the
// light + dark SVGs through the shared table-driven renderer (panel/render.js).
// See design/panel-editor.md.
'use strict';
const fs = require('fs');
const { renderPanel } = require('../../panel/render.js');
const layout = require('./panel.layout.js');

fs.writeFileSync(__dirname + '/panel.svg', renderPanel(layout, false));
fs.writeFileSync(__dirname + '/panel.dark.svg', renderPanel(layout, true));
console.log('wrote panel.svg + panel.dark.svg');
