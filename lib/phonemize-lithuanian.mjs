// SPDX-License-Identifier: GPL-3.0-or-later
//
// Lithuanian phonemizer for the Piper voice lt_LT-reginute1-medium, without Python.
// A JavaScript port of piper1-gpl `src/piper/phonemize_lithuanian.py` (GPL-3.0):
// espeak-ng IPA per word (WebAssembly build @echogarden/espeak-ng-emscripten, GPL-3.0)
// plus the stress dictionary, letter names and vocatives from piper1-gpl
// `src/piper/lithuanian/*.tsv` (CC BY 4.0). Keep the logic in step with the Python file.
// This file is GPL-3.0, unlike the rest of the repo (MIT); see LICENSE.

import { readFileSync } from 'node:fs';
import path from 'node:path';

const ACUTE = 'ˈ', STRESS_MARKS = 'ˈˌˋ';
const IPA_VOWELS = 'aeiouɑɐɔɛɪʊæøɘəɜ', LENGTH = 'ː', CONSONANT_MODIFIERS = 'ʲʷʰ̩';
const WORD_CLEAN = /[^a-zA-ZąčęėįšųūžĄČĘĖĮŠŲŪŽ0-9]/g;
const KEEP_PUNCT = '.,!?:;';
const SENTENCE_SPLIT = /(?<=[.!?…])\s+/;
const CACHE_LIMIT = 250000;
const STRIP = { ą: 'a', č: 'c', ę: 'e', ė: 'e', į: 'i', š: 's', ų: 'u', ū: 'u', ž: 'z' };
const stripDiacritics = s => s.replace(/[ąčęėįšųūž]/g, c => STRIP[c]);
const VOC_OPENERS = [',', ':', '-', '–', '—'], VOC_CLOSERS = [',', '.', '!', '?', '…'];

