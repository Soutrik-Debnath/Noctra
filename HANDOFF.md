# Noctra — Complete Session Handoff

**Read this file first, in full, before doing anything.** Then read `PROGRESS.md` (every decision
and what shipped) and `BUGS.md` (every defect). Reference images are in `docs/references/`. The
original spec is `docs/noctra-build-prompt.md`.

You are continuing someone else's session. Everything the owner asked for is written here so they
never have to repeat it.

---

## 1. Who you're working with

- Self-described beginner, a "vibe coder." Maintains this with AI help, not from deep experience.
- **English only.**
- Explain the *why* in plain language. Avoid jargon. When you must use a technical term, say what
  it does in ordinary words.
- Build incrementally, one phase at a time. Never dump hundreds of lines into chat — write to files.
- **Do not make them your test harness.** Verify things yourself by running the app and reading
  live state. Only go back to them when something genuinely needs human eyes or a decision.
- They have said, repeatedly and with growing frustration: *"no need to ask me every damn thing."*
  Act on sensible defaults. Reserve confirmation for genuinely irreversible or optional/advanced
  features where you should explain complexity and wait.
- They are fine with blunt, direct tone.

---

## 2. Standing instructions that override the spec

These were given explicitly and are settled. Do not re-litigate them.

### 2a. Aesthetics outrank the performance budget
Original spec: *"stable 30fps on 2-core/4-thread, 8GB RAM, integrated GPU. This target overrides
visual ambition wherever they conflict."*

Owner reversed this: *"focus heavily on aesthetics over everything else... idk care abt a bit of lag
but aesthetics over everything looks matter a lot... maybe that 2 core 4 threads was way too much i
just want it optimized yet should run in general budget pcs quite well."*

**Applied policy:** push glass, blur and motion hard. Still banned, because it genuinely destroys
frame rate and they did ask to keep running on budget PCs: a **live full-window `backdrop-filter`**.
The full-window background stays a pre-blurred bitmap; everything else is fair game.

### 2b. Viewability still counts
*"also do care about viewabilty"* — contrast and legibility are not negotiable, no matter how good
the glass looks. Text over a bright cover is the recurring failure mode.

### 2c. Match the reference screenshots closely
Original spec forbade copying a product's layout/iconography. Owner chose **"Match screenshots as
closely as possible"** when asked directly.

**The one line still held:** never use Spotify's name, logo, or icon artwork — trademarks. Noctra
ships its own icon set drawn to matching visual weight.

### 2d. Never fabricate assets — use the real thing
*"ALBUM ART IS ALREADY PRESENT IN THE SONG AND U JUST NEED TO USE THE EXISTING FROM EACH SONG IN THE
CURRENT BACKGROUND OF THE APP."*

Cover art must come from the embedded artwork in the user's own audio files. Do not generate,
download, or invent placeholder imagery. When a fixture is needed, derive it from real files.
(The owner also had to say *"STOP THIS IMAGE GENERATING PART"* — do not generate demo art.)

### 2e. Process documents are mandatory and must stay current
*"Maintain a progress .md file logging down every new idea u derive and logging down every feature u
finally implement. Also maintain a bug list where u enter new bugs and solve them accordingly,
before making major edits ask for confirmation to create a backup of the current source code."*

- `PROGRESS.md` — every idea/decision (numbered `D-00N`, with reasoning) **and** everything shipped.
  Rejected ideas get recorded too, or a future session re-litigates them.
- `BUGS.md` — log a bug the moment it's noticed, even unfixed. ID, symptom, root cause, status, fix.
- Ask before wide-blast-radius edits; offer a source backup.

---

## 3. Reference images — what each one means

All in `docs/references/`. Look at them before touching UI.

