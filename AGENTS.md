# talking-face – notes for an LLM agent

Read this before you change anything. It explains what the project is, how avatars are
made (Blender + MPFB, or direct GLB editing), and the traps that were already hit.
The owner writes in Lithuanian: answer in Lithuanian, briefly and in simple words.
The UI texts are Lithuanian too.

## 1. What the project is

Static HTML pages, no build step, no package.json. Everything runs in the browser.

| File | What it does |
|---|---|
| `talking-face.html` | 2D faces (SVG/canvas): human, girl, robot, realistic. |
| `talking-face-3d.html` | One 3D face (`facecap.glb` from the three.js CDN). |
| `talking-face-avatars.html` | Main page: full 3D avatars (GLB), voice, mic, Ollama chat. |
| `talking-face-vrm.html` | VRoid Studio avatar (VRM) via three-vrm; same voice, lip-sync, mic, Ollama code. See section 2a. |
| `avatars/*.glb` | Own avatars (`ona.glb`, `saule.glb`). |
| `blender/make_avatar.py` | Builds an avatar in Blender with MPFB (headless). |
| `tools/make_rpm_variant.py` | Recolours a Ready Player Me GLB (no Blender). |
| `blender/work/` | Downloaded source models and temp images (git-ignored). |

How the talking works (all our own code):
- Voice: browser `speechSynthesis`. If the browser has no voice for the chosen
  language (Chrome on Windows has no Lithuanian voice), the pages fall back to
  Google Translate TTS (`translate.google.com/translate_tts?...&client=tw-ob`, max ~190
  characters per request, text is split by `splitForTts`). Edge has its own online
  Lithuanian voices (Leokadija, Ona) and does not need the fallback.
- Lip sync: visemes are guessed from the letters of the text and timed to the speech
  (for Google TTS, scaled to the real audio length).
- Mic: RMS level opens the jaw.
- Idle: blinking, gaze, head sway.
- Chat: Ollama at `http://localhost:11434` (`/api/tags`, `/api/chat`, preferred model
  `qwen3:8b`, 5.2 GB Q4_K_M; runs on the RTX 2070 SUPER GPU, ~85 % GPU / ~15 % CPU).
  Answers are spoken sentence by sentence (`enqueueSentence` /
  `speakNextSentence`).
- three.js 0.170.0 from `cdn.jsdelivr.net` (import map). Internet is needed.

### Running it

```powershell
# from the project root
python -m http.server 8000
# open http://localhost:8000/talking-face-avatars.html
```

`file://` does not work for the mic, Ollama and local GLB files. Stop the server by PID
when done.

### Running it on Linux/macOS

Server: `python3 -m http.server 8000` (same URL).

This checkout is also set up on Linux (Pop!_OS 22.04): a portable Blender 5.2.2 lives
in `~/opt/talking-face/blender/blender-5.2.2-linux-x64/`, and MPFB + the asset packs are
in the default Blender config dir (`~/.config/blender/5.2/extensions/`). For avatar
work use the wrappers:

```bash
blender/make_avatar.sh avatars/<id>.glb <preset>   # Blender: $BLENDER, or the portable build, or PATH
tools/make_rpm_variant.sh                          # needs Pillow (python3 -m pip install --user pillow)
```

The `.sh` wrappers call the same Python scripts as Windows; the PowerShell instructions
further down are kept for the owner's Windows machine.

### Better Lithuanian voice (Piper / Microsoft Edge)

The "Kalbėk" button first uses the browser's own voice for the selected language. When the
browser has no `lt` voice, the page now tries a local TTS server instead of the old
Google Translate voice:

```bash
tools/run-server.sh          # http://localhost:3000/talking-face-avatars.html
```

What the server (`server.mjs` in the project root, port 3000, one npm dependency: `msedge-tts`;
start with `npm install` + `npm start`; `run-server.sh` runs `npm install` on first start) does:

- serves the project pages too (`/` redirects to `talking-face-avatars.html`);
- `GET /api/tts?text=...&engine=auto|piper|edge&voice=lt-LT-OnaNeural` — `auto` tries
  Piper first (offline), then Microsoft Edge voices via the npm package `msedge-tts`
  (`lt-LT-OnaNeural`/`lt-LT-LeonasNeural`, online, no Python);
