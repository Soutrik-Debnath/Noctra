# Noctra — feature batch from the inspiration + master spec docs

## Context

You asked to "add these features" from `noctra-feature-inspiration.md` and the consolidated master
spec. The project is much further along than `HANDOFF.md` claims — its phase table says Phase 5 was
never started, but queue, playlists, favourites, lyrics, settings, taskbar integration and the
statistics page all exist and work.

So the first job was an audit of all 33 feature ideas against the real code. Most were already
built. What was missing split into a cheap core tier and an expensive advanced tier.

**Scope decided:** core usability, the visual tier, **and the full audio tier** — gapless,
crossfade, ReplayGain and a parametric EQ. Plus the smart-playlist rule editor and a true
fullscreen artwork mode.

**Declined:** system tray, "Open with Noctra", Discord Rich Presence, vim navigation, the metadata
editor, library maintenance tools, M3U import/export, waveform seek bar, custom accent picker,
Japanese/Korean romanisation. Those are logged in `PROGRESS.md` as considered-and-rejected with the
reason, so a later session does not re-offer them.

One consequence of taking EQ, worth stating before you approve: `createMediaElementSource` is
**permanent for a given element** — you cannot un-hook it. So "EQ off gives you back today's
verified playback" cannot mean "the graph is bypassed". It has to mean "a fresh element on the
direct path", which costs one re-seek when you toggle. Designing for that from the start is the
only way to avoid a silent no-sound failure state, so it shapes Phase 8 and Phase 9 below.

With an `AudioContext` present anyway, the audio-reactive art "breathing" from the inspiration doc
becomes nearly free when EQ is on, and is noted there rather than in its own phase.

**A second source batch arrived after this was written** — Echo Music settings screenshots — which
adds Phases 14 to 16: full offline silence analysis and skipping, a queue and playback-continuity
group, and the lyric presentation group. Its own triage and rejections are recorded there.

That puts **17 phases** in front of you, which is not a sensible thing to attempt in one pass. The
build order at the bottom of this file is the honest recommendation: the lyrics and queue groups are
cheap, low-risk and immediately visible, while the audio-engine work is where the app can actually
break. I would land the bug fix plus Phases 0 to 6, stop, use it for a while, then treat 7 to 16 as
a second round with its own approval.

## Already built and verified in the live app

Done in this session before planning began; checked by running probes over the CDP harness against
the real 314-track library, not by reading the code.

| Feature | Evidence |
|---|---|
| True Fisher-Yates shuffle everywhere | `playSimilar`'s biased `sort(() => Math.random()-0.5)` replaced with `utils/shuffle.ts`; probe: complete permutation, 310/314 positions moved |
| Related tracks from local history | `history.svelte.ts` now records "heard together" pairs; `similarTo` scores on adjacency + genre + a familiarity tiebreak |
| Queue insert-after-latest-inserted | Was a real bug — queuing A, B, C produced `[C,B,A]`. Probe: `[0,1,2]` |
| Repeat N times then advance | 4th mode, right-click the repeat orb, clamped 2–20, `×N` rendered on the button |
| "Never play this again" | New `blocked.svelte.ts`, per track and per artist, filtered out of the play order; probe confirms the victim leaves and re-enters the order |
| A-B section loop | Code complete, typechecks. **Not yet probed** |
| Timestamp bookmarks | Code complete, typechecks. **Not yet probed** |

## Corrections to my own earlier audit

Two findings from the design pass overturned what I first reported. Both are load-bearing.

- **Local `.lrc` reading already exists and works.** `read_sidecar_lyrics` at
  `src-tauri/src/commands/mod.rs:126`, registered at `lib.rs:43`, and `services/lyrics/lyrics.ts:147`
  calls it *first*, ahead of the cache, returning source `"local file"`. The Settings copy about
  local lyrics is accurate. Only **embedded-tag** lyrics is fabricated — `lrc.ts:23` allows
  `"embedded tag"` and `LyricsSettings.svelte:35` renders "Embedded in the track", but no code path
  can ever produce that string.
