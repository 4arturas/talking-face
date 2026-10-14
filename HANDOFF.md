# HANDOFF — kas padaryta ir kaip tęsti

Šis failas skirtas būsimam LLM agentui: glaustai aprašo, kas jau pastatyta, kur kas gyvena,
kaip paleisti ir kokių spąstų vengti. Detalesnės techninės pastabos – `AGENTS.md`; `README.md` – tik paleidimas ir išjungimas.

## 1. Projekto esmė

„Talking face“ – trys statiniai HTML puslapiai (be build sistemos, be `package.json` kataloge
`talking-face.html`, `talking-face-3d.html`, `talking-face-avatars.html`). Pagrindinis –
`talking-face-avatars.html`. Avatarai – `.glb` modeliai (`avatars/ona.glb`, `avatars/saule.glb`).

Kiekvienas puslapis turi: tekstą + „Kalbėk“ (TTS + lip-sync pagal PHP-sintetintas fono formas),
mikrofoną (STT per Web Speech), pokalbį eilutėmis su Ollama (tik avatrų puslapyje), kalbos
pasirinkimą (`lt-LT` / `en-US`), emocijų mygtukus (3D puslapyje su bones animacija).

Lietuviški UI tekstai, bendravimas su naudotoju – lietuviškai, paprastai.

## 2. Katalogų struktūra

```
talking-face.html / -3d.html / -avatars.html   # puslapiai (viskas inline, three.js iš CDN)
talking-face-vrm.html                          # VRoid (VRM) avataras, three-vrm 3.5.5 (AGENTS.md 2a)
avatars/*.glb                                  # avatarų modeliai
blender/make_avatar.py                         # MPFB avataro generacija (Windows originalas)
blender/make_avatar.sh                         # Linux/macOS wrapper
tools/make_rpm_variant.py / .sh                # „reminis-PMG” spalvojimas (Pillow)
tools/run-server.sh                            # paleidžia NTTS serverį (Linux)
server.mjs                                     # vietinis balsų serveris (npm: msedge-tts)
README.md                                      # paleidimas / išjungimas
AGENTS.md                                      # techninės pastabos agentui
blender/work/                              # .gitignored (Blender darbo katalogas)
```

## 3. Dvi mašinos, du pasauliai

- **Windows (savininko)** – originalūs `.py` scriptai, PowerShell komandos AGENTS.md faile.
- **Linux (Pop!_OS 22.04, NVidia RTX 2070 SUPER 8 GB)** – šiame checkout'ai. Kadangi
  Windows naudoja `.py`, o Linux tik wrapperius, **nauji scriptai kuriami kaip `.sh` wrappers,
  `.py` paliekami Windows originalui**. Jokios `.py` modifikacijos savininko Windows neatrašys.

Aplinka (Linux): Node v26.8.2, npm 11.19.1, python3 3.10.12 (pip 26.2.1 vartotojo `~/.local`),
Ollama 0.34.0, Blender 5.2.2 portable, MPFB 2.0.18 + asset packs.

## 4. Kur kas įdiegta (Linux)

- Blender: `~/opt/talking-face/blender/blender-5.2.2-linux-x64/blender`
- MPFB duomenys: `~/.config/blender/5.2/extensions/.user/user_default/mpfb/data/`
- Demo MPFB turtas: `makehuman_system_assets_cc0`, `visemes02`, `faceunits01`
- Ollama: systemd vartotojo paslauga `ollama.service` (enabled + active),
  bazė `http://localhost:11434`, CORS leidžia `Origin: http://localhost:8000`
- Piper modelis: `~/opt/talking-face/piper/lt_LT-reginute1-medium.onnx` + `.json`
  (atsarginė kopija `.orig.onnx.json`)
- `git` nepriima didelių dvejetainių failų; GLB kuriami per scriptus.

## 5. Kaip paleisti

```bash
tools/run-server.sh                 # = node server.mjs (portas 3000)
# atidaryti: http://localhost:3000/talking-face-avatars.html
```

Serveris (a) patiekia HTML puslapius (faktiškai kaip `python -m http.server`), (b) `/` 301 →
`/talking-face-avatars.html`, (c) teikia `/api/tts` balsus. Alternatyva – `python3 -m http.server 8000`
(be balsų, tik puslapiai; TTS page bus sukurtas per absoliučią nuorodą `http://localhost:3000`).

Ollama pokalbiui pasiekiamas tiesiai iš `localhost:8000` (CORS), proksiuoti nereikia.

## 6. Vietinis balsų serveris (naujausia dalis)

`server.mjs` (šaknyje) – vienintelis Node failas; npm paketas `msedge-tts` (Edge balsai).

