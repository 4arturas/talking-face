#!/usr/bin/env node
/* Vietinis balsų serveris (talking-face projektui).
 *
 * Vienu metu:
 *   - patiekia projekto HTML puslapius (kaip python -m http.server), kad būtų
 *     vienas adresas:  http://localhost:3000/  (index.html: visi puslapiai tabuose)
 *   - suteikia /api/tts balsus:
 *       GET /api/tts?text=...&engine=auto|piper|edge&voice=lt-LT-OnaNeural
 *     engine=auto (numatytasis): pirma bandoma Piper (offline, patikimas),
 *     jei nepavyksta – Microsoft Edge balsai per npm paketą msedge-tts (internete).
 *
 *   - GET /api/say/events (SSE): kai pasikeičia say.txt (projekto šaknyje),
 *     tekstas nusiunčiamas puslapiams, ir avataras jį ištaria.
 *
 * Atsakymas: WAV (piper) arba MP3 (Edge). CORS leidžiamas, kad veiktų
 * ir iš python -m http.server (port 8000).
 *
 * Paleidimas:
 *   npm install                     (vieną kartą, projekto šaknyje)
 *   npm start                       (= node server.mjs, numatyta: port 3000)
 *   PORT=8080 node server.mjs
 *
 * Priklausomybės: npm msedge-tts (Edge balsai), npm sherpa-onnx-node (Piper be Python).
 * Piper modelis: ~/opt/talking-face/piper/lt_LT-reginute1-medium.onnx (+ .onnx.json),
 * šalia – espeak-ng-data/ ir `node tools/piper-to-sherpa.mjs` sukurti failai.
 * Jei jų nėra, naudojamas pip --user piper-tts (arba PIPER_BIN) – veikia, bet lėčiau.
 */

import http from 'node:http';
import { createReadStream, existsSync, readFileSync, writeFileSync, watchFile } from 'node:fs';
import { createRequire } from 'node:module';
import { stat, readFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);
const home = os.homedir();

const IS_WIN = process.platform === 'win32';
const PIPER_MODEL = process.env.PIPER_MODEL
  || path.join(home, 'opt/talking-face/piper/lt_LT-reginute1-medium.onnx');
const PY_BIN = process.env.PYTHON_BIN || (IS_WIN ? 'python' : 'python3');
// Windows: pip --user Scripts katalogas dažnai ne PATH'e, todėl `python -m piper`.
const PIPER_CMD = process.env.PIPER_BIN
  ? [process.env.PIPER_BIN]
  : (IS_WIN ? [PY_BIN, '-m', 'piper'] : ['piper']);

const EDGE_VOICES = {
  'lt-LT-OnaNeural': 'Ona (Microsoft Edge, online)',
  'lt-LT-LeonasNeural': 'Leonas (Microsoft Edge, online)',
  'en-US-AriaNeural': 'Aria (Microsoft Edge, online)',
  'en-US-JennyNeural': 'Jenny (Microsoft Edge, online)',
  'en-US-GuyNeural': 'Guy (Microsoft Edge, online)',
};
const PIPER_LABEL = 'Aistė-Reginautė (Piper, offline)';
const voiceLang = id => id.split('-').slice(0, 2).join('-');

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

function run(cmd, args, input = '', outFile = null) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    const chunks = [];
    let err = '';
    p.stdout.on('data', d => chunks.push(d));
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', async code => {
      if (code === 0 && outFile) {
        try { return resolve(await readFile(outFile)); }
        catch (e) { return reject(e); }
        finally { unlink(outFile).catch(() => {}); }
      }
      if (code === 0 && chunks.length) return resolve(Buffer.concat(chunks));
      if (outFile) unlink(outFile).catch(() => {});
      reject(new Error(err.trim().split('\n').pop() || `${cmd} exit ${code}`));
    });
    if (input) p.stdin.end(input);
    else p.stdin.end();
  });
}

