# Noctra — Offline-First Premium Music Player (Build Spec for AI Agent)

## Who you're building for
The requester is a beginner ("vibe coder"). Build **incrementally, phase by phase**. After each phase: confirm it runs, explain briefly what changed, give the exact run command, and **wait for explicit confirmation** before continuing. Never dump hundreds of lines into chat — write directly to project files.

## Non-negotiable ground rules
- Modular, simple architecture over clever abstraction. This person will be maintaining it with AI help, not reading dense code.
- No placeholder features that pretend to work. If something can't be built yet, leave a clearly labeled `// TODO:` comment and say so out loud.
- Every phase must leave the app in a buildable, runnable state.
- **Hard performance target: stable 30fps on a 2-core/4-thread CPU, 8GB RAM, integrated GPU.** This target overrides visual ambition wherever they conflict — see the Performance Budget section, it is not optional.

---

## Tech stack
- **Tauri 2** (Rust backend + WebView2 on Windows)
- **Svelte + TypeScript**
- Plain CSS (no heavy CSS framework)
- **HTML5 `<audio>`** for playback
- Rust crate **`lofty`** for audio tag + embedded-artwork extraction (MP3, FLAC, WAV, M4A/AAC, OGG) — do this in Rust, not JS; JS audio-tag libraries are unreliable for FLAC/OGG cover art.
- **`tauri-plugin-fs`**, **`tauri-plugin-dialog`** (folder picking), **`tauri-plugin-store`** (small persisted settings)
- Library metadata persistence: start with a JSON file on disk; document a clear upgrade path to SQLite (`tauri-plugin-sql`) for libraries beyond a few thousand tracks — do not build SQLite in Phase 1–3, just leave the storage layer behind an interface so it can be swapped later.
- Lyrics: **LRCLIB** (`https://lrclib.net`, free/no-key API, offline-cacheable, includes word-level "enhanced" sync for many tracks) as the online source, plus support for local `.lrc` and enhanced-LRC files. Do **not** scrape spicylyrics.org or any site without an official API — it's fragile and likely against its terms.
- Optional, scoped-only: **ybouane/liquidglass** for a handful of small UI elements (see Design System). Do not apply it as a full-app effect.

---

## Offline/online boundary (be explicit about this)
- The app must fully launch, browse the library, and play music with **zero network access**.
- The **only** network calls are: (a) fetching lyrics from LRCLIB when a track has no local `.lrc` and no cached result, and (b) nothing else, ever.
- Every lyrics fetch result is cached to disk keyed by a track fingerprint (title+artist+duration or file hash). Once cached, it never re-fetches.
- If offline or the fetch fails: show "Lyrics unavailable" gracefully — never block playback, never retry aggressively, never crash.

---

## Performance budget (read this before writing any animation code)
This is the section that resolves the biggest risk in the original idea: stacking full-window blur + animated motion + live color extraction + word-by-word highlighting + glass distortion all at once is *not* achievable at 30fps on the target hardware if done naively. Follow these rules:

1. **Never use live `backdrop-filter` blur across the full window.** Instead: when a track loads, downscale its artwork (e.g. to ~120–200px), apply a fast blur **once** (Rust-side using the `image` crate, or an offscreen canvas in JS if Rust is inconvenient), and cache the resulting blurred image per track. Animate that cached image only with cheap GPU-friendly properties: `transform: scale()/translate()`, `opacity`. Never re-run the blur filter every frame.
2. **Extract the dominant color palette once per track**, cache it (also keyed by track fingerprint), and reuse. Never recompute color extraction on every frame or every UI re-render.
3. **Cap animation-driven CSS to `transform` and `opacity`.** Avoid animating `filter`, `box-shadow` blur radius, or layout-affecting properties.
4. **Throttle lyric-sync checks** to ~10–15 checks per second against the audio's `currentTime`, not per animation frame. Word-highlight interpolation can use `requestAnimationFrame` only for the currently active word, not the whole lyric list.
5. **Scope "liquid glass" to at most 3–4 small, mostly-static UI elements** (nav rail, mini-player bar, queue/modal panel). Never apply it to the full-screen Now Playing background.
6. **Library scanning, tag reading, and artwork extraction run as Rust background commands**, streaming results back to the UI in batches (e.g. every 50 tracks), never as one blocking call that freezes the window.
7. **Virtualize any track list** over ~200 rows (render only visible rows) instead of mounting every row in the DOM.
8. Provide a **"Reduced Motion / Low Power" toggle** in Settings that disables background motion and drops it to a static blurred image + palette, no animation at all. This is the safety valve for genuinely low-end machines.

---