- `GET /api/voices` — lists the available voices with `id`, `label` and `lang`
  (Piper is `lt-LT` only; Edge also has `en-US-AriaNeural`/`JennyNeural`/`GuyNeural`).
  To add an Edge voice, add it to `EDGE_VOICES` in `server.mjs`.
- `GET /api/say/events` — Server-Sent Events. The server watches `say.txt` in the project
  root (created empty on start, gitignored; another path via `SAY_FILE=...`). When the file
  is saved with non-empty text, every open page gets `event: say`, `data: {"text":"..."}`,
  puts the text into the text box and calls `speak()` with the chosen voice. The page
  connects only when opened over http (not `file://`). Browsers allow sound only after a
  user click, so before the first click the page shows "Spustelėk puslapį – tada ištarsiu"
  and speaks on that click. To speak with no click at all, open the page with
  `npm run show` (`tools/show.mjs`): it starts Chrome (or Edge) with its own profile and
  `--autoplay-policy=no-user-gesture-required`. Edge ignores this flag when the
  organisation policy `AutoplayAllowed = 0` is set, so Chrome is tried first.
  Code: `watchFile`/`handleSayEvents` in `server.mjs`,
  `sayFromServer()` in each page. Example: `Set-Content -Encoding utf8 say.txt "Labas"`
    (Windows PowerShell 5.1 needs `-Encoding utf8` for Lithuanian letters; the BOM is
    stripped) or `echo "Labas" > say.txt`.

Each page has a **"Balsas"** select under "Kalba". It is filled from `/api/voices`
(voices of the selected language), plus this browser's own voices and Google Translate.
`Automatiškai` = Piper → Edge „Ona" for Lithuanian, the first Edge voice for other
languages. The choice is saved in `localStorage` (`talking-face.voice.<lang>`). Code:
`fillVoices()`, `speakChosen()`, `loadServerVoices()` in each page.

Needed: `npm install` in the project root. It installs `msedge-tts` (Edge voices) and
`sherpa-onnx-node`, which runs Piper inside Node – **no Python**. The model is loaded once
at server start (~1.5 s), then a reply takes ~0.2–0.5 s (Python `piper` took ~3 s per
reply, mostly startup). Piper also needs, in `~/opt/talking-face/piper/`:
- the model `lt_LT-reginute1-medium.onnx` and its sidecar JSON;
- `espeak-ng-data/` (phonemizer data, includes Lithuanian);
- `lt_LT-reginute1-medium.sherpa.onnx` and `.tokens.txt`, made once by
  `node tools/piper-to-sherpa.mjs` (copies the model and adds the metadata sherpa-onnx needs;
  multi-character phonemes such as `aɪ` are skipped – each character has its own id).

If these files are missing, the server falls back to Python `piper` (`pip install --user
piper-tts`), and without that to Edge voices. The startup log says which Piper is used.
Env vars: `PIPER_MODEL`, `ESPEAK_DATA`. The page falls back to Google Translate TTS only if
the server is unreachable.

On Windows (PowerShell):

```powershell
npm install
# voice model -> %USERPROFILE%\opt\talking-face\piper\
$d = "$env:USERPROFILE\opt\talking-face\piper"; New-Item -ItemType Directory -Force $d
$b = "https://huggingface.co/rhasspy/piper-voices/resolve/main/lt/lt_LT/reginute1/medium/lt_LT-reginute1-medium"
curl.exe -sL --ssl-no-revoke -o "$d\lt_LT-reginute1-medium.onnx" "$b.onnx"
curl.exe -sL --ssl-no-revoke -o "$d\lt_LT-reginute1-medium.onnx.json" "$b.onnx.json"
curl.exe -sL --ssl-no-revoke -o "$d\espeak-ng-data.tar.bz2" "https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/espeak-ng-data.tar.bz2"
tar -xjf "$d\espeak-ng-data.tar.bz2" -C $d; Remove-Item "$d\espeak-ng-data.tar.bz2"
node tools/piper-to-sherpa.mjs
npm start   # http://localhost:3000/talking-face-avatars.html
```

Traps (Python fallback only):
- piper-tts 1.8 rejects `"phoneme_type": "lithuanian"` in the model JSON; change it to
  `"espeak"` (keep a copy of the original).
- On Windows the server runs `python -m piper` (pip's user `Scripts` folder is often not on
  `PATH`) and writes to its own temp WAV, because `piper -f -` fails there with
  `PermissionError` on a temp file.

## 2. What an avatar GLB must contain

`talking-face-avatars.html` loads a GLB with `GLTFLoader` (+ `MeshoptDecoder`) and
collects morph targets from **all** meshes (`morphTargetDictionary`), so partial sets on
teeth/eyes are fine.

Morph targets (names are case-sensitive):
- Oculus visemes: `viseme_aa, viseme_O, viseme_U, viseme_E, viseme_I, viseme_PP,
  viseme_FF, viseme_DD, viseme_kk, viseme_CH, viseme_SS, viseme_nn, viseme_RR,
  viseme_TH` (+ `viseme_sil` is nice to have).
- ARKit: `jawOpen`, `eyeBlinkLeft/Right`, `eyeLookUp/Down/In/Out` + `Left/Right`,
  `browInnerUp`, `browOuterUpLeft/Right`.

Bones (exact names, `findBone`): `Head, Neck, LeftEye, RightEye, LeftArm, LeftForeArm,
RightArm, RightForeArm`. The page rotates the arms down (`lowerArm`) for T-pose models.

### Adding an avatar to the page

In `talking-face-avatars.html`:
1. `<option value="<id>">Name – description (size MB)</option>` in `#avatar`.
2. A note in `AVATARS[<id>]` (source, licence, "Reikia localhost.").
3. For a local file: add `<id>: 'avatars/<id>.glb'` to `LOCAL_AVATARS`. Otherwise the
   page loads `BASE + id + '.glb'` (TalkingHead repo at a pinned commit).
4. Update the licence comment at the top of the file.

### Checking a GLB without a browser

Parse the JSON chunk in Python: bytes 12–16 = JSON length, JSON starts at byte 20.
Check `meshes[].extras.targetNames`, `nodes[].name`, `materials[].alphaMode`, image
sizes. Write such scripts to `%TEMP%` and delete them afterwards.

## 2a. VRM page (`talking-face-vrm.html`)

A copy of `talking-face-avatars.html` with the GLB parts replaced. Voice, `schedule()` /
`onWord()` lip-sync tempo, mic, Ollama, `say.txt` are the same code – keep them in sync
when you change one page.

- Libraries: three.js 0.170.0 + `@pixiv/three-vrm@3.5.5`
  (`lib/three-vrm.module.min.js`). It imports bare `three`, so the import map needs the
  `"three"` key. three-vrm 3.x needs three >= 0.137.
- Load: `GLTFLoader` + `loader.register(p => new VRMLoaderPlugin(p))`,
  `vrm = gltf.userData.vrm`, then `removeUnnecessaryVertices`, `combineSkeletons`,
  `rotateVRM0`. Call `vrm.update(dt)` every frame (expressions, lookAt, spring bones).
- Only preset expressions: mouth `aa ih ou ee oh` (max ~0.8, m/b/p = all 0), `blink`,
  `surprised` × 0.35 for brows on ? / !. Missing ones are skipped and listed under the
  avatar list. `surprised` with `overrideMouth/overrideBlink = 'block'` is not used.
- Eyes: `vrm.lookAt.target` = an `Object3D` in front of the head. Head: normalized
  `neck` / `head` bones. Arms: normalized `left/rightUpperArm.rotation.z = ∓1.2`; the
  code checks that the lower arm ends up below the upper arm and flips the sign if not.
- Traps: VRM 0.x normalized bones have X and Z flipped after `rotateVRM0` (`axis = -1`).
  ACES tone mapping washes out MToon, so the page uses `NoToneMapping`. `file://` does
  not work. VRM 0.x meta uses `commercialUssageName` (sic).
- Samples: Seed-san and VRM1_Constraint_Twist_Sample from `vrm-c/vrm-specification`
  (pinned commit, jsDelivr, ~11 MB each). Own model: VRoid Studio → File → Export as
  VRM → "Įkelti savo .vrm". A local file can be added to `AVATARS` as `avatars/x.vrm`.

## 3. Way A – build a new human in Blender with MPFB

### What is installed (owner's machine)

- Blender 5.4 (portable zip). Below, `<blender>` means the path to its `blender.exe`;
  ask the owner if you do not know it.