| File | What it is | Instruction |
|---|---|---|
| `01-lyrics-fullscreen-bg.png` | Lyrics fullscreen background | Match the full-bleed blurred art-tinted backdrop, big bold current line, dimmed smaller previous/upcoming lines |
| `02-lyrics-fullscreen-hover-controls.png` | Same, mouse hovering album art | *"just fucking copy it"* — hover reveals a row of thin circular outlined icons over the art (layout, lyrics toggle, fullscreen, library, settings, close), plus vertical volume slider, favourite heart, and transport row |
| `03-lyrics-fullscreen-alt-palette.png` | Different cover, warm orange | Reference for how the palette should flood the whole view; note upcoming lines right-aligned while active line is left |
| `04-main-interface-inspiration.png` | Main app window | *"just for inspiration DO NOT COPY THE INTERFACE MAKE IT UNIQUE AND SEXY and offline music friendly; it can be similar, just the album art blurred background or maybe cooler"* |
| `05-desktop-miniplayer.png` | Floating desktop card | *"make it exactly same if possible"* — rounded card over the wallpaper, small art + title + artist on top, synced lyrics scrolling below with active line lit |
| `06/07/08-taskbar-*.png` | Windows 11 taskbar hover previews (WMP, Spotify, Noctis) | **Proof the taskbar thumbnail buttons are real and achievable on Windows 11.** See §5 |

## 3A. Aesthetic requirements — the full acceptance checklist

**This is the most important section in the file.** The owner's standing instruction is *"looks
matter a lot... it must be so good that it stands out quite well."* Judge every UI change against
this list, not against taste.

### Motion and timing — exact values from the spec, still binding

| Requirement | Target |
|---|---|
| Now Playing background | Full-bleed, heavily blurred, **slowly drifting/zooming** version of the current album art |
| Background change | **Cross-fade over 600–800ms**, never a hard cut |
| Album cover | Large, centred, rounded corners, soft shadow; cross-fades and **scales slightly** on track change |
| Accent colour | Drives glow, progress bar, active controls, current-lyric emphasis. **Interpolated over ~500ms**, never snapped |
| Lyric scroll | Smooth **`translateY` + opacity** between lines — never an instant jump |
| Word highlight | Each word goes dim → fully lit with **soft opacity + slight scale** as its timestamp lands. **No flashing. No karaoke sweep bar.** |
| Theme | Dark throughout, generous spacing, restrained motion |
| Avoid | Neon, heavy borders, effect-stacking "because it's possible" |

### Added by the owner on top of the spec

- **Glassmorphism / liquid glass / blur "all over wherever necessary."** Applied so far: nav rail,
  mini-player bar, Now Playing control orbs, desktop card. **Still wanted:** more surfaces — panels,
  overlays, popovers, the library header. Tokens live in `app.css` as `--glass-*`, `.glass`,
  `.glass-strong`. The specular top hairline is what makes it read as glass rather than translucency.
- **Buttons must be more aesthetic** — *"make the buttons more aesthetic... make it like the images
  i provided earlier."* Current transport/orb buttons are functional but plain. Match the thin,
  circular, outlined treatment in `02-lyrics-fullscreen-hover-controls.png`.
- **Viewability is not negotiable.** Bright covers must not wash out text. Recurring failure mode:
  scrim tuned for vibrancy until text disappears. Current mitigation is a directional scrim in
  `BlurredBackground.svelte` (dark at bottom/edges, clear in centre) plus raised text contrast
  tokens. Keep both when changing anything visual.
- **Only hard ban still standing:** no live full-window `backdrop-filter`. Everything else is
  permitted even at some frame cost.

### Per-screen targets

- **Fullscreen lyrics** (`01`/`02`/`03`): art-tinted full-bleed backdrop; current line large, bold,
  full opacity; previous lines dimmer and slightly smaller; upcoming dim. Hover over the artwork
  reveals the thin circular icon row — layout, lyrics toggle, fullscreen, library, settings, close —
  plus a vertical volume slider and the favourite heart. Transport sits **inside** the bottom of the
  artwork.
- **Desktop mini card** (`05`): rounded card floating over the wallpaper; small art with title and
  artist across the top; synced lyrics scrolling beneath with the active line lit and the rest dim.
- **Main window** (`04`): inspiration only for the design language — the blurred-art background and
  colour behaviour — **not** a layout to copy.

### Where the visual work stands

Built and verified: drifting blurred backdrop with cross-fade, per-track accent extraction, glass on
four surfaces, fullscreen layout matching `02`. **Not done:** heavier glass across remaining
surfaces, the button restyle, and any explicit frame-rate measurement.

---



## 4. Feature requests captured verbatim in intent

### 4a. Lyrics sources — owner overrode the spec
Spec says: use LRCLIB only, **do not** scrape sites without an official API (names spicylyrics).