## Design language (original, not a clone)
Inspired by cinematic, minimal music-app conventions — **do not literally copy any specific product's screenshots, layout, iconography, or branding.** The reference behaviors to build (as generic techniques, not copied assets):
- Full-bleed, heavily blurred, slowly drifting/zooming version of the current album art as the Now Playing background, with a dark overlay for text readability, cross-fading to the new track's background over ~600–800ms on track change.
- A large, centered album cover with rounded corners and soft shadow, cross-fading/scaling slightly on track change.
- Dominant-color-driven glow/accent color for progress bar, active controls, and current-lyric emphasis, smoothly interpolated (not hard-cut) between the old and new palette over ~500ms.
- Lyrics panel: previous lines dim and slightly smaller, current line large/bold/full-opacity, upcoming lines dim; smooth vertical scroll (translateY + opacity) between lines rather than an instant jump.
- Word-level highlight (when word timestamps exist): each word transitions from dim to fully lit with a soft opacity/slight-scale change as its timestamp arrives — no flashing, no karaoke-bar effect.
- Fullscreen lyrics mode: same techniques, larger type, more immersive background, same performance rules apply (this is the highest-risk view for fps — test it explicitly).
- Dark theme throughout; generous spacing; restrained motion; avoid neon, heavy borders, or effect-stacking "just because it's possible."

---

## Architecture
```
src/
  components/
    PlayerControls/
    MiniPlayer/
    AlbumArt/
    Lyrics/
    Sidebar/
    Queue/
    TrackList/
    Search/
  views/
    Home/
    Library/
    NowPlaying/
    Playlist/
  stores/          (Svelte stores: playback state, queue, library, settings)
  services/
    audio/         (playback engine wrapper around <audio>)
    metadata/      (calls into Rust tag-reading commands)
    library/       (scan orchestration, JSON persistence)
    lyrics/        (LRCLIB client + local .lrc parser + cache)
    artwork/       (blur + palette cache)
    persistence/   (settings/store wrapper)
  utils/
src-tauri/
  src/
    commands/      (scan_folder, read_tags, extract_artwork, blur_image, ...)
```
Adjust freely if a simpler layout fits better — the goal is clear responsibilities per module, not rigid adherence to this tree.

---

## Persisted data
- Music library (paths + parsed metadata + artwork cache references)
- Playlists, favorites
- Last played track + playback position
- Volume, shuffle state, repeat mode
- UI preferences, including the Low Power toggle
- Lyrics cache (per track fingerprint)
- Blurred-background + palette cache (per track fingerprint)

---

## Build phases (build ONLY the current phase; wait for go-ahead before the next)

### Phase 1 — Visual foundation (no real audio, no real library yet)
- Tauri + Svelte app shell, dark theme, base typography
- Sidebar (Home / Library / Playlists / Favorites / Settings — non-functional nav is fine)
- Now Playing layout with one hardcoded demo track + demo artwork
- Pre-baked blurred background (even if computed once in JS for now) with the slow drift/zoom animation
- Large album art with rounded corners/shadow
- Bottom mini-player bar with play/pause/prev/next buttons (visual only, no real audio yet)
- Confirm it builds and launches before stopping

### Phase 2 — Real audio playback
- Wire `<audio>` element to play/pause/prev/next/seek/volume/mute
- Progress bar reflects real playback time
- Keyboard shortcuts (space, arrows)
- Still using demo tracks/local test files, not the full library yet

### Phase 3 — Local music library
- Folder picker (`tauri-plugin-dialog`) + recursive scan (Rust command, batched/streamed)
- Tag + embedded artwork extraction via `lofty`
- JSON persistence of the library
- Track list view + search
- Test with a real folder of mixed-format files

### Phase 4 — Dynamic visual system
- Palette extraction from artwork, cached per track
- Real dynamic gradients/glow/progress-bar color driven by palette
- Smooth palette interpolation on track change
- Swap the Phase-1 blur placeholder for the real cached-blur pipeline
- Explicit fps check on a representative low-end target before moving on

### Phase 5 — Queue / playlists
- Queue, shuffle, repeat (off/all/one)
- Playlists, favorites
- Drag-reorder if it doesn't add real complexity risk

### Phase 6 — Lyrics
- Local `.lrc` / enhanced-LRC parsing first
- LRCLIB online fetch + disk cache as fallback, fully optional/offline-safe
- Line-level sync UI (previous/current/upcoming styling, smooth transitions)
- Word-level highlight when timestamps exist, graceful fallback to line-level when they don't
- Fullscreen lyrics mode
- Explicit fps check again — this is the highest-risk view

### Phase 7 — Persistence, polish, Low Power mode
- Full playback-state restoration on relaunch
- Settings/playlist/library persistence finalized
- Loading/empty/error states
- Implement the Low Power toggle described in the Performance Budget
- Final pass: spacing, animation consistency, readability, and one more fps check with Low Power **off** on the target hardware profile

---

## Definition of done for the whole project
- Runs fully offline except the opportunistic, cached lyrics fetch
- Holds ~30fps on a 2-core/4-thread, 8GB RAM, integrated-GPU machine, including in fullscreen lyrics mode, with Low Power mode off
- No blocking UI operations during library scans
- No feature exists that silently fails or fakes success