// Piper per sherpa-onnx-node: modelis įkeliamas vieną kartą, atsakymas ~0.2 s (be Python).
// Reikia failų, kuriuos sukuria `node tools/piper-to-sherpa.mjs`, ir espeak-ng-data katalogo.
const PIPER_BASE = PIPER_MODEL.replace(/\.onnx$/, '');
const ESPEAK_DATA = process.env.ESPEAK_DATA || path.join(path.dirname(PIPER_MODEL), 'espeak-ng-data');
let sherpaTts = null;
function loadSherpa() {
  const model = `${PIPER_BASE}.sherpa.onnx`, tokens = `${PIPER_BASE}.tokens.txt`;
  if (!existsSync(model) || !existsSync(tokens) || !existsSync(ESPEAK_DATA)) {
    console.log('Piper: sherpa failų nėra – naudosiu Python piper (lėčiau). Žr. AGENTS.md.');
    return;
  }
  try {
    const { OfflineTts } = createRequire(import.meta.url)('sherpa-onnx-node');
    const inf = JSON.parse(readFileSync(`${PIPER_MODEL}.json`, 'utf8')).inference || {};
    sherpaTts = new OfflineTts({
      model: {
        vits: {
          model, tokens, dataDir: ESPEAK_DATA,
          noiseScale: inf.noise_scale ?? 0.667, noiseScaleW: inf.noise_w ?? 0.8, lengthScale: inf.length_scale ?? 1,
        },
        numThreads: 2, provider: 'cpu',
      },
      maxNumSentences: 1,
    });
    console.log('Piper: sherpa-onnx (Node, be Python).');
  } catch (e) {
    console.log(`Piper: sherpa-onnx neįsikėlė (${e.message}) – naudosiu Python piper.`);
  }
}

// Float32 -> 16-bit WAV; garsumą sulyginame (Python piper irgi normalizuoja).
function toWav(samples, sampleRate) {
  let peak = 0;
  for (const x of samples) peak = Math.max(peak, Math.abs(x));
  const gain = peak > 0 ? Math.min(0.95 / peak, 4) : 1;
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + samples.length * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 2, 28); buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i] * gain)) * 32767), 44 + i * 2);
  }
  return buf;
}

// Tyla garso pradžioje: Bluetooth ausinės/adapteriai (pvz. Poly BT700) pabunda
// tik gavę garsą ir nukerpa pirmus ~100–300 ms. Puslapiai lūpas paslenka tiek pat (leadMs).
const TTS_LEAD_MS = Math.max(0, Number(process.env.TTS_LEAD_MS ?? 300));
const EDGE_OWN_LEAD_MS = 150;  // Edge MP3 jau turi ~150 ms tylos pradžioje (išmatuota)

// 16-bit PCM WAV: kalba (pirmas garsesnis mėginys) turi prasidėti tiksliai po TTS_LEAD_MS.
function padWav(buf) {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') return buf;
  let pos = 12, rate = 22050, ch = 1;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('ascii', pos, pos + 4), size = buf.readUInt32LE(pos + 4);
    if (id === 'fmt ') { ch = buf.readUInt16LE(pos + 10); rate = buf.readUInt32LE(pos + 12); }
    if (id === 'data') {
      const start = pos + 8, end = Math.min(buf.length, start + size);
      let first = start;
      while (first + 1 < end && Math.abs(buf.readInt16LE(first)) < 500) first += 2;
      const have = Math.floor((first - start) / (2 * ch));
      const add = Math.max(0, Math.round(rate * TTS_LEAD_MS / 1000) - have) * 2 * ch;
      if (!add) return buf;
      const out = Buffer.concat([buf.subarray(0, start), Buffer.alloc(add), buf.subarray(start)]);
      out.writeUInt32LE(out.length - 8, 4);
      out.writeUInt32LE(size + add, pos + 4);
      return out;
    }
    pos += 8 + size + (size & 1);
  }
  return buf;
}

// MP3: pirmą (tylų) kadrą pakartojame tiek kartų, kad tyla būtų ≈ TTS_LEAD_MS.
function padMp3(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || (buf[1] & 0xe0) !== 0xe0) return buf;  // ne kadras (pvz. ID3)
  const ver = (buf[1] >> 3) & 3, layer = (buf[1] >> 1) & 3;
  if (layer !== 1) return buf;  // tik Layer III
  const rates = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] }[ver];
  const kbps = (ver === 3
    ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320]
    : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[buf[2] >> 4];
  const rate = rates && rates[(buf[2] >> 2) & 3];
  if (!rate || !kbps) return buf;
  const perFrame = ver === 3 ? 1152 : 576;
  const len = Math.floor(perFrame / 8 * kbps * 1000 / rate) + ((buf[2] >> 1) & 1);
  const frame = buf.subarray(0, len);
  if (frame.includes('Xing') || frame.includes('Info')) return buf;
  const n = Math.round((TTS_LEAD_MS - EDGE_OWN_LEAD_MS) / (perFrame * 1000 / rate));
  return n > 0 ? Buffer.concat([...Array(n).fill(frame), buf]) : buf;
}