- `GET /api/tts?text=...&engine=auto|piper|edge&voice=lt-LT-OnaNeural`
  - `engine=auto` (numatytas): pirma `piper`, jei klaida → `edge-tts`; jei ir tai – HTTP 503.
  - `piper`: per npm `sherpa-onnx-node` (Node, be Python): `OfflineTts` sukuriamas vieną kartą
    paleidžiant serverį (`loadSherpa()`, ~1,5 s), atsakymas ~0,2–0,5 s; WAV koduoja `toWav()`
    (garsumas normalizuojamas kaip Python piper). Reikia `espeak-ng-data/` ir failų, kuriuos sukuria
    `node tools/piper-to-sherpa.mjs` (`.sherpa.onnx` su metaduomenimis, `.tokens.txt`).
    Jei jų nėra – atsarginis kelias: `python -m piper -m <modelis> -f <failas>` (~3 s/užklausa).
  - `edge`: npm `msedge-tts` (MP3, online).
  - Garso pradžioje pridedama tyla `TTS_LEAD_MS` (numatyta 300 ms; Piper – `padWav()`, Edge –
    `padMp3()` kartoja pirmą tylų MP3 kadrą), nes Bluetooth ausinės/adapteris (pvz. Poly BT700)
    nukerpa pirmus ~100–300 ms. Puslapių `speakLocal` lūpas paslenka per `leadMs`.
- `GET /api/voices` – balsų sąrašas JSON + `leadMs`.
- `GET /api/say/events` – SSE: pasikeitus `say.txt` (šaknyje), tekstas nusiunčiamas puslapiams,
  avataras jį ištaria (`sayFromServer()`; iki pirmo paspaudimo laukia, nebent puslapis atidarytas
  per `npm run show` – Chrome su `--autoplay-policy=no-user-gesture-required`; Edge vėliavą
  ignoruoja, jei politika `AutoplayAllowed = 0`). Serveris tekstą siunčia **tik vienam** klientui:
  tam, kuris paskutinis kvietė `POST /api/say/active?id=...` (fokusas/paspaudimas/matomumas);
  jei tokio nėra – paskutiniam prisijungusiam. Veikia ir tarp skirtingų naršyklių.
- `POST /api/say/active?id=<PAGE_ID>` – puslapis praneša, kad jis aktyvus (204).
- Užklausos vykdomos **paeiliui** (Piper/edge yra CPU pertekūviniai procesai).
- CORS ant API: `Access-Control-Allow-Origin: *`, kad veiktų ir iš `localhost:8000`/file://.