Owner later instructed, twice:
> *"u can use lyrics fetch from https://github.com/surfbryce/beautiful-lyrics &
> https://github.com/Spikerko/spicy-lyrics — Beautiful lyrics and Spicy Lyrics (u can refer to their
> sites as well, this will be purely online there will be a 'Find Lyrics' button in full screen and
> it will find the lyrics of the following song and this word by word lyrics u can fetch it from or
> at least be inspired from these)"*

**Recorded as D-023. Requirements:** a **"Find Lyrics" button in fullscreen** that searches for the
current track; word-by-word timing.
**Not yet verified:** what providers those libraries actually hit, their licences, maintenance.
**Known constraint:** both are Node scrapers — the webview can't do cross-origin fetches, so this
must be ported to Rust behind a Tauri command, not `npm install`ed.
**Worth checking first:** LRCLIB's `syncedLyrics` already carries word-level timestamps, so these
may be best as a *fallback for misses* rather than the primary source.

### 4b. Windows taskbar + system media integration (full spec, restated)
> Native Windows media thumbnail toolbar on taskbar hover. Controls: **Previous, Play/Pause, Next,
> Favorite/Like** if technically supported. Controls **must** drive real playback — not decorative
> placeholders. Preview should show current track artwork where Windows allows. Track info updates
> on song change. Also integrate with Windows system media controls / Media Session: play, pause,
> previous, next, title, artist, album artwork, playback state — kept synchronised with internal
> state. If Windows doesn't support a control natively, implement the closest native behaviour
> rather than faking it. **Do not create a custom fake taskbar preview.** Use native
> Windows/Tauri/Rust integration.
>
> Test: start → play → minimise → hover taskbar icon → verify prev/play-pause/next → verify they
> affect playback → change track, verify metadata/artwork updates → verify system media controls.

Conceptual layout (do **not** render this ASCII in the app):
```
┌──────────────────────────┐
│      Album Artwork       │
│   Borderline — Tame I.   │
│    ⏮   ▶/⏸   ⏭   ♡      │
└──────────────────────────┘
```

### 4c. Multi-folder library
*"can i like add more folders if required easily ryt?"* — **done.** "Add folder" appends and
dedupes; "Replace" rebuilds.

### 4d. Buffering must be fast
*"make the buffering quite fast cause idk it's slow asf"* — see §6.

### 4e. General feature ambition
*"there is not quite many features or functions add like all cool possible functions from most well
known softwares out there"* — but immediately qualified: *"This is a feature pool, not a command to
implement everything. Do not add features outside the current phase. Before implementing
optional/advanced features, explain their complexity and wait for approval, but yeah try and give
all features which u feel is required and will make a good experience."*

So: add what genuinely improves the experience, stay in-phase, and gate only the expensive stuff.

---

## 5. The Windows 11 taskbar correction — read before dismissing it

I (previous session) told the owner Windows 11 cannot render taskbar thumbnail toolbar buttons
(`ITaskbarList3/4::ThumbbarAddButton`) and that no app can do it.

**That was false.** The owner produced three Windows 11 screenshots proving it — Media Player,
Spotify and Noctis all show a live window thumbnail with a working ⏮ ▶  (♡) row underneath.

**Do not repeat that mistake.** It's recorded in `PROGRESS.md` and in persistent memory.

Implementation plan (task 16, not started):
- `windows` crate → `CoCreateInstance(CLSID_TaskbarList)` → `ITaskbarList4` → `HrInit`
- `ThumbBarAddButtons` with `THUMBBUTTON` entries (`THB_BITMAP|THB_ICON|THB_TOOLTIP|THB_ENABLED`)
- Generate `HICON`s from raw ARGB in code — no `.ico` assets ship with the project
- Subclass the window proc; handle `WM_COMMAND` where `HIWORD(wParam)==THBN_CLICKED`, route
  `LOWORD(wParam)` to the player store on the main thread
- Re-add buttons on `WM_TASKBARCREATED` (taskbar recreates itself; buttons silently vanish)
- Update glyph on play/pause and artwork on track change
- Keep it isolated in `src-tauri/src/taskbar.rs` — it's a lot of `unsafe`; a mistake is a crash
- A `favorite` action is **not** a Media Session action Chromium supports, so ♡ can live in the
  thumbnail toolbar (we own those buttons) but not in the system-wide SMTC UI

---

## 6. Performance / playback state — measured facts, not vibes