let tmpSeq = 0;
async function synthPiper(text) {
  const trimmed = text.trim();
  // Tarpas pradžioje – kitaip Piper gali „nukąsti" pirmą garsą.
  const input = ` ${/[.!?…]$/.test(trimmed) ? trimmed : `${trimmed}.`}`;
  if (sherpaTts) {
    const a = await sherpaTts.generateAsync({ text: input, sid: 0, speed: 1 });
    return toWav(a.samples, a.sampleRate);
  }
  // Windows: Piper `-f -` meta PermissionError (temp failas atidaromas du kartus),
  // todėl rašome į savo laikiną failą ir jį perskaitome.
  const out = IS_WIN ? path.join(os.tmpdir(), `tts-${process.pid}-${++tmpSeq}.wav`) : '-';
  return run(PIPER_CMD[0], [...PIPER_CMD.slice(1), '-m', PIPER_MODEL, '-f', out], input,
    IS_WIN ? out : null);
}

const escapeXml = s => s.replace(/[<>&"']/g, c =>
  ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c]);

async function synthEdge(text, voice) {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    // Tarpas pradžioje, kaip ir Piper – kad nenukąstų pirmo skiemens.
    const { audioStream } = tts.toStream(escapeXml(` ${text.trim()}`));
    const chunks = [];
    await new Promise((resolve, reject) => {
      audioStream.on('data', d => chunks.push(d));
      audioStream.on('error', reject);
      audioStream.on('close', resolve);
    });
    if (!chunks.length) throw new Error('Edge balsas negrąžino garso');
    return Buffer.concat(chunks);
  } finally {
    tts.close();
  }
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
      buf = type === 'audio/wav' ? padWav(buf) : padMp3(buf);
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
    leadMs: TTS_LEAD_MS,
    piper: [{ id: 'piper', label: PIPER_LABEL, lang: 'lt-LT' }],
    edge: Object.entries(EDGE_VOICES).map(([id, label]) => ({ id, label, lang: voiceLang(id) })),
  });
}

async function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') {
    res.writeHead(301, { Location: '/index.html' });
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

// say.txt: kai failas pasikeičia, jo tekstas per SSE (/api/say/events)
// nusiunčiamas atidarytiems puslapiams, ir avataras jį ištaria.
const SAY_FILE = process.env.SAY_FILE || path.join(ROOT, 'say.txt');
// Tekstą gauna tik vienas klientas: tas, kuris paskutinis pranešė, kad yra
// aktyvus (/api/say/active?id=...). Taip netaria keli tabai ar naršyklės.
const sayClients = new Map(); // res -> puslapio id
let activeSayId = '';
let sayTimer = null;

if (!existsSync(SAY_FILE)) writeFileSync(SAY_FILE, '');

function broadcastSay(text) {
  const data = `event: say\ndata: ${JSON.stringify({ text })}\n\n`;
  const all = [...sayClients];
  // aktyvus klientas, o jei jo nėra, paskutinis prisijungęs
  const target = all.find(([, id]) => id && id === activeSayId) || all[all.length - 1];
  if (target) target[0].write(data);
  console.log(`say.txt -> ${target ? target[1] || '?' : 'niekam'} (iš ${all.length}): ${text.slice(0, 60)}`);
}

// watchFile (ne fs.watch): veikia ir kai redaktorius failą pakeičia nauju.
watchFile(SAY_FILE, { interval: 300 }, (curr, prev) => {
  if (curr.mtimeMs === prev.mtimeMs) return;
  clearTimeout(sayTimer);
  sayTimer = setTimeout(async () => {
    try {
      const text = (await readFile(SAY_FILE, 'utf8')).replace(/^\uFEFF/, '').trim();
      if (text) broadcastSay(text);
    } catch (e) {
      console.error(`say.txt klaida: ${e.message}`);
    }
  }, 200);
});

function handleSayActive(req, res, url) {
  activeSayId = url.searchParams.get('id') || '';
  res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
  res.end();
}

function handleSayEvents(req, res, url) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  });
  res.write('retry: 3000\n\n');
  sayClients.set(res, url.searchParams.get('id') || '');
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); sayClients.delete(res); });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/api/tts') return handleTts(req, res, url);
  if (url.pathname === '/api/voices') return handleVoices(req, res);
  if (url.pathname === '/api/say/events') return handleSayEvents(req, res, url);
  if (url.pathname === '/api/say/active') return handleSayActive(req, res, url);
  if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Nėra tokio API' });
  serveStatic(req, res, url);
});

loadSherpa();

server.listen(PORT, () => {
  console.log(`Talking-face serveris veikia: http://localhost:${PORT}/  (index.html su tabais)`);
});