// designer-server.js — dev host for the visual panel editor (designer.html).
//
// Serves the repo statically with no-store caching (so edited modules always reload
// fresh) and accepts POST /save from the designer: it writes a module's
// panel.overrides.json and regenerates that module's panel.svg + panel.dark.svg by
// running its gen-panel.js. Dev-only; never shipped. See design/panel-editor.md.
//
//   node designer-server.js    ->    http://localhost:8784/designer.html

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import saveMod from './designer-save.js';   // shared with the in-app IPC save

const { savePanel } = saveMod;
const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8784;
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

// POST /save — delegate to the shared save module (same logic the in-app IPC uses).
function handleSave(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 4e6) req.destroy(); });
  req.on('end', async () => {
    let msg;
    try { msg = JSON.parse(body); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
    const result = await savePanel(ROOT, msg);
    sendJson(res, result.error ? 400 : 200, result);
  });
}

function handleStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/designer.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}

http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/save') return handleSave(req, res);
  if (req.method === 'GET') return handleStatic(req, res);
  res.writeHead(405); res.end('method not allowed');
}).listen(PORT, () => console.log(`panel designer on http://localhost:${PORT}/designer.html`));
