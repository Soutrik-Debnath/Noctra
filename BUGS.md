# Noctra — Bug Log

Defects found during development, worked through in ID order. A bug is entered the moment it is
noticed, even if it is not fixed yet, so nothing gets silently dropped.

Status legend: `OPEN` (unreproduced or unfixed) · `FIXING` (being worked on) · `RESOLVED` ·
`WONTFIX` (with reason)

---

## BUG-001 — winget install aborted: unrecognised `--accept-license-agreements`

- **Status:** RESOLVED
- **Phase:** 0 (toolchain)
- **Symptom:** All three toolchain installs (Node, Rustup, VS Build Tools) exited immediately with
  code 2. Nothing was installed. The log showed
  `Argument name was not recognized for the current command: '--accept-license-agreements'`.
- **Root cause:** My own command construction, not the environment. This winget build (v1.29.380)
  exposes `--accept-package-agreements` and `--accept-source-agreements`, but has no
  `--accept-license-agreements` flag. Because the flag is rejected during argument parsing, winget
  printed its usage text and exited before attempting any install — so all three failed identically,
  which made it look like a broader system problem at first glance.
- **Fix:** Dropped the invalid flag from all three invocations. Retried as
  `winget install -e --id <pkg> --source winget --accept-package-agreements --accept-source-agreements --silent`.
- **Lesson:** An exit code on a wrapper script that chains commands says nothing about the individual
  steps. The per-step `*_EXIT=` markers in the log are what caught this.

---

## BUG-002 — FLAC probe: Vorbis comment lengths read as big-endian

- **Status:** RESOLVED
- **Phase:** 1 (asset extraction probe)
- **Symptom:** Every FLAC file failed with `The value of "offset" is out of range ... Received
  536871290`. Identical failure across all files, which initially made it look like the files were
  corrupt or not really FLAC.
- **Root cause:** FLAC's *outer* metadata block framing is big-endian, but the string lengths
  inside a VORBIS_COMMENT block are **little-endian**. Reading the vendor-string length as
  big-endian turned `20 00 00 00` into 536870912 instead of 32, so the next read ran 500MB past the
  end of the buffer.
- **Fix:** Added a little-endian reader for Vorbis comment internals; left the block framing
  big-endian.
- **Note:** My first diagnosis was wrong — I assumed the picture block field order was the
  culprit and "fixed" that first, which changed nothing. The offsets in the error message
  (`536871488 - 576 = 0x20000000`, where 572 was the comment block body) pointed at the real
  location. Reading the numbers beats guessing at the spec.

## BUG-003 — FLAC probe: wrong STREAMINFO bit offsets, durations came back absurd

- **Status:** RESOLVED
- **Phase:** 1 (asset extraction probe)
- **Symptom:** Tags and artwork read fine, but duration parsed as `300395212` seconds, then `null`
  after a partial fix. Sample rate decoded as 0, bit depth as 8.
- **Root cause:** STREAMINFO is a packed bitfield, and I assumed the commonly-cited field widths
  (10-bit block sizes, sample rate at bit 21). Those don't fit: 4096 is not representable in 10
  bits, and 10+10+1+20+3+5+36+128 = 213 bits, which cannot fill a 34-byte (272-bit) block. The
  real layout in these files uses 16-bit block sizes with sample rate at bit 80.
- **Fix:** Stopped guessing. Built the block's bit string and searched it for values that had to be
  there (44100, 4096), which located the fields exactly. Verified the derived layout on three
  files: block 4096/4096, 44100 Hz, 2 ch, 16-bit, and durations that cross-check against file size
  at a plausible FLAC compression ratio.
- **Lesson for Phase 3:** this is precisely why the spec mandates `lofty` in Rust instead of
  hand-rolled tag parsing. The probe is throwaway; do not promote this parser into the app.

---

## BUG-004 — Now Playing backdrop rendered as near-black

- **Status:** RESOLVED
- **Phase:** 1 (visual verification, caught by screenshotting the running app)
- **Symptom:** The full-bleed blurred artwork backdrop — the defining visual of the whole design —
  was invisible. The window read as flat black with a faint tint.
- **Root cause:** Two compounding issues. The scrim stacked a radial gradient topping out at
  `rgba(0,0,0,0.62)` over a linear gradient reaching `rgba(6,6,10,0.78)`, which multiplies to
  roughly 92% black at the bottom of the window. Separately, several covers in the library are
  genuinely dark (AM is near-monochrome), so a straight blur of them contributes almost nothing.
- **Fix:** Cut the scrim to 0.34 / 0.52 maximum, and bake `brightness(1.3) saturate(1.16)` into the
  blur pass. The brightness correction rides on the same `ctx.filter` as the blur, so it is paid
  once per track and costs nothing per frame — which keeps it inside the performance budget.
- **Note:** Only visible by actually looking at the running app. `npm run build` and `svelte-check`
  both passed the entire time this was broken.

## BUG-005 — Hover-reveal controls hidden from the accessibility tree

- **Status:** RESOLVED
- **Phase:** 1
- **Symptom:** The Now Playing overlay cluster (layout / lyrics / fullscreen / library / settings /
  collapse) never appeared in the accessibility snapshot, even though it was in the DOM.
- **Root cause:** `aria-hidden={!player.isPlaying}` on the overlay container. Playback state has
  nothing to do with whether the cluster is shown — the condition was simply wrong, so the entire
  control group was declared hidden from assistive tech whenever the track was paused.
- **Fix:** Removed the bogus binding. Also switched the hidden state from opacity alone to
  `visibility: hidden`, so the buttons leave both the accessibility tree and the tab order while
  collapsed, and re-enter on hover or `:focus-within`. Verified by hovering: all six controls now
  appear, with the three unbuilt ones correctly `disabled` and labelled with their phase.

---

## BUG-006 — Progress bar never advanced during real playback

- **Status:** RESOLVED
- **Phase:** 2
- **Symptom:** After wiring the audio element, `player.position` stayed at 0 while audio played.
- **Root cause:** `startClock()` was defined and never called. The `play` event listener only
  emitted the `playing` callback; `stopClock()` was correctly wired to `pause`/`ended`, so the
  teardown half of a mechanism existed while its setup half did not. TypeScript could not catch it
  because the method was referenced by the class itself.
- **Fix:** Call `startClock()` from the `play` listener.
- **Note:** Seek appeared to work throughout, because `engine.seek()` pushes a position update
  directly. That masked the bug in a quick click-test and made it look like only the display was
  stale.

## BUG-007 — Clock froze whenever the window was covered

- **Status:** RESOLVED
- **Phase:** 2
- **Symptom:** Position advanced ~1 second per second of wall clock instead of tracking smoothly,
  and appeared frozen for long stretches.
- **Root cause:** The progress clock used `requestAnimationFrame`. Chromium freezes rAF for hidden
  or fully occluded windows, so the loop stopped whenever Noctra went behind another window —
  while audio kept playing. A music player whose progress bar dies when it loses focus is broken
  by definition.
- **Fix:** Replaced the rAF loop with a 66ms `setInterval`. Visible pages run it at full rate;
  hidden ones throttle to roughly 1Hz, which is acceptable for a bar nobody is looking at.
  `stopClock()` now also emits the element's true `currentTime` so the displayed position lands
  exactly where playback stopped rather than at the last poll.

## BUG-008 — WebView2 refused to decode the library's FLAC files

- **Status:** RESOLVED — fixed in the `noctra-audio://` protocol (D-022)
- **Phase:** 2
- **Symptom:** Every FLAC fails with `NotSupportedError: no supported source was found`,
  `MediaError.code 4`, `networkState 3`, `readyState 0`. The element rejects the source before
  downloading anything.
- **What has been ruled out:**
  - *Asset protocol* — the same URL fetches at HTTP 200 with the correct 29,686,716 bytes and
    magic `664c6143` (`fLaC`).
  - *MIME type* — the server sends `audio/x-flac`, and a `Blob` explicitly typed `audio/flac`
    fails identically.
  - *CORS* — the fetch succeeds cross-origin.
  - *Broken files* — `lofty` parses all three perfectly: Flac, 44100 Hz, 2 ch, and durations that
    match the values read independently from the raw stream.
  - *Missing codec from age* — the WebView2 runtime is Chromium 153; FLAC has been supported in
    Chrome since v43.
  - *Media element* — a WAV data URI, an MP3 and an M4A from the same folder all play correctly
    through the identical asset-protocol path.
- **RESOLVED DIAGNOSIS — root cause confirmed by controlled experiment.**
  A FLAC `PICTURE` metadata block whose **MIME type string is empty** makes Chromium's FLAC
  demuxer reject the *entire file*, before it downloads or decodes any audio.
  Proof, all against the same Skyfall file served from the same place:
  | Variant | Change | Result |
  |---|---|---|
  | original | none | `MediaError.code 4` |
  | all metadata stripped | STREAMINFO only | **plays**, 286s, readyState 4 |
  | STREAMINFO + PICTURE | picture MIME filled | **plays**, 286s |
  | **all 5 blocks kept** | **only** the picture MIME filled, +10 bytes | **plays**, 286s |
  The last row is the one that closes it: every other byte, including the audio frames, is
  unchanged, so the empty MIME string is the sole cause.
- **The files are not malformed.** Four FLACs from three independent sources (Music folder,
  Telegram Desktop, a phone mirror) share identical header structure, and that structure is
  arithmetically forced: 16+16+48+20+3+5+36 = 144 bits + 128-bit MD5 = exactly the 34 bytes each
  file declares for its STREAMINFO. The 10/10/1/20 field layout I first assumed accounts for only
  213 bits and cannot fill a 34-byte block, so my original "these headers are non-standard" theory
  was wrong on both counts — the layout was standard and the tagger's empty MIME string was the
  problem. lofty tolerates it; Chromium does not.
- **Ruled out earlier, still true:** asset protocol (200 + correct bytes + `fLaC` magic), MIME of
  the *HTTP response* (fails identically as `audio/x-flac`, as `audio/flac` from Vite, as a Blob
  typed `audio/flac`, and as an untyped Blob), CORS, the media element itself (WAV, MP3, M4A all
  play through the same path), and codec availability (WebView2 is Chromium 153).
- **Fix shipped:** `src-tauri/src/audio_protocol.rs` registers a `noctra-audio://` scheme that
  streams the file and fills in the empty MIME string on the bytes it serves. Nothing on disk is
  touched. Verified: Skyfall, Do I Wanna Know?, Akuma no Ko, The Humma Song and a Telegram-sourced
  Tame Impala track all report correct durations and play; range requests were checked byte-for-byte
  against the physical file to confirm the offset translation.
- **Two things that nearly caused a wrong fix:** the first implementation omitted the 4-byte `fLaC`
  signature from the served prefix, which showed up as a byte delta of 6 instead of 10 — that
  discrepancy is what identified it. And hand-building a `noctra-audio://...` URL in JS silently
  failed on Windows, where custom schemes are only reachable via the rewritten
  `http://noctra-audio.localhost/...` form; `convertFileSrc(path, "noctra-audio")` is the call that
  handles it.

## BUG-009 — Media suspends seconds after start while the window is covered

- **Status:** CLOSED — measured, no longer inferred
- **Closure (release pass):** `scripts/occlusion-sampler.js` starts a track, the window is minimised
  from outside via `ShowWindow(SW_MINIMIZE)`, and the deck is polled for 115s. Position advanced
  **115.1s against 115s of wall clock** with `paused` false on every sample, `readyState` 4 throughout
  and `error` null. Minimising is the stronger form of the original condition, so the spontaneous
  pause at ~7.6s is gone — the three Chromium flags in `additionalBrowserArgs`
  (`CalculateNativeWinOcclusion`, backgrounding, timer throttling) are what fixed it, and this is the
  first run that actually observed it rather than assuming.
- **Phase:** 2
- **Symptom:** With `--disable-features=CalculateNativeWinOcclusion` applied, playback starts and
  tracks wall clock correctly (3.3s → 6.3s over 3 seconds), then the element fires `pause` by
  itself at roughly 7.6s. No error is set, the track index does not change, and position does not
  reset, so it is a genuine spontaneous `pause` rather than `ended` or a failure.
- **Context:** observed only while the Noctra window was fully occluded and unfocused, which is
  exactly the state automated testing leaves it in. `document.visibilityState` reads `visible`
  throughout, so this is not the same mechanism as BUG-007.
- **Why it matters if real:** a music player must keep playing when minimised or behind other
  windows.
- **Update after D-020/D-022 landed:** a later 18-second run with the window still fully covered
  showed position advancing continuously (2.2 → 4.7 → 7.1) with no spontaneous pause, so the
  occlusion flag plus the new protocol may have resolved it. Not closed, because the earlier
  reproduction was clean and the observation window is short.
- **Still needs:** a human watching a visible window for a few minutes to confirm.
- **Second sighting, this session:** after "The Humma Song" reached its end, the auto-advance moved
  to the next track and the element settled at position 0 with `isPlaying` false and no error set.
  Same signature as the original report — a spontaneous `pause` rather than `ended` or a failure.
  Not reproducible on demand; it happened once across several hours of automated runs.

---

## BUG-014 — Taskbar thumbnail row quality

- **Status:** FIXED (rendering), OPEN (needs one more look)
- **Phase:** taskbar integration
- **Update:** the owner hovered it and reported back, so the row does render on Windows 11 — the
  "never been seen" concern from the first version of this entry is closed. What they reported
  instead: the glyphs were **blurry and pixelated**, the circle around each button made it worse, and
  the favourite looked reversed.
- **Cause of the blur:** the glyphs were rasterised at 32px. The shell scales thumbnail buttons to
  the system small-icon size, which at this DPI is larger than 32, so the bitmap was being scaled
  *up*.
- **Fix:** render at 64px in a 32-unit design space, so the shell only ever downscales. Geometry and
  the thin ring are unchanged; the ring is what both reference apps (Noctis, Spotify) draw, so it
  stays.
- **Still open:** whether the heart now reads correctly in both states. The outline/filled pair is
  generated from one analytic curve, and the mapping was verified correct in code, but the owner's
  "reversed" report has not been re-checked by eye since the resolution change.

---

## BUG-015 — Lyrics panel showed the previous track's words

- **Status:** RESOLVED
- **Phase:** 6
- **Symptom:** "I Don't Care" was playing and the lyric column showed "The Humma Song".
- **Root cause:** `LyricsStore.load()` fired a request per track and applied whichever answer
  resolved last. A slow LRCLIB response for the outgoing track overwrote a fast one for the incoming
  track. The in-flight map keyed by title+artist only prevented duplicate requests for the *same*
  song, which is not the race.
- **Fix:** every request takes a sequence number and a response is discarded unless its number is
  still current.
- **Note:** this was found by reading the actual rendered text against the actual playing title, not
  by looking at the code. The data layer was correct throughout — only the display raced.

---

## BUG-016 — Transport controls invisible over a light album cover

- **Status:** RESOLVED
- **Phase:** visual pass
- **Symptom:** after the reference-accuracy pass, the fullscreen transport row (shuffle, previous,
  next, repeat) disappeared entirely on white sleeves. Only the accent play disc was left.
- **Root cause:** making the transport bare glyphs, as reference 02 shows, is only correct because
  that reference's cover is dark. White ink on a near-white cover has no contrast at all. The
  drop-shadow on the row is not enough when the whole background is 250+.
- **Fix:** the blur pass now reports the artwork's raw luminance alongside the corrected one, and
  above 0.55 the transport inside `.art-zone` switches to dark ink. Scoped to the artwork so the
  same controls on the dark mini-player bar keep white ink.
- **Lesson:** a treatment copied from a screenshot carries that screenshot's background with it.
  Check it against the brightest asset in the real library before calling it done.

---

## BUG-017 — Nothing on screen during the first play of a session

- **Status:** RESOLVED (presentation only — the delay itself is not fixable from here)
- **Phase:** 2 / 7
- **Symptom:** the owner reports songs taking 8–10 seconds to start.
- **Measured cause:** the one-time audio subsystem start-up in WebView2. `engine.warmUpOutput()`
  plays 0.25s of generated silence through a blob URL — no file, no protocol, no tags — and takes
  **6786 ms**. A real play immediately after it takes **670 ms**. An `AudioContext.resume()` in the
  same page costs 7141 ms, so it is the output device, not the media element.
- **Why the warm-up did not hide it:** it starts 400 ms after mount and runs for ~7s. A user who
  clicks play inside that window queues behind it — measured at 7211 ms for a click one second after
  launch, versus 445–670 ms for every play after the subsystem is up.
- **Fixes:** warm-up starts at 0 ms instead of 400 ms; `engine.play()` calls `cancelWarmUp()` so a
  real request takes the cost rather than waiting behind a silent buffer; and the player now shows
  "Starting audio…" from the moment play is requested until the first frame, instead of showing
  nothing and looking hung.
- **What is NOT fixed:** the ~7 seconds still happens once per session if you are faster than it.
  It is a platform cost. Anyone reading this later should not re-diagnose it as a file, protocol or
  tag problem — it has been ruled out directly.

---

## BUG-010 — First play of a session stalled ~8.6s before any audio

- **Status:** RESOLVED
- **Phase:** 2 (user-reported: "buffering slow asf")
- **Symptom:** The first track played after launch produced no sound and no progress for roughly
  8.6–9.5 seconds. Every subsequent play started in ~400ms.
- **Root cause:** One-time initialisation of the webview's audio output pipeline, paid on the first
  element that actually renders sound. It is not file I/O and not the network.
- **How the cause was pinned down:** warming the network path first (`fetch` with a range, 56ms)
  left the first audio play at 8620ms, while the second play of a different file was 402ms. Playing
  0.25s of silence first brought the first real track down to 345ms. That isolates it to audio
  output init rather than anything in `noctra-audio://`.
- **Fix:** `engine.warmUpOutput()` plays a short runtime-generated silent WAV at app start, behind
  a `try/catch` so a blocked autoplay policy degrades to "first play is slow" rather than failing.
  Measured through the real UI: **9497ms → 802ms**.
- **Two wrong turns worth recording, because both looked like clean results:**
  1. I first concluded `preload="auto"` caused a 90s preroll, because in a batched test the slow
     run happened to be the first one in the page. Re-running showed `auto`/`metadata`/`none` all
     slow when first and all fast after — the variable was order, not `preload`. `preload` was left
     at `metadata` on general principle, not as the fix.
  2. Then I suspected the explicit `el.load()` call, and again the pattern was first-vs-later.
  The lesson: with a per-session warm-up cost present, any A/B test that runs variants sequentially
  in one page will attribute the warm-up to whichever variant ran first. Randomise or reload between
  variants.

---

## BUG-011 — Desktop mini-player window does not appear

- **Status:** RESOLVED
- **Phase:** 2c
- **Symptom:** `toggle_mini` returned `Ok(true)`, yet no OS window existed. A full Win32
  `EnumWindows` sweep of the process showed only the main `Tauri Window`, and the webview had no CDP
  page target for `mini.html`.
- **Two real bugs found and fixed on the way here:**
  1. **Deadlock.** A synchronous `#[tauri::command]` runs on the main thread, so calling
     `run_on_main_thread` from one queues work onto the loop the command is itself blocking. Fixed
     by making the command `async`.
  2. **Swallowed error.** The closure ended in `if let Ok(w) = built { … }`, so a failed `build()`
     still returned `Ok(true)`.
- **Root cause:** `WebviewWindowBuilder::build()` on Windows returns `Ok` and registers the label,
  but produces **no platform window at all** when the app's config-declared window sets
  `additionalBrowserArgs`. The extra window gets a WebView2 environment whose browser args differ
  from the main window's, so creation never completes. Measured directly: `hwnd()` returned
  *"the underlying handle is not available"* and `outer_position()`/`outer_size()` returned
  *"failed to receive message from webview"*.
