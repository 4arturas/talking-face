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

What the server (`tools/tts-server/server.mjs`, port 3000, zero npm dependencies) does:

- serves the project pages too (`/` redirects to `talking-face-avatars.html`);
- `GET /api/tts?text=...&engine=auto|piper|edge&voice=lt-LT-OnaNeural` — `auto` tries
  Piper first (offline), then `edge-tts` (Microsoft's `lt-LT-OnaNeural`/`lt-LT-LeonasNeural`,
  online);
- `GET /api/voices` — lists the available voices.

Needed Python packages (installed with `python3 -m pip install --user piper-tts edge-tts`),
the Piper model `lt_LT-reginute1-medium.onnx` and its sidecar JSON in
`~/opt/talking-face/piper/`. The page falls back to Google Translate TTS only if the
server is unreachable.

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
