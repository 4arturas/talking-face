#!/usr/bin/env node
/* Vietinis balsų serveris (talking-face projektui).
 *
 * Vienu metu:
 *   - patiekia projekto HTML puslapius (kaip python -m http.server), kad būtų
 *     vienas adresas:  http://localhost:3000/talking-face-avatars.html
 *   - suteikia /api/tts balsus:
 *       GET /api/tts?text=...&engine=auto|piper|edge&voice=lt-LT-OnaNeural
 *     engine=auto (numatytasis): pirma bandoma Piper (offline, patikimas),
 *     jei nepavyksta – Microsoft Edge balsai per edge-tts (internete).
 *
 * Atsakymas: WAV (piper) arba MP3 (edge-tts). CORS leidžiamas, kad veiktų
 * ir iš python -m http.server (port 8000).
 *
 * Paleidimas:
 *   node tools/tts-server/server.mjs                         (numatyta: port 3000)
 *   PORT=8080 node tools/tts-server/server.mjs
 *
 * Priklausomybės (pip --user): piper-tts, edge-tts, o Piper modelis:
 *   ~/opt/talking-face/piper/lt_LT-reginute1-medium.onnx
 */

import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const PORT = Number(process.env.PORT || 3000);
const home = os.homedir();

const PIPER_BIN = process.env.PIPER_BIN || 'piper';
const PIPER_MODEL = process.env.PIPER_MODEL
  || path.join(home, 'opt/talking-face/piper/lt_LT-reginute1-medium.onnx');
const PY_BIN = process.env.PYTHON_BIN || 'python3';

const EDGE_VOICES = {
  'lt-LT-OnaNeural': 'Ona (Microsoft Edge, online)',
  'lt-LT-LeonasNeural': 'Leonas (Microsoft Edge, online)',
};
const PIPER_LABEL = 'Aistė-Reginautė (Piper, offline)';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function run(cmd, args, input = '') {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [];
    let err = '';
    p.stdout.on('data', d => chunks.push(d));
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0 && chunks.length) return resolve(Buffer.concat(chunks));
      reject(new Error(err.trim().split('\n').pop() || `${cmd} exit ${code}`));
    });
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

function synthPiper(text) {
  const input = /[.!?…]$/.test(text.trim()) ? text : `${text.trim()}.`;
  return run(PIPER_BIN, ['-m', PIPER_MODEL, '-f', '-'], input);
}

function synthEdge(text, voice) {
  return run(PY_BIN, ['-m', 'edge_tts', '--voice', voice, '--text', text, '--write-media', '-']);
}

// Sintetiname paeiliui – Piper/edge yra CPU vartojantys procesai.
let ttsChain = Promise.resolve();
function enqueue(fn) {
  const next = ttsChain.then(fn, fn);
  ttsChain = next.then(() => {}, () => {});
  return next;
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

function handleTts(req, res, url) {
  const text = (url.searchParams.get('text') || '').trim();
  if (!text) return sendJson(res, 400, { error: 'Trūksta ?text=' });
  const engine = (url.searchParams.get('engine') || 'auto').toLowerCase();
  const voice = EDGE_VOICES[url.searchParams.get('voice')] ? url.searchParams.get('voice') : 'lt-LT-OnaNeural';
  const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

  const job = enqueue(async () => {
    try {
      let buf, type;
      if (engine === 'piper') {
        buf = await synthPiper(text); type = 'audio/wav';
      } else if (engine === 'edge') {
        buf = await synthEdge(text, voice); type = 'audio/mpeg';
      } else {  // auto
        try {
          buf = await synthPiper(text); type = 'audio/wav';
        } catch (piperErr) {
          buf = await synthEdge(text, voice); type = 'audio/mpeg';
        }
      }
      res.writeHead(200, { 'Content-Type': type, ...cors });
      res.end(buf);
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (!res.headersSent) { res.writeHead(503, cors); res.end(`Nepavyko: ${msg}`); }
      else res.end();
    }
  });
  job.then(null, e => {
    if (!res.headersSent) { res.writeHead(500, cors); res.end(e.message); }
    else res.end();
  });
}

function handleVoices(req, res) {
  sendJson(res, 200, {
    piper: [{ id: 'piper', label: PIPER_LABEL }],
    edge: Object.entries(EDGE_VOICES).map(([id, label]) => ({ id, label })),
  });
}

async function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') {
    res.writeHead(301, { Location: '/talking-face-avatars.html' });
    res.end();
    return;
  }
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }
  try {
    const s = await stat(file);
    if (!s.isFile()) throw new Error('ne failas');
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/tts') return handleTts(req, res, url);
  if (url.pathname === '/api/voices') return handleVoices(req, res);
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Nėra tokio API' });
  serveStatic(req, res, url);
});

server.listen(PORT, () => {
  console.log(`Talking-face serveris veikia: http://localhost:${PORT}/talking-face-avatars.html`);
});