- **How it was isolated:** a temporary probe created windows across the whole option space —
  transparent/not, decorations on/off, from an async command, from `run_on_main_thread`, and from
  `setup()` on the real main thread. **Every variant failed identically**, which ruled out the
  window options and the threading and pointed at the environment. It also matches the upstream
  report [tauri-apps/tauri#13092](https://github.com/tauri-apps/tauri/issues/13092), whose
  maintainer recommends declaring the window in config instead.
- **Fix:** the mini window is declared in `tauri.conf.json` with `visible: false` and the same
  `additionalBrowserArgs` as the main window. `toggle_mini` now only shows and hides it.
- **Verified:** Win32 enumeration shows `Noctra Mini | Tauri Window | 376x339` hidden at startup;
  `mini.html` appears as a real CDP target; toggling flips `visible=false → true → false` correctly;
  and the card receives live metadata, real embedded artwork, the accent colour and 59 synced lyric
  lines.
- **Trade-off:** the webview exists from launch rather than on demand, so it holds some memory even
  when the card is closed. This is the maintainer-recommended shape and is what makes the feature
  work at all.
- **Note on verification:** `PrintWindow` cannot capture a transparent window, so a near-empty PNG
  from the capture script is not by itself evidence of a blank card.

---

## BUG-012 — Intermittent "playback error" from the real library

- **Status:** NOT REPRODUCIBLE (release pass) — kept open in spirit, with the instrument that would catch it
- **Release-pass sweep:** `scripts/final-playback-probe.js` plays the first ten real library tracks in
  sequence and reads `deck.media.error` plus `player.error` after each. **0 errors, 0 timeouts,
  10/10 reached `readyState` 4.** Ten tracks is not three hundred, so this is not proof the defect is
  gone; it is proof the failure is not common, and the probe now exists to re-run in a minute whenever
  the symptom is reported again — which was the actual gap: the error string had never been captured.
- **Phase:** 4 (reported by user after the multi-folder library landed)
- **Symptom:** Playback sometimes fails with the error message shown in the UI. Not every track,
  not every time — no reproduction rate established yet.
- **Not yet diagnosed.** The error string the UI shows is the useful artefact and has not been
  captured yet. `describeError()` in the engine maps `MediaError.code`, so the exact wording will
  narrow it immediately: code 4 means the source was rejected, code 3 means decoding failed
  mid-stream, code 2 means the read itself errored.
- **First thing to do:** reproduce it and read `player.error`, not just the screenshot.

## BUG-013 — Buffering ~30s on real library tracks

- **Status:** CLOSED — every listed suspicion was already fixed, and the symptom no longer measures
- **Closure (release pass):** cold first-play on a real library track is **634ms to the first
  movement of the clock**, and the worst of ten consecutive tracks was also 634ms — the distribution
  is flat, not a tail. `scripts/final-playback-probe.js` measures to `currentTime > 0.05`, not to
  `canplay`, so a parsed header with a stalled body cannot hide behind it.
- **The four suspicions listed below were checked against the code, not remembered, and all four are
  already handled:** cover art now carries `cache-control: public, max-age=31536000, immutable`
  (`audio_protocol.rs`, deliberately images-only), and `artwork_path` is normalised to forward slashes
  on the way out (`scan.rs`). The 30s report predates both, which is the most likely explanation for
  the gap between it and this measurement. The three-competing-reads suspicion was not tested
  separately; the end-to-end number is what matters and it is no longer 30 seconds.
- **Phase:** 4
- **Symptom:** User reports buffering of roughly 30 seconds. This is far worse than the 802ms
  first-play figure recorded in BUG-010, so that fix is either incomplete or something else now
  dominates.
- **Important caveat on the earlier measurement:** the 802ms was measured on a demo track that had
  already been fetched many times during debugging, so it may have been warm in Chromium's cache.
  Real library tracks are cold. The number was probably not representative.
- **Suspicious, unverified:**
  - Every artwork request goes through `noctra-audio://` with **no `Cache-Control` header**, so
    nothing is cached. Cover images in this library reach 556KB.
  - On track change the app now fetches artwork for the blur, the palette, *and* prefetches the
    next track's palette — three large image reads competing with the audio range requests.
  - Each protocol request spawns a fresh OS thread and re-opens the file.
  - `scan.rs` normalises the track `path` to forward slashes but **not** `artwork_path`, which
    reaches the webview with backslashes (`…%5C<hash>.jpg`). It evidently loads, but it is an
    inconsistency worth removing while in here.
- **Measured, cold, real library (314 tracks), this session:**
  | Track | Metadata | First audio |
  |---|---|---|
  | Iktara | 8994ms | 9254ms |
  | bloodline | 663ms | 803ms |
  | Beggin' | 447ms | 532ms |
  | Laal Ishq | 594ms | 718ms |
  | Nadaan Parinde | 663ms | 758ms |
  | My Life Is | 796ms | 972ms |
- **So the typical cold start is ~0.5–1.0s, not 30s.** The 30s the user saw is not reproducing in
  these runs, which means it is either tied to a specific file, to first-play-after-launch, or to
  whatever BUG-012 actually is.
- **Iktara is a one-off, and it is consistent.** It took 8.8s and 9.0s on two separate plays, so it
  is not warm-up cost — it is that file. Ruled out: header size (Laal Ishq's is larger at 511KB vs
  303KB and plays in 0.6s) and file size (Laal Ishq is 46MB vs 28.5MB). Still unexplained.
- **Fixes applied while investigating, all valid regardless:**
  - `Cache-Control: immutable` on artwork responses. Covers were being re-fetched from disk on
    every look at a track.
  - Shared image decode cache (`services/artwork/imageCache.ts`) — the blur pass and the palette
    pass were each fetching and decoding the same cover separately.
  - `artwork_path` is now normalised to forward slashes like `path`; it was reaching the webview
    with backslashes.
- **Still needed to close this:** the exact error text from BUG-012, and a test of a track that has
  genuinely never been opened since the app started.
- **RESOLVED — see BUG-017.** The 8–10s the owner reports is the one-time audio subsystem start-up,
  not a per-file property. Re-measured this session across 308 FLAC / 4 MP3 / 2 M4A: steady state is
  445–670 ms and no file errored. The variance that made it look file-specific (one track at 8.7s
  once, 431 ms twice more in the same session) is whether that play happened to land on the cold
  window. The "Iktara is a consistent 9s outlier" note above did not reproduce and is probably dead.



---

## BUG-019 — Word-by-word lyrics rendered with no spaces

- **Status:** RESOLVED
- **Phase:** 6
- **Symptom:** the active line read as "जयहो,जयहो,शंकरा" — words butted together. Reported by the
  owner as "there are no spaces sometimes in between".
- **First attempt, wrong:** added `white-space: pre-wrap` to the word spans, then a
  `::after { content: " " }`. Both looked right in the source and both failed. Measured the gap
  between adjacent word boxes: **-1px and -0.3px**, i.e. no space at all.
- **Real cause:** a trailing space is trimmed at the edge of an `inline-block` box. Every word span
  ends at its own right edge, so anything appended there is discarded regardless of `white-space`.
- **Fix:** `margin-right: 0.24em` on `.word`, zeroed on `:last-child`. Re-measured: 9.1px and 9.2px.
- **Lesson:** `textContent` was never going to show this bug and did not; measuring the rendered
  boxes did.

---

## BUG-020 — Romanisation produced "bholenatha" and a stray nukta glyph

- **Status:** RESOLVED
- **Phase:** 6
- **Symptoms:** "भोलेनाथ" came out as "bholenatha" (should be "bholenath"), and "जुल्फ़ें" came out as
  "julaFen" with a raw combining mark loose in the string.
- **Causes:** two separate rules. Hindi drops the inherent schwa at the end of a word, and the code
  was emitting the pending vowel at every boundary including word-end. And the nukta (़) is its own
  codepoint modifying the preceding consonant, which the loop was falling through to the pass-through
  branch.
- **Fix:** discard a pending vowel at a word boundary; resolve the nukta by peeking forward while
  writing the consonant, with a table for क़ ख़ ग़ ज़ ड़ ढ़ फ़ य़ ल.
- **Verified:** "जुल्फ़ें है ज़ालिम और आँखें है आफ़त" → "julfen hai zalim aur aankhen hai aafat".

---

## BUG-021 — Artists grouped on feature lists

- **Status:** RESOLVED
- **Phase:** 5
- **Symptom:** Top Artists showed "A.R. Rahman, Anu…", "A.R. Rahman, Ariji…", "A.R. Rahman, Bad…" as
  separate artists, and Statistics reported 264 artists across 314 songs.
- **Cause:** grouping keyed on the raw `artist` tag, which in this library is a credits list.
- **Fix:** group on the lead name — split on comma, `&`, "feat" and "vs" and take the first token.
  Applied in Home and Statistics.

---

## BUG-022 — Fullscreen lyrics could show the previous song's timings

- **Status:** RESOLVED
- **Phase:** 6
- **Symptom:** the owner reported the view "automatically scrolling to some part of song that is not
  currently being sung".
- **Cause:** the store set `status = "loading"` on a track change but left the old `lyrics` array in
  place, so the active-line index kept being computed against the previous song's timestamps while the
  new fetch was in flight.
- **Fix:** clear `lyrics` when a request starts. A cache hit is fast enough that the blank is
  imperceptible, and showing nothing is honest where showing the wrong thing is not.

---


## BUG-018 — Shuffle's "pin current track" logic corrupted the normal play order

- **Status:** RESOLVED
- **Phase:** 5
- **Symptom:** with shuffle off and repeat off, pressing Next on the last track of the library
  jumped to track 0 and kept going, instead of stopping.
- **Root cause:** `ensureOrder()` permutes on shuffle and then moves the current track to the front
  of the list so turning shuffle on mid-song does not jump. The pin step was written outside the
  `if (shuffle)` block, so it also ran on the identity order — turning `[…, 313]` into
  `[313, 0, 1, …]`. "Next" from 313 then meant position 1, which is track 0, and the end-of-run
  check never fired.
- **Fix:** pin only inside the shuffle branch.
- **How it was found:** by actually calling `next()` at the last index and reading the result, not
  by reading the code. The identity-order test (`1,2,3,4`) passed both before and after, because it
  never starts at the end — a test that only walks the middle of a list cannot catch an
  off-by-one-at-the-boundary bug like this.

---

## BUG-023 — Every accent-tinted glow and tint was silently discarded

- **Status:** RESOLVED
- **Phase:** 6
- **Symptom:** accent glows, tinted borders and the mini card's coloured wash rendered as flat
  nothing. `getComputedStyle(card).backgroundImage` came back `"none"` on a rule that declared two
  gradients. A long-standing contributor to the "buttons look malnourished / glass looks cheap"
  feedback.
- **Root cause:** 27 sites wrote `rgba(var(--accent-rgb), 0.5)` where `--accent-rgb` holds three
  **space**-separated channels (`184 148 108`). Substitution yields
  `rgba(184 148 108, 0.5)`, which is invalid CSS — space-separated channels require `/ alpha`.
  Because `var()` defers validation to computed-value time, the declaration parses happily and then
  is dropped at use, so nothing ever warned.
- **Proof, measured in the live webview rather than reasoned:** setting
  `style.background-color` to `rgba(184 148 108, 0.5)` round-trips to `''` (rejected), while
  `rgb(184 148 108 / 0.5)` round-trips to `rgba(184, 148, 108, 0.5)` (accepted).
- **Fix:** rewrote every site to `rgb(var(--x-rgb) / a)`. Applied across `app.css`, `controls.css`
  and 8 components/views. Verified the mini card's gradient now computes to a real two-layer
  gradient instead of `none`.
- **Lesson:** a `var()` inside a colour function hides a syntax error until render. Confirm a
  visual fix by reading the *computed* style, not by checking that the CSS parsed.

---

## BUG-024 — Lyrics reel tracked the right line but never scrolled to it

- **Status:** RESOLVED
- **Phase:** 6
- **Symptom:** in fullscreen lyrics the active line was correctly identified (right index,
  `blur(0px)`, opacity 1) yet sat 700–2200px outside the visible viewport, so the panel looked like
  it had "scrolled to a part that is not being sung".
- **Three separate causes, each found by measuring rather than reasoning:**
  1. A clearing effect ran `lineEls.length = 0` after render, wiping the refs `bind:this` had just
     assigned, so the centring effect read `undefined` and returned early.
  2. The parallel `bind:this` array drifted out of sync with the keyed `{#each}` across track
     changes, so it measured an element that was no longer the active one. Fixed by querying the
     rendered DOM (`.line` at the active index) instead of keeping a shadow array.
  3. **The real one:** `el.offsetTop` is relative to the nearest **positioned** ancestor, which here
     is a container above the scroll viewport, so every measurement was out by almost exactly one
     viewport height. Symptom was a suspiciously constant `centreErr ≈ -720` against a
     `clientHeight` of 720.
- **Fix:** position is measured as `el.rect.top - reel.rect.top`. Both elements carry the same
  `translateY`, so the transform cancels and the value is independent of the offset parent. The
  offset is then clamped to the reel's real travel range, and re-measured on the next animation
  frame because the active line is set larger than its neighbours and the list is still growing.
  `.lyrics` also stopped centring its content, which had put an unstated offset under the maths.
- **Verified:** `centreErr` went from −2200 / `inView: false` to within ~70px of centre with
  `inView: true` across successive line changes; click-to-seek still lands within 1s of the line's
  timestamp.

---

## BUG-025 — Lyrics were only ever fetched while the fullscreen view was mounted

- **Status:** RESOLVED
- **Phase:** 6
- **Symptom:** the mini card always read "No lyrics for this track" even on a track with lyrics,
  and `lyricsStore.status` stayed `"idle"` through 18s of playback.
- **Root cause:** the only call to `lyricsStore.load()` lived in an `$effect` inside
  `src/views/Lyrics.svelte`. Nothing else triggered a fetch, so unless that one view happened to be
  open the store stayed empty — for the card, Now Playing and everything else.
- **Fix:** moved the track-change trigger to `App.svelte`, which is mounted for the whole session,
  and left the view as a pure reader. The request stays fire-and-forget so playback never waits on
  it, and the existing `seq` guard still discards a late answer for the previous track.
- **Verified:** a real track change drives `status` to `ready` with 59 lines, and the card receives
  them over the bridge without the fullscreen view ever being opened.

---

## BUG-026 — Taskbar thumbnail buttons drew a ring around every glyph

- **Status:** RESOLVED
- **Phase:** taskbar
- **Symptom:** the shell's hover-preview row looked like four heavy badged chips instead of the bare
  glyphs in the reference, and the favourite button read as "reversed" — liked and unliked looked
  the same.
- **Root cause:** `inside()` returned `ring(x, y) || glyph`, painting a thick circle at radius
  12.1–13.7 around every shape. The glyphs had been authored to sit *inside* that ring, so they were
  small; at the 16px the shell actually renders, the outline heart's band was nearly as thick as the
  whole shape, making it indistinguishable from the filled one. That is the "reversed" report — the
  toggle logic and both heart paths were correct, the rendering just made them identical.
- **How it was confirmed:** the rasteriser was ported to Node and the six glyphs rendered to PNG at
  both 1:1 and the shell's real 16px. That showed the ring, and showed outline vs filled heart
  becoming clearly distinct once it was removed — without needing a rebuild or the shell's flyout.
- **Fix:** dropped the ring and scaled the shapes 1.75x about the icon centre so they fill the box
  the way the reference glyphs do. 2.1x was also rendered and rejected — the filled heart bled into
  the cell edges.
- **Related fix:** `install_buttons` also runs on the `TaskbarCreated` broadcast when Explorer
  rebuilds its taskbar, and it was resetting play/pause and favourite to their defaults. Both glyphs
  are now stored in an `AtomicUsize` pair and re-applied on rebuild.
- **Not verified live:** the shell's hover flyout does not open under synthetic input, so the row was
  confirmed by rendering the identical maths offline, not by screenshotting the real buttons.

---

## BUG-027 — Player bar: transport sat left of centre and every button drew a circle on hover

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** two things in the bottom player bar. The shuffle/prev/play/next/repeat cluster sat
  well left of the window's middle, and hovering any of them produced a filled circle behind the
  glyph. Turning shuffle or repeat on also drew an accent ring around it. This is the same "circle
  over every button" objection raised twice before, reappearing through two paths that had not been
  checked.
- **Root causes:**
  1. `.centre` is a flex column with `align-items: center`, and the transport row inside it is
     `display: flex` with no `justify-content`. The row stretched to fill the 920px centre column, so
     its buttons packed against that column's left edge. Measured: cluster centre 600 against a
     window centre of 960.
  2. `.orb-bare:hover` set `background-color: rgba(255,255,255,0.1)` on an element with
     `border-radius: 50%` — a circle by construction.
  3. `.orb-bare.orb-on` inherited `.orb-on`'s `border-color` and `background-color`, which are meant
     for a glass orb and become a ring the moment the button is borderless.
- **Fix:** `justify-content: center` on the transport row; hover now carries the accent glow and a
  1.14 scale with no fill; a dedicated `.orb-bare.orb-on` rule drops the ring and tint and instead
  puts a small dot under the glyph, so the on-state is not communicated by colour alone.
- **Verified:** cluster centre now measures exactly 960 against a 1920px window; computed
  `border-color` and `background-color` on both the plain and active bare orbs are
  `rgba(0, 0, 0, 0)`; screenshot confirms a bare-glyph row matching the reference.

---

## BUG-028 — Word-by-word highlight drifted behind the singing

- **Status:** RESOLVED
- **Phase:** 6
- **Symptom:** the word highlight lagged, getting worse toward the end of each line.
- **Root cause:** `interpolateWords` spread the words across the **entire** gap between a line's
  timestamp and the next line's. That gap is not all singing — its tail is the breath before the
  next line — so every word was placed progressively later than it is actually sung. The final word
  was then special-cased to end exactly at the next line's timestamp, which pinned it across the
  whole remaining gap.
- **Fix:** the estimated vocal span is now 78% of the gap (`VOCAL_FILL`), capped at 6.5s so an
  instrumental break cannot stretch one line's words over twenty seconds, and the last-word
  special case is gone so every word gets a proportional slot.
- **Verified numerically against real library lyrics:** the last word of a line now starts at
  55–67% into the gap instead of ~100%, vocal span is 78% of the gap, word starts stay monotonic,
  and no word extends past the following line's timestamp.

---

## BUG-029 — Fullscreen lyrics blur was far too heavy on unsung lines

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** every line except the one being sung went soft enough to be a struggle to read.
- **Root cause:** a tuning overcorrection. While matching the reference's depth-of-field, `depth()`
  had been set to `blur = min(12, 2.6 + d * 2.3)`, which puts the immediate neighbours at 4.9px and
  anything four lines away at the 12px cap. Past roughly 4px a lyric line stops reading as depth of
  field and reads as a broken panel.
- **Fix:** `blur = min(4.5, 0.9 + d * 0.75)`, with the opacity floor lifted from 0.30 to 0.42 and
  the shrink softened. Neighbours are now merely soft rather than illegible, which is what the
  reference actually does.
- **Verified:** measured computed styles around the active line are 0 → 1.65 → 2.4 → 3.15 → 3.9 →
  4.5px, and a screenshot confirms the surrounding lines stay readable while the active line is
  crisp and centred.

---

## BUG-030 — Escape closed the lyrics panel and also ejected fullscreen

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** pressing Escape to dismiss the new in-place lyrics panel also dropped the user out of
  fullscreen lyrics entirely — two actions from one keypress.
- **Root cause:** both handlers listen on `window`. `registerPlaybackShortcuts()` runs at app mount,
  so its listener is registered first and fires first; the panel's own `stopImmediatePropagation()`
  never got a chance to run before the global one.
- **Fix:** the global Escape case now returns early when a `[role="dialog"]` is on screen. The check
  has to live in the global handler — a later-registered listener cannot preempt an earlier one on the
  same target.
- **Verified:** an open → close-by-button → open → close-by-Escape cycle leaves the panel dismissed
  with `ui.view` still `"lyrics"`.

---

## BUG-031 — A large rounded rectangle appeared behind the transport on hover

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** moving the pointer anywhere near the play/pause cluster painted a big plate behind
  the whole group, spanning most of the bar's centre column.
- **Root cause:** a class-name collision, not a style on the component. `controls.css` is a global
  sheet and defines `.row:hover { background-color: var(--card-hover) }` for list rows.
  `PlayerControls.svelte` happened to name its own wrapper `class="row"`, and because Svelte only
  scopes a component's *own* style block, the global rule reached in and styled it.
- **Fix:** renamed the wrapper to `.transport`. Every remaining `class="row"` in the app is a genuine
  list row that wants that hover, so the global rule is now correct everywhere it applies.
- **Lesson:** a global utility sheet's generic class names (`row`, `card`, `item`) will collide with
  component-local names. Check for a global rule before debugging a component's own CSS.

---

## BUG-032 — Taskbar favourite heart rendered as a malformed, apparently inverted glyph

- **Status:** RESOLVED
- **Phase:** taskbar
- **Symptom:** the ♡ in the thumbnail toolbar looked upside down, and liked/unliked looked like two
  different shapes rather than one toggle.
- **Root cause:** not a bitmap row-order flip, despite that being the obvious suspect. The outline was
  built by subtracting a scaled copy of the implicit heart `(u²+v²−1)³ − u²v³ ≤ 0` from itself. A
  uniform scale is not an offset curve, so the band width tracked local curvature. Measured in design
  space: the top row came out 14px of solid fill while the rows below it were 2–4px — a heavy cap with
  a near-empty body, which reads as an inverted shape.
- **Fix:** replaced the implicit curve with a 96-point parametric heart polygon. The filled variant is
  point-in-polygon and the outline is distance-to-edge against the same polygon, so the stroke is even
  regardless of curvature and both variants share one silhouette. A bounding-box reject skips the ~87%
  of pixels that cannot be on the outline, keeping the one-time rasterise cheap.
- **Verified:** row profile of the new shape is 2 runs at the top (the lobe notch), widest at
  y=11–14, tapering to a point by y=23 — correct heart geometry, not an inverted one. Rendered to PNG
  at icon size and at 4x to confirm the band is even. The shell's hover flyout cannot be opened under
  synthetic input, so the real row still needs an eyeball.

---

## BUG-033 — Album artwork was cropped at the sides

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** the fullscreen cover rendered as a tall rectangle with the left and right edges cut
  off, rather than the full square sleeve in the reference shots. Reported repeatedly.
- **Root cause:** `AlbumArt`'s wrapper had `width: var(--size); height: var(--size); max-width: 100%`.
  When the parent column was narrower than `--size`, the width clamped down but the height did not, so
  the box became a portrait rectangle — and `object-fit: cover` then cropped the sides of a square
  image to fill it.
- **Fix:** `aspect-ratio: 1` with `height` removed, so a non-square box is geometrically impossible.
- **Verified:** measured the live box at 464x464 from a 1200x1200 source, `artIsSquare: true`, and the
  full sleeve is visible in the capture.

---

## BUG-034 — Word-by-word highlight felt evenly timed and lagged

- **Status:** RESOLVED
- **Phase:** 6
- **Symptom:** every word appeared to get the same duration regardless of how long it is actually
  held, and short lines crawled.
- **Root cause:** the estimate weighted words by raw character count and then stretched the result to
  fill the whole gap to the next line. Two consequences: a two-word line's words each got an absurdly
  long slot, and character count is a poor proxy for sung duration.
- **Constraint, re-verified:** no public lyrics API supplies word timing. LRCLIB was probed again
  across five well-known tracks returned by `/api/search` — every result is line-level, zero inline
  `<mm:ss.mmm>` word stamps. The spec forbids scraping, so this stays an estimate and the UI says so.
- **Fix:** model it as syllables at a fixed singing rate instead of stretching to fill.
  `syllableCost` counts vowel groups for Latin scripts (dropping a silent trailing "e") and falls back
  to code-point/2 elsewhere, so Devanagari and Japanese are not forced through English phonotactics.
  Each word gets `cost x 235ms`; the line only compresses if that overruns the gap, otherwise the tail
  is left as a rest. The final word gets 1.45x, since a line's last syllable is normally sustained.
- **Verified:** a two-word line in a 4s gap now spans ~576ms instead of 4000ms; a three-word long line
  compresses to fit the same 4s; costs land as expected (function words 1, "extraordinary" 5).

---

## BUG-035 — The artwork volume rail rendered as a red pill, not clear glass

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** the vertical slider on the artwork looked like an opaque coloured capsule, the opposite
  of the liquid-glass reference.
- **Root cause:** self-inflicted. The rail used `backdrop-filter: var(--glass-filter)`, and D-060 had
  just raised that token's `saturate()` to 2.15. Heavy saturation is right for a panel over the
  already-normalised backdrop, but over a vivid cover it doubles the colour through a small element.
- **Fix:** added `--glass-filter-clear` (blur 26, saturate 1.15) for glass that sits directly on the
  artwork, and applied it to the rail and the glass slider track. The fill also dropped from
  near-opaque white to a translucent frosted gradient, so the level reads by brightness rather than by
  coverage.

---

## BUG-036 — The active lyric line was the least readable text on the lyrics view

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** every *inactive* line was bright and legible while the line actually being sung read as
  a dark outline. The one thing the listener is looking at was the hardest thing on screen.
- **Root cause:** two, stacked. (1) The word-by-word highlight had been replaced by a gradient
  clipped to the letterforms with `color: transparent`, but `.line` still carried a `text-shadow`,
  which is inherited — and a transparent fill suppresses the glyph paint, not the shadow. The result
  was a solid black copy of the whole line drawn directly behind the clipped gradient, eating it.
  (2) The unsung remainder of the line was set to `rgba(255,255,255,0.34)`, which is *dimmer than the
  inactive lines below it*, so the hierarchy was inverted even before the shadow.
- **Fix:** `text-shadow: none` on the clipped span, with the line's shadow moved to a
  `drop-shadow` filter (a filter only sees the pixels the clip actually paints) built into `depth()`
  so the inline `filter` could not override it. The unsung portion went to 0.5 — still ~9:1 against
  the scrim, but clearly behind the sung part so the fill reads as motion. The neighbour falloff also
  steepened from 0.07 to 0.13 per line, which had left adjacent lines at 0.83 against the active
  line's 1.0.
- **Note:** this is the second time a `color: transparent` + `background-clip: text` treatment has
  been defeated by an inherited `text-shadow`. Any future clipped-gradient text must kill the shadow
  on the clipped element specifically.

---

## BUG-037 — Credit labels over the artwork were invisible on bright sleeves

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** measured at **1.00:1** on the Hawayein sleeve — the artist and album captions at the
  top corners of the fullscreen artwork were entirely gone.
- **Root cause:** `data-art-light` was supposed to cover this, but it is driven by one mean luminance
  for the whole cover, and the failure is local: that sleeve is dark where the transport sits and
  blown out exactly where the captions sit. A global ink switch cannot express that. The attribute
  also only styled `.orb-bare`, never `.corner`, so even when it fired the captions were untouched.
- **Fix:** a directional scrim across the top and bottom bands of the artwork — geometric rather than
  measured, so it holds on any cover — with the captions and controls lifted above it by z-index. The
  middle of the sleeve is left completely clear so the artwork still reads as the artwork. Captions
  now measure 5.46:1 and the whole view passes.

---

## BUG-038 — Local `.lrc` sidecars were never read, and the source label lied

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** the lyrics panel's source readout offers "Local .lrc file", and `Lyrics["source"]`
  includes both `"local file"` and `"embedded tag"`, but the lookup chain was only cache → LRCLIB.
  Sixteen `.lrc` files sitting in the user's Music folder were ignored, and two of the four declared
  sources were unreachable code.
- **Root cause:** the chain was written against the spec's stated order without the local stage ever
  being implemented. The type and the UI were added on the assumption it existed.
- **Fix:** added a read-only `read_sidecar_lyrics` Rust command and made it the first stage, ahead of
  the cache and ahead of `force`. Verified end to end: the same track resolves to `local file` / 48
  lines with a path and `lrclib` / 51 lines without one.
- **Why it matters beyond the bug:** this is now the only route by which real per-word timings can
  reach the player. Every public lyrics API returns line-level data, so the enhanced `<start,end>`
  word tags the parser already handles can only ever arrive from a file the user placed there.
- **Trap found while fixing:** the sidecar name must be built as a string, not with
  `Path::with_extension`. That method keys off the *last* dot in the file name, so
  `04. Tame Impala - Loser.flac` would have looked for `04.lrc` and silently missed every track whose
  filename carries a numbered prefix.

---

## BUG-039 — Every lyric line arrived blurred for the first seconds of each song

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** opening the fullscreen lyrics at position 0:00 showed the entire column out of focus
  and dim, including the line about to be sung. It looked like the depth-of-field effect was broken
  rather than between lines.
- **Root cause:** `depth()` computed each line's distance as `index < 0 ? 99 : |i - index|`. Before
  the first timestamp there is no active line, so every line was placed 99 steps away and clamped to
  the maximum blur and the dim floor. The anchor was "nothing", which the falloff maths reads as
  "everything is far from it".
- **Fix:** anchor on line 0 when nothing is active yet. The upcoming line gets the sharp, full-opacity
  treatment and the rest recede from it. It deliberately does not gain the `.active` class, so it is
  in focus without falsely claiming to be the line being sung.

---

## BUG-040 — `setSize` on the mini window was silently refused by the capability list

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** the pill rendered correctly but inside a card-sized window, so it floated in about
  200px of dead transparent space. Nothing errored anywhere.
- **Root cause:** Tauri capability permissions. `window.set_size` is not part of `core:default`, and
  `capabilities/default.json` grants window permissions one at a time — `allow-start-dragging`,
  `allow-set-title`, `allow-close`, `allow-set-focus`. `allow-set-size` was simply absent, so the
  IPC call was rejected at the boundary.
- **Fix:** added `core:window:allow-set-size` to the capability list.
- **The part worth remembering:** the effect wrapped the call in `.catch(() => {})` because a resize
  failing should never break the widget, which meant the real error — `window.set_size not allowed.
  Permissions associated with this key: core:window:allow-set-size` — was thrown away. The DOM looked
  completely healthy: `.pill` existed, the vinyl was spinning, the progress bar was moving. Only
  measuring the actual OS window rectangle against the requested size exposed it. When a permission
  error is swallowed, surface it once in the console rather than discarding it.

---

## BUG-041 — The mini player could freeze on screen with the bridge switched off

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** two ways to reach a card that was visible but dead. Changing the mini-player style in
  Settings did nothing; and after pressing the card's own × the window stayed on screen showing the
  last frame it had, with the title, progress and lyrics never updating again.
- **Root cause:** `ui.miniOpen` is a frontend *mirror* of a Windows window state that Rust already
  knows authoritatively — `toggle_mini` asks `window.is_visible()` rather than trusting a flag. Two
  paths let the mirror drift from reality:
  1. Reloading the main window (any Vite full reload, including the ones a settings-store edit
     triggers) resets `ui.miniOpen` to its `false` initialiser, while the separate mini document is
     never reloaded and stays visible.
  2. The `close` command handler set `ui.miniOpen = false` and did nothing else. Nothing hid the
     window, so the mirror said closed while the card was still up.
  Every push in the bridge is gated on `if (!ui.miniOpen) return`, so a mirror reading false silently
  stops feeding a card that is still on screen.
- **Fix:** added `mini_visible` and `hide_mini` commands. `startMainBridge` now re-derives the mirror
  from the real window before the timers start reading it, and `close` hides the window instead of
  only clearing the flag. `hide_mini` is explicit rather than reusing `toggle_mini`, because a toggle
  whose result depends on which way the window happens to be is the same class of guess that caused
  this.
- **General lesson:** a cached mirror of OS state has to be re-derived on startup, not assumed from
  its initialiser. The gate that reads the mirror and the thing the mirror describes live in different
  processes and have different lifetimes.

---

## BUG-042 — The glass rim rendered 6× brighter than the reference it was copied from

- **Status:** RESOLVED
- **Phase:** polish (liquid glass pass, D-070)
- **Symptom:** after the first pass at the Echo Music glass, the contrast audit went from 3 failures to
  3 failures but the *identity* of them changed: two `span.chip` rows that had measured 8.9–11.7 dropped
  to **1.43**. Nothing about the chips had been touched.
- **Root cause:** the pane's edge. `--glass-specular: rgba(255,255,255,0.62)` combined with
  `--glass-rim: rgba(255,255,255,0.26)` at the same 1.5px inset position *stack*, and the pair composited
  to a **197-luminance hairline** over a 49-luminance interior — a lift of +148. The reference's edge
  lifts +24 on the sides and +40 along the top. Anything that scrolled past the floating bar was being
  measured, and lit, by that hairline.
- **Fix:** rim 0.11, top arc 0.07 (they stack to ~0.17), and the same ratio applied to `.glass-strong`,
  `.glass-panel` and `.glass-pill`, which each carried their own hardcoded copy of the over-bright pair.
  Re-measured: side +22, top +37, interior +25 against the reference's +24 / +40 / +27. The chips went
  back to 4.5+.
- **General lesson:** two `inset` box-shadows at the same offset are not alternatives, they are a
  composite — `1 - (1-a)(1-b)`. Tuning "the rim" and "the specular" independently is how it blew past
  the target twice. Also: an audit that reports a *different* element failing after an unrelated change
  is not noise, it is the shared token reaching somewhere you were not looking.

---

## BUG-043 — Content clearance was silently overridden by component-scoped styles

- **Status:** RESOLVED
- **Phase:** polish (liquid glass pass, D-070)
- **Symptom:** the rail floated correctly but sat *on top of* the Settings text, cutting sentences in
  half. The rule that was supposed to keep content clear of it was in `app.css` and simply did nothing.
- **Root cause:** specificity tie. The clearance rule was written as `.shell .content > *` (0,2,0) and
  Svelte compiles a component's `.page` selector to `.page.svelte-xyz` (0,2,0) as well. Equal
  specificity means source order decides, and component styles are injected after the global sheet, so
  every view's own `padding` shorthand won.
- **Fix:** `.shell .frame .content > *` (0,3,0). One rule, no per-view edits, and the clearance for both
  floating panes stays defined next to the panes.
- **General lesson:** a global override aimed at scoped component styles needs a third class or it is a
  coin flip on load order. Confirmed by reading the computed value back over CDP (`paddingLeft: 292px`)
  rather than by looking at the screenshot again.

---

## BUG-044 — The now-playing row is accent text on an accent-derived backdrop

- **Status:** RESOLVED — fixed during the vibrancy pass, the entry was simply never updated
- **What closed it:** `controls.css` `.row.active .row-title` now uses `--accent-text`, the floored
  variant, keeping the hue as the now-playing signal while lifting the measured ratio off the sleeve
  backdrop. The interim note below suggested exactly this, and it is the treatment the sidebar had
  already had. The release-pass audit re-measured every view: **0 failures across Home, Library,
  Playlists, Favorites, Statistics and Settings**.
- **Phase:** pre-existing, surfaced by the D-070 audit
- **Symptom:** `.row.active .row-title` measures **2.27:1** in Library and 3.30:1 on Home, against a
  4.5:1 floor. It is the only remaining contrast failure in the app, and it is worst on exactly the row
  the listener is most likely to be reading.
- **Root cause:** `src/controls.css:311` sets `color: var(--accent)` on the active row. The accent is
  extracted from the cover (D-034) and the backdrop is a wash of the same cover, so the two are
  deliberately similar hues — the row's own theme guarantees the collision. The `.sub` line beside it
  drops to 1.94 for the same reason once the row is over a lighter panel.
- **Not fixed here because:** it is not part of the liquid glass request, and the fix is a decision
  rather than a value — either the active row stops using accent ink, or it gets a plate to sit the
  accent on, and D-035/D-070 have both ruled plates out for bare rows. Needs the owner's call.
- **Interim note:** the sidebar's active item had this exact failure at **1.25:1** and was fixed as part
  of D-070 by switching to ink brightness. The same treatment would likely resolve this one too.

---

## BUG-045 — The volume percentage readout in Settings sits just under the contrast floor

- **Status:** FIXED (release pass)
- **Fix:** the concern below was that clearing it meant a token bump, which would re-open the veil
  trade-off D-073 had just bracketed. It does not. `.num` in `Settings.svelte` was pinned to
  `--text-dim` locally, so it is now `var(--text)` locally — one selector on one number, with the
  global veil untouched. Settings audits clean afterwards.
- **Phase:** polish (D-073 audit)
- **Symptom:** `span.num` ("100%") measures **4.09:1** against a 4.5:1 floor. It is the only failure on
  the Settings view and the only one left anywhere besides BUG-044.
- **Cause:** small secondary text over a pane that D-073 made deliberately more transparent, so its
  backdrop is now whatever the cover wash happens to be rather than a fixed panel tone. It is marginal,
  not broken.
- **Not fixed here because:** it is one number on one control and the fix is a token bump that would
  re-open the veil trade-off D-073 had just bracketed. Note it, and revisit if the owner reports the
  percentage being hard to read.

---

## BUG-050 — "Delete cached lyrics" deleted nothing and reported success

- **Status:** FIXED (JS side live; Rust side needs a rebuild — see "Verification" below)
- **Phase:** found during the feature-pool audit, before any new phase started
- **Symptom:** the user deletes saved lyrics, the panel clears, the app says it worked. The cache file
  is still on disk, so the next lookup returns the same lyrics and the delete appears to do nothing.
- **Root cause — two independent faults compounding:**
  1. **The fingerprint had two different duration sources.** `App.svelte` loaded lyrics with
     `player.duration || player.current.duration`, i.e. the *decoded* duration once the element
     reported it, and `save_lyrics` cached under that. Both delete paths —
     `LyricsSettings.dropCache` and the `trackMenu` item — passed the *tag* duration.
     `fingerprint()` rounds with `Math.round()`, so a tag of `214` and a decoder reading `214.6`
     produce two different cache keys. The delete targeted a file that had never been written.
  2. **A missing file was reported as success.** `delete_lyrics` mapped
    `ErrorKind::NotFound` to `Ok(())`, and `deleteCache` returned a bare `true` for anything that
    did not throw. So "found nothing to remove" and "removed it" were the same answer, and the UI
    rendered the one that looked like success.
- **Why it survived so long:** fault 2 is what hides fault 1. With a missing file reported as
  success, the mismatch is unobservable from the interface — it only shows as lyrics that refuse to
  stay deleted, which reads as a caching bug rather than a delete bug.
- **Fix:**
  - `lyricsQuery(track)` in `services/lyrics/lyrics.ts` is now the only way a query is built, and it
    always uses the scanned tag duration. The tag value is the only one available for a track that is
    not playing, which the right-click menu can target, so it is the only value that can be the key.
    All four construction sites now call it: the `App.svelte` load effect, the `Find lyrics` button in
    `Lyrics.svelte` (a fourth site the original audit missed), `refetch`, and both delete paths.
  - `delete_lyrics` returns `"deleted"` or `"notCached"`, and `deleteCache` returns
    `DeleteOutcome = "deleted" | "notCached" | "error"`.
  - Outcomes are reported where the user can see them: the lyrics panel via `lyricsStore.report()`
    when the affected track is the current one, and the new `stores/notice.svelte.ts` surface when it
    is not, because a track that is not playing has no panel to speak through.
- **Accepted consequence:** entries cached before this fix are keyed on the decoded duration and
  become unreachable. They are not deleted, just orphaned, and the affected track re-fetches once and
  is re-cached under the correct key. Cache files, not user data.
- **Verification:** `svelte-check` 0 errors / 0 warnings; `cargo check` exit 0. The duration
  unification is verified live — no `player.duration ||` construction site remains and the probes
  still pass. **The deleted-vs-notCached half is NOT yet verified**, because the running dev instance
  is still the binary built at 16:22, which predates the Rust change. Against that stale binary the
  new JS reads `null` and would report `notCached` for a real deletion, so testing it now would
  produce a false failure rather than a result. Needs `npm run tauri dev` rebuilt; note R-6, a
  lingering hidden instance holds port 1420 and makes the restart fail for unrelated-looking reasons.

---

## BUG-051 — A second bare `:focus-visible` overrode the tokenised focus ring and re-shaped focused elements

- **Status:** FIXED
- **Phase:** polish / accessibility
- **Symptom:** invisible in normal pointer use, and wrong for anyone on a keyboard. Tabbing to a
  control drew `var(--accent)` at a 3px offset instead of `var(--focus-ring)` at 2px, and additionally
  applied `border-radius: 4px` to whatever had focus — so an element with no radius rule of its own
  visibly changed shape the moment it was tabbed to and changed back on blur.
- **Cause:** two bare `:focus-visible` rules in `app.css`. The tokenised one at line 294, introduced
  with a comment claiming "one focus ring for the whole app", and an older one at line 335 that
  predated it. Identical selector means identical specificity, so source order decided it and the
  later, older rule won. D-073 noticed the dead token and flagged it as someone else's in-flight work
  rather than changing it.
- **Fix:** removed the later rule, keeping the tokenised one. The `border-radius` was not a style
  preference but a side effect of applying a shape property inside a focus selector; a focus rule
  should only ever paint an outline.
- **Verification:** enumerated `document.styleSheets` in the live app rather than reasoning about the
  cascade — before, two bare `:focus-visible` rules existed and the second set `border-radius: 4px`;
  after HMR, exactly one remains and it reads
  `outline: 2px solid var(--focus-ring); outline-offset: 2px`.
- **Method note:** the first attempt to verify this used `el.focus()` and measured computed styles.
  That proved nothing, because programmatic focus does not generally match `:focus-visible` (it keys
  off the modality of the last interaction), so the reading came back as neither of the two candidate
  rules and looked like a third mystery rule. Cascade questions get answered from the stylesheet, not
  from a simulated focus.

---

## BUG-052 — The mini-player's volume control was an unstyled native input

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** the hover cover's vertical volume pill rendered as a short horizontal blue bar with a
  round native thumb — the browser default, not the glass control used everywhere else.
- **Root cause:** `Slider.svelte` has no `<style>` block at all. Its track, fill, thumb and the
  entire `.slider-v` vertical layout live in the global `controls.css`. `main.ts` imports that file;
  `mini.ts` imported only `app.css`. Every other component in the mini window carries its own scoped
  styles, so this was invisible until a component that leans on globals was used there.
- **Fix:** `mini.ts` now imports `controls.css`.
- **Worth remembering:** a component that renders correctly in one window and as a bare native
  control in another is almost always a shared-CSS import boundary, not a bug in the component. The
  failure is silent because the markup and the JS are both entirely correct.

---

## BUG-053 — Reloading the mini window left it permanently without lyrics

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** after the mini document reloaded, the card showed "No lyrics for this track" forever,
  even though the main window had the full set and was still playing. Switching tracks fixed it;
  nothing else did.
- **Root cause:** one-way push with a memo on the sending side. The main window tracks
  `lastLyrics` and only emits when the object changes. The card's document can restart independently
  — any Vite full reload, or the window being recreated — and when it does the card's copy is gone
  while the sender's memo still reads "already delivered". The state is correct on the sending side
  and empty on the receiving side, and there is no path from the receiver back to the sender.
- **Fix:** the card emits `mini-command: "sync"` on mount; the bridge drops the memo and pushes both
  the lyrics and a player snapshot. The general rule: when one window holds the only copy of state
  and another renders it, the renderer needs a way to ask.
- **Note:** this is the third mirror-desync bug in the bridge after BUG-041's two. All three share
  the same shape — cached state in one process that has no idea the other process restarted.

---

## BUG-054 — The taskbar thumbnail heart glyph rendered upside down

- **Status:** FIXED (render-verified; one human hover still needed to confirm on the real flyout)
- **Phase:** Windows integration polish
- **Symptom:** the ♡ button in the taskbar hover preview renders point-up. Reported twice: the first
  time it was diagnosed as a *distinctness* problem and "fixed" by D-050, which is why it came back.
- **Root cause:** `rasterize()` in `src-tauri/src/taskbar.rs` stored both bitmaps pre-flipped —
  `let dy = OUT - 1 - row` — under a comment asserting "Both bitmaps are stored bottom-up, which is
  what `CreateIcon` expects." The shell actually draws the first row of both bitmaps at the top, so
  the pre-emptive flip inverted every glyph.
- **Why it survived so long, and why the previous fix missed it:** four of the six glyphs (`Prev`,
  `Play`, `Pause`, `Next`) are symmetric about y=16, so a vertical flip leaves them pixel-identical.
  The heart is the only asymmetric shape in the set. The bug is therefore invisible everywhere except
  on the one glyph the user was reporting, which is also why D-050's port-to-Node check concluded the
  glyphs were "correct and optically centred" — it was checking shapes that cannot show the defect.
  The heart was later rewritten from the implicit curve to a polygon, which fixed a genuinely
  separate problem (uneven outline stroke width) and left the flip untouched.
- **Why the previous verification passed and this is the real lesson:** `scripts/heart-proto.cjs`,
  written for D-050, samples `inside()` directly and writes its output top-down. That validates the
  *geometry* — which was, and is, correct — but it never models `rasterize()`'s buffer row order,
  which is the only layer that was broken. The check could not have failed. Any future glyph change
  must be verified with `scripts/render-heart-glyph.cjs`, which reproduces the buffer ordering and
  therefore renders what the shell actually draws. The general form: a test that bypasses the suspect
  layer is not evidence, however careful the reasoning behind it.
- **Fix:** rows written in design order, no inversion, for both the colour bitmap and the AND mask, so
  the two stay consistent.
- **Verification:** `scripts/render-heart-glyph.cjs` ports the rasteriser to Node and emits the glyph
  as the shell reads it. Before the fix the filled heart rendered point-up; after it, both the filled
  and outline states render lobe-up with an even stroke and matching silhouettes. `cargo check` exit 0.
  **Not yet confirmed on the real flyout** — see the standing limitation that no synthetic hover
  (`SetCursorPos`, stepped `SendInput`, dwell) has ever made Windows 11 open the preview, so this
  needs one manual hover.
- **The row-order assertion is now measured, not assumed:** the render script still has to *pick* a
  convention to display under, so on its own it could only re-state the claim in `rasterize()`'s
  comment. `scripts/icon-row-order-probe.ps1` removes that gap. It builds a 32bpp icon through the same
  `CreateIcon(planes=1, bits=32)` call the shipped code uses, with buffer rows 0-15 red and rows
  48-63 blue, draws it via `DrawIconEx` into a negative-height (top-down) DIB section, and reads the
  pixels back. At 64, 48 and 32px the red band is always at output rows 0-15, so **buffer row 0 really
  does land at the top** and the pre-emptive flip was the whole bug. The build in
  `src-tauri/target/release/noctra.exe` (Sep 28 06:35) post-dates the source fix (Sep 26 21:23), so
  the shipped binary already contains it — a heart-still-inverted report after that timestamp would be
  a new bug, not this one.
- **Method note:** the first pass at this bug was pure geometric reasoning, which concluded the code
  was correct — and the reasoning was right about the maths and wrong about the conclusion, because
  the defect was not in the geometry. Rendering the pixels settled in one step what analysis could
  not. Also note the render script's own labels were initially inverted, which produced a correct
  image under a misleading name; the numbers (566 filled pixels in the top half vs 350 in the bottom)
  are what identified the truth.

---

## BUG-055 — Peer dimming dimmed the whole transport on any sleeve hover

**Status:** RESOLVED (introduced and caught in the same pass)

**Symptom:** Adding the reference's "one glyph glows, the row recedes" behaviour made all five
transport glyphs sit at 0.42 opacity whenever the pointer entered the artwork — the exact inverse of
the intended effect, and it made the fullscreen transport look permanently disabled.

**Cause:** The rule was written as `.dim-peers:hover > :not(:hover) { opacity: .42 }` and the class was
put on `.transport`, `.orbs` and `.cover-trans`. For `.orbs` and `.cover-trans` that is correct. For
the fullscreen transport it is not: `.transport` lives inside `.inart`, which is itself a direct child
of the hovered `.art-zone`, so the hover bubble that reveals the controls also satisfied the dimming
selector's own `:hover`.

**Fix:** The marker class became `cluster`, and the rule requires the cluster itself to be hovered.
Hovering a glyph hovers `.transport`, so the row dims; hovering anywhere else on the sleeve does not.

**Evidence:** Real CDP hover on the next glyph measured `Next track=1` against
`Shuffle/Previous/Play/Repeat=0.431` mid-transition; hovering the sleeve centre leaves all five at 1.

**Worth remembering:** a hover-revealed control group and a hover-reactive control group cannot share
an ancestor-hover selector. Any future peer effect has to name the cluster, not the container.

---

## BUG-056 — The lyrics cache silently destroyed word timings

- **Status:** RESOLVED
- **Phase:** word-level lyrics (Tier 1)
- **Symptom:** a track whose lyrics really are word-timed showed word highlighting on first play and
  line-level highlighting on every play after that, with no error and no visible cause.
- **Root cause:** `getLyrics` cached the provider's `syncedLyrics` string. For LRCLIB that field is always
  line-level, even on records where the same response's `lyricsfile` carries per-word timestamps — so the
  cache wrote down the worse half of the data and the read path had nothing to recover from.
- **Fix:** the cache is written through `toLrc()`, which emits enhanced per-word `<mm:ss.mmm,mm:ss.mmm>`
  tags, so a cached word result re-parses as word level. It stays a plain `.lrc` file a person can open.
- **Verified:** three word-timed cache files exist in `%APPDATA%\com.soutr.noctra\lyrics` with their tags
  intact, and selecting that track again returns `level: "word", source: "cache", wordLines: 38`.

---

## BUG-057 — Static lyrics were given fabricated timing and scrolled as if synced

- **Status:** RESOLVED
- **Phase:** word-level lyrics (Tier 1)
- **Symptom:** a track with only untimed lyrics still had a large white "active" line that advanced about
  once a second and filled left to right, exactly like a synced track.
- **Root cause:** the plain-lyrics branch built its lines with `time: i * 1000`. That number came from
  nowhere — it is a made-up timeline, the same category of invention as `lineDuration / numberOfWords`, and
  it is what the task's "show C without pretending it's word-synchronized" rule forbids.
- **Fix:** untimed results carry `level: "plain"` with every `time` at 0. The renderer takes a separate
  static branch: no active line, no fill, no jump targets, and no frame-rate clock.
- **Verified:** driving the view with a real LRCLIB plain payload (untimed words for 亜咲花 "SHINY DAYS")
  renders 43 `.static-line` elements, 0 `.line.active`, 0 `.text.sweep`, and the DOM is byte-identical
  1.2s later while the position clock advances.

---

## BUG-058 — LRCLIB's word timings were never read, and the docs said they did not exist

- **Status:** RESOLVED
- **Phase:** word-level lyrics (Tier 1)
- **Symptom:** word-level highlighting could only ever come from a local file.
- **Root cause:** the response type only declared `syncedLyrics` and `plainLyrics`. The API also returns
  `hasWordSync` and `lyricsfile`; because `syncedLyrics` is line-level even on word records, reading only
  that field made the word data invisible and appeared to confirm D-033/D-065's "no public API has word
  timing". Those entries are marked superseded.
- **Fix:** `services/lyrics/lyricsfile.ts` parses the YAML (no dependency added; units are read from the
  `start_ms`/`end_ms` field names), and the lookup prefers it whenever `hasWordSync` is set.
- **Verified:** 3 of 314 library tracks reach `level: "word"` from LRCLIB with real timestamps; durations
  in one line run 160/160/200/160/160/160/204/689ms, and 86–3616ms across a full record.

---

## BUG-059 — The desktop mini card could never show word sync

- **Status:** RESOLVED
- **Phase:** word-level lyrics (Tier 1)
- **Symptom:** with a word-timed file, the fullscreen view highlighted word by word while the mini player
  highlighted line by line.
- **Root cause:** `pushLyrics()` mapped lines to `{ time, text }`, dropping the `words` array, and the card
  had no word markup at all.
- **Fix:** the bridge sends `words` and the real `level`; `MiniApp.svelte` renders word spans on the active
  line and, for `level: "plain"`, an unblurred scrollable column instead of picking a fake active line.
- **Verified:** partially — the payload and component changes type-check and the main-window path is
  measured, but the card itself was not read on screen because the mini window was closed during testing
  (`ui.miniOpen === false` means no lyrics are pushed to it at all).

---

## BUG-060 — Over-strict track matching dropped lyrics for "Title (From Movie)" files

- **Status:** RESOLVED
- **Phase:** word-level lyrics (Tier 1)
- **Symptom:** during testing, 3 of 24 sampled library tracks returned "No lyrics found" that had
  previously returned lyrics.
- **Root cause:** the new `sameTrack()` guard compared normalised titles by substring. `Tum Ho (From
  "Rockstar")` normalises to `tum ho from rockstar` and a record titled `Tum Ho (Rockstar)` normalises to
  `tum ho rockstar` — neither contains the other, so a correct record was rejected as a different song.
  Applying the same guard to `/api/get` was the second half of it: the server already matched on title,
  artist, album and duration together.
- **Fix:** `norm()` now strips bracketed asides and connector words (`from`, `feat`, `mix`, `edit`, …), and
  the guard is applied only to the loose `/search` results where it earns its keep.
- **Verified:** "Tum Ho" is back to 40 line-timed results. "Laal Ishq" and "Sooraj Dooba Hain" turned out
  to be a *pre-existing* miss — their credits-heavy artist tags make LRCLIB's search return zero rows — so
  a title-only retry was added, and both now return timed lyrics rather than nothing.

---

---

## BUG-061 — A CSS custom property declared on the component it configures can never be overridden

- **Status:** RESOLVED
- **Phase:** polish (D-079)
- **Symptom:** the transport was rewired to read its sizes from `--pc-tap`, `--pc-play` and friends so
  Now Playing could scale them off the artwork. `--art` was 565px, and the play glyph still measured
  23px — the old literal. The ring row and the heart, which were styled directly, scaled correctly, so
  it looked like the transport specifically was being ignored.
- **Root cause:** the defaults were *declared on the element that consumes them*:
  `.transport { --pc-tap: 52px; ... }`. A declaration on an element always beats a value inherited
  from its parent, so `.inart { --pc-tap: var(--art-tap) }` was shadowed before it ever reached the
  buttons. Nothing about the selector, specificity or load order was wrong — the override was simply
  unreachable.
- **Fix:** defaults moved into each consumer as fallbacks — `--orb-size: var(--pc-tap, 52px)` — and
  `.transport` declares nothing. `.transport.compact` still declares its own set, which is correct
  because the mini-player is a leaf context with nothing above it trying to win.
- **General lesson:** when a component is meant to be *configured by its parent*, never declare the
  property on the component itself. Put the default at the use site as `var(--x, default)`. The
  giveaway is a variable that reads back as the wrong value on a child while the parent looks correct.

---

## BUG-062 — A glass plate and accent bloom painted on the play button alone, only while hovered

- **Status:** FIXED
- **Phase:** transport polish
- **Symptom:** the owner had asked repeatedly for bare glyphs with no circle, and for the row to dim
  around a hovered control instead of the hovered control gaining a shape. The four secondary
  transport buttons behaved correctly; the play/pause button still lit up with a circular glass
  plate, a white catch-light ring and a 48px accent bloom whenever the pointer crossed it.
- **Root cause — a cascade fall-through, not a rule that was written wrong.** `.orb-bare:hover`
  explicitly resets `background-color`, `border-color` and `box-shadow`, which is why the secondary
  glyphs never showed a plate. `.orb-primary:hover` set only `transform` and `text-shadow`. CSS does
  not reset properties a rule omits, so those three fell through to `.orb:hover:not(:disabled)`,
  which paints the full glass treatment. The primary button was one selector-list away from being
  correct, and the bug was invisible unless you hovered that specific control.
- **Compounding factor:** the `text-shadow` in the same rule was doing nothing. `text-shadow` does
  not apply to SVG geometry, so it read as "there is a deliberate glow here" to anyone reviewing the
  CSS while contributing no pixels at all.
- **Also fixed in passing:** with the disc gone the primary action had become the *smallest* glyph on
  the row — `--pc-play: 23px` against the skips' `24px`, `19px` against `20px` in the compact bar,
  and `art × 0.081` against `0.092` on both artwork surfaces. Play is now the largest on every
  surface, which is the minimum it needs to read as primary without a plate behind it.
- **Verification:** `scripts/probe-hover.mjs` drives a genuine `Input.dispatchMouseEvent` and reads
  what actually paints, because this defect only existed in a `:hover` state and cascade reasoning
  about a hover state is not evidence. `document.elementFromPoint` confirms the pointer really landed
  on the intended button before each reading — without that check an earlier run of this probe
  reported a false negative, since it re-read `.orb-bare` (the first match, Shuffle) rather than the
  element it had moved onto.
  - Hover Shuffle → Shuffle `opacity: 1`, all four siblings `0.42`, no `box-shadow` anywhere.
  - Hover Play → Play `opacity: 1`, all four siblings `0.42`, no `box-shadow` anywhere.
  - Painted glyph widths: bottom bar Play 24 vs skips 20; artwork row Play 47 vs skips 40.
- **Method note, for whoever checks a hover state next:** `getComputedStyle(el).width` on an SVG
  inside a scaled parent returns the untransformed value. Measuring painted size needs
  `getBoundingClientRect()`. Both mistakes in this session's transport work came from trusting a
  computed style that could not see the thing being asked about.

## BUG-063 — The mini-player bar swapped the heart glyph instead of fracturing it

- **Status:** RESOLVED
- **Phase:** mini/fullscreen parity
- **Symptom:** reported as "animation is not working in mini player as the same as on full screen (heart
  animation etc)".
- **What it was not:** the desktop card was the obvious suspect and it is fine. Measured in the running
  app's own document: the card's heart pops (`heart-pop-lg`, 1.28× → settle over 520ms) and fractures
  (`heart-break-left`/`-right` on the two clipped halves) correctly, the keyframes are present in that
  window, and nothing is gating them — `prefers-reduced-motion` false, `data-low-power` absent. Chasing the
  card would have "fixed" something that already worked.
- **Root cause:** three surfaces render the favourite, and only the bottom bar never grew the fracture.
  `MiniPlayer.svelte` had a `pop` state for the like direction and simply re-rendered the icon on
  un-like, while `Lyrics.svelte` and `MiniApp.svelte` both hold a `breaking` state and split the glyph
  into two `.heart-half` spans.
- **Fix:** the bar now keeps `BREAK_MS`/`breaking`/`heartGlyph` in step with the card and wraps the icon
  in the two halves. `.orb` is already `display: grid`, so `grid-area: 1/1` stacks them with no new
  layout CSS. The bar deliberately keeps its **red** liked state via `.orb-love` rather than adopting
  `.heart-lit`'s white — the note on that rule says a hue change is the only thing that can carry state
  at 18px, so parity here is gesture and timing, not colour.
- **Verified:** `svelte-check` 0/0. Live over CDP on the running bar: at rest the halves sit at
  `inset(0 49% 0 0)` / `inset(0 0 0 49%)`; after an un-like the button carries `heart-breaking` with
  `animation-name: heart-break-left|heart-break-right`, jagged `polygon(...)` clips and rotating
  transforms; the class clears when the 1250ms completes. Favourite state restored afterwards.
