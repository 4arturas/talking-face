#!/usr/bin/env node
/* Atidaro avatarų puslapį naršyklėje, kuriai leista groti garsą be paspaudimo,
 * kad avataras iš karto ištartų say.txt tekstą.
 *
 *   npm start                                (serveris, kitame lange)
 *   npm run show                             (index.html – visi puslapiai tabuose)
 *   npm run show -- talking-face-3d.html     (kitas puslapis)
 *
 * Naršyklė paleidžiama su --autoplay-policy=no-user-gesture-required ir atskiru
 * profiliu (~/.talking-face/browser-profile). Atskiras profilis būtinas: jei Edge/Chrome
 * jau atidaryta, be jo naujas langas prisijungtų prie esamo proceso ir vėliavą ignoruotų.
 * Pirmiausia ieškoma Chrome: Edge vėliavą ignoruoja, jei organizacijos politika
 * AutoplayAllowed = 0 (taip yra darbo kompiuteriuose). Kita naršyklė: BROWSER=C:\...\chrome.exe npm run show.  Kitas port'as: PORT=8080.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const page = process.argv[2] || 'index.html';
const url = `http://localhost:${process.env.PORT || 3000}/${page}`;

const candidates = process.platform === 'win32'
  ? [
      `${process.env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
      `${process.env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${process.env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ]
  : process.platform === 'darwin'
    ? [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      ]
    : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];

const browser = process.env.BROWSER || candidates.find(p => p && existsSync(p));
if (!browser) {
  console.error('Nerasta Edge/Chrome. Nurodyk kelią: BROWSER=<kelias iki naršyklės> npm run show');
  process.exit(1);
}

const profile = path.join(os.homedir(), '.talking-face', 'browser-profile');
mkdirSync(profile, { recursive: true });

spawn(browser, [
  `--user-data-dir=${profile}`,
  '--autoplay-policy=no-user-gesture-required',
  '--no-first-run',
  '--no-default-browser-check',
  `--app=${url}`,
], { detached: true, stdio: 'ignore' }).unref();

console.log(`Atidaryta: ${url}\n(${browser})`);