- MPFB 2.0.18 (MakeHuman Plugin For Blender; needs Blender 4.2+), installed as a user
  extension: `%APPDATA%\Blender Foundation\Blender\5.4\extensions\user_default\mpfb`.
  - Code: `...\mpfb\services\` (`humanservice.py`, `faceservice.py`,
    `exportservice.py`, `targetservice.py`); reference export pipeline:
    `...\mpfb\ui\operations\exportops\operators\createexportcopy.py`.
  - Rigs: `...\mpfb\data\rigs\standard\rig.<name>.json` (`default`, `game_engine`,
    `mixamo`, ...).
- Asset packs (user data dir
  `%APPDATA%\Blender Foundation\Blender\5.4\extensions\.user\user_default\mpfb\data`):
  - `makehuman_system_assets` (CC0, ~280 MB): skins, eyes, eyebrows, eyelashes, teeth,
    tongue, a few hairs (bob01/02, short01–04, long01, afro01, braid01, ponytail01) and
    clothes (`female_casualsuit01/02`, `male_casualsuit01–06`, `shoes01–06`, ...);
  - `visemes02` – Meta/Oculus viseme targets (needed for lip sync);
  - `faceunits01` – 52 ARKit face units (needed for blink, gaze, brows, jawOpen).
  - Not installed (optional): `skins01` (~99 MB), `hair01` (~217 MB), `eyebrows01`.
    List: https://static.makehumancommunity.org/assets/assetpacks.html

No Blender MCP server is used (https://www.blender.org/lab/mcp-server/). The owner
asked for the safest way: MCP lets an LLM run arbitrary code inside Blender. Blender
is driven only by headless Python scripts that are saved in this repo.

### Generate an avatar

```powershell
& <blender> --background --python blender\make_avatar.py -- avatars\<id>.glb <preset>
```

Linux/macOS wrapper (finds Blender, see above):

```bash
blender/make_avatar.sh avatars/<id>.glb <preset>
```

- A run takes 1–2 minutes. Filter the noisy output:
  `... 2>&1 | Select-String 'AVATAR|Error|Traceback'`.
- New look = new entry in `PRESETS` at the top of `make_avatar.py`:
  - `macro`: `gender` (0 = female, 1 = male), `age`, `muscle`, `weight`,
    `proportions`, `height`, `cupsize`, `firmness`, `race` {asian, caucasian, african};
  - `skin`: path to a `.mhmat` under the data dir;
  - `assets`: `(type, path to .mhclo)`; types used: Eyes, Eyebrows, Eyelashes, Teeth,
    Tongue, Hair, Clothes.
  List what exists with `Get-ChildItem <data dir>\hair` etc.
- The script: creates the human → `default` rig → GAMEENGINE skin and assets → export
  copy (bake targets, load Meta visemes + ARKit, interpolate to proxies, bake masks,
  remove helpers) → renames bones (`BONE_RENAMES`, e.g. `head`→`Head`,
  `upperarm01.L`→`LeftArm`) → makes materials opaque → exports GLB → patches
  hair/eyebrows/eyelashes/eyes to `alphaMode: MASK`.

### Blender/MPFB traps (already hit)

- Import MPFB like this: `from bl_ext.user_default.mpfb.services import HumanService, ...`
  (`LocationService` is an instance there).
- Do not use `--factory-startup`: it can disable user extensions. Delete the default
  scene objects in the script instead.
- Blender "Allow Online Access" is off. Keep it off. Install extensions/packs from
  files you downloaded and checked:
  - extension: `blender.exe --command extension install-file -r user_default --enable <zip>`;
  - asset pack: headless `bpy.ops.mpfb.load_pack(filepath=<zip>)`;
  - before installing, list the zip and make sure it holds only data (no `.py`/`.exe`);
  - pack URLs: `https://files.makehumancommunity.org/asset_packs/<name>/<name>_cc0.zip`,
    `https://files.makehumancommunity.org/functional/visemes02.zip` (and `faceunits01`).
- `curl` on this network needs `--ssl-no-revoke` (otherwise exit code 35).
- Transparency: the glTF exporter writes `BLEND` for every material with a connected
  Alpha. In three.js that breaks depth sorting (teeth and eyes show through the face).
  So: everything opaque, only hair/eyebrows/eyelashes/eyes as `MASK`. Eyes need MASK
  because the cornea is transparent; opaque eyes look white.