const lines = file => readFileSync(file, 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#'));
// Python `c in "..."` for one character (undefined = out of range).
const isIn = (set, c) => c !== undefined && set.includes(c);

function loadDictionary(file) {
  const map = new Map();
  for (const line of lines(file)) {
    const p = line.split('\t');
    if ((p.length !== 3 && p.length !== 4) || !STRESS_MARKS.includes(p[2])) continue;
    map.set(p[0], [Number.parseInt(p.length === 4 ? p[3] : p[1], 10), p[2]]);
  }
  return map;
}

function loadLetters(file) {
  const map = new Map();
  for (const line of lines(file)) {
    const p = line.split('\t');
    if (p.length < 2 || !p[1]) continue;
    map.set(p[0].toLowerCase(), [p[1], p.length > 2 ? p[2].split(',').filter(Boolean) : []]);
  }
  return map;
}

function loadVocatives(file) {
  const set = new Set();
  for (const line of lines(file)) {
    const w = line.split('\t')[0].trim().toLowerCase();
    if (w) set.add(stripDiacritics(w));
  }
  return set;
}

function vowelGroups(ipa) {
  const groups = [];
  for (let i = 0; i < ipa.length; i++) {
    if (!isIn(IPA_VOWELS, ipa[i])) continue;
    groups.push(i);
    while (i + 1 < ipa.length && (isIn(IPA_VOWELS, ipa[i + 1]) || ipa[i + 1] === LENGTH)) i++;
  }
  return groups;
}

export function placeAccent(ipa, groupIndex, mark) {
  const clean = [...ipa].filter(c => !STRESS_MARKS.includes(c)).join('');
  const groups = vowelGroups(clean);
  if (groupIndex == null || groupIndex >= groups.length) return ipa;
  let i = groups[groupIndex] - 1;
  while (i >= 0 && isIn(CONSONANT_MODIFIERS, clean[i])) i--;
  if (i >= 0 && !isIn(IPA_VOWELS, clean[i]) && clean[i] !== ' ' && clean[i] !== LENGTH) i--;
  let boundary = i + 1;
  let j = i;
  while (j >= 0 && !isIn(IPA_VOWELS, clean[j]) && clean[j] !== ' ') j--;
  if (j < 0 || clean[j] === ' ') boundary = j + 1;
  return clean.slice(0, boundary) + mark + clean.slice(boundary);
}

function vocativeAccent(ipa) {
  const accented = placeAccent(ipa, 0, ACUTE);
  const groups = vowelGroups(accented);
  if (!groups.length) return accented;
  const start = groups[0];
  let end = start;
  while (end + 1 < accented.length && (isIn(IPA_VOWELS, accented[end + 1]) || accented[end + 1] === LENGTH)) end++;
  if (end !== start) return accented;
  return accented.slice(0, end + 1) + LENGTH + LENGTH + accented.slice(end + 1);
}

export async function createLithuanianPhonemizer({ dictDir, phonemeIdMap }) {
  const dictionary = loadDictionary(path.join(dictDir, 'lt_kirciai.tsv'));
  const letters = loadLetters(path.join(dictDir, 'lt_raides.tsv'));
  const vocatives = loadVocatives(path.join(dictDir, 'lt_kreipiniai.tsv'));

  const E = await (await import('@echogarden/espeak-ng-emscripten')).default();
  const worker = new E.eSpeakNGWorker();
  worker.set_voice('lt');
  const decoder = new TextDecoder();
  const cString = ptr => { const h = E.HEAPU8; let e = ptr; while (h[e]) e++; return decoder.decode(h.subarray(ptr, e)); };
  const cache = new Map();

  function espeakWord(word) {
    let ipa = cache.get(word);
    if (ipa === undefined) {
      if (cache.size >= CACHE_LIMIT) cache.clear();
      // This build separates phonemes with "_"; without them the IPA equals Python piper's espeak.
      ipa = cString(worker.text_to_phonemes(word, 1).ptr)
        .replace(/_/g, '').replace(/\([^)]+\)/g, '').normalize('NFD').trim()
        .replace(/ʂ/g, 's');
      cache.set(word, ipa);
    }
    return ipa;
  }

  function phonemizeWord(word) {
    let ipa = espeakWord(word);
    const entry = dictionary.get(word.toLowerCase());
    if (!entry) {
      if (![...ipa].some(c => STRESS_MARKS.includes(c))) {
        const g = vowelGroups(ipa);
        if (g.length) ipa = ipa.slice(0, g[0]) + ACUTE + ipa.slice(g[0]);
      }
      return ipa;
    }
    return placeAccent(ipa, entry[0], entry[1]);
  }

  function letterIpa(word, next) {
    const e = letters.get(word.toLowerCase());
    if (!e) return null;
    return e[1].some(p => next.toLowerCase().startsWith(p)) ? null : e[0];
  }

  function isVocative(words, tokens, i) {
    if (!vocatives.size || !vocatives.has(stripDiacritics(words[i].toLowerCase()))) return false;
    const opened = i === 0 || VOC_OPENERS.some(s => tokens[i - 1].trimEnd().endsWith(s));
    const closed = i === tokens.length - 1 || VOC_CLOSERS.some(s => tokens[i].trimEnd().endsWith(s));
    return opened && closed;
  }

  function phonemizeSentence(sentence) {
    const pieces = [];
    const tokens = sentence.split(/\s+/).filter(Boolean);
    const words = tokens.map(t => t.replace(WORD_CLEAN, ''));
    tokens.forEach((token, i) => {
      const word = words[i];
      const punct = [...token].filter(c => KEEP_PUNCT.includes(c)).join('');
      if (!word) {
        if (punct && pieces.length) pieces[pieces.length - 1] += punct;
        return;
      }
      const override = letterIpa(word, words[i + 1] ?? '');
      let ipa = override || phonemizeWord(word);
      if (override == null && isVocative(words, tokens, i)) ipa = vocativeAccent(ipa);
      pieces.push(ipa + punct);
    });
    return pieces.join(' ');
  }

  // Text -> one phoneme string (NFD) per sentence.
  function phonemize(text) {
    return text.trim().split(SENTENCE_SPLIT).filter(Boolean)
      .map(s => phonemizeSentence(s).normalize('NFD')).filter(Boolean);
  }

  // Same as piper phoneme_ids.py: ^ _ (id _)* $; unknown phonemes are skipped.
  function toIds(phonemes) {
    const ids = [...phonemeIdMap['^'], ...phonemeIdMap._];
    for (const p of phonemes) {
      const id = phonemeIdMap[p];
      if (id) ids.push(...id, ...phonemeIdMap._);
    }
    ids.push(...phonemeIdMap.$);
    return ids;
  }

  return { phonemize, toIds, dictionarySize: dictionary.size };
}