- **Cold playback measured this session on the real 314-track library:** typically **0.5–1.0s**
  (bloodline 0.80s, Beggin' 0.53s, Laal Ishq 0.72s, Nadaan Parinde 0.76s, My Life Is 0.97s).
- **Owner reported ~30s.** That did **not** reproduce. Either file-specific, first-play-after-launch,
  or the same event as BUG-012.
- **`Iktara` is a consistent 9s outlier** — 8.8s and 9.0s on two runs. Ruled out: file size and
  header size (Laal Ishq is bigger on both and is fast). Unexplained.
- **First media play in a page costs ~9s of audio-pipeline init.** Fixed by
  `engine.warmUpOutput()` playing 0.25s of generated silence at startup. **Measurement trap:** any
  A/B test of playback variants run sequentially in one page blames whichever variant ran first —
  this caused two wrong diagnoses already. Randomise or reload between variants.
- **`noctra-audio://` throughput:** 15.3 MB/s; 2MB in 221ms. Not the bottleneck.
- **FLAC fix (BUG-008):** an empty MIME string in the PICTURE metadata block makes Chromium reject
  the entire file. The protocol patches that field on streamed bytes. **Never modify files on disk.**
- Progress clock uses `setInterval`, **not** `requestAnimationFrame` — rAF is frozen for occluded
  windows (BUG-007).
- `additionalBrowserArgs` in `tauri.conf.json` carries
  `--disable-features=CalculateNativeWinOcclusion` plus backgrounding and autoplay flags. **Removing
  the autoplay flag silently breaks the warm-up** — that regression happened once already.
- **`--remote-debugging-port=9223` is still in that config string. Remove before any release build.**

---

## 7. Open bugs, priority order

1. **BUG-012 — intermittent "playback error."** The exact message has never been captured.
   `describeError()` in `services/audio/engine.ts` maps `MediaError.code` to a sentence — the wording
   immediately narrows it (4 = source rejected, 3 = decode failed mid-stream, 2 = read error).
   Reproduce and read `player.error`.
2. **BUG-013 — 30s buffering report + the Iktara outlier.** See §6 for what's already excluded.
3. **BUG-011 — desktop mini-player card may render blank. Never confirmed working.**
   Two traps: `PrintWindow` cannot capture a transparent window (a blank PNG proves nothing), and
   opening `mini.html` directly in a browser shows white because `/src/mini.ts` can't resolve from
   `file://` — also proves nothing. Verify inside the running app.
4. **Taskbar thumbnail buttons** — §5, fully planned.
5. **Visual pass still requested and not done:** heavier glass/blur in more surfaces, buttons
   rebuilt to match `docs/references/`. All safe CSS work.
6. **Phase 6 lyrics** — §4a.

---

## 8. Phase status

| Phase | State |
|---|---|
| 0 Toolchain | done |
| 1 Visual foundation | done |
| 2 Real audio playback | done |
| 2b FLAC streaming fix | done |
| 3 Library, search, persistence | done, verified by owner |
| 4 Palette colour from art | **done and verified.** Remaining: explicit fps check |
| 5 Queue, shuffle, repeat, playlists, favourites | not started |
| 6 Lyrics + Find Lyrics | not started |
| 7 Persistence restore, Low Power toggle, polish | not started |
| Taskbar integration | not started |
| Desktop mini card | built, **unconfirmed** |

---

## 9. Dev tooling — use it, don't rebuild it

- `scripts/cdp-eval.mjs` — evaluate JS in the running webview over CDP. Needs the debug port in
  `additionalBrowserArgs`. Modes: `"<expr>"`, `--file <path>`, `--inject <path>` (survives reload),
  `--click <x> <y>` (**trusted** event — `element.click()` does not grant user activation, and
  autoplay-policy rejections then masquerade as real bugs).
- `window.__noctra = { player, ui, library }` in dev builds for live state inspection.
- `AppData/Local/Temp/noctra-setup/capture-all.ps1` — captures every Noctra window (note §7.3 caveat).
- Rust rebuilds take 30–70s; Vite cold start ~36s. Don't conclude a hang from a short wait.

## 10. Commands

```bash
cd "D:\Noctra Project"
npm install
npm run tauri dev      # the app
npm run check          # svelte-check + tsc
npm run build          # frontend only
```

## 11. Definition of done for the whole project

Runs fully offline except cached lyrics; no blocking UI during scans; **no feature that silently
fails or fakes success**; looks as good as the references; runs well on a normal budget PC.