- **Standing rule this comes from:** the mini player must match the fullscreen view's behaviour and
  animation, and stay that way unless the owner says otherwise. Any future fullscreen visual change needs
  a check against `MiniApp.svelte` in the same pass.

## BUG-064 — The bar's control row had irregular spacing and undersized glyphs

- **Status:** RESOLVED
- **Phase:** polish
- **Symptom:** owner report — "the spacing between them is irregular and it feels off and feels like
  they're too wide apart and looks cheap ... also the overall whole buttons is still really really small
  increase their sizes (including those of play/pause prev next)".
- **Root cause of the irregularity:** optical gap between two bare glyphs is
  `gap + (box − glyph)/2` for each neighbour, and the bar's right cluster broke that. Heart and queue sat
  in 52px hit boxes while the sleep timer sat in a 38px one, all around the same 18px glyph, so the
  declared `gap: 6px` measured on screen as 40px, 40px, then 33px. The number was regular; the row was
  not.
- **Fix:** one 42px box for the whole cluster, glyphs 18 → 22, `gap: 4px`. Measured after: 24px and 24px.
  The transport went to the fullscreen glyph scale (aux/skip/play 20/24/28, up from 17/20/24) inside
  44/48px boxes, which measures 26/24/24/26 — symmetric, and 2px off perfect only because a single
  `--pc-tap` token has to cover both the 20px and 24px pair.