- **`src/services/audio/shortcuts.ts:93` is not a duplicate case** — `"l"` closes the `S` case above
  it and returns; `Escape` is the next case. I misread it as a bug. Leave it alone.

## Bug to fix first — "Delete cached lyrics" deletes nothing and reports success

Verified by reading all four sites. This violates your own definition of done ("no feature that
silently fails or fakes success"), so it goes before any new feature.

- Cache is **written** with the decoded duration: `App.svelte:104` passes
  `duration: player.duration || c.duration`.
- Cache is **deleted** with the tag duration: `LyricsSettings.svelte:55` and `trackMenu.ts:70` both
  pass `c.duration`.
- `fingerprint()` rounds to whole seconds, so a tag of `214` and a decoded `214.6` hash differently.
- `commands/mod.rs:112` maps `ErrorKind::NotFound` to `Ok(())`, so `deleteCache` returns `true` and
  the UI clears the view as if it worked.

Fix: one duration source for save and delete alike, and have `delete_lyrics` return
`deleted | notCached` so the UI can say which. Log as a new `BUG-0NN` in `BUGS.md`.

## Build order

### Phase 0 — hygiene (unblocks the next two)
- `player.tracks` is a plain getter that rebuilds 314 objects on every read, and
  `views/Library.svelte` hits it twice per visible row (lines 135, 140). Make it `$derived`.
- `player.index` is an index into a mutable array that `removeTrack()` never re-anchors. Add
  `library.removeTracks(ids)` plus `reanchorAfterRemoval()` before anything bulk-deletes.
- `library.filtered` returns `this.tracks` **by reference** when the search box is empty, so an
  in-place sort would silently reorder the real library. Every sort must copy first.

### Phase 1 — sorting, and the `dateAdded` data it needs
- `src/services/sort.ts`: `SortKey` = title / artist / album / year / duration / added / plays, one
  module-level `Intl.Collator` with `numeric: true`, deterministic tie-break on title+id so keyed
  rows don't remount while scrolling.
- New `src/stores/added.svelte.ts` (`noctra.added`, id to epoch ms), written only for genuinely
  fresh tracks. Deliberately **not** a Rust scan field: a rebuild-on-"Replace" would reset every
  date and make the view a lie.
- **Honesty constraint:** 314 existing tracks have no add date. Do not backfill with today — show a
  real empty state saying dates are recorded from now on.
- Preference lives in `Settings` as one global `{sortKey, sortDir}`, not per-view.
- UI: a single `Sort: Title ↑` button opening a menu, reusing `repeatMenu.ts` / `sleepMenu.ts`
  idiom. Not a 7-option segmented control, which would wrap the header.
- Shared by Library, Favorites and the new Browse pages. **Not** playlists, albums or the queue —
  their order is user intent, and sorting it is a bug.

### Phase 2 — Browse: Albums, Artists, Genres, Folders, Recently Added
- **One** `Browse.svelte` with a facet parameter, not five views. Five sidebar entries and five
  `{#if}` branches is nav bloat at this size.
- `src/services/browse.ts` derives all five from `library.tracks` + `added` + `history`. Genres gets
  an explicit "Unlabelled" bucket rather than dropping those tracks.
- Sidebar gains a `group` field with divider labels — labels only, no collapsible accordion.
- Fixes Home's cap misrepresentation with "See all" links rather than raising the 12/8 limits.

### Phase 3 — bulk multi-select
- `src/stores/selection.svelte.ts` with a `source` field so navigating away clears it, otherwise
  "remove from library" acts on rows that are no longer on screen.
- Plain click still plays. Ctrl+click toggles, Shift+click ranges over the *displayed sorted* order,
  right-click inside a selection gives a batch menu, right-click outside clears it first.
- Permanent 26px checkbox slot — one that appears on hover shifts every row and makes the list
  twitch while scrolling.
- One fixed floating action bar, not four per-page toolbars.
- **No glass on rows**: 30-40 rows each with a live `backdrop-filter` is exactly the frame cliff
  your one remaining ban exists to prevent.

### Phase 4 — lyrics sources
- New read-only Rust `read_embedded_lyrics` using lofty: `LYRICS` for FLAC/OGG (these really do
  carry synced LRC), `©lyr` for M4A, `USLT` for MP3. **Skip MP3 `SYLT`** — it needs byte-level
  parsing of a rare frame, and a wrong decode produces confidently-wrong lyrics, the worst failure
  mode available here. Record that rejection in `PROGRESS.md`.
- Never open the audio file writeably, in this or any future command.
- `Settings.lyricsPriority: LyricsSourceId[]`, default `["sidecar","embedded","cache","lrclib"]`,
  validated in `sanitize()` by filtering to known ids and appending missing ones so a half-written
  value cannot lose a source.
- Cache entries get a `#[noctra-source: lrclib]` marker line — `parseLrc` already skips metadata
  comments, so no parser change — so a cached network guess can never outrank a local file the user
  added afterwards.

### Phase 5 — per-item resume position
- Needs a context identity the player does not have: `context = $state<PlayContextId>` as a string
  like `library` / `playlist:<id>` / `album:<key>` / `queue`.
- Key is `${contextId}|${trackId}` in one `noctra.resume` map, storing `at`, `total` and `atMs`, so
  per-track, per-playlist and per-queue are one mechanism rather than three.
- Written from the 15Hz clock into memory, gated to 1/sec, persisted on a 10s debounce plus
  immediately on pause / track change / `pagehide`. Not piggybacked on `history`'s 5s timer.
- Skips when `loopArmed` — otherwise a looped 12-second passage stores an offset inside itself and
  next session seeks backwards into a span you explicitly rejected.
- Applied **only** on launch restore and on explicitly entering a context, never inside
  `moveTo`/`next`/`previous`, which are allowed to keep resetting position to 0. Must not break
  `previous()`'s 3-second-restart convention, which is the escape hatch out of a resumed track.
- Seek lands via a `pendingSeek` applied in the existing `ready` callback, because `engine.seek`
  clamps against a duration that is NaN before metadata. Restore stays paused — no autoplay.
- **Deferred honestly:** "resume per playlist" will mean *resume the last track of that playlist*,
  not *continue the album from track 7*. That needs `order` built from the context's own track list,
  a real refactor of `ensureOrder`/`stepBy`/`similarTo` and the shuffle-pin logic that caused
  BUG-018. Its own phase, after this proves the persistence shape.

### Phase 6 — real liquid glass
- **Step 0 is a spike, not a component.** Prove whether WebView2 accepts `url()` inside
  `backdrop-filter` at all. Chromium support has been unreliable for years, and the whole design
  turns on the answer. If it fails, fall back to an in-pane image layer under `filter: url()`,
  which is fully supported — the honest limitation there being that panes refract the artwork, not
  each other.
- Needs a sharper 360px source from `services/artwork/blur.ts`. Refracting the existing 180px tile
  bends a blur, which reads as "nothing happened".
- Normal map generated from a rounded-rect signed distance field, cached on geometry quantised to
  4px, or it regenerates on every sub-pixel resize.
- Filter on a `::before` layer with a rim-band mask — never on the pane root, or the text refracts
  too, which is how this feature usually ruins a UI. Explicit filter regions, or a 48px pill clips
  the bevel into a hard edge. Refcounted filter registry in an SVG def, or every view switch leaks.
- Degrades to today's verified `.glass` under `data-low-power`, centre masked so the measured
  contrast numbers are untouched.
- Convert four surfaces first — sidebar, mini-player bar, queue panel, lyrics sheet — and record
  before/after numbers in `PROGRESS.md` for each.

### Phase 7 — ReplayGain / loudness normalisation
First audio item, because it needs no graph and no engine change — just tag data and a multiplier.
- Rust `read_one` reads `REPLAYGAIN_TRACK_GAIN/PEAK` and `..._ALBUM_...` into `ScannedTrack` as
  `Option<f64>` with `#[serde(default)]`.
- **These must go into the staleness check**, which means one full re-read of the library. That is
  unavoidable: unchanged files are never re-parsed, so gains would otherwise stay empty forever.
  The scan is streamed and non-blocking, so this is seconds, not a stall. Say so before doing it.
- Apply as a pre-amp **below** the user's volume, never by pushing `el.volume` past 1 — a +6 dB
  track cannot be represented otherwise. Global headroom equal to the largest positive gain in the
  library pulls everything down instead of clipping the loud ones. `peak + gain > 0` reduces that
  track's gain to `-peak`.
- No tags → unadjusted, and Settings shows an honest "no loudness data for N of 314" count. Do not
  compute gain by decoding files; that is the expensive version and it is not wanted.
- UI: Off / Track / Album segmented control in the Playback section.

### Phase 8 — Two-deck engine: gapless and crossfade
The riskiest change in the whole batch. `engine.ts` currently guarantees exactly one
`<audio>` element and the handoff code depends on it.
- Deck-based rewrite: active plus preloaded standby, same `EngineEvents` seam so the player store
  barely changes. New `prepare(source)` and `crossfadeTo(source, seconds)`.
- Everything reading position must move to the active deck only: the 15Hz clock, `history.addSeconds`
  (double-counting here is the likely bug), the A-B loop, resume, the taskbar glyph and SMTC.
  `ended` must not fire during a crossfade.
- **Gapless will be honest, not perfect.** A timer-driven handoff between two HTML5 elements leaves a
  few milliseconds of gap or overlap. Sample-accurate gapless needs decode-to-buffer, which is a
  different engine. Ship it labelled "seamless", not "sample-accurate".
- Must be tested against two concurrent `noctra-audio://` streams — the FLAC header patch from
  BUG-008 has only ever run one file at a time, and the protocol's per-path plan cache and 2MB
  response cap are unverified under that load.
- Settings: gapless toggle and crossfade 0–12s slider as **separate** controls; the spec is right
  that they solve different problems.

### Phase 9 — Parametric EQ, opt-in
- `services/audio/graph.ts`: one context, per-deck `createMediaElementSource` → six
  `BiquadFilterNode` (low shelf, two peaking, high shelf) → pre-amp → destination.
- Because attaching a source node is irreversible, the on/off switch **recreates the element** and
  re-seeks to the saved position. One blip when you toggle is the honest price of keeping the
  verified direct path available; the alternative is the graph always being in the signal path.
- Pay the `AudioContext.resume()` cost inside the existing `warmUpOutput()` window so it never
  lands on a user's first play.
- Presets in `noctra.eq`: Flat / Bass boost / Vocal / Acoustic built in, plus save-current-as, and a
  bypass A/B.
- If the graph ever fails to attach, output is silent — so this needs a visible indicator that the
  graph is live and a reset-audio escape hatch, tested in both modes.
- Optional consumer when the graph is on: the audio-reactive art breathing from the inspiration doc,
  fed by an `AnalyserNode`. Nearly free here, and still unavailable with EQ off.

### Phase 10 — Smart playlists
- Prerequisite: a star rating. `Track` has no `rating` field and none exists anywhere, so the
  rating rule the spec asks for has nothing to run on yet. New `noctra.ratings` plus rating UI in
  the row menu and Now Playing. (The master spec lists ratings as core Phase 5 work, so this is
  back-filling a gap rather than a new idea.)
- `src/services/smart.ts`: rules as `{ field, op, value }` combined ALL/ANY. Fields: genre, artist,
  album, year, plays, rating, duration, added, last-played, never-played. Never-played is a set
  difference against `history.plays`, not a zero filter.
- Smart playlists persist as **rules**, never materialised ids, so they track a growing history.
  `Playlist` gains `kind: "manual" | "smart"`, defaulted to manual so existing lists are untouched.
- Memoise the evaluation on library length plus history/added versions, or it re-runs over 314
  tracks on every render.
- Builder UI with a live "matches N tracks" count.

### Phase 11 — True fullscreen and artwork zoom
- Real OS-level fullscreen on the main window with `F` and Esc, restoring the prior size. The
  `fullscreen` and `fullscreen-exit` glyphs are already drawn and currently unused.
- Click the cover to zoom to an art-only view; click again to return. Keep the
  `data-art-light` ink flip working at the larger size.

### Phase 12 — per-track audio info
The data is already captured and displayed nowhere. `scan.rs:275` reads codec, bitrate, sample rate
and bit depth; they flow through `StoredTrack` into `Track`; the only consumer in the whole UI is
`Stats.svelte:31` bucketing lossless vs lossy. So this is presentation, not collection.
- Subtle and on demand, per the spec: a `FLAC · 24-bit · 96 kHz` line in Now Playing behind a
  details toggle, plus the same string as the tooltip on a track row's format chip. Never by default.
- Where a property is 0 (bit depth on lossy formats, where the concept does not apply), omit that
  segment rather than printing `0-bit`.

### Phase 13 — animation polish
- Reinterpreted: Settings has four stacked cards and **no tabs**, so a tab indicator doesn't apply.
  Build the two that do — a single sliding thumb on the `.segmented` repeat control, and one
  travelling indicator on the sidebar, which today cross-fades two separate bars.
- Spring-eased toggle knobs with a mid-flight squash. Reuse the existing `.rise` entrance for
  Settings cards.
- Slider readout pulse must fire on `change`, not `input` — `oninput` runs ~60x/second while
  dragging and an animation restarting at 60Hz reads as a jittering blur.
- Move `.switch` / `.segmented` / `.row` out of `Settings.svelte` into `controls.css` first, so
  Phase 6 doesn't leave glass tokens and toggle styles in two files that must be edited together.

## Second source batch — Echo Music screenshots

Five screenshots of Echo Music's Appearance / Player-and-audio settings, triaged against what
Noctra can actually be.

**Already covered by the plan above:** crossfade, audio normalisation, equaliser, preload-next-song,
show-codec, remember-shuffle-and-repeat, auto-scroll-lyrics, seek-on-lyric-click, play/pause on the
thumbnail. The theme, background-style and liquid-glass rows are the custom-accent picker you
declined earlier, so they stay untouched.

**Impossible here, not merely declined:** Music Quality, Download Quality, Data Saver, Google Cast,
Auto download on like, Comments, Listen Together. Every one presupposes a streaming backend, and the
spec bans streaming integration and social features explicitly.

**No desktop equivalent:** haptics, swipe gestures, mini-player swipe sensitivity, high refresh rate,
offload audio path, stop-on-task-clear, Legacy Icon.

**You picked down, so not building:** rotating vinyl artwork, library density / grid cell size,
silent auto-skip, head-and-tail-only silence analysis.

**Also not building, with the reason:** history retention window. It looks free but `history` stores
a play count and an ordered recent list with no per-entry timestamp, so "forget after N days" needs a
new `lastPlayed` map for a maintenance nicety on data that is already bounded at 500 entries and
4000 pairs. Low payoff, and it would be the third write path into that store.

### Phase 14 — Silence analysis and skipping
The heaviest item in the entire plan, because Noctra has no decoder today — `lofty` reads tags, it
does not produce samples.
- New Rust dependency: `symphonia` (pure Rust, covers the MP3/FLAC/AAC/OGG/WAV list already in the
  spec).
- `analyse_silence(path)` decodes to PCM, runs a windowed RMS gate, and returns merged silent
  ranges. Reads the file straight from disk, so it is **not** affected by the BUG-008 streaming
  patch — worth stating because it means the analyser and the player can disagree about a repaired
  file and the analyser is the one that is right.
- Results cached keyed on path + mtime + size, so an edited file re-analyses and an untouched one
  never does again.
- **This must not run on first play.** A full decode would land squarely on the 0.5–1.0s cold-start
  path measured in §6 of the handoff. It runs as its own queued, cancellable, single-file-at-a-time
  background job with progress, like the tag scan. Until a track is analysed, silence skipping is
  simply inactive for it and the UI says so rather than pretending.
- Settings: on/off, a sensitivity choice, and **two behaviours matching the reference** — jump
  straight past, or run silent passages at a higher `playbackRate`. The speed-up variant is the
  gentler one and costs nothing extra.
- Four conflicts to resolve deliberately, not discover:
  1. **Gapless.** Both features exist to remove gaps. With gapless on, skipping must be restricted to
     interior silence, or the two fight at every track boundary.
  2. **A-B loop.** A marked span is chosen by hand; never skip inside it. Same rule Phase 5 already
     applies to resume recording.
  3. **Listening time.** Derived from position deltas, so a jump skip is already excluded by the
     existing `delta > 0 && delta < 2` guard, but speed-up mode accrues more position-seconds than
     wall-seconds. Accept it and note it in `PROGRESS.md` rather than silently skewing the statistics
     page.
  4. **Resume.** Do not store an offset that only exists because a skip landed there.

### Phase 15 — Queue and playback continuity
Small, independent, and the group with the best value-per-line in this batch.
- **Auto-skip to the next track on a playback error, with the failure kept visible** — your call, and
  the right one while BUG-012 is still undiagnosed. Advance after a short beat and name the track
  that failed on screen. Two hard requirements: a run of consecutive failures has to stop and say so
  rather than walking the whole library, and a `NotAllowedError` autoplay rejection must **not** be
  treated as a bad file, because that is a harness artefact and skipping on it would hide it.
- **Persistent queue** — save the queue and its context, restore on launch. Slots naturally into the
  Phase 5 persistence work.
- **Prevent duplicate tracks in queue** — move-if-present rather than appending a second copy. The
  current code already refuses the track that is playing; this extends that to everything else.
- **Autoplay on queue end from local similarity** — when the run is over and repeat is off, append
  similar tracks instead of stopping. Reuses the `similarTo` scorer built this session, so the cost
  is the wiring, not the algorithm. Original context finishes first, then similar content, suppressed
  under repeat-all, and capped at a few extensions so a long session cannot grow the queue forever.
- **Accelerating seek** — hold the arrow key and the step grows. Cheap, and noticeably better on a
  7-minute track.
- **Immersive fullscreen** — drop the window decorations alongside the Phase 11 fullscreen, which is
  the desktop equivalent of the reference's hide-status-bar option.
- **Keep the screen awake while playing** — a small Rust `SetThreadExecutionState` call, opt-in.
  Genuinely useful for the one thing this app is built around: reading lyrics on screen.

### Phase 16 — Lyric presentation
Where the aesthetic payoff of this batch actually is, and all three are CSS plus one setting each.
- **Word-reveal animation styles** — Fluid, Fade, Pop. Same timing data, different easing per word,
  selectable in the in-place lyrics panel. All three stay inside D-008's rule: opacity and scale
  only, no flashing, no karaoke sweep bar.
- **Glowing active lyric line** — an accent bloom behind the line being sung with a small bounce on
  entry, sitting on top of the existing depth-of-field system rather than replacing it. Must be
  re-measured with `scripts/contrast-probe.cjs` afterwards: a glow behind text is exactly the kind of
  change that quietly eats the viewability margins from D-060. Low Power and reduced-motion get the
  static glow with no bounce.
- **Lyric text position** — left / centre / alternating. This is **D-007**, decided in the first
  session and never built, which is why the reference's row looks familiar.


## Verification

- `npx svelte-check` after every phase — currently **0 errors, 0 warnings**.
- Extend the existing CDP probes (`scripts/probe-playback.js`, `scripts/probe-loop.js`) per phase.
  Both already run against the live app, and I fixed the harness to target the main window — it was
  attaching to the desktop mini-card, because that webview can be listed first on port 9223.
- Phase 5 and 6 need manual checks automation cannot do: real audio for the loop wrap and a resumed
  track, and a human eye on refraction quality.
- Phase 6 must re-run `scripts/contrast-probe.cjs`. The current WCAG AA margins over the library's
  brightest cover (sidebar 4.98:1, hero 8.78:1, content 11.32:1, player bar 14.39:1) are the
  regression gate for any glass change.
- `PROGRESS.md` gets a `D-0NN` per phase **including the rejections** — Web Audio tier declined,
  MP3 `SYLT` skipped, per-view sort prefs, Rust `addedAt`, collapsible sidebar, Settings tabs — so a
  later session doesn't re-litigate them. `BUGS.md` gets the lyrics delete defect logged today.
- Phases 7–11 are audio and cannot be verified by reading code. Each needs the running app:
  - **ReplayGain** — a known-loud and known-quiet pair from your own library, confirm the
    difference closes and that nothing clips into `el.volume = 1`.
  - **Gapless / crossfade** — a live album or a two-track pair with no intended gap; measure the
    handoff, confirm listening time is not double-counted, and confirm the BUG-008 empty-MIME FLAC
    still plays when it is the *preloaded* track rather than the first one. That last case is the
    untested one and the likeliest place this batch breaks.
  - **EQ** — test both states in one session: graph on, graph off, on again, with audio actually
    audible each time. A silently detached source node means total silence, which is a worse
    failure than the 7 seconds the graph costs, so it has to be looked for deliberately.
    Re-measure `warmUpOutput()` with the context created, so the resume cost is proven to sit
    behind the warm-up rather than in front of the first play.
- Before any release build: `--remote-debugging-port=9223` is still in `tauri.conf.json`
  `additionalBrowserArgs` and must come out.

## Files

New: `src/utils/shuffle.ts` · `src/stores/blocked.svelte.ts` · `src/stores/bookmarks.svelte.ts` ·
`src/services/repeatMenu.ts` · then `src/services/sort.ts` · `src/stores/added.svelte.ts` ·
`src/stores/selection.svelte.ts` · `src/views/Browse.svelte` · `src/components/LiquidGlass.svelte` ·
`src/liquid-glass.css` · `src/services/audio/graph.ts` · `src/stores/eq.svelte.ts` ·
`src/stores/ratings.svelte.ts` · `src/services/smart.ts` · `src/stores/silence.svelte.ts` ·
`src/services/queueMenu.ts`

Modified: `src/stores/player.svelte.ts` · `src/stores/settings.svelte.ts` ·
`src/stores/history.svelte.ts` · `src/stores/library.svelte.ts` · `src/stores/playlists.svelte.ts` ·
`src/services/audio/engine.ts` (major — single element to two decks) · `src/views/Library.svelte` ·
`src/views/Settings.svelte` · `src/components/PlayerControls.svelte` ·
`src/components/ProgressBar.svelte` · `src/services/trackMenu.ts` · `src/services/lyrics/lyrics.ts` ·
`src/services/audio/shortcuts.ts` · `src-tauri/src/commands/mod.rs` ·
`src-tauri/src/commands/scan.rs` · `src-tauri/Cargo.toml` (symphonia for Phase 14) ·
`src-tauri/capabilities/*` (fullscreen needs
`core:window:allow-set-fullscreen`) · `src/App.svelte` · `src/app.css` · `src/controls.css` ·
`src/main.ts`

## Final refinement pass — owner directive, runs after ALL phases above are done

Given 2026-09-27. Do not start early. Full detail in project memory
(`noctra-final-refinement-directive.md`). Order:

1. **Storage diet** — project measured at ~2.2 GB: `src-tauri/target` 1.9 GB (clean), `frames1/`
   180 MB (scratch contact sheets — delete after confirming nothing references it), stray root PNGs
   (`m-hover*`, `sheet-*`, `x-bar-*`) are scratch captures. Check shipped installer/binary size too.
2. **Animations everywhere** the user can see (Phase 13 is the seed, go beyond). Respect
   reduced-motion and the no-live-full-window-backdrop-filter ban.
3. **Deep online research** on premium music-player aesthetics/UX, then apply — must look premium,
   not cheap.
4. **Bug/tool sweep** — every open `BUGS.md` entry, verified with CDP probes.
5. **Reference re-study** — re-check all of `docs/references/` and refine the UI against them.

Be credit-efficient: batch work, reuse existing scripts/probes, no redundant exploration.