- Opaque textures are exported as JPEG, which halved the size (22 → 12 MB).
- Not verified: whether `neck01` is the best `Neck` bone; the MPFB arm rest pose (the
  page frames only head and shoulders).

## 4. Way B – recolour an existing GLB (no Blender)

`tools/make_rpm_variant.py` makes "Saulė" from TalkingHead `brunette.glb` (Ready Player
Me). It edits the GLB directly with Python + Pillow, so the skeleton and all 72 morphs
stay exactly the same. A Blender import/export round trip would lose these edits and
can change morphs, so do not use Blender for simple recolours.

```powershell
python tools\make_rpm_variant.py   # needs Pillow; downloads brunette.glb to blender\work\ if missing
```

Linux/macOS wrapper: `tools/make_rpm_variant.sh`

- Ready Player Me materials: `Wolf3D_Skin, Wolf3D_Eye, Wolf3D_Teeth, Wolf3D_Body,
  Wolf3D_Hair, Wolf3D_Outfit_Top, Wolf3D_Outfit_Bottom, Wolf3D_Outfit_Footwear,
  Wolf3D_Glasses`.
- Hair colour is in two places: the hair texture **and** the scalp painted on the face
  texture (top ~25 %). Brows are also painted on the face texture (y ≈ 0.26–0.30).
- Tunable constants at the top: `BLONDE_DARK/LIGHT`, `TOP_HUE_SHIFT`,
  `BOTTOM_HUE_SHIFT`. `shift_hue` keeps saturated orange accents unchanged.
- Glasses are removed by taking their node out of the parent's `children`.
- When writing the GLB, rebuild the BIN chunk with 4-byte alignment and update
  `bufferViews` offsets and `buffers[0].byteLength`.
- Pillow 12: use `get_flattened_data()`, not the deprecated `getdata()`.

## 5. Testing in a browser (Playwright)

There is no Playwright in this repo. Install it in a temp folder outside the repo
(`npm install playwright`) and `require()` it by absolute path.

- `chromium.launch({ channel: 'chrome' | 'msedge', headless: true,
  args: ['--use-gl=angle', '--use-angle=swiftshader'] })` – WebGL works headless.
- Wait ~6 s after starting `http.server`. Wait until `#loading` is hidden;
  `selectOption('#avatar', '<id>')`; press `#speakBtn`; the status ends with `Baigta.`.
- Collect `pageerror` and console errors. A 404 for `favicon.ico` is expected.
- Clicking "Kalbėk" scrolls the page; scroll to top before a screenshot.
- Playwright browsers only have the 3 local Windows voices (David, Mark, Zira), so the
  Lithuanian path always uses the Google TTS fallback in tests.
- Look at the screenshot yourself before saying the avatar looks right.

## 6. Licences

See `LICENSE`: code is MIT; each avatar file has its own licence (listed there).
When you add or change an avatar, update `LICENSE` too.

- MPFB code: GPL. MakeHuman system assets, visemes02, faceunits01: CC0 → `ona.glb` is
  free to use.
- TalkingHead avatars (Ready Player Me, Avaturn, AvatarSDK, VRoid, MPFB demo) and
  everything derived from them (`saule.glb`): **CC BY-NC 4.0** – non-commercial, with
  attribution. Mention this in the `AVATARS` note.
- VRM samples (Seed-san, VRM1_Constraint_Twist_Sample): VRM Public License 1.0,
  commercial use allowed; Seed-san needs credit (VirtualCast, Inc.).
- Google Translate TTS is an unofficial endpoint; the spoken text is sent to Google.
  The UI says so.

## 7. Working rules for the agent

- Keep changes small; preserve the page style and Lithuanian UI texts.
- Windows PowerShell 5.1: no `&&`; `Set-Content -Encoding utf8` adds a BOM and can
  break Lithuanian letters – use the edit tool or Python with `encoding="utf-8"`.
  Do not print Lithuanian text from Python to the console (cp1252).
- Keep temp scripts, screenshots and downloaded zips out of the repo (`%TEMP%` or
  `blender\work\`), and delete them after use.
- Do not install anything new into Blender, or enable online access, without asking.