- **Traps hit on the way, worth remembering:** splitting the bar's heart into the shared `.heart-half`
  pair first rendered **two misaligned hearts** rather than one. `clip-path: inset(0 49% 0 0)` is a
  percentage of the *span's* box, and the sleeve and card give that span a box the size of the heart,
  while the bar centres a 22px glyph inside a 42px orb — so the seam landed outside the artwork. Pinning
  the halves to 22px fixes the alignment, but the overlap that hides the seam is `1%` of the box: 1.5px
  on a 150px heart, and **0.22px** here — a sub-pixel sliver that can leave a hairline crack down a
  filled heart depending on zoom and device pixel ratio. So the bar no longer keeps the heart split at
  all: it renders one glyph at rest and swaps to the two halves only for the 1250ms break. The split
  exists to be animated, so animating is the only time it needs to exist. Any surface adopting the
  shared fracture must size the halves to the glyph, and should not hold them split at rest below roughly
  40px.
- **Follow-up report:** the owner then reported the bar's heart "seems broken". It was not the wiring —
  the element was present, red when liked, and both animations fired. Measured after the change above:
  at rest 1 `<svg>` and 0 halves (no seam is now constructible), liked stays red `rgb(255,59,82)` while
  the sleeve heart is white by design, `heart-pop` runs at 0.44s on like, and un-like mounts 2 halves on
  `heart-break-left`/`heart-break-right` which then unmount back to the single glyph. Two things made
  this look worse than it was while diagnosing: the window had been switched into the fullscreen lyrics
  view, where there is no playbar at all, and a crashed probe had left a track favourited — both
  restored.
- **Verified:** measured in the running app over CDP (bounding boxes, not eyeballed), plus a 12× capture
  confirming the heart reads as one seamless outline at rest, `heart-break-left`/`-right` firing on
  un-like and the class clearing afterwards, and the favourite state restored after testing.
  `svelte-check` 0 errors, `vite build` clean. The one remaining warning is `MiniApp.svelte:445`
  (slider `tabindex`), which is another session's in-flight work, not this change.

---

## BUG-065 — `ProgressBar` ignored three of the scale variables its callers were passing it

**Status:** RESOLVED

**Symptom:** The bottom mini-player bar's seek rail was a 4px line while the fullscreen views read as a
substantially thicker bar, and hovering it popped a white circle out of nowhere. The owner asked for the
bar to match fullscreen and for the circle to stop appearing.

**Cause — two separate things.**

1. NowPlaying passes `--pb-rail`, `--pb-hit` and `--pb-head` into `ProgressBar` on the assumption the
   component reads them, and a comment in that file says the scale is "handed through the same kind of
   hook the transport uses". It never was: `ProgressBar` consumed only `--pb-gap`, `--pb-time` and
   `--pb-time-w`, while the rail height stayed hardcoded at `4px` and the head at `11px`. The variables
   were being set, inherited, and silently dropped.
2. `.track:hover .head { opacity: 1 }` revealed the thumb on hover. Every other seek surface in the app —
   including the fullscreen lyrics bar — has no thumb at all, so this was both a parity break and the only
   control in the app that drew a shape under the pointer, which is the treatment that has been rejected
   repeatedly.

**Fix:** The three variables are now actually read, with defaults that thicken the bar for every caller
(`--pb-rail` 7px, `--pb-hit` 18px, `--pb-head` 12px), and the `:hover` reveal is gone. The head stays
visible while dragging, where it reports the position being set, and on keyboard focus, where it is the
focus ring. The head is centred with `translate: -50% -50%` rather than a hardcoded negative half-width
margin, so one custom property sizes it.

**Measured:** rail and fill both compute to `7px`, hit area `18px`, on a real CDP hover over the track
(`hover=true`) with no thumb rendered. NowPlaying, which is the caller that had been setting the variables
all along, now renders a `10.08px` rail (`0.024 × --art`) instead of the hardcoded 4px it was actually
drawing — so the fullscreen bar it was meant to have is now the one it gets. `svelte-check` 0 errors.

**Worth remembering:** a custom property crossing a component boundary is invisible to both the compiler
and the type checker. Setting `--foo` on a wrapper produces no error when the child never reads `--foo` —
it just quietly does nothing. Whenever a component is described as "sized by the parent", grep the child
for the variable name rather than trusting the comment in the parent.

---

## BUG-066 — The fullscreen volume rail was a glass capsule inside a glass capsule

- **Status:** RESOLVED
- **Phase:** polish (Echo batch)
- **Symptom:** the user reported, again, that the fullscreen volume slider "still isnt fixed … make it
  liquid glass". At 5× zoom the rail was unmistakably wrong: a dark ring, then a grey ring, then the
  actual track — three nested capsules, and a flat grey core that showed none of the cover.
- **Root cause — two separate ones, and the first diagnosis was wrong.**
  1. *My probe lied first.* I sampled x=640 and x=600 to compare "pill interior" against "artwork
     beside it" and got a delta of ~1 luminance, which looked proof that `backdrop-filter` was not
     compositing at all. It was proof that x=640 is **outside the pill** — the pill sat at x 461..481.
     The instrument bypassed the layer under test.
  2. *The real cause:* `VolumePill` had been extracted as a shared component carrying its own glass
     (background, `backdrop-filter`, border, radius), but `Lyrics.svelte`'s `.side` — which used to
     **be** the rail — still had its own identical set, plus padding. So the fullscreen drew a pane
     inside a pane, and the inner pill's `backdrop-filter` sampled the outer wrapper's already-blurred
     20px box instead of the cover. Now Playing's `.side` had already been reduced to a positioning
     wrapper; the two surfaces had drifted into different implementations of the same control.
- **Fix:** `.side` in `Lyrics.svelte` is now positioning only. Separately, `VolumePill` had genuinely
  been left behind by the liquid-glass work — it was still on the shallow `--glass-filter-clear`
  (34px) with a single 1px border and two inset shadows, while every other surface had moved to the
  deep blur and the four-layer rim band. It now uses `--glass-filter` with rim / lens / dispersion /
  lip, the lens narrowed to 4px because at 20–27px wide an 18px band from both sides leaves a 6px
  clear core and reads as another nested capsule.
- **Measured after:** pane interior uniform at lum 126 while the cover behind it swings between 32 and
  191 — that uniformity *is* the lens averaging its neighbourhood. Rim lift +21 over the interior
  against the reference's +24.
- **General lessons:**
  - **Get the geometry from the same frame you capture.** Rect and screenshot must come from one
    session; measuring a rect in one call and sampling a PNG taken later is how you end up confidently
    reporting a bug that isn't there.
  - When a shared component is extracted, **grep the old call sites for the styling it absorbed.**
    Leaving the previous chrome in place produces nested surfaces that no amount of re-tuning the
    component will fix.

---

## BUG-066 — The lyrics view heart was a 15px rope at half the size of the other two

**Status:** RESOLVED

**Symptom:** "the heart in full screen again got thicker outlines and smaller in size".

**Cause:** Two independent drifts, both in `Lyrics.svelte`, which is the third surface that draws the big
heart and the one that had not been touched by the last two rounds of correction.

1. `.bigheart:not(.heart-lit) :global(svg) { stroke-width: 1.5 }`. Unlike `vector-effect`, `stroke-width`
   *does* inherit from the `<svg>` into the paths, so this applied — but in viewBox units on a 24-unit box
   blown up to ~250px, rendering as roughly a **15px** outline. The comment above it read "the unliked
   heart is a hairline, not a stroke-weight outline", describing an intent the code did not implement.
2. The box was still `clamp(150px, 57%, 330px)`, so with the glyph at 88% of it the heart sat at ~50% of
   the sleeve while the artwork view and the desktop card had both been taken to 80%.

**Fix:** `vector-effect: non-scaling-stroke; stroke-width: 4px` declared on `svg path`, matching the other
two surfaces, and the box raised to `clamp(240px, 91%, 528px)` so the glyph lands at 80% of the sleeve.

**Measured:** glyph 348px on a 435px sleeve = **80.1%**, `strokeWidth: 4px`,
`vectorEffect: non-scaling-stroke`. `svelte-check` 0 errors.

**Worth remembering:** D-082's lesson generalises to a second failure mode. `stroke-width` on the `<svg>`
container is *not* inert the way `vector-effect` is — it inherits, so it silently takes effect in the wrong
unit. Any time a large glyph's outline is tuned, the check is "is this on the path, and is the stroke
pinned to device pixels", and it has to be done for **every** surface that draws the glyph, not the one
being looked at.

---

## BUG-068 — "Add to playlist…" did nothing: the picker opened and closed in the same tick

- **Status:** FIXED
- **Reported by:** the owner — "i cant add songs to playlist wtf"
- **Symptom:** right-click a track, choose *Add to playlist…*, and the menu simply dismisses. No picker,
  no error, no notice.
- **Cause:** `MenuStore.run()` closes the menu unless a handler returns exactly `false`
  (`src/stores/menu.svelte.ts`):
  ```ts
  const keep = item.onSelect();
  if (keep !== false) this.hide();
  ```
  `openPlaylistPicker` re-enters `menu.show()` from *inside* its own handler to swap in the list of
  playlists, and returned `undefined`. So `show()` set `open = true` and `run()` set it back to `false`
  one statement later. The picker was built correctly — it had its rows — it was just never visible.
- **Not a regression from the icon/motion pass.** `menu.svelte.ts` was created in `9c8e3ee` already
  carrying this behaviour, and `return false` has never appeared in `trackMenu.ts` (`git log -S`). The
  defect was latent and latent-only: every other `menu.show()` call site is a top-level opener reached
  from a right-click handler, where the post-handler hide does not apply. This is the only one that is
  re-entrant.
- **Fix:** `openPlaylistPicker` now returns `false`, honouring the contract the type already documents.
  The stale comment claiming "the caller's menu closes because this returned true" is gone — returning
  `true` would have closed it too, which is part of why the bug survived.
- **Verified:** `scripts/repro-menu-reentry.mjs` drives the real `trackMenu()` item through the real
  `menu.run()` against the live app. Red before the fix (`picker stays open … FAIL`), green after, and
  it cannot mutate a playlist because it only builds the menu and runs the one re-entrant item.
  `npm run check` clean; `npm test` 39/39.
- **Left open:** the contract itself is a trap. Any future item whose handler opens a menu has to
  remember to return `false`, and forgetting produces this same silent no-op. A re-entrancy guard in
  `run()` — capture an open-token before the call and skip the hide if it changed — would make the
  mistake impossible rather than merely documented. Not done here to keep this fix to one line.

---

## BUG-067 — The queue drawer was squeezed to an 88px column and covered the volume control

Reported by the owner with a screenshot: the queue panel rendered its text one or two words per line —
`Queue` / `0` / `songs` / `.` / `3:56` / `left` — down the right edge of a pane that was, by its own
rule, 380px wide.

**The pane was never the wrong size.** Measured live: `panel w=380`, `max-width: none`, and the only
rule touching its width was the intended `width: min(380px, 42vw)`. Walking the subtree showed every
child at 87px, and the cause on the first line of the same dump: `padding-left: 292px`.

`.shell .frame .content > *` hands every child of the content column the rail clearance
(`--pad-start` = rail width + gutter) and the bar clearance (`--pad-bottom`). That is right for the
scrolled views, which are in flow and must not run under the floating chrome. The queue drawer is also a
direct child of `.content`, but it is absolutely positioned against the window edge — so it received
292px of left padding inside a 380px box, leaving 88px for its content.

**A second defect was hiding behind the first.** With `bottom: 0` the drawer ran the full window height
at z-index 40, over the transport bar's z-index 20. `elementFromPoint` at the bar's right end returned
`SECTION.panel`, so the volume pill and its percentage readout were unclickable for as long as the queue
was open. The owner could not have seen this, because the collapsed text was on top of it.

Fixed in two places: the clearance rule now excludes the drawer (`.content > :not(.panel)`), and the
drawer stops above the bar (`bottom: var(--pad-bottom)`) so it floats over the content the way the rail
does instead of covering the transport.

Verified live after the change: panel 380x652 with `padL=0`, header and body 379px wide, the view's
`.page` still at `padL=292px` (the clearance was not lost where it is owed), and the bar's right end
resolving to `FOOTER.bar` / `SPAN.vfill` again.

**Why it survived:** the selector is written as a wildcard with a deliberate reason attached — it needs
to outrank the per-component `padding` shorthand Svelte scopes onto each view root. Adding a second kind
of child to `.content` silently inherited a rule written for the first. A future overlay pane placed in
the same slot will hit this again unless it is also exempted.

**Superseded in part by D-100:** the `bottom: var(--pad-bottom)` fix here stopped the pane above the bar,
but it used the content clearance rather than the pane inset, so the drawer floated 18px higher than the
rail and kept square corners. It is now the rail's twin at `--float-inset` / `--radius-float`. The
`:not(.panel)` exemption stands.

---

## BUG-069 — The taskbar thumbnail buttons looked broken; the window they lived on was gone

**Status:** RESOLVED (by restart) — root cause is still **R-6**, which is now causing real damage

**Reported as:** "the pause/play button on the thumbnail preview of the window is also gone wtf".

**It was not the toolbar code.** Enumerating the windows of the running instance showed the process had
**no main window at all** — only the 160x28 broker and a 16x16 helper. It had been running about twenty
hours, and the main window had been destroyed at some point by the close button while the process stayed
alive because the mini card is only hidden (R-6). The thumbnail toolbar is attached to the main window's
`HWND`, so when that handle was destroyed the buttons went with it — but the process kept its taskbar
button, which is why a preview still appears, minus the controls.

**Confirmed by elimination, not by guessing:**
- `taskbar.rs` was last modified two days before the instance started, and the binary was built after it,
  so it was not a stale build.
- `init` is correctly scoped to `app.get_webview_window("main")`, so D-076 giving the mini card its own
  taskbar button did not mis-target the toolbar.
- The frontend wiring (`startTaskbarBridge`, `syncTaskbarPlaying`, `syncTaskbarFavorite`) was intact.
- Launching the same binary fresh produced **no** `taskbar buttons unavailable` line on stderr, and
  `ThumbBarAddButtons` returns `Err` on failure — so the install succeeds whenever a main window exists.

**Why this matters beyond the one symptom:** R-6 was filed as an inconvenience ("a hidden instance keeps
port 1420 bound"). It is now demonstrably degrading shell integration too — a zombie process presents a
taskbar button whose preview is missing controls, and the user reasonably reads that as the feature
breaking. Closing the last visible window should either quit the app or put it somewhere recoverable with
a tray icon, and that decision is still the owner's.

---

## BUG-070 — One OS close bricked the desktop card until the whole app was restarted

**Status:** RESOLVED. `CloseRequested` on the mini window is now intercepted and turned into a hide.

**Reported as:** "the card mini player now isn't working for some reason", immediately after the pill
variant was deleted. The obvious suspect was that deletion, and it was wrong.

**The error text sent the investigation to the wrong file.** Clicking the bar's desktop-card toggle
produced `Could not open the mini-player: mini window is not declared in tauri.conf.json`, so the first
place to look was the config — where the `mini` window is plainly declared, `visible: false`, at
`tauri.conf.json:33`. The message is emitted by `toggle_mini` when
`app.get_webview_window("mini")` returns `None`, and it conflates "never configured" with "no longer
exists". Both call sites now say `mini window no longer exists at runtime`.

**Root cause.** The card is frameless but `closable` is still the default `true`, and nothing anywhere in
`src-tauri/src` handled `WindowEvent::CloseRequested` — no `prevent_close`, no `on_window_event`, no
`WebviewWindowBuilder`. So Alt+F4 (or any OS-level close on the focused card) *destroyed* the window.
Every path the app itself takes hides it (`toggle_mini` hides, the card's close button sends
`hide_mini`), which is why the hole survived: the design note above `toggle_mini` says the window is
"built once and then only shown or hidden afterwards", but nothing enforced that against the OS. Once
destroyed, only a process restart brings it back, because rebuilding a webview at runtime is the
documented-bad path on Windows (BUG-011: a runtime-built webview gets a WebView2 environment with
different browser args and never finishes initialising).

**How the deletion was ruled out, rather than assumed innocent:**
- The error is raised in Rust before any frontend code runs, and the click demonstrably *reached* Rust —
  so the bridge, `windowBridge.ts` and the settings store were all alive.
- `getAllWebviewWindows()` on the running instance returned `["main"]` only: the window was absent from
  that process, not mis-rendered by it.
- The debug binary had not been rebuilt (mtime still 2026-09-28 00:49) and that same binary had served the
  card earlier the same day, so a stale build was excluded too.
- No frontend file calls `.close()` or `.destroy()` on any window — grep returns nothing.

**Fix** (`src-tauri/src/lib.rs`): an `on_window_event` guard that, for the `mini` label only, calls
`api.prevent_close()` and hides. The window stays registered, which is what every other code path already
assumed.

**Verified on the rebuilt binary, end to end:** after a restart both `main` and `mini` exist; the toggle
shows the card; `getCurrentWindow().close()` from inside the card leaves `mini` in
`getAllWebviewWindows()` with `mini_visible` now `false`; toggling again returns `mini_visible: true` with
no error. Before the fix that same `close()` is what emptied the window list.

**Relationship to R-6 — this narrows it but does not close it.** R-6's premise is that the mini window is
"only hidden", which is what keeps the process alive after the main window closes. That premise was
untrue until now: the mini window *could* be destroyed. It can no longer be, so R-6's mechanism stands as
described — and R-6 itself (a hidden instance holding port 1420 and presenting a control-less taskbar
preview) is still open and still the owner's decision.

---

## BUG-071 — `content-visibility` clipped the tile glow into a rectangle and severed its top

**Status:** RESOLVED. The property is gone from `MediaCard`.

**Reported as:** "the glow here seems a little glitchy... it seems it is enclosed in a rectangle make it
uniform, and the upper portion is a little bit cut". Both halves of that sentence are the same bug, and
the owner found it by looking at the screen.

**Cause.** D-107 added `content-visibility: auto` to `MediaCard` so the 267-tile Albums facet would skip
layout and paint off screen. `content-visibility` implies **paint containment**, and paint containment
clips the element's *subtree* to its own box. The glow lives on `.art`, a descendant, and reaches roughly
60px past the card's box — so the browser drew it and then cut it to the card's rectangle.

**Why the top was worst.** A round tile is a 128px card holding a 108px circle with 2px of card padding,
so the card's top edge sits only ~2px above the artwork. The halo above the circle had essentially no
room and vanished; the sides had 10px, which is why it read as a box hugging the avatar rather than light
around it.

**Why the square album tiles hid it.** There the art fills the cell, so the clip boundary falls near the
artwork's own edge and the truncation reads as an ordinary hard shadow. The circles exposed it because
their ink is round inside a box that was never meant to be seen.

**Fix.** Removed `content-visibility` and `contain-intrinsic-size` from `.mcard` and `.mcard.round`, with
a comment at the site explaining the trade so it does not get re-added as a performance win. The lazy
palette resolution in the script is what keeps the facet affordable — that part was never the problem and
stays.

**Also fixed in passing:** the hovered tile now raises to `z-index: 2` over its neighbours. The halo
extends well past the 18px gap, so without it the next tile in DOM order painted over the light and the
glow looked cut on one side — a second, unrelated cause of the same "not uniform" complaint.

**Verified on pixels:** hovering Aditya Rikhari in the Artists facet now shows a circular red halo, even
on all sides, top intact, sitting above the adjacent tiles. svelte-check and the build are clean.

**The lesson worth keeping:** a perf property applied to a shared component was chosen for a number
(267 tiles) and never looked at on screen, and every measurement I had made — counts, contrast, resolved
colours — was about data, not rendering. The screenshot found it immediately.

---

## BUG-072 — The square tiles had the same severed top, from a different clipper

**Status:** RESOLVED. Follows BUG-071; same symptom, different cause, plus the glow was genuinely too
faint on squares.

**Reported as:** "similarly for the album... the up seems a little cut and the glow seems way too subtle".

**First cause: the scroll container, not the tile.** `.grid` is `overflow-y: auto`, and a scroll container
clips at its padding edge. The first row's artwork sat **2px** below that edge, so every halo on the top
row was cut along its upper side, and the outer columns were cut left and right. Measured before the fix:
`headroomAboveArt: 2`. Now 32px above and 28px at the left, which is padding on the grid — headroom for
the light, not spacing for looks.

**Second cause: the glow was reaching past the place it could be seen.** The previous tuning spread its
light to about 64px at low alpha. On the circular artist tiles that reads as a halo, because the circle is
108px inside a 128px box with room around it. On the album tiles the art fills the cell and the gap between
neighbours is 18px, so almost all of that reach landed underneath the next cover — invisible where it was
dim, and only the dim part survived where it overlapped. A glow you cannot see is not subtle, it is absent.

**Retuned to be shorter and stronger:** a 2px full-strength ring, an 18px halo at 0.85 alpha, and a 42px
wash at 0.42 — total reach about 50px, now inside the headroom the grid provides. The hovered tile also
raises to `z-index: 2` (from BUG-071's fix) so its light paints over its neighbours rather than under them.

**Verified on pixels:** the first-row Sean Paul tile lights in its own warm orange, ring crisp, halo even
on all four sides with the top intact, and the play button's dark glyph stays legible on the orange fill.
svelte-check and the build are clean.

## BUG-073 — The queue's length changed with a transport orb nobody had identified

- **Status:** RESOLVED
- **Phase:** queue / play order
- **Symptom:** owner report — "the queue sometimes gives 12 songs and sometimes 312 songs". Measured on
  the live app: 314 playable tracks, `shuffle: true`, `similar: true`, and `order.length` was **31**.
- **Root cause:** "Play similar" *filtered* the run to the neighbourhood of the current track rather
  than ordering the library. `ensureOrder()` returned early with `seed = [current, ...similarTo(current)]`
  — about 30 songs — and `extendSimilar()` topped it up as the run progressed so it never visibly ran
  dry. Toggling the orb therefore changed how many songs the session contained, from a single icon with
  no count on it, which is why the number looked random.
- **Fix:** similar is now a **priority, never a subset**. The order is always built from every playable
  track (blocked ones still excluded), and in radio mode it is re-sequenced to
  `[current, ...related, ...everything else]`. The queue length is 314 either way; what the radio
  changes is that the next few songs are chosen to fit instead of picked at random.
- **Trade-off, stated so it is not rediscovered as a regression:** the related block is ranked against
  whatever was playing when the order was built. `extendSimilar()` is gone, so an hour into a radio run
  the tail is the plain library rather than still orbiting the current song. That is inherent to
  guaranteeing the full list up front, and the run no longer stopping is worth more than a tail nobody
  reaches.
- **Verified** on the running app: with radio ON the order is `314/314` (was 31); toggling off and back
  on both give 314; `new Set(order).size === 314`, so nothing is duplicated or dropped; `order[0]` is the
  current track and **8 of the next 8** come from `similarTo(current)`. `svelte-check` 0 errors / 0
  warnings, `vite build` clean. Session state (track, position, both flags, view) captured before the
  test and restored after.

---

## BUG-074 — The lyric head/tail clamp was inert: Svelte wiped the custom properties that drove it

- **Status:** RESOLVED
- **Phase:** lyric motion
- **Symptom:** owner report — "when the first line is being played do not change its position to the
  middle suddenly". Measured on the live app, the first line of every song really was yanked to dead
  centre in **both** webviews, which is what the clamp in `measure()` existed to prevent. The clamp's
  arithmetic was correct and its unit tests passed.
- **Root cause:** `measure()` wrote the clamp padding with
  `reel.style.setProperty("--reel-top", …)`, but the reel's own markup carries a template binding —
  `style="transform: translateY({offset}px)"` — and **Svelte replaces the element's entire `style`
  attribute when a binding updates, not the one declaration it owns.** The follow rewrites that
  transform every frame, so the two custom properties were deleted on the very next frame of the same
  follow that needed them. Caught red-handed in both webviews: `.reel`'s raw attribute read
  `transform: translateY(-729.281px);` with `props: ["transform"]` only, and the mini's computed
  `padding-block` was `0px / 0px`. With no padding the column has no head or tail slack, so the clamp
  bounds collapse and every target resolves to "centre the line".
- **Fix:** the properties are now set on `.lyrics` (the scroll viewport), which carries no style
  binding in either surface, and the reel inherits them. Custom properties inherit by design, so the
  reel's `padding-block: var(--reel-top) var(--reel-bottom)` reads them unchanged.
- **Lesson:** `Element.style.setProperty()` and a Svelte `style=` binding cannot coexist on the same
  element. Put custom properties on a parent the template never writes to. A `props: ["transform"]`
  read of the raw attribute is the only way to see this — `getComputedStyle` reports the resolved
  value and quietly returns the fallback, so the padding looked *intended* rather than *absent*.
- **Verified** on the live app after the fix: MINI `--reel-top: 58px; --reel-bottom: 63px` computing to
  `padding: 58px / 63px`; MAIN `--reel-top: 185px; --reel-bottom: 204px` → `padding: 185px / 204px`.
  Projected settled position of all 54 lines, both surfaces: line 0 at **23%**, line 1 at 34–35%,
  line 2 at 47–50% (all three clamped at the head), lines 3–50 free at 50%, line 51 at 54–57%,
  line 52 at 65–66%, line 53 at **75%** (clamped at the tail). Bands `{start: 3, free: 48, end: 3}`,
  min 23% / max 75%, identical on the card and the fullscreen view.

---

## BUG-075 — The reel's clamp padding was written for a viewport height it no longer had

- **Status:** RESOLVED
- **Phase:** lyric motion
- **Symptom:** the clamp behaved inconsistently across a session — correct just after opening the
  lyrics view, wrong later, with nothing obvious in between.
- **Root cause:** the padding is derived from the viewport's measured height and only rewritten when
  that height changes, but the thing watching for the change was a window `resize` listener. The lyric
  box is a **grid row** in the fullscreen view and a **flex row** under the header in the card, so its
  height also changes when something else in the layout does — the player bar growing, the column
  swapping between the reel and the plain list, the card's header appearing once a track arrives — and
  none of those fire a window resize. Measured, not theorised: the reel was caught carrying padding
  written for a **1007px** viewport while the viewport was **927px**, so the clamp was working from a
  height that no longer existed.
- **Fix:** a `ResizeObserver` on the viewport itself in both surfaces. On any box change it invalidates
  the cached height (`padHeight = -1`) and pokes the follow, which re-measures and rewrites the
  properties on its next frame.
- **Lesson:** "the size changed" is a property of the element, not of the window. Anything positioned
  from a measured box needs an observer on that box.

---

## BUG-076 — Thinning the card veil fixed the lyrics and left the title at 3.04:1

**Status:** RESOLVED. Found by measurement, not by looking — the card reads fine in a screenshot.

- **Symptom:** the vibrancy pass dropped the mini card's veil from `0.55 → 0.78` to `0.40 → 0.62` to
  stop the blurred cover looking smothered next to the fullscreen view. The lyric field went to
  7.8–13:1, which is what was checked. The header was not.
- **Cause:** the veil is a `150deg` linear gradient, so its *lightest* stop lands across the top of the
  card — which is exactly where the title and artist live. The lyric reel sits low enough to fall in
  the darker tail. One gradient, two very different answers, and only the one that was measured moved.
- **Fix:** ~~a header scrim as the topmost background layer~~ — **superseded by BUG-078**, which is the
  owner reporting the very next screenshot. The real fix is in BUG-078. What remains true here is the
  diagnosis: a directional veil has to be measured at every band of text it crosses.
- **Verified:** `scripts/audit-run.cjs mini.html` on the four brightest covers in the library — title
  7.79 / 8.00 / 7.91 / 8.81, artist 9.25–10.46, worst lyric line 6.07. Main window re-audited after the
  shared `SATURATION` bump: 70 elements, 0 failures, worst 7.13.
- **Lesson:** a directional overlay has to be measured where the text *is*, not at the busiest-looking
  spot. And ranking covers by their raw artwork overstates the case — `blur.ts` normalises to
  `TARGET_LUMINANCE = 84`, so a pure-white sleeve never reaches the card as white.

---

## BUG-078 — The header scrim that fixed BUG-076 was a visible black plate

**Status:** RESOLVED. Reported as "a slight rectangular black-ish tint on the texts of the name of the
song and the artist name too, so it looks bad."

Two distinct things were painting that tint, and isolating them took A/B captures rather than reading CSS:

- **The scrim itself.** BUG-076's fix added `linear-gradient(to bottom, rgba(10,8,14,0.45), transparent
  26%)` over the card's top band. A gradient that ends inside a large smooth field does not read as
  shading — it reads as a plate, with a visible horizontal edge where it stops. The same rule the owner
  has applied twice already: no plate behind bare glyphs.
- **An inherited 18px black bloom.** `body { text-shadow: var(--text-shadow) }` in `app.css` carries a
  second stop of `0 0 18px rgba(0,0,0,0.32)`. On the main window that keeps a label readable when it sits
  directly on bright artwork. On the card, where the veil already does that job, 18px of pooled black
  around a 12px artist line is a soft rectangle the same shape as the words.

**Fix.** The scrim layer is gone. The base veil's ramp was flattened from `150deg 0.40 → 0.62` to
`160deg 0.52 → 0.62` — one continuous layer, no band, no edge — and the card's `.title`/`.artist` override
the inherited shadow with `0 1px 2px rgba(0,0,0,0.4)`, keeping a one-pixel edge and dropping the cloud.

**Verified by A/B capture, then by measurement.** Captured the header with and without only the scrim
layer: the band and its edge disappeared, and the colour flowed continuously. Contrast then re-run on the
four brightest covers plus the cover that originally scored 3.04 — title 5.30 / 5.46 / 5.53 / 6.31, and
**6.58** on the original failure case (was 3.04), artist 7.96–9.31, worst lyric line 6.36. 0 failures.
Main window re-audited: 0 failures. `svelte-check` 0/0, build clean.

**Lesson:** a contrast number can go up while the surface gets worse. BUG-076 was closed on a measurement
and reopened on a screenshot one round later, because the fix bought legibility with an opaque region and
nothing in the audit checked whether the *background itself* had become a shape.

---

## BUG-077 — The contrast audit reported nothing, then reported a failure that wasn't there

**Status:** RESOLVED. Two independent defects in `scripts/audit-run.cjs`, both found on the same run.

- **Silent zero:** every `img` was registered as a backdrop blocker, so the mini card's own full-bleed
  `<img class="bg">` rejected all six sample points of all 16 text elements. The tool printed
  "16 fully covered by chrome, not measurable" and exited 0. The `url()` pass already had a
  greater-than-25%-of-viewport exception for exactly this; the element pass did not.
- **Invented failure:** the ring is sampled just *outside* the element's box, but a marquee's travelling
  inner span is wider than the clip window it scrolls through. Sampling outside that box put the point
  inside the run of visible glyphs, in a gap between letters — where `elementFromPoint` correctly
  answers "the clip container", so the occlusion test cannot catch it. The mini title scored 1.77:1
  against an antialiased edge of its own text.
- **Fix:** the area exception now applies to `img`/`canvas`/`video` too, and each element's rect is
  intersected with every clipping ancestor before sampling, so the ring surrounds the *visible* text.
  The 1.77 became 3.04 — a real number, and a real defect (BUG-076).
- **Lesson:** an audit that measures nothing looks identical to an audit that passes. Both of these
  reported success-shaped output while telling the truth about nothing.

---

## BUG-079 — A component's scoped `transition` replaced the shared `.row` primitive's, so the press snapped

**Status:** RESOLVED. Found by the motion audit (`scripts/probe-snap-hover.mjs`), not by looking. Reported
by the owner as "the ui feels sloppy overall".

On album, artist and playlist track lists — and on the queue drawer — the row background eased in over
`--tap` while the press squeeze and the hover border arrived on a single frame. Half the hover animated,
half of it popped, and the two halves had the same trigger.

- **Root cause:** two rules, and the narrower one wins by specificity. `controls.css` declares a global
  `.row` primitive (0,1,0) carrying `background-color`, `border-color` and `transform` at `--tap`.
  Svelte scopes a component's own rule to `.row.svelte-<hash>` (0,2,0). A component that re-declares
  `transition` therefore does not *add* to the primitive's list — it **replaces** it, because
  `transition` is a shorthand and the losing declaration contributes nothing. TrackList and QueuePanel
  both declared a subset (background only) with identical timing, so the primitive's `border-color` and
  `transform` were dropped while its `:hover` and `:active` rules still applied. The properties changed
  on hover; nothing was left to ease them.
- **Fix:** two different remedies, because the two situations are not the same. Where the scoped
  transition was a strict subset with identical timing it was **deleted** (TrackList, QueuePanel) — the
  primitive already said it. Where the component deliberately wanted different timing it was
  **extended** to carry the full property list (Favorites at 160ms, Library at 140ms). Deleting that one
  would have been a behaviour change disguised as a cleanup.
  The same omission without the specificity twist, folded in here rather than numbered separately:
  `ArtistPage` and `Playlists` `.card` set a `box-shadow` on hover alongside the lift, and their lists
  named only two of the three properties, so the shadow snapped on under an eased transform.
- **Verified:** live on ArtistPage and on 129 QueuePanel rows — computed `transition-property` reads the
  full list, and a 60ms sampling window catches `border-color` and `transform` mid-ease rather than
  already settled. Favorites (160ms) and Playlists `.card` (`box-shadow` added) are CSSOM-verified only:
  both views are genuinely empty (0 playlists, 0 hearts), so there was nothing mounted to sample.
- **Lesson:** the specificity trap is not only about *winning* — a scoped rule that wins with a
  **shorter** shorthand silently un-declares what the primitive it overrides was providing. Any
  component that restates a shared primitive's `transition` has to restate all of it.

---

## BUG-080 — `border-color: transparent` in a hover neutraliser also erased the divider the row draws itself

**Status:** RESOLVED. Introduced by the fix for the row-hover ring, caught by the same audit that found it.

- **Root cause:** Settings' rows cancel the global `.row` hover ring with `border-color: transparent`.
  `border-color` is a **shorthand** for all four sides. The row also draws its own separator as
  `border-bottom-color: rgba(255,255,255,0.07)`, so the neutraliser wiped it too — the divider vanished
  for exactly as long as the pointer was over the row, then came back. A hairline that blinks out under
  the cursor reads as a repaint glitch, which is what "sloppy" means here.
- **Fix:** keep the shorthand cancellation and restore the longhand underneath it
  (`src/views/Settings.svelte:511-516`), with the reason in a comment at the site.
- **Verified:** live — `dividerStable: true` across a hover/unhover cycle, the bottom border's computed
  colour never leaves `rgba(255,255,255,0.07)`.
- **Lesson:** an undrawn border cannot snap (`border: none` computes to style `none`, width `0px`), so
  "cancel the border" is only safe on an element that has no border of its own. Check what the element
  draws before neutralising what a primitive adds. Related: a fix that makes an audit report *worse*
  (this one went 3 findings → 5 before it was corrected) is a signal the fix was wrong, not that the
  audit is noisy.

---

## BUG-081 — The card's lyric line snapped its glow on arrival; the fullscreen line did not

**Status:** RESOLVED. The two lyric surfaces are separate implementations, so a fix to one never reaches
the other — this is the parity gap, found by diffing their transition lists rather than by watching.

- **Root cause:** `MiniApp.svelte`'s `.line` transitioned `font-size`, `opacity`, `filter` and
  `transform`, but not `text-shadow`. The arrival changes all five: the sung line grows, sharpens, lifts
  to full opacity **and** picks up a glow. Four of them eased over `--dur-lyric`; the glow appeared on
  the first frame and sat there waiting for the rest to catch up. On a 12px card line that is most of
  what the arrival is made of.
- **Fix:** add `text-shadow var(--dur-lyric) var(--ease-lyric)` to the list
  (`src/MiniApp.svelte:1087-1092`), with the reason at the site.
- **Verified:** live on 26 mounted card lines — computed duration `0.46s`, and a sample mid-arrival
  catches an interpolated shadow rather than either endpoint.
- **Lesson:** transition longhands do **not** inherit (measured: a child of a parent with
  `transition: text-shadow 400ms linear` computed `transitionProperty: "all"`, `transitionDuration:
  "0s"`). Every element that changes a property needs that property on *its own* list, and a list built
  by copying a sibling's is only as complete as the sibling.

---

## BUG-082 — The arrival animation and the depth-of-field transition fought over the same properties

**Status:** RESOLVED. Reported as "the text when in highlight that animation feels sloppy and cheap also
(like the text enlargement that animation doesn't seem smooth)".

Every line visibly **dropped back** at the end of its own arrival — a small retreat, on every line
change, on both lyric surfaces. It read as the animation being cheap rather than as a bug, which is why
it survived as long as it did.

- **Root cause:** `line-arrive` animated `transform`, `opacity` and `filter`. The rule above it
  transitions those same three for the depth of field, because a line's distance from the sung line is
  expressed as size + blur + fade. An animation on a property does not blend with a transition on it —
  it **replaces** it for the animation's whole length, then hands back to whatever the transition had
  reached by then. At `--dur-lyric` against a longer font-size cross-fade, the handback landed about a
  quarter of the way short of the target, so the line snapped backwards and the transition finished the
  job from there. One motion, two owners, and the seam was visible.
- **Fix:** the keyframe now animates the **independent `scale` property**
  (`src/views/Lyrics.svelte:1136-1161`, mirrored in `MiniApp.svelte`). `scale` composes with the depth
  ramp's inline `transform: scale(d)` by multiplication instead of competing with it, so both can own
  their own value and the arrival rides on top of the transition rather than interrupting it.
- **Verified:** live trace across a real line change — font-size 15.5 → 23.0px **monotonically**, no
  dips; independent `scale` 0.95 → peak 1.0120 → 1.0000 → `none`; inline `transform` matrix `.a`
  0.935 → 1.000 concurrently. The retreat is gone because nothing is handed back.
- **Lesson:** before adding a keyframe, check which properties the element is *already* transitioning.
  An animation and a transition on one property is not two effects layered — it is one effect that
  stops and restarts. The independent transform properties (`scale`, `translate`, `rotate`) exist
  precisely so a second motion can be added without taking the first one's property away.

---

## BUG-083 — TrackList's index cell swapped `display`, so the play glyph arrived on the frame the number left

**Status:** RESOLVED. Found by the audit's appear-swap detector: a rule whose `:hover` changes `display`
between two children of one cell.

- **Root cause:** the index cell held either the track number `.n` or the play glyph `.p`, chosen with
  `display: none` ↔ `display: grid`. That swap is **atomic and un-transitionable**: an element that was
  not rendered has no starting computed value, so there is nothing to ease from. The number popped out
  and the glyph popped in on the same frame, while the row's own background was still washing in over
  `--tap` — the single instant part of a hover that was otherwise smooth, and the part the eye lands on
  first because it is where the pointer is.
- **Fix:** `.num` is already `width: 22px; flex: none; display: grid; place-items: center`, so both
  children now share that one cell via `grid-area: 1 / 1` and trade `opacity` instead
  (`src/components/TrackList.svelte`). No markup cost: `.p` wraps an `Icon` that is already
  `aria-hidden`, so holding it in the tree at opacity 0 exposes nothing new, and Chromium skips
  painting a fully transparent element. `.row.active .n { display: none }` was deleted as provably
  dead — the markup puts `.n` and `.bars` in opposite branches of one `{#if active}`, and Svelte swaps
  branches in the same flush as the `class:` binding that drives it, so the rule could never match.
- **Verified:** live on a real AlbumPage row. Both children compute `grid-area: 1 / 1` and
  `transition-property: opacity, color` at `0.14s`. Samples across the hover show a genuine
  complementary crossfade — t=45ms: `.n` 0.538 / `.p` 0.462; t=72ms: `.n` 0.255 / `.p` 0.745; settled
  0 / 1. The `.num` cell holds at exactly **21×22 px** before, during and after, so the crossfade costs
  no layout shift.
- **Lesson:** `grid-area: 1 / 1` stacking is the standard remedy whenever a state change is expressed as
  "swap which child is rendered" — it turns a discrete swap into a property that can interpolate, at the
  cost of keeping both children mounted. BUG-063 used the same trick on the heart glyph halves. Reach
  for it before reaching for `@starting-style`, which also needs the stacking to avoid a layout jump
  and adds a mechanism on top.

---

## BUG-084 — The motion audit reported three classes of false positive and one false negative

**Status:** RESOLVED. Defects in `scripts/probe-snap-hover.mjs` and `scripts/sweep-views.mjs`, all found
by distrusting a result rather than by reading the tools.

The audit compares, for every mounted element, the properties its `:hover`/`:active` rules change
against the properties its computed `transition` list actually covers, and reports a finding for each
gap. Four ways it told the truth about nothing:

- **`text-overflow` is discrete.** A marquee's rule declares a 400ms transition and changes
  `text-overflow` from `ellipsis` to `clip`; sampling at 60ms already read `clip`. Not a missing
  transition — the property has no interpolable values, so 400ms was always going to be a swap. Added to
  the exempt set with the measurement in a comment.
- **`animation-*` longhands.** A hover rule that attaches `animation-name` reads as "a property changed
  with no transition covering it". But an animation is not a transition: attaching one cannot be eased
  *into*, the animation **is** the motion. All eight `animation-*` longhands exempted.
- **A clean reading on an empty view.** The worst of the four, because it reports success. Favourites
  with 0 hearts and Playlists with 0 playlists return `findings: 0` with nothing mounted to judge — and
  a full nine-step sweep once printed nine **identical** clean rows because the fullscreen player was
  open: the nav rail has no client rects behind it, so every click was a silent no-op and every step
  re-probed the same surface. Fix is to make coverage part of the report: the probe now returns `roots`,
  `judgedSelectors`, `measured` and `unmountedSelectors` next to `findings`, the sweep asserts each hop
  landed (`expect` on the visible root string plus an optional `check` predicate) instead of trusting
  the click, and a step with `measured: 0` prints "(nothing mounted to judge — this surface was empty)"
  under its zero.
- **The rail is unmounted, not hidden.** Measured `navInDom: 0` while the fullscreen player is up, which
  falsified the sweep's own comment. The overlay-unwind guarded on "does `.nav` exist" and so returned
  immediately from inside the player — the exact case it exists for. Guarding on the rail's presence is
  also wrong in the other direction: the desktop card has no rail either, so the guard fired there too
  and `NOCTRA_CDP_MATCH=mini` printed twelve bogus `NAV FAILED` rows. Now guarded on
  `location.pathname`, and the card gets its own single-step list that asserts card-ness — because
  `cdp-eval` silently falls back to the main window when the card is not up, and a fallback there would
  report the main window's clean reading as the card's.
- **Lesson:** an audit's zero has to carry its denominator. "0 findings" and "0 findings out of 0
  elements judged" are the same string and opposite meanings — which is the identical failure BUG-077
  describes in the contrast audit, arrived at from a different direction. Also: one `Runtime.evaluate`
  held open for 20-30s across nine hops will be destroyed by a Vite HMR full reload from a concurrent
  session; one short call per step costs one hop and retries.

---

## BUG-085 — The first lyric line wore the sung line's treatment for the whole intro

**Status:** RESOLVED. Reported as "why the fuck even when the music is playing but still the first lyric
line is being highlighted", on "How Long" at 0:03.

Reproduced live and it was worse than the screenshot: on "Jeena Jeena" the first timestamp is
**27080 ms**, so for 27 seconds line 0 sat rendered exactly like the line being sung.

- **Root cause:** `activeLine()` was already correct — it returns -1 before the first timestamp, and
  `class:active={i === index}` therefore marked nothing. The defect was one layer down, in `depth()`:
  `const anchor = index < 0 ? 0 : index`. Collapsing "no sung line" onto line 0 put it at distance zero,
  which takes the `d === 0` branch — `alpha: 1`, `blur(0px)`, the 12px white bloom, and on the card
  `size: 24` against the resting 19. Measured on the running app before any change: line 0 at
  `opacity 1 / matrix(1,0,0,1,0,0) / blur(0px) drop-shadow(...)`, line 1 at 0.77 / 0.935 / blur 2.04px.
  The whole depth ramp was arranged around a line that had not started.
- **Why it was like that:** the clamp was a previous fix, and its comment records the reason — anchoring
  on -1 literally makes line 0 distance 1, so the entire column opened dimmed and blurred and the card
  read blank for a few seconds on every track. That fix traded one wrong for the other wrong. Both are
  the same mistake: treating "nothing is being sung" as if it were a *position* on the ramp.
- **Fix:** `lineDistance(index, i)` in `lrc.ts` returns `null` when `index < 0` instead of a distance, so
  the state is explicit in the type rather than re-derived at two call sites. Each surface holds a
  **rest** state for it: sharp and readable (`blur(0px)`, `alpha 0.85`, `scale 0.95`, card `size 19`) but
  uniform across every line and with none of the glow. `depth()` on both surfaces now calls it.
- **Verified on both surfaces, both directions.** Fullscreen at 5s: 0 active, all lines
  `46px / 0.85 / blur(0px) / scale 0.95`. Card at 5s: all `19px / 0.85 / no drop-shadow`. Fullscreen at
  29s: 1 active, `54px / opacity 1 / glowing / scale 1`, ramp behind it. Card at 29s: same shape at
  `24px`. The `.active` font-size step (46 → 54, 19 → 24) only exists once a line is genuinely being
  sung, so rest and singing are now distinguishable by four properties instead of one. `npm test` 57
  pass / 0 fail, including a new `lrc.test.ts` whose central case is that no `i` yields distance 0 while
  `index` is -1 — written red against the fix, then green.
- **Lesson:** a sentinel value like -1 has to stay a sentinel all the way down. The moment it is folded
  into a coordinate — `index < 0 ? 0 : index` — it becomes a position, and every rule keyed on that
  position fires for a state that has no position at all. Also: the card returns `size` from `depth()`
  while the fullscreen takes its size from a `.line.active` CSS rule, so the same root cause produced a
  *bigger* line on one surface and only a brighter one on the other. Fixing both from a shared helper
  does not mean the surfaces render the same; verify each one.
- **Followed by:** a correct-but-empty rest state reads as a screen that has not loaded, so the same gap
  now carries the reference's three-dot waiting indicator. That is a feature, not a defect, and is
  written up under "The waiting indicator" in `PROGRESS.md`.

---

## BUG-086 — Eight romanisation table entries were dead keys, and the setting looked like it was ignoring itself

**Status:** RESOLVED. Found by running the engine over the user's own cached lyric files instead of
eyeballing a table of glyphs.

With romanise on, the fullscreen sheet still showed Devanagari in 6 of 22 lines of a Hindi track —
`ज़िन्दगी`, `दहलीज़`, `तारीफ़ें`. Three separate defects, all in `services/lyrics/romanize.ts`:

- **Decomposed letters used as table keys.** Bengali ড় and Gurmukhi ਸ਼ were typed as the base letter plus
  a combining dot, so the *keys* in the table were two-codepoint strings while the engine looks a table
  up one codepoint at a time. Eight such keys — three Bengali, five Gurmukhi — and all eight were dead:
  they still registered in `OWNER`, which is what made `needsRomanisation()` answer "yes, romanise this"
  for a line the transliterator could not actually read.
- **The precomposed spelling was missing entirely.** The Hindi nukta letters U+0958–U+095F (क़ ख़ ग़ ज़ ड़ ढ़ फ़)
  are primary codepoints in Unicode, not combos, and only the "consonant + dot" fold existed. The corpus
  uses the single-codepoint form almost everywhere it appears — ज़ alone accounts for 217 lines.
- **The dot can be filed outside the halant it belongs inside.** "ख़्वाहिश" arrives as
  ख U+0916, halant U+094D, nukta U+093C — the dot sitting *after* the cluster marker though it modifies the
  consonant. A one-character lookahead never sees it. Reordered before the state machine, which is a
  correction rather than a guess: a nukta cannot modify a halant, so there is no other reading.

**Measured over the real library:** 253 cached `.lrc` files, 3818 Indic lines, 3806 of them romanisable.
Before: **756 lines leaked script**. After: **0**. The same sweep is what found the gap — an Indic codepoint
left in the output is the defect, so counting those characters across the whole corpus is a check that cannot
be faked by a table that *looks* complete.

**The probe was wrong first, and that is the other half of this entry.** The initial A/B test toggled
`settings.set("romanise", …)` from code that did `await import("/src/stores/settings.svelte.ts")` inside the CDP
`Runtime.evaluate`. Vite served that specifier as a **second module instance**, so the probe wrote a store the
app never renders from and reported the two states as identical text — a result that read as "the feature does
not work" and would have sent me rewriting a component that was already correct. The app publishes its own
singletons on `window.__noctra` in dev precisely so a probe reaches the instances that are live; use that, and
never import an app module into the page to drive it.

**Now guarded.** `romanize.test.ts` pins both spellings of all thirteen affected letters by codepoint escape,
the halant-ordering case, and per-script inherent vowels. Run against a reverted copy of the engine it fails
9 of 21, including every Bengali and Gurmukhi composed letter. `npm test` 78 pass / 0 fail, `npm run check`
clean. Re-measured in the rendered DOM on both surfaces for the same track: setting off → 22 of 22 lines
Devanagari; on → 22 of 22 Latin, 0 Indic characters anywhere in the lines.

**Lesson:** `NFC` and `NFD` do not convert between these two spellings — they are not canonical equivalents —
so nothing in the toolchain will ever reconcile them and the file looks and diffs and renders correctly either
way. A hand-typed Indic table needs its ambiguous letters written as escapes, and a feature that transforms
text needs a corpus, not a sample line.

---

## BUG-087 — The card went deaf: `ui.miniOpen` desynced and every state push was gated off

**Status:** RESOLVED. Found while verifying the waiting dots, not on its own account — the card was
showing **"Connecting…"** with zero lyric lines and zero buttons while the main window played normally.

**The root cause I first wrote here was wrong, and the correction is the useful part.** It said the
startup re-derive "ran once and either raced or Rust answered not-visible". It was measured afterwards,
and Rust *does* answer not-visible — for a window that is plainly on screen. The guard was not stale, it
was being handed a lie.

- **Root cause:** every push in the bridge is gated on the main window's `ui.miniOpen` flag
  (`if (stopped || !ui.miniOpen) return;` in the 250ms loop). That flag is written from a visibility
  query at startup, and `mini_visible` is `is_visible().unwrap_or(false)` inside a
  `.map(...).unwrap_or(false)` — so it returns false both when the window is genuinely hidden *and*
  whenever the command is unavailable or errors. It fails closed, and a false answer closes the gate on
  a visible card.
- **The same query fails from the other side too.** The fix first tried was a card-side watchdog guarded
  by `appWindow.isVisible()`, on the reasoning that the window itself knows best. Measured: it returned
  **`false` while the card was the focused, on-screen window** — `document.visibilityState` was
  `"visible"`, `document.hasFocus()` was `true`, inner size 406x394, body opacity 1, and the main window
  was the unfocused one. A transparent always-on-top WebView2 window is simply not something either
  query answers honestly. That guard was removed; the instrumented watchdog proved the interval was
  ticking and the gap was growing (4.3s → 30.3s) while `visible: false` blocked every ask.
- **Fix, two halves.** The startup re-derive is now **one-way**: only a `true` answer is acted on, so an
  unreliable query can open the gate but never shut it. And the card runs a watchdog that re-sends the
  existing `sync` command whenever the feed has been quiet for 2s — unguarded, because the only
  alternative signal was just shown to be untrustworthy. The main window's `sync` handler already set
  the mirror true and pushed; nothing on that side needed new machinery.
- **Verified by reproducing the failure, then reproducing the recovery.** Pre-fix: `ui.miniOpen = false`
  froze the card at `0:30` for 30+ seconds with the flag stuck down and no ask ever sent. Post-fix, with
  the main window stamped by an epoch marker so an HMR reload could not be mistaken for healing: the
  flag reopened within one poll and the card's clock advanced `3:14 → 3:17 → 3:20 → 3:27 → 3:33`. Then
  shut again on a long-mounted card, where the mount `sync` could not be responsible: reopened inside
  1.2s. `svelte-check` 0/0, `npm test` 87/0.
- **Cost accepted:** a genuinely hidden card now asks once every 2s and the main window rebuilds its
  snapshot 4x/second for it. That is a few field reads and a `favorites.has()`; the alternative was a
  card that can go permanently deaf with no path back.
- **Both halves are now committed.** They were split at first because `MiniApp.svelte` also carried
  another session's in-flight `createReelFollow(measure, apply, bounds)` call and
  `onwheel={follow.onWheel}`, whose three-argument overload exists only in their uncommitted
  `reelFollow.ts` — committing the card as-is would have produced a HEAD that fails to typecheck.
  Resolved by staging only this file's three watchdog hunks and leaving their two in the working tree,
  then confirming the staged blob contains no reference to the uncommitted API. Their scroll feature is
  still red on its own (3 failing tests in `reelFollow.test.ts`) and deliberately not committed.
- **Lesson:** a flag that mirrors external state is only as good as the query behind it, and "did you
  check the platform's own API" is not a finished question — the platform's own API returned false for a
  window that was on screen and had focus. When a query fails closed, acting on its negative turns a
  measurement problem into an outage. Prefer a repair path that needs no truth at all: the card knowing
  it has heard nothing is a fact available locally, and it is the one that fixed this. And "Connecting…"
  remains the worst possible surface for a dropped feed — it is the text for *not yet*, so a permanent
  failure reads as a transient one.

---

## BUG-088 — The lyric column hijacked the mouse wheel for volume

**Status:** RESOLVED. Reported as "why when I am scrolling in the full screen my volume is changing".
Not a wiring fault — the handler was deliberate, and the deliberate choice was the bug.

- **Root cause:** `Lyrics.svelte` bound `onwheel={onWheel}` on the lyric viewport, and `onWheel` did
  `e.preventDefault(); player.setVolume(volume + (deltaY > 0 ? -0.04 : 0.04))`. So scrolling anywhere
  over the right half of the fullscreen player turned the volume in 4% steps. The `preventDefault()`
  also swallowed the scroll the gesture was actually asking for — and there was nothing to scroll
  anyway, because `.lyrics` is `overflow: hidden` and the reel is positioned by the follow's
  `transform`, not by `scrollTop`. The handler therefore could only ever take something away.
- **Fix:** the handler and its binding are deleted. Wheel-volume itself is not lost — `VolumePill`
  carries its own `onwheel` and sits on this same screen, which is where the gesture belongs: under the
  pointer that is aiming at the volume.
- **Verified on the running app:** dispatching a `deltaY: 400` wheel event on `.lyrics` left
  `player.volume` at `0.273` → `0.273` (`lyricsStoleGesture: false`), while the same event on `.vpill`
  moved it to `0.233` (`pillResponds: true`). The test moved the real volume, so it was restored to
  `0.273` afterwards.
- **Lesson:** a gesture is claimed in one place, and the place that claims it is the place the user is
  pointing at. Repurposing a large passive region — half the screen — as a control for something else
  is not a shortcut, it is a trap, and `preventDefault()` makes it worse by cancelling the gesture's
  real meaning on top of giving it a surprising one. If the region cannot even do what the gesture
  asks, the handler has no upside at all.

---

## BUG-089 — LRCLIB's instrumental note glyph rendered as an unlabelled broken box

**Status:** RESOLVED. Reported as "change that music symbol into that dancing dot thingy". The user read
it as a malfunctioning control, which was a reasonable reading of what was on screen.

- **Root cause:** nothing in Noctra drew it. LRCLIB writes a bare `♪` (U+266A) into the timed slot of an
  instrumental break, and this app rendered that character as line text. The line is a
  `width: fit-content; padding: 2px 14px; border-radius: 12px` button, so one narrow glyph inside it came
  out as a small rounded rectangle with a note floating in the middle — the button chrome was visible
  and its label was not a word. Confirmed against live data rather than inferred: "I WANNA BE YOUR SLAVE"
  carries U+266A at 95740 ms and 153190 ms, and nothing else on those lines.
- **Fix:** `isInstrumental(text)` in `lrc.ts` — true for an empty/whitespace line or one made only of
  note characters (U+2669–U+266C and the emoji pair U+1F3B5 / U+1F3B6). Both lyric surfaces render that
  case as the same three-dot wave the intro uses, sized to their own type (14px dots rising 9px on the
  fullscreen, 8px rising 5px on the card), inheriting `currentColor` so the depth ramp reaches them like
  words. They animate only while that break is the line being played, which is the waiting row's rule.
  The button keeps its click handler, so a break is still seekable, and now carries
  `aria-label="Instrumental break"` instead of an accessible name of "♪".
- **One guard worth stating:** the sweep gradient that paints the sung line had to be excluded for these
  lines, because it sets `color: transparent` and would have erased the dots.
- **Verified on the running app, both surfaces.** Fullscreen at 102.25 s: `activeIsMarker: true`,
  `dotCount: 3`, dots `14px` at `rgb(255,255,255)`, `animation: lyric-wait 1.2s` with delays
  `0s / 0.2s / 0.4s`, `aria-label: "Instrumental break"`, and `noteCharStillPainting: false`. Sampled
  over 1.4 s the dots travelled `[8.93, 8.93, 4.64]` px with crests at 360/520 ms — which also proves the
  `var(--wait-rise)` inside the shared keyframe resolves per element rather than falling back to the
  waiting row's −15px. A non-active marker's dot computes `animation-name: none`. The card renders both
  markers (`.line.inst` count 2). 4 new tests in `lrc.test.ts`, including the boundary that a note
  among real words ("Na na na ♫") must stay a lyric. `npm test` 81/0, `svelte-check` 0/0, motion sweep
  12/12 with 0 findings.
- **Lesson:** a glyph that arrives from a data source is content, and content rendered into a control's
  box will look like the control. When a bare character lands inside `fit-content` padding, the padding
  is what the user sees. The fix was not to style the box better — it was to stop treating the character
  as a line of words.

---

## BUG-090 — The lyric column could not be scrolled at all, in either surface

**Status:** RESOLVED. Reported as "WHY CANT I SCROLL THE LYRICS WITH MY MOUSE SCROLL", for both the
fullscreen view and the mini player.

- **Not a regression, and not a broken handler.** Three things had to be true before a wheel could do
  anything, and none of them were:
  1. Both `.lyrics` boxes are `overflow: hidden` — deliberately, because the mask fade at the ends of the
     column and the pinned active line both depend on the reel being the only thing that moves. That also
     removes the native scroller, so `scrollTop` could never change. Measured: `scrollHeight` 4491 against
     a 927px viewport in fullscreen, 2381 against 288 in the card.
  2. No `wheel` handler existed on either surface. Across `src/` the only two are `Slider.svelte` and
     `VolumePill.svelte`.
  3. The reel's Y had no user term. It is written exclusively by `createReelFollow(measure, y => …)`, and
     `measure()` is a pure function of the line being sung. Even a handler would have had nothing to
     write to.
- **Precondition was BUG-088.** That round deleted the wheel→volume binding and recorded "there was
  nothing to scroll anyway". This is the other half of that fix: the gesture now does the thing it was
  always asking for, in the place the user is pointing.
- **Fix, in the shared service.** `createReelFollow` gains a `pinned` browse position and a `scroll()` /
  `onWheel()` pair, plus the reel's own `{ travel, view }` as a third argument. Both surfaces wire the
  same object, so the parity rule cannot be broken by one of them drifting. `onWheel` normalises
  `deltaMode`, because a mouse sends pixels, a trackpad sends lines and a legacy device sends pages.
- **The behaviour, and why each rule is there:**
  - A scroll applies **instantly**, not through the follow's easing. The smoothing hides the playhead
    re-measuring a column that is still changing height; putting the reader's own wheel through it makes
    the text feel rubbery.
  - While browsed, the playhead is **ignored**. A column that drifts while you are reading it is worse
    than one you cannot move.
  - A small scroll does **not** snap back. Without that latch a 50px nudge would be recentred and the
    wheel would be useless.
  - Control returns when the sung line comes back into view — latched through `wasOutside`, so it only
    hands back once the line had actually left. And `jump()` drops the offset, so a seek or a new track
    re-attaches.
- **Tested first:** six cases added to `reelFollow.test.ts` before the implementation, all failing with
  `scroll is not a function`, then 19/19 in the file and 87/87 across the suite. The existing thirteen
  are unaffected because the new argument is optional and absent means no clamping and no browse.
- **Verified on the running app:** with playback **paused** — the earlier probe had to be redone because
  a playing track moves the reel on its own and faked a pass — five wheel ticks moved fullscreen
  −1278 → −1695 and the card −624 → −831, both landing exactly on `travel`, and scrolling back stopped
  exactly on 0. Eight samples over 2s while paused held at a constant value, so there is no
  attach/detach thrash. Seeking +45s moved the reel to −1047, confirming a seek re-attaches.
  `svelte-check` 0/0, build clean.
- **Lesson:** "the scroll doesn't work" and "the scroll handler is broken" are different diagnoses, and
  the second one is the tempting guess. The instrument that mattered here was the paused test: the first
  run reported `MOVED (scroll works)` purely because audio was playing.

---

## BUG-091 — The reel re-centred on every line, so the column was never still

**Status:** RESOLVED. Reported as "the current lyric line which is being played automatically shifts
itself if it is not in the middle… some scrolling for sometime". Offered three readings, the owner chose
**"only move when it must"**.

- **Root cause:** `measure()` in both surfaces returns the translateY that puts the sung line dead
  centre, and the follow eases toward it on every line change. So the column crept a few pixels every
  few seconds for the entire song — motion nobody asked for, and which cannot be opted out of while the
  track plays.
- **Fix — a hold band, in the shared service.** The reel keeps its position while the sung line is
  within `HOLD_BAND` of the centre and glides only once it drifts past that. `measure()`'s return is
  already the centring position, so the line's current distance from centre is exactly `|y - target|`;
  no extra geometry was needed. While holding, `target = y`, which also lets the loop park instead of
  re-measuring a column that is not going anywhere.
- **A hold that re-tests every frame cancels its own glide.** First implementation stopped a move
  0.29px short: as the reel approached the line the drift fell back inside the band, the hold
  re-asserted, and it parked mid-travel. The band is now a Schmitt trigger — it releases past the band
  and re-arms only on arrival, where it lands exactly rather than at the boundary.
- **Why the band is 30% and not larger:** the column's mask fade runs `#000 14% … 86%`, so the clear
  zone is ±36% of the height from centre. At 40% the active line would sit inside the fade and be
  dimming out the whole time it is being sung. 30% leaves margin on both surfaces: ~5 lines of slack in
  the 927px fullscreen column, ~3 in the 288px card.
- **Interacts with the browse pin by design.** `jump()` clears the pin *and* the commit flag, so a seek
  or a new track still re-centres even when the line was already readable — a seek is not drift.
  Resuming after a browse no longer yanks to centre either; it just starts moving again when it must.
- **Tested first:** four cases added before the implementation, three failing. 23/23 in
  `reelFollow.test.ts`, 91/91 across the suite. The pre-existing thirteen are untouched because the
  band only exists when the caller supplies a `view`.
- **Verified live, from a known attached state:** fullscreen — 10 line changes, 7 scrolled the reel
  (was 100%), max drift 245px inside a 278px band. Card — 3 line changes, 1 scrolled (was 100%), max
  drift 83px inside an 86px band, frames in motion 7% → 3%. `svelte-check` 0/0, build clean.
- **The first live measurement was invalid and is worth recording:** it reported 0% movement on both
  surfaces, which looked like a clean pass. It was not — both were still pinned from the wheel test in
  the previous entry, and `pinned` bypasses the hold entirely, while the fullscreen sample had no
  detected sung line at all. A forced track change (which is what calls `jump()`) was needed to get back
  to an attached state before the numbers meant anything.
- **Lesson:** before trusting a behavioural measurement, confirm the system is in the state the feature
  requires. "Nothing moved" and "nothing was allowed to move" produce identical numbers.

---

## BUG-092 — Gapless was enabled and could never fire: the preload lead was shorter than the load

**Status:** RESOLVED for transitions. The cold-load cost behind it is only partly reduced — see below.

**Reported as:** "WHY DID THE BUFFERING TAKING SO MUCH AND FOR EACH SONG AND CROSSFADE AND GAPLESS IDK IS
IT EVEN WORKING OR NOT".

**The arithmetic made it impossible.** `armStandby` gated preloading on
`duration - position > crossfadeSec + 6` (`player.svelte.ts`). With crossfade at its default of 0 that is
a **6-second** lead. A cold local FLAC measured 9–13.7s to become audible. So the next song was armed
too late to ever finish loading, every boundary stalled, and `gapless` sat in Settings looking enabled.
The lead was hostage to a fade control the owner had deliberately turned off.

**Fix:** `Math.max(crossfadeSec + 6, STANDBY_LEAD_FLOOR)` with the floor at 22s, so crossfade stays a
taste control and the preload always gets long enough to finish.

**Verified on a real boundary** ("O Piya", parked 30s from the end): standby armed at **21.8s**
remaining, reached `readyState >= 3` at **13.1s** remaining, and across the handoff `isBuffering` was
false at the flip and in 0 of 8 samples after it. Before the fix the same deck sat at
`readyState 0 / networkState 3` with nothing loaded for the whole song.

**What I did not fix, and one claim I am withdrawing.** I raised `MAX_CHUNK` from 2MB to 8MB and removed
a double copy from `read_logical` (it staged every 256KB in a fresh scratch vector and then
`extend_from_slice`d it, so the body was allocated and copied twice). Cold load went 11–13.7s → 9–12s:
real, but ~25%, not the fix. Throughput measures 4–11 MB/s and a 30MB FLAC therefore costs about what it
costs; the ceiling is the multi-megabyte copy across Tauri's URI-scheme bridge, not the request count.

I also briefly concluded `preload = "auto"` was the culprit, on an A/B showing 9650ms versus 539ms. **That
reading was confounded** — the second run used the same file the first run had already pulled into
cache. Splitting preload by deck role is still the right thing (a deck about to be heard should not ask
for the whole file) so I kept it, but the comment in `deck.ts` now says what it actually is instead of
repeating my bad number.

**Remaining, unfixed:** first play of a track the user just chose still waits ~9–12s. Closing that needs
a different serving path — a real localhost HTTP server, or pre-decoding — which is a structural change
to the audio subsystem rather than a tuning.

---

## BUG-093 — A small manual scroll pinned the lyric reel for the rest of the song

**Status:** RESOLVED, with two regression tests that were confirmed to fail before the fix.

**Reported as:** "till 18 secs it was automatically scrolling but when i scrolled at 19 sec after some
time the current lyric which is being played is not automatically scrolled back". The owner then stated
the intended behaviour directly: hold for a few seconds where they scrolled, then return to the sung
line and carry on.

**Cause.** Releasing manual control required `wasOutside`, and `wasOutside` only latches when the sung
line has been pushed more than half a viewport from where the reader parked the column:

```
if (Math.abs(pinned - next) > view / 2) wasOutside = true;
else if (wasOutside) { pinned = null; ... }
```

A modest scroll never crosses that line, so `wasOutside` stays false, the release branch can never
fire, and `pinned` holds for the remainder of the track. The only escapes were `jump()` — a seek or a
new song. "Scroll a little" was a permanent action.

The latch was not pointless: without it a 50px nudge got snapped straight back to centre, which makes
the wheel useless. The error was treating "the reader lost the line" as the only reason to hand control
back, when it is only a reason to hand it back *early*.

**Fix.** A 4000ms timer armed on every scroll, so browsing always ends, and the existing `wasOutside`
path is kept as the early lane — if the line drifts back into view sooner there is no reason to wait it
out. Each further scroll restarts the clock, so nobody is pulled away mid-gesture.

A real timer rather than a frame budget, because a pinned reel is already at its target, which lets the
loop park itself after `CALM` frames — and a parked loop would never notice frames ticking by.

**Testable only after fixing the rig.** The fake clock drove `requestAnimationFrame` but not
`setTimeout`, so the contract had no way to be asserted; both are now on the same hand-cranked clock.
The two new tests were run against the unfixed module and both fail (`-500 !== -400`), so they guard
the regression rather than merely describing the change. 93/93 pass.

**Note on the first attempt:** `resumeTimer` was typed `number`, which is right in a browser and wrong
under `@types/node`, where `setTimeout` returns a `Timeout`. `ReturnType<typeof setTimeout>` is correct
in all three contexts — browser, the mini card's webview, and the node test rig.

---

## BUG-094 — A failed release build reported success and nearly shipped the previous installer

- **Status:** CAUGHT (before any file was replaced)
- **Phase:** release pass
- **What happened:** `npm run tauri build` was launched as a background task written as
  `npm run tauri build > log 2>&1; echo "EXIT=$?"; tail -20 log`. The task reported **exit code 0**,
  because the last command in that chain is `tail`, and `tail` succeeded. The build itself had died in
  `tauri-winres` for want of `rc.exe` (see R-10). Had the next step run, the freshly "built" installer
  would have been copied over the Desktop and backup copies — where it would have been, byte for byte,
  the September 28 build that was 18 frontend files behind the app.
- **How it was caught:** the verification step compared the artifact's fingerprint rather than trusting
  the pipeline. `Noctra_0.1.0_x64-setup.exe` still had mtime Sep 28 06:35, size 2091941 and MD5
  `8fe4d82a…`, identical to the copy on the Desktop. A build that produced nothing cannot change a
  hash, so the only honest reading of "exit 0" plus "identical hash" is that the exit code was a lie.
- **The rule this establishes:** for a build, the *artifact* is the assertion. Check mtime, size and
  hash before believing any status line, and never let the command whose exit code matters be followed
  by a pipe or a trailing utility. The shell form here should be `cmd && echo ok` at most, never
  `cmd; tail`.
- **Also worth noting:** the outgoing installer was preserved as
  `D:\noctra-backups\Install Noctra (Sep 28 build).exe` before anything was overwritten, so the
  discovery cost nothing.

---

## BUG-095 — Crossfade was cancelled by its own settings effect, ~1s into every fade

- **Status:** FIXED (measured through a complete transition)
- **Reported as:** the crossfade spec — "skips the end of the song and plays the next one suddenly",
  and a waveform that "drops abruptly then fluctuates messily at a low level for over 11 seconds".
- **The spec's §0 diagnosis was wrong about this codebase, and following it would have broken the
  feature.** It asserts gapless and crossfade are two mechanisms racing each other and asks that
  turning crossfade on switch gapless *off*. In fact `decideHandoff()` (`services/audio/handoff.ts`)
  is a single pure function returning exactly one action per tick, and line 42 reads
  *"Crossfade is a kind of gapless. If gapless is off, no second deck ever exists."* So
  crossfade-on-implies-gapless-off does not produce a race — it produces **no crossfade at all**,
  because `decideHandoff` returns `none` whenever `gapless` is false. §1's structural worry was
  already satisfied too: the engine has run two `Deck`s (active/standby) since the two-deck rewrite.
- **Actual root cause:** `App.svelte` runs `$effect(() => player.syncHandoffSettings())`, and that
  method began with an unconditional `engine.cancelHandoff()`. `settings.set()` replaces the entire
  `$state` object (`this.value = { ...this.value, [key]: v }`), so a write to *any* setting — volume,
  lyrics offset, anything — re-runs the effect. Instrumented over one idle playback stretch,
  `syncHandoffSettings` fired at t=3.82, 5.80 and 7.77s with the pair still `true/5`: **three runs,
  zero changes.** Each one called `cancelHandoff()` → `stopRamp()` → both decks snapped back to unity
  gain. So `beginHandoff(5)` started the ramp and it was murdered roughly a second later. That is the
  "fluctuates messily at a low level" waveform exactly: a fade begun, cut, and re-armed.
- **Fix:** the push is now guarded on the `(gapless, crossfadeSec)` pair actually last applied, so only
  a genuine change may disarm a handoff. The cancel-on-real-change behaviour is kept deliberately —
  a standby decoded under the old rule really is the wrong standby.
- **Verification:** `scripts/handoff-instrumented.js` wraps the engine's handoff methods and prints the
  call sequence; `scripts/ramp2.js` samples both decks by role through a transition. Before:
  `startRamp` at 5.15s, `cancelHandoff` at 6.28s and 7.22s, no ramp. After: a continuous ~5s crossover,
  incoming ramp 0.57→0.986 and outgoing 0.43→0.014, **the two ramps summing to 1.00 at every sample**,
  the outgoing deck pausing as the incoming reaches the user's 0.8, then a clean `idle` with
  `fadeSeconds` back to 0. No silent sample. 0 type errors, 93/93 tests, 16/16 handoff tests.
- **Left alone on purpose:** the object-replacement churn in `settings.set()` is the underlying waste
  and would make *every* settings-reading effect re-run. Fixing it means touching a store shared by
  the whole UI, which is outside a crossfade fix. The guard removes the damage; the churn remains.
- **Still owed:** the spec's §4 asks for a *natural* end-of-track transition by ear. This was measured
  by seeking to 8s from the end, which exercises the identical code path but is not the same thing as
  listening to it.

---

## BUG-096 — The production CSS minifier deleted `backdrop-filter` and `translate`, so the shipped app had no glass

- **Status:** FIXED (verified in the browser's own CSSOM, not by reading a file)
- **Reported as:** "the play bar at the bottom has no liquid glass effect, it is rather transparent
  fully", and separately "the heart is still misplaced in fullscreen".
- **Root cause:** vite 8 builds through rolldown, and its default CSS minifier drops both
  `backdrop-filter` and the standalone `translate` property. Nothing about the app's CSS was wrong —
  the declarations simply were not in the output. `dist/assets/main.css` carried **one**
  `backdrop-filter` where the source has ~13 rules, and the parsed `.glass` rule in the running app
  contained `background-color` and `box-shadow` but no filter at all.
- **Why the two symptoms look unrelated:**
  - `.glass` lost `backdrop-filter` → every glass surface became a plain translucent rectangle with no
    blur, so the Now Playing bar showed the list rows straight through it.
  - `.bigheart` lost `translate: -50% -50%` while keeping `left:50%; top:50%`, which positions a box by
    its **top-left corner** at the centre. Measured offset: +186.4px on both axes — exactly half the
    element's own 372.7px width. The heart was not mis-centred by a layout bug; it was centred on its
    own corner.
- **Why it survived every previous check:** both properties are fine in `npm run tauri dev`, which
  serves unminified CSS. The loss only appears in a production build, and every visual pass up to now
  was done in dev.
- **Fix:** `build.cssMinify: false` in `vite.config.ts`. `cssMinify: "esbuild"` was tried first and
  fails outright — rolldown-vite does not ship the `esbuild` package. The cost is CSS size (main
  71KB→151KB, mini 12KB→37KB, romanize 22KB→69KB), which is nothing for a locally installed desktop
  app and is bought back entirely by having the styles exist.
- **Verification:** rebuilt CSS now carries 4 `backdrop-filter` declarations in `main` (was 1) and 4
  `translate` (was 2); `romanize` went 10→22. To be confirmed again against the *installed* build,
  since that is the artifact that was lying.
- **General lesson:** a dev-server screenshot is not evidence about a release bundle. Any visual claim
  has to be measured in the built artifact, because the build is where this class of defect lives.

---

## BUG-097 — The sweep tool reported six clean views when it had only ever measured one

- **Status:** FIXED
- **Symptom in the tool, not the app:** a six-view contrast sweep against the *installed* build
  printed "sampled 29 text elements — 0 FAIL" six times, with an identical "5 fully covered" count.
  Real views have 14 to 113 nodes, so six identical results meant six measurements of the same screen.
- **Cause:** `nav-to.mjs` selected its CDP target with `url.includes("1420")`. That port only exists
  under `tauri dev`; an installed build serves from `tauri.localhost`, so the script printed
  `no main target` and exited 2 — and the sweep had piped its output into `/dev/null`, so the failure
  was invisible and the loop just re-audited whatever was already on screen.
- **The near-miss matters:** that output reads as a clean bill of health two minutes before a release.
  It was caught only because identical counts across different views are the exact signature this
  project has now been bitten by twice.
- **Fix:** target selection in `nav-to.mjs`, `probe-hover.mjs`, `cdp-eval.mjs` and `shot.mjs` now
  identifies the main window by *excluding* the mini card rather than by requiring the dev port, which
  works in dev and against an installed binary alike. Re-run properly, the same sweep reports
  113 / 80 / 14 / 14 / 70 / 89 nodes per view — and still 0 contrast failures, which is now a claim
  backed by six different screens.
- **Rule:** never send a harness's own output to `/dev/null` inside a loop that reports success.

---

## Known risks (not bugs yet, but expected trouble spots)

Tracked here so a later failure is recognisable rather than novel.

| ID | Risk | Why it may bite |
|---|---|---|
| R-1 | Transparent + always-on-top mini-player on WebView2 | ~~Unverified~~ Now verified working: the config-declared transparent window captures with its tinted card and blurred lyrics intact (see BUG-011). The residual quirk is that `PrintWindow` on a transparent window can come back near-empty, which is a capture artefact, not a blank card. |
| R-2 | Fullscreen lyrics fps | The spec names this the highest-risk view. Blur + drift + word highlight together. |
| R-3 | `lofty` cover-art extraction on OGG/M4A | The reason the spec insists on Rust here; JS tag libraries are unreliable for these formats. |
| R-4 | Library scan freezing the UI | Must stream in batches from a Rust background command, never one blocking call. |
| R-5 | First-play placeholder background | Blur is computed once per track, so the very first play may show a placeholder. Correct behaviour, not a defect. |
| R-6 | Closing the main window leaves the process alive | Observed, not yet decided. The `mini` window is declared in `tauri.conf.json` and only hidden, so it keeps the process up after the main window is closed: `noctra.exe` survives with no visible window at all. That is either a leak or a feature — many players deliberately let the desktop widget keep playing — but it needs an explicit decision plus a tray icon or an "exit" affordance, not an accident. Side effect worth knowing: a hidden instance keeps port 1420 bound, so the next `npm run tauri dev` fails with "Port 1420 is already in use" for reasons that look unrelated. |
| R-7 | Lyrics lookup is rate-limited by the provider, not by us | LRCLIB returns 503 at anything denser than roughly one request per 500ms. `REQUEST_GAP_MS` spaces our own calls, but anything that warms the lyrics cache across a whole library needs its own pacing. |
| R-8 | Embedded ID3v2 `SYLT` (synchronised lyrics) is unreadable in lofty 0.25 | It arrives as a raw binary frame and unmapped frames are dropped when a format tag converts to the generic `Tag`, so reading it needs a hand-written ID3v2 parser. Taggers almost never write `SYLT`, so the cost is real and the benefit is not. Files that do carry it fall back to `USLT`/`LYRICS` and lose only the word level. |
| R-9 | `read_embedded_lyrics` has never run | It is new Rust, so the live dev instance that the Tier 1 tests drove did not have it registered. It compiles clean under `cargo check`; a rebuild is needed before the embedded tier can be confirmed against the 195 library files that carry a `lyrics=` tag. |
| R-10 | A release build needs the VS dev shell, and a plain shell fails silently-ish | `npm run tauri build` from Git Bash dies in `tauri-winres` with *"Are you sure you have RC.EXE in your $PATH"*. Nothing is wrong with the project: `rc.exe` only resolves inside the Visual Studio Build Tools environment, so the build must be launched through `VsDevCmd.bat -arch=amd64`. See BUG-094 for the way this nearly shipped a stale installer. |
