#!/usr/bin/env node
/* Paruošia Piper modelį sherpa-onnx (Node) naudojimui – be Python.
 *
 *   node tools/piper-to-sherpa.mjs [kelias/iki/modelio.onnx]
 *
 * Iš <modelis>.onnx.json sukuria:
 *   <modelis>.tokens.txt   – fonemų sąrašas ("simbolis id" eilutėmis),
 *   <modelis>.sherpa.onnx  – modelio kopija su metaduomenimis, kurių reikia sherpa-onnx
 *                            (model_type=vits, comment=piper, voice, sample_rate ...).
 * Originalus .onnx nekeičiamas. Metaduomenys pridedami ONNX ModelProto lauku 14
 * (metadata_props) failo gale – protobuf leidžia laukus rašyti bet kuria tvarka.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const model = process.argv[2]
  || process.env.PIPER_MODEL
  || path.join(os.homedir(), 'opt/talking-face/piper/lt_LT-reginute1-medium.onnx');
const cfg = JSON.parse(readFileSync(`${model}.json`, 'utf8'));
const base = model.replace(/\.onnx$/, '');

// sherpa-onnx priima tik vieno simbolio fonemas; kelių simbolių (pvz. "aɪ") praleidžiame –
// kiekvienas jų simbolis turi ir savo atskirą id.
const tokens = Object.entries(cfg.phoneme_id_map)
  .filter(([s]) => [...s].length === 1)
  .map(([s, ids]) => `${s} ${ids[0]}`);
// espeak-ng kartais paprastą „s“ rašo kaip ʂ (klausimas -> klauʂɪmas). Lietuviško modelio
// mokymo duomenyse ʂ nėra, todėl jis tarė nesąmonę („klaujimas“). Piper lietuviškas
// fonemizatorius ʂ keičia į s – sherpa-onnx tą patį daro per tokens.txt.
const aliases = { 'ʂ': 's' };
for (const [from, to] of Object.entries(aliases)) {
  const ids = cfg.phoneme_id_map[to];
  const i = tokens.findIndex(t => t.startsWith(`${from} `));
  if (!ids) continue;
  if (i >= 0) tokens[i] = `${from} ${ids[0]}`; else tokens.push(`${from} ${ids[0]}`);
}
const tokensText = tokens.join('\n') + '\n';
writeFileSync(`${base}.tokens.txt`, tokensText, 'utf8');

const meta = {
  model_type: 'vits',
  comment: 'piper',
  language: cfg.language?.name_english || cfg.espeak.voice,
  voice: cfg.espeak.voice,
  has_espeak: 1,
  n_speakers: cfg.num_speakers || 1,
  sample_rate: cfg.audio.sample_rate,
};

const varint = n => { const b = []; while (n > 0x7f) { b.push((n & 0x7f) | 0x80); n >>>= 7; } b.push(n); return Buffer.from(b); };
const field = (tag, buf) => Buffer.concat([Buffer.from([tag]), varint(buf.length), buf]);
const entries = Object.entries(meta).map(([k, v]) =>
  field(0x72, Buffer.concat([field(0x0a, Buffer.from(k, 'utf8')), field(0x12, Buffer.from(String(v), 'utf8'))])));

writeFileSync(`${base}.sherpa.onnx`, Buffer.concat([readFileSync(model), ...entries]));
console.log(`Sukurta:\n  ${base}.tokens.txt\n  ${base}.sherpa.onnx`);