Balsai:
- Piper: `lt_LT-reginute1-medium` („Aistė"), 61 MB, WAV 22050 Hz, offline.
- Edge: `lt-LT-OnaNeural` („Ona", online), `lt-LT-LeonasNeural` („Leonas", online).
- PIPER konfigūra: kintamieji `PIPER_MODEL`, `ESPEAK_DATA`, `PORT`; Python atsarginiam keliui –
  `PIPER_BIN`, `PYTHON_BIN`.

Priklausomybės: npm `msedge-tts`, `sherpa-onnx-node`. Python (`piper-tts`) nebūtinas.

## 7. Balsų prioritetas puslapiuose (visuose trijuose)

Buvęs elgesys: naršyklėje radus natyvų `lt` balsą – jis (prastas, pvz. „Lithuanian+female1"),
kitaip – Google. **Naujas**:

1. vietinis serveris → `/api/tts` (Piper arba Edge) — žymė statuso juostoje „Kalbu… (Piper / Edge)";
2. naršyklės (natyvus) `speechSynthesis` balsas — jei serveris nepasiekiamas;
3. Google Translate TTS — jei ir natūraus nėra.

Implementacija (kiekviename puslapyje vienodai):
- `speakLocal(text, lang, onDone, fallback)` – groja `/api/tts` gabalais (`splitForTts` per
  `GOOGLE_TTS_MAX = 190`), lip-sync `schedule()` mastelį pagal realaus garso trukmę;
  klaidų atveju kviečia `fallback`.
- `ttsBase()` – jei puslapis atidarytas iš `localhost:3000`, nuoroda santykinė (`''`),
  kitaip absoliuti `http://localhost:3000`.
- `speakNative(text, lang, voice, onDone)` – senas natyvus `SpeechSynthesisUtterance` kelias.
- `fallbackVoice(text, lang, onDone)` – natyvus ↔ Google.
- `speakText` (avatrų) / `speak()` (2D/3D): `speakLocal(..., fallbackVoice)`.

`describeVoice()` dabar rodą tvarką „vietinis → naršyklės → Google" balsų užrašu.

## 8. Ollama pokalbio nustatymai (avatrų puslapis)

- `talking-face-avatars.html`, `PREFERRED_MODELS = ['qwen3:8b', 'gemma4:e2b', 'gemma4:e4b',
  'llama3.2:latest', 'qwen3.5:latest']`.
- `qwen3:8b` – pageidaujamas modelis, veikia GPU (84 % CPU→GPU offload pagal `ollama ps`).
- `gemma4:e2b` (4.6 GB) ir kiti – atsarginiai. Nedaryti `ollama rm` be savininko sutikimo.
- Galima alternatyva geresnei kokybei: `gemma3:12b` (8.1 GB, dalinai offload – arba ne).

## 9. Avatarų generacija (Blender + MPFB)

```bash
blender/make_avatar.sh avatars/<id>.glb <preset>   # $BLENDER, arba portable build, arba PATH
tools/make_rpm_variant.sh                          # reikalauja Pillow
```

`make_avatar.sh` randa Blender per `$BLENDER` → `~/opt/talking-face/blender/...` → `PATH`.
GLB reikalavimai (žr. AGENTS.md): morphus 15 visem `viseme_*` + 52 ARKit, bones pervedant
(`AvatarRoot`, `Jaw`, `Brow_L/R`, `EyeBlink_L/R` ir pan.), `alphaMode` MASK/tekstūros.
Vienas end-to-end testas praėjo (12.3 MB GLB).

Spąstai (jau išspręsti): Blender turi atidaryti failą ir `bpy.app.handlers`, MPFB tiesiog
`import` neveikia – paleidžiamas per `blender --background --python make_avatar.py`.

## 10. Done / TODO

Padaryta:
- [x] MPFB + asset packs + vienas pilnas end-to-end GLB testas
- [x] `.sh` wrappers (make_avatar, make_rpm_variant) + AGENTS.md Linux sekcija
- [x] Ollama: systemd paslauga + `gemma4:e2b` + `qwen3:8b` (GPU patvirtintas)
- [x] `PREFERRED_MODELS` ir AGENTS.md atnaujinti su `qwen3:8b`
- [x] Piper (`lt_LT-reginute1-medium`) sintezė patvirtinta; `phoneme_type` perrašytas į `"espeak"`
- [x] `server.mjs` + `tools/run-server.sh` + AGENTS.md TTS skyrius
- [x] Visi 3 puslapiai: vietinis → natyvus → Google prioritetas
- [x] `talking-face-vrm.html`: VRM avataras (Seed-san, Twist sample, savas .vrm)
- [x] Nukirpta kalbos pradžia (BT): tyla `TTS_LEAD_MS` serveryje + lūpų poslinkis puslapiuose

Planuojama / lieka:
- [ ] Naršyklės funkcinis testas su realiu garso atkūrimu (Playwright neįdiegtas – savininkas atsisakė).
- [ ] Galbūt `gemma3:12b` bandymas (jei savininkas panorės geresnės pokalbio kokybės).
- [ ] AGENTS.md: galima pridėti Windows paleidimo su viengubu Node (jei savininkas panorės).
- [ ] VRM puslapis: rankų padėtį, galvos linguojimą ir VRM 0.x modelį patikrinti naršyklėje.
- [ ] „Kalbėk“ garsui – jei `talking-face-avatars.html` pastebimas delsimas, galima prebufferinti.

## 11. Komandos, kurios padeda toliau

```bash
# serverio valdymas (PID faile, kad pkill nepalytėtų savo shell):
[ -f /tmp/tts-server.pid ] && kill "$(cat /tmp/tts-server.pid)"
nohup node server.mjs >/tmp/tts-server.log 2>&1 & echo $! >/tmp/tts-server.pid

# balsų testai:
echo "Sveiki!" | piper -m ~/opt/talking-face/piper/lt_LT-reginute1-medium.onnx -f - > out.wav
python3 -m edge_tts --voice lt-LT-OnaNeural --text "Sveiki" --write-media - > out.mp3
curl -s "http://localhost:3000/api/tts?text=Sveiki" -o out.wav

# JS sintaksė HTML failuose (ištraukus <script> be JSON/imimport map):
python3 -c 'import re,sys;sys.argv[0]'  # extract into /tmp/x.js; then:
node --check /tmp/x.js
```

## 12. Atidėti, kad nesugadintum

- NENAUDOK `pkill -f "server.mjs"` komandos – šablonas sutampa su pačiu bash, nukeria shellį.
  Vietoj to – PID failas (žr. 11).
- NEkomituok `output.wav` ar kitų testų likučių, didelių dvejetainių, `.venv`, `node_modules`.
- Nekeičiau GLP/BPM failų, jei nesu tikras, kad savininkas to nori.