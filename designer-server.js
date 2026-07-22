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
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = 8784;
const MODULE_DIRS = new Set(['complex-oscillator-259t', 'lpg-292', 'function-gen-281t', 'mixer', 'gallery']);
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.css': 'text/css',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}

// POST /save { dir, overrides } -> merge overrides, regenerate the module's SVGs.
function handleSave(req, res) {
  let body = '';
  req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
  req.on('end', () => {
    let dir, overrides;
    try { ({ dir, overrides } = JSON.parse(body)); } catch (e) { return sendJson(res, 400, { error: 'bad json' }); }
    if (!MODULE_DIRS.has(dir)) return sendJson(res, 400, { error: `unknown module "${dir}"` });
    if (!overrides || typeof overrides !== 'object') return sendJson(res, 400, { error: 'no overrides' });

    const modDir = path.join(ROOT, 'modules', dir);
    const ovPath = path.join(modDir, 'panel.overrides.json');
    const keys = Object.keys(overrides);
    try {
      if (keys.length) fs.writeFileSync(ovPath, JSON.stringify(overrides, null, 2) + '\n');
      else if (fs.existsSync(ovPath)) fs.unlinkSync(ovPath);   // empty = back to the pristine layout
    } catch (e) { return sendJson(res, 500, { error: String(e) }); }

    execFile(process.execPath, [path.join(modDir, 'gen-panel.js')], { cwd: ROOT }, (err, _out, stderr) => {
      if (err) return sendJson(res, 500, { error: String(stderr || err) });
      sendJson(res, 200, { ok: true, overrides });
    });
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
