# Noctra — Progress Log

Live development journal. Two jobs: capture every idea that comes out of the references and
decisions, and record what actually shipped. Read `BUGS.md` alongside this for defects.

Run commands are at the bottom. Spec lives in `noctra-build-prompt.md`.

---

## Decisions & ideas

### D-001 — Add a Phase 0 (toolchain) that the spec assumes away
The spec starts at "Tauri + Svelte app shell", but this machine had no Node.js, no Rust, and no
MSVC Build Tools. Nothing can build until those land. Installed via winget: `OpenJS.NodeJS.LTS`,
`Rustlang.Rustup`, `Microsoft.VisualStudio.2022.BuildTools` with the `VCTools` workload.
**Idea for future phases:** any "just run it" instruction needs its prerequisites verified first.

### D-002 — LRCLIB instead of Spicy Lyrics
Reference screenshot credits "Provided by: Spicy Lyrics". The spec explicitly forbids scraping
sites without an official API, and Spicy Lyrics has none. **LRCLIB** (`lrclib.net`) is used instead:
free, no API key, and its `syncedLyrics` field carries word-level `<hh:mm:ss.mmm>` timestamps for
many tracks — which is exactly the enhanced-sync behaviour the references show. So the forbidden
source offered nothing the approved one lacks.

### D-003 — The blur is a cached image, never a live filter
The single biggest performance trap in this design. `backdrop-filter: blur()` across a full window
on an integrated GPU tanks straight through the 30fps budget. Instead: downscale artwork to
~120–200px, blur it **once**, write it to a cache file keyed by track fingerprint, then animate that
bitmap with `transform: scale()/translate()` and `opacity` only. Those are compositor properties —
they don't touch layout or paint. Same rule for the palette: extract once per track, cache, reuse.
**Consequence worth remembering:** the first play of a track may show a placeholder background while
the blur computes; that is correct behaviour, not a bug.

### D-004 — Match the references' behaviour and layout; keep the brand our own
User chose to match the screenshots as closely as possible. Doing that for layout, control
placement, spacing rhythm, and the lyric dimming behaviour. Not doing it for Spotify's name, logo,
or icon artwork — those are trademarks, and copying them is a legal problem rather than a design
choice. Noctra gets its own icon set drawn to the same visual weight.

### D-005 — Mini-player is a real desktop window, not a DOM element
Screenshot 5 shows the widget floating over the wallpaper with the desktop visible behind it. That
cannot be done inside the main window's DOM. It becomes a second Tauri `WebviewWindow`: frameless,
transparent, always-on-top, draggable. Flagged as a risk because transparent + always-on-top +
WebView2 has a history of quirks on Windows; verify early, before building features on top of it.

### D-006 — Hover-reveal control cluster over the artwork
References 1 and 2: controls are hidden, and hovering the album art fades in a row of small
circular buttons (layout, lyrics mode, fullscreen, library, settings, close) plus a vertical volume
slider and the transport row. Implement as a static overlay whose `opacity` transitions on
`:hover` — cheap, and it stays inside the transform/opacity budget.

### D-007 — Lyric alignment as a preference
Reference 3 differs from 1 and 2: upcoming lines are right-aligned while the active line is left,
which reads well for the Hindi track. Worth exposing as an "alignment" setting (left / centre /
alternating) rather than hard-coding one layout.

### D-008 — Word highlight must not be a karaoke sweep
Spec is firm: each word transitions dim → lit with soft opacity and a slight scale as its timestamp
arrives. No filled progress bar sweeping across the text, no flashing. Interpolate only the active
word on `requestAnimationFrame`; the rest of the list updates on a 10–15Hz tick.

### D-009 — Library storage behind an interface
JSON on disk for now. The read/write path sits behind a module boundary so `tauri-plugin-sql`
(SQLite) can replace it once a library passes a few thousand tracks, without touching callers.
Not building SQLite in Phases 1–3.

### D-010 — Offline boundary is one call, ever
The app must launch, browse and play with zero network. The only permitted request is an LRCLIB
lyrics fetch, and only when there is no local `.lrc` and no cache hit. Everything else ships
offline. Failures degrade to "Lyrics unavailable" — never a blocked play, never an aggressive retry.

### D-011 — Plain Vite + Svelte 5, not SvelteKit
`create-tauri-app --template svelte-ts` scaffolds a **SvelteKit** app (file-based routing,
`+page.svelte`, `+layout.ts`, adapter-static). The spec's architecture is a plain SPA with
`views/`, `stores/` and `services/` and no router at all — view switching is a single store
value. SvelteKit would contribute SSR/pre-render concerns and a routing layer we would spend
effort working around. Kept the scaffolder's Rust side, which is version-correct, and
hand-wrote the frontend config instead.

### D-012 — Use real embedded artwork; never fabricate demo assets
Phase 1 originally got AI-generated placeholder covers. That was wrong on two counts: the app's
whole visual system is driven by artwork extracted from the user's own files, so a synthetic cover
tests a path that never runs in production; and one generated image landed close to a real,
copyrighted album cover. Replaced with artwork pulled out of three actual FLACs in
`C:/Users/<you>/Music`, along with their real titles, artists, albums and durations.
**Standing rule:** when real data is available, derive the fixture from it.

### D-013 — Component layout flattened
The spec tree nests one folder per component (`components/PlayerControls/`). With one component
per file that adds a directory for every file with no benefit, so components are flat
(`components/PlayerControls.svelte`). The spec explicitly permits this. `views/`, `stores/`,
`services/` and `utils/` keep their folders.

### D-014 — Icons are one lookup table, not sixteen files
`components/Icon.svelte` holds path data in a map keyed by name. Adding an icon means adding a
string. Stroke weight is fixed at 1.7 on a 24px grid so the set reads as one family inside the
circular buttons. `play`/`pause` are filled rather than stroked, which is what the references show.

### D-015 — Controls that don't work yet are visibly inert, not silently dead
The Now Playing hover cluster and the sidebar's Shuffle/Repeat render at full fidelity but are
`disabled` with a title naming the phase that delivers them. This keeps the layout honest to the
references while refusing the spec's banned pattern — a control that looks live and isn't.

### D-016 — Local files reach the webview through the asset protocol
`convertFileSrc(path)` turns `C:/Users/<you>/Music/x.mp3` into an `http://asset.localhost/...`
URL the webview may load, with allowed paths declared in `tauri.conf.json` under
`app.security.assetProtocol.scope` (`$MUSIC/**`, `$HOME/Music/**`). This is the mechanism Phase 3
will rely on for an arbitrary user-chosen folder, so it was worth proving now rather than
discovering it then. The `protocol-asset` Cargo feature (added by hand) is what compiles the
handler in.

### D-017 — Progress polls on a timer, not `requestAnimationFrame`
rAF is the reflex choice for anything animated and it is wrong here: Chromium freezes it for
hidden or occluded windows, so the progress bar stops while the music keeps playing. A 66ms
`setInterval` is correct on both counts — full rate when visible, ~1Hz when hidden, which is fine
for a bar nobody is looking at. See BUG-007.

### D-018 — Automated clicks must be trusted or playback tests lie to you
`element.click()` from `Runtime.evaluate` does **not** grant user activation, so Chromium's
autoplay policy rejects the resulting `play()` — which looks exactly like a broken player.
`Input.dispatchMouseEvent` produces a trusted event and does activate. Any future automated
playback test must use the trusted path or it will chase a bug that is not there.

### D-019 — A dev-only state handle and a CDP harness instead of guesswork
`scripts/cdp-eval.mjs` evaluates expressions inside the running webview over the DevTools protocol
(`--file`, `--inject`, `--click`), and `main.ts` publishes `window.__noctra = { player, ui }` under
`import.meta.env.DEV`. Together they replaced a stretch of speculation with direct reads of live
state, and they are what the fps checks in Phases 4 and 6 will use.

### D-020 — `--disable-features=CalculateNativeWinOcclusion` is required
Without it Windows reports a covered window as occluded and the webview throttles rendering. Set
in `tauri.conf.json` via `additionalBrowserArgs` so it applies to release builds, not just to a dev
shell with an env var. Verified applied by confirming a debug port opened from config alone.
Note this does not yet stop media suspending — see BUG-009.

### D-021 — Artwork extraction returns a path, not bytes
`extract_artwork` writes the embedded picture to disk and hands back the path rather than
base64-ing ~500KB through `invoke`. That is also the shape Phase 3's artwork cache wants, so the
command is written once.

### D-023 — Lyrics sources: user overrides the spec's LRCLIB-only rule (Phase 6)
The spec forbids scraping sites without an official API and names LRCLIB as the only online
source. The user has since pointed at two third-party libraries and asked for lyrics fetched from
them, with a **"Find Lyrics" button in fullscreen** that searches for the current track:
- `github.com/surfbryce/beautiful-lyrics`
- `github.com/Spikerko/spicy-lyrics`

This is an explicit override, recorded so it is not re-litigated later. Three things to weigh when
Phase 6 starts — none of which change the decision, but all of which shape the implementation:

1. **LRCLIB may already do the part that matters.** Its `syncedLyrics` field carries word-level
   `<hh:mm:ss.mmm>` timestamps for many tracks, which is the word-by-word highlighting being asked
   for. So these libraries may be most valuable as a *fallback for tracks LRCLIB does not have*
   rather than the primary source. Worth confirming against real misses before building a second
   pipeline.
2. **These are Node scrapers, not services.** Noctra's webview cannot make arbitrary cross-origin
   requests, so fetching has to live in Rust (`reqwest`) and the selectors/parsing get ported
   rather than imported. `npm install` of either library will not work as-is in this stack.
3. **Fragility is the real cost.** Scrapers break silently when the upstream site changes its
   markup. Mitigation if we adopt them: keep them behind the same cache-by-fingerprint layer as
   LRCLIB so a broken scraper degrades to "already-cached lyrics still work", and never let a
   fetch failure block playback.

Not yet verified: which providers each library actually hits, their licenses, or whether they are
maintained. That check belongs in Phase 6.

### D-022 — FLAC playback needs a repair layer, and it must not touch the library
Confirmed cause is in BUG-008: an empty MIME string in the PICTURE block makes Chromium reject the
whole file, while lofty and the user's other players tolerate it. Repairing it in place would edit
files inside the library, which is off the table without explicit consent — a music player should
never rewrite someone's collection as a side effect of opening it.

Two non-destructive shapes, not yet chosen:
- **Streaming scheme handler** — register a Rust `noctra-audio://` protocol that reads the file,
  patches that one field in the metadata block it streams out, and passes the audio frames through
  untouched. No duplicated bytes on disk and it also gives Phase 3 control over Range requests.
  More work, and the right long-term answer.
- **Patched copy in a cache dir** — simpler, but duplicates up to 30MB per track; for 308 files
  that is most of an 8GB library. Cheap to build, wasteful to keep.

A third option, stripping metadata entirely, also works but throws away the cover art the whole
visual system is built on, so it is not actually on the table.

### D-028 — Favourites moved out of Phase 5 so the taskbar heart is not a lie
The taskbar spec asks for a ♡ button whose click does something real. Favourites were scheduled for
Phase 5, and a heart that toggles nothing is exactly the "looks live and isn't" pattern D-015 rules
out. So the favourite *state* — a set of track ids, a toggle, and a place to see them — is pulled
forward now, the same way `read_tags` and `extract_artwork` were pulled into Phase 2 to unblock
BUG-008. What stays in Phase 5 is everything built on top of it: queue, shuffle, repeat modes and
playlists.

It lives in its own store rather than as a field on `StoredTrack`, because the library array is
rebuilt wholesale on every rescan and anything stored inside it would not survive adding a folder.

### D-029 — Favourites persist in `localStorage`, not the Rust library file
`load_library`/`save_library` are typed around tracks and their roots. Favourites are a few hundred
short strings that only the webview reads, and routing them through Rust would mean widening that
command's shape for no benefit. `localStorage` in a Tauri app is backed by the WebView2 user data
folder, so it survives restarts. The seam that matters — one place that reads and writes the list —
is still there if it ever needs to move.

### D-030 — One global `.orb` class, not a button style per component
The circular control was previously restyled independently in Now Playing, PlayerControls and the
mini-player, which is how they drifted apart. It is now defined once in `app.css` with two
orthogonal axes: size (`.orb-sm`/`.orb-lg`) and emphasis (`.orb-halo` for secondary, `.orb-primary`
for the single main action, `.orb-on` for a control that is toggled on). Components only compose.

The `::before` sheen is a pseudo-element rather than a second background layer so `:hover` can
change the fill without painting the highlight out.

### D-031 — ~~Transport over the artwork gets a glass smudge~~ SUPERSEDED BY D-035
This put a soft glass disc behind every transport control inside the artwork. The owner rejected it:
"there's a circle over every play/pause, prev next fav button making it even more uglier." Replaced by
D-035, which keeps the reference's bare glyphs and solves the legibility problem another way.

### D-032 — Taskbar glyphs are rasterised in code, not shipped as assets
Four glyphs as `.ico` files means four binaries to regenerate whenever the icon family changes, for
shapes that are a dozen lines of maths. Each is drawn white on transparent at 32px with 4x
supersampling and handed to `CreateIcon` as premultiplied BGRA plus a 1-bit AND mask. Premultiplying
over black is deliberate: the hover preview is dark, so the anti-aliased edge reads correctly whether
or not the shell composites the alpha channel.

Both hearts come from one analytic curve, `(u²+v²−1)³ − u²v³ = 0`, with the outline being the
difference between it and a copy shrunk about its own centre. Two hand-drawn paths would have drifted
and the toggle would have read as two unrelated icons.

### D-033 — Word-by-word lyrics are built on line timing, and the UI says so
> **Superseded by D-071 (2026-09-26).** The measurement below is still correct about `syncedLyrics`, but
> the conclusion "LRCLIB does not have word timing" is not: the API also returns `hasWordSync` and a
> `lyricsfile` YAML document carrying real per-word `start_ms`/`end_ms`. Interpolation is gone for good;
> word timing now comes from the sources that actually have it.

The owner asked for word-by-word lyrics. **LRCLIB does not actually have them.** Measured against
the live API: 0 of 400 search results and 0 of 13 real `/api/get` lookups returned word timing. Its
`syncedLyrics` field is line-level LRC. Word data exists only in a separate `lyricsfile` YAML field
with effectively no coverage, and `hasWordSync` is not filterable.

So: parse real per-word timestamps when a source has them (local enhanced-LRC files, and
`lyricsfile` if LRCLIB ever fills it in), and otherwise **interpolate** word timing across the line
proportional to character count. The line label states which one you are getting —
"Word sync · LRCLIB" versus "Line sync · words timed by interpolation" — because the spec explicitly
forbids claiming word-level sync when only line-level was returned.

Rejected alternative: scraping spicy-lyrics / beautiful-lyrics for real word data. They are Node
scrapers over sites with no API, they break silently, and §6 of the spec rules them out.

### D-034 — The backdrop is normalised to a target luminance, not boosted by a fixed amount
The old blur pass applied a flat `brightness(1.3)` to every cover. That was the BUG-004 fix, and it
was correct for dark covers and catastrophic for bright ones: a white sleeve multiplied past 255 and
the whole window blew out, which is exactly the screenshot the owner sent.

Now the pass measures the artwork's mean luminance (16×16 sample, same one-time cost as the blur) and
solves for the multiplier that lands the backdrop near a fixed target, clamped to `[0.5, 1.45]` so
dark covers still get their lift. Saturation went 1.16 → 1.55 to compensate: the signature look is
the cover's colour flooding the window, and that is carried by chroma, not brightness.

Two numbers are published, not one. `luminance` (after correction) drives the veil. `raw` (before
correction) drives whether controls sitting *on* the artwork need light or dark ink — see D-035.

### D-035 — Transport glyphs are bare, and flip to dark ink over a light sleeve
Reference 02 has plain white glyphs for the transport and circles only on the top icon row. The
previous pass put a glass ring on all five controls, which read as a cluster of identical bubbles,
and the owner rejected it outright. They are now two classes: `.orb` (ringed, for the icon row) and
`.orb-bare` (no ring, no fill, for the transport).

Bare glyphs create their own failure, though: white on a white cover is invisible. So when the
artwork's raw luminance is above 0.55 the transport switches to dark ink, scoped to `.art-zone` so
the same controls on the dark mini-player bar keep white ink. This is why D-034 publishes two
numbers.

### D-036 — Liked is red, not the track accent
The heart used to take `--accent`, which on a warm cover meant a gold heart on a gold disc — no
visible change when you liked something. Favouriting is a universal red convention; it is now a
fixed `--love` token and does not move with the palette.

### D-037 — Settings own the visual intensity, applied as CSS custom properties
The owner's resolution of the aesthetics-versus-frame-rate tension was to let the user choose.
`stores/settings.svelte.ts` holds glass blur radius, colour intensity, extra dimming, low power,
lyric offset, shuffle/repeat and volume; `apply()` writes the visual ones straight onto
`documentElement.style`, so a slider repaints the app live with no component subscribing.

### D-038 — The ~7 second first play is the audio subsystem, and the UI has to narrate it
Confirmed by measurement, not theory: `engine.warmUpOutput()` — which plays 0.25s of generated
silence through a blob URL, touching no file and no protocol — takes **6786 ms** on this machine, and
a real play immediately after it takes **670 ms**. An `AudioContext.resume()` in the same page takes
7141 ms. So the cost is WebView2 bringing up its audio output, not disk, not the FLAC repair layer,
not the file.

That means the warm-up was always working; the problem was that a user who clicks play during that
window queues *behind* it. Two changes: the warm-up now starts at 0 ms instead of 400 ms, and
`engine.play()` calls `cancelWarmUp()` so a real request takes the cost rather than waiting on a
silent buffer. Neither removes the 7 seconds — nothing here can — so the third change is the one that
matters: the player shows "Starting audio…" from the moment play is requested until the first frame,
instead of showing nothing for seven seconds and looking hung.

### D-039 — No gradients on controls; glass only on floating chrome
Studied the reference the owner kept pointing at (github.com/heartached/Noctis) rather than guessing
again. Two findings that reversed the previous direction:

1. `grep -i gradient` over its entire stylesheet returns **zero matches**. Every gradient sheen
   painted onto a button was the thing making the app look homemade.
2. Its own source carries the comment: *"Accent action buttons deliberately keep their solid accent
   fill: frosting them (2026-08-06) read as washed-out, muddy buttons and was reverted 09-07."* It
   also keeps the sidebar opaque because at 55% every flyout was see-through.

So glass is reserved for floating chrome — nav rail, mini-player island, desktop card. Content areas
use a solid `--card` film with a hairline. Buttons are flat fills. The top-edge catch-light and lower
lip are inset box-shadows, which is what a real pane does; a gradient overlay is paint.

Hover is now **motion, not colour**: scale plus a soft accent bloom, with the fill held constant.

### D-040 — Media glyphs are filled geometry, and type got heavier
The owner's word for the controls was "malnutritioned". Cause: thin 1.7px strokes at 18px next to a
light font weight. Noctis draws its whole transport as **filled** paths at 12–14px and uses
SemiBold/Bold with nothing below 12px. So play, pause and both skips are now solid shapes, stroke
weight went 1.7 → 2.15, and the type scale moved up (section titles 22px/800, hero 28px/800).

### D-041 — Listening history starts recording now, not in the phase that displays it
Play counts, last-played order and total listening time went into `stores/history.svelte.ts` the day
"Most played" was asked for, not the day it is finished. History cannot be back-filled — a store added
next phase would start from zero and the feature would look broken for weeks however good the UI is.

Listening time is derived from the position clock rather than a wall timer, so a paused track or a
seek cannot inflate it. Verified: 4 seconds of playback accrued exactly 4 seconds.

### D-042 — "Play similar" is a similarity score, not a model
The owner asked for AI mix/shuffle but flagged "not required if too heavy on cpu". An embedding model
is the heavy version and cannot run offline on the target hardware regardless. The honest offline
signal is what the listener actually plays: same album scores highest, then same lead artist, then a
shared album-name token, and the top 25 candidates are shuffled. It is labelled "Play similar", not
"AI".

### D-043 — Auto-scan is a focus-and-timer rescan, not a file watcher
`library.refresh()` re-runs the existing append-scan over each root, which dedupes on the
path-derived id, so new files land and existing ones are skipped. A `notify`-based Rust watcher would
catch changes while the app is backgrounded, at the cost of a second source of truth for what is on
disk and a set of debounce bugs. Deleted files are deliberately **not** pruned by auto-scan: that has
to be certain a file is gone and not merely on an unmounted drive, so it stays a manual action.

### D-044 — Romanisation is Devanagari-only, offline, and drops the final schwa
LRCLIB has no romanised field, and the sites that do are the un-API'd scrapers §6 rules out. But
Devanagari-to-Latin is a *script* conversion, not a translation, so a rule table is deterministic and
free. Japanese and Korean are deliberately not attempted — their readings are ambiguous without a
dictionary, and a wrong reading is worse than none.

Two rules decide whether the output is readable at all. Hindi drops the inherent schwa word-finally,
so "भोलेनाथ" is "bholenath" and not "bholenatha" — a pending vowel is discarded at a word boundary.
And the nukta dot (ज़, फ़, क़) is its own codepoint sitting on the previous consonant, resolved by
peeking forward while writing that consonant.

ASCII only, no macrons: the point is singing along, and "khwabon" scans faster than "khwābon".

### D-045 — Home is derived, and groups by lead artist
Home and Library were the same page twice. Home now composes a Continue-listening hero, Top Artists,
Most Played and Last Played side by side, and an Albums grid — all derived from the scanned library
plus history, with no configuration step.

Artist grouping keys on the **first** billed name. Tag `artist` fields in this library are feature
lists, so grouping on the raw string produced a Top Artists row of "A.R. Rahman, Anu…", "A.R. Rahman,
Ariji…", "A.R. Rahman, Bad…" and a statistics page claiming 264 artists across 314 songs.

---

### D-046 — The mini-player window is declared in config, not built at runtime
See BUG-011. `WebviewWindowBuilder::build()` on Windows returns `Ok` and registers the label but
creates **no platform window** when the config window carries `additionalBrowserArgs`. Every option
combination and every calling thread was probed and all failed identically, which is what moved the
suspicion off the window options and onto the WebView2 environment.

The window now lives in `tauri.conf.json` with `visible: false` and the same browser args, and
`toggle_mini` only shows and hides it. Cost: the webview holds memory from launch. That is the
upstream maintainer's recommended shape and the only one that works.

### D-047 — Accent tints use `rgb(var(--x-rgb) / a)`, never `rgba(var(--x-rgb), a)`
`--accent-rgb` stores space-separated channels, so the comma form substitutes to invalid CSS.
`var()` defers validation, so the declaration parses and then silently drops at computed-value time
— 27 sites had been dead. See BUG-023.

### D-048 — Scroll position is measured against the moving container, never `offsetTop`
`offsetTop`'s origin is the nearest *positioned* ancestor, which is not the scroll viewport here, so
every centring calculation was out by roughly one viewport height. Both lyric surfaces now use
`el.rect.top - reel.rect.top`, which cancels the shared `translateY`. They also read the active line
from the rendered DOM instead of a parallel `bind:this` array, which drifts out of sync across track
changes. See BUG-024.

### D-049 — Lyrics load on track change from `App.svelte`, not from the lyrics view
The fetch was triggered only by an effect inside the fullscreen view, so the store stayed empty for
every other consumer, including the desktop card. The trigger now sits in the always-mounted root;
views are pure readers. Still fire-and-forget, so playback never waits on lyrics. See BUG-025.

### D-050 — Taskbar glyphs are bare, ring-free, and scaled to fill the button
See BUG-026. The reference row is bare thin glyphs on the dark bar with nothing behind them, so the
ring is gone and the shapes are scaled 1.75x about the centre to compensate for no longer being sized
to sit inside it. Verified by porting the rasteriser to Node and rendering the six glyphs at the
shell's real 16px — outline and filled heart are now distinct, which is what the "reversed favourite"
report actually was.

`leadArtist()` was duplicated in Home and Lyrics with byte-identical bodies; it now lives in
`src/utils/format.ts` and has a third consumer, the window title.

### D-051 — The window title is "Track - Artist"
The shell reads the window title for the taskbar tooltip, the hover thumbnail header and Alt+Tab, so
leaving it "Noctra" made every song look identical there. `syncWindowTitle()` in the taskbar service
sets it on track change, using the lead name so a five-person credits tag does not swallow the label,
and falls back to plain "Noctra" when nothing is loaded. Needs `core:window:allow-set-title`.
Verified on the native window: `The Humma Song (From "OK Jaanu") - A.R. Rahman`. Note
`document.title` does not mirror a native `setTitle`, so it still reads "Noctra" — check Win32.

### D-052 — Bare glyphs never get a circular plate, in any state
See BUG-027. The rule that came out of this: for `.orb-bare`, no state may set a background fill or a
border, because the element is `border-radius: 50%` and any fill is instantly a circle. That covers
hover (glow + scale only) and the active/on state (accent ink + a 4px dot beneath). The dot is
deliberate — colour alone would fail the "don't signal state by colour only" check.

The transport row also needs an explicit `justify-content: center`. A flex column's `align-items`
centres the *row box*, not the buttons inside it, so a stretched row still packs left.

### D-053 — Interpolated words occupy 78% of the gap, not 100%
See BUG-028. The gap between two LRC timestamps is not all singing; its tail is the breath before
the next line. Spreading words over the whole gap makes the highlight lag by a growing amount, which
is worse on the last word — and the last word used to be additionally pinned to the next timestamp.
`VOCAL_FILL = 0.78` with a 6.5s cap per line. This is an estimate and is labelled as one in the UI;
real word timing would need a provider that supplies it, which LRCLIB does not.

### D-054 — Depth of field in lyrics is blur, capped at 4.5px
See BUG-029. The reference softens neighbouring lines but they remain readable. Past ~4px the effect
reads as a broken panel rather than depth, so the ramp is `min(4.5, 0.9 + d * 0.75)` with the opacity
floor at 0.42. The active line stays crisp, larger, and centred.

### D-055 — Fullscreen lyrics has its own in-place settings panel
The Settings orb on the artwork used to call `ui.set("settings")` and drop the user into the generic
app settings page. Every control that matters for lyrics — timing offset, word sync, size, softness,
fade — is only useful while the words are on screen, because you nudge and watch the line land on the
syllable. Adjusting them from another page means adjusting blind. `LyricsSettings.svelte` therefore
overlays the fullscreen view, and the generic page gained the same controls for setting-and-forgetting.

### D-056 — Bare glyphs signal hover with ink, lift and halo — never a fill
Any button that is not meant to be a disc gets no `background-color` on hover and no border. The
element is `border-radius: 50%`, so a fill is instantly the circle that has been rejected three times
now. Hover is `color: #fff` + `scale(1.14)` + an accent halo, and the active/on state is accent ink
plus a 4px dot beneath. The dot matters: colour alone would fail the don't-signal-state-by-colour-only
check. The genuinely circular controls — the thin outlined row over the artwork — keep their ring,
because that is what the reference draws.

### D-057 — The volume slider on artwork is glass, not a coloured pill
A solid accent fill over a cover reads as a sticker laid on the picture. `Slider` gained a `glass`
variant: the unfilled channel is a frosted tube the artwork shows through (`backdrop-filter`), and the
filled portion is white rather than accent, so the level stays legible on any cover. Only the artwork
rail uses it; the horizontal bar slider keeps the accent fill, where there is no artwork behind it.

### D-058 — The mini card shares the fullscreen backdrop
The card now renders the same pre-blurred artwork the fullscreen view uses, clipped to its own rounded
rect, with the accent wash and a dark base over it. It has to compute its own: a transparent webview
cannot `backdrop-filter` the desktop behind it, so the card needs an opaque artwork layer to sit on.
Hovering its artwork scales it 1.5x and reveals the transport plus a favourite toggle inside the art
bounds, matching the fullscreen interaction.

### D-059 — Hover on a bare glyph is ink and lift only, no halo
Removed the accent bloom from `.orb-bare:hover` as well as the fill. The glow read as cheap, and on
the light-cover variant the white plate was the same circle problem in different clothes. Hover is now
`color: #fff` plus `scale(1.1)` and nothing else. The genuinely circular controls keep their ring and
their glow, because those are drawn as rings in the reference.

### D-060 — Backdrop vibrancy comes from chroma and bloom, not from brightness
The old pass normalised luminance then added only `saturate(1.55)`, which read as flat and grey-ish.
Now `SATURATION = 2.1` and `TARGET_LUMINANCE = 112`, plus a `mix-blend-mode: screen` accent bloom over
the top. Brightness is deliberately *not* pushed further, because blowing the level out is what makes
text unreadable on a white sleeve. The veil ceiling dropped from 0.50 to 0.42 on the reasoning that the
scrim, not the veil, should own contrast — the scrim darkens the bottom band and the edges where text
actually sits, and leaves the centre vivid.

Viewability was re-measured rather than assumed, per §3b. `scripts/contrast-probe.cjs` decodes a window
capture and takes the median luminance of a region as its background and the 99.5th percentile as the
glyph. Against the brightest cover in the library (raw 0.962, near-white), all five sampled regions
pass WCAG AA: sidebar 4.98:1, hero 8.78:1, heading 8.66:1, content 11.32:1, player bar 14.39:1.

### D-061 — Removed the glass blur and colour intensity dials from Settings
Both were removed rather than re-tuned. Nobody lands on a better number than the shipped default by
dragging a slider, and the backdrop is now built from a pre-blurred chroma-boosted bitmap plus a bloom
layer, which a live `backdrop-filter` radius control cannot express anyway. The fields are gone from
the settings store, not just hidden, so a stale persisted value cannot override the CSS tokens.
"Extra dimming" stayed: it has an honest answer that varies by room and by cover.

The glass tokens were raised in exchange for the performance the owner offered — blur 26→44px,
saturate 1.9→2.15, stronger specular and shadow.

### D-062 — Favourite is a large centred heart on the cover, with a break
Moved out of the right-hand rail to the middle of the artwork, 74px, revealed only on hover, opaque
white when liked and a thin outline when not. Un-favouriting plays a break: two halves clipped at the
centre line slide apart and tilt outward while fading. The glyph only swaps to the outline after the
halves separate, so the shape never visibly changes mid-flight. Honours reduced-motion and Low Power by
skipping straight to the end state.

The rest of the overlay grew with it — 38px discs and 17px glyphs read as tiny against a 464px cover,
so the artwork row is now 52px discs with 24px icons, and the volume rail moved from `bottom: 84px` to
truly centred on the right edge.

### D-063 — Glass on artwork gets its own neutral filter
`--glass-filter` is tuned for panels over the normalised backdrop and pushes saturation hard. Reusing
it for a small element sitting directly on the cover turns it into a colour-doubling lens, which is
what made the volume rail look like a red pill. `--glass-filter-clear` is a separate token for that
case. Any future glass placed on artwork should use the clear variant.

**Superseded in part by D-070.** The colour-doubling is gone because the *global* token no longer
saturates — it is now the neutral one, measured off the Echo Music reference. The separate clear token
still earns its place, but for a different reason than it was created for: glass on artwork needs a
shallower blur than a 72px pane, or it eats the picture the listener is looking at.

### D-064 — Empty lyrics state is centred, not top-anchored
The "no lyrics" message and the Find lyrics button were top-aligned in the lyrics viewport and partly
eaten by the edge mask, which made them look like they were fading out. `.lyrics.hollow` centres them;
there is no reel to keep clear in that state.

---

### D-065 — Lyrics highlight the line by filling it, not by estimating words
> **Partially superseded by D-071 (2026-09-26).** Deleting the estimated word timing was right and it
> stays deleted. But "no public API returns word alignment" is wrong: LRCLIB's `lyricsfile` field carries
> genuine per-word `start_ms`/`end_ms` on `hasWordSync` records (3 of 760 sampled; 3 songs in this
> library). The line fill remains the correct rendering for line-level data — it is simply no longer the
> only rendering available.

The owner asked for word-by-word like Noctis / the Pixel player, and authorised the fallback in the
same breath: source it properly, and only if that fails go line-by-line with an animation good enough
that it does not read as a compromise.

Searched properly, three times, from three directions:
- LRCLIB's `syncedLyrics` is line-level. Measured 0 word-timed records across 400 search results and
  13 real lookups.
- The 108 files already in Noctra's own lyrics cache contain zero `<mm:ss>` word tags.
- The 16 `.lrc` sidecars in the user's Music folder are line-level too.

**The conclusion drawn here at the time — that no public API returns word alignment without a key or a
second application — was wrong, and D-071 has the measurement.** LRCLIB does publish per-word
`start_ms`/`end_ms`, in the `lyricsfile` YAML document and flagged by `hasWordSync`; reading only
`syncedLyrics`, which is what every check above did, makes that data invisible while appearing to
confirm the guess. Sparse, not absent: 3 records in 760 sampled, and 3 songs in this library.

What is still correct below is the decision. The estimated word timing is gone — it had produced
BUG-019, BUG-028 and BUG-034, all three being the owner reporting that the words did not land where
they were sung. What replaced it is a gradient clipped to the letterforms whose stop rides
`lineProgress()`, the true fraction between this line's timestamp and the next one's. Both endpoints
are facts from the file, so unlike the word model this cannot drift; it just doesn't claim to know
where a word starts. Real word tags win whenever a source carries them, from a sidecar or from
LRCLIB's `lyricsfile`.

The lesson, since it generalises: three independent measurements that all agreed was not
disproof — all three queried the same field. A negative claim about what a provider *has* needs the
provider's own response schema, not a sample of one field from it.

---

### D-066 — Contrast is measured from rendered pixels, not reasoned about from CSS
"Viewability is still an issue across the whole UI" was the third round with the same complaint, and
the previous two were each declared fixed on the strength of looking at one screenshot. `scripts/
audit-run.cjs` now collects every visible text element over CDP, captures the same frame, and
`contrast-audit.cjs` scores each against real pixels.

Two things the tool had to be taught, both of which produce confident nonsense if you don't:
- Sampling the ring *above and below* a list row lands on the row's own title glyphs, so the text is
  measured as its own background. Sample to the sides and at the corners only.
- A pill with a translucent fill must be composited over the sampled ring; auditing it against the
  artwork behind it measures the wrong surface entirely.

Current state: Now Playing, Home, Library and Settings all pass with zero failures; the lyrics view
went from two hard failures (1.00:1) to clean. The earlier DOM-only version of this check reported
"0 failures" on a build that was visibly broken, because the backdrop is a bitmap and no ancestor ever
has an opaque `background-color`, so every element was measured against an assumed near-black. A check
that cannot fail is not a check.

---

### D-067 — The provenance line: genre · year · track count · Lossless
The owner pointed at Spotify's `Alternative · 2015 · 2 tracks · Lossless` under the artist and asked
for the same. Built as `mediaLine()` in `data/track.ts`, rendered on Now Playing and on the fullscreen
lyrics view, measured at 9.7:1 and 8.9:1.

Three things the reference does not have to deal with but this library does:
- **Tags are sparse.** 159 of 314 files carry no year and 40 no genre, so every part is optional and a
  missing one is dropped rather than rendered as a hole. The line degrades to `2014 · 2 tracks` or to
  nothing at all, and the element is not emitted when empty.
- **Genre is usually a list.** Real values read `Films/Games & Film Scores & Bollywood` and
  `Filme/Videospiele, Filmmusik, Bollywood`. `primaryGenre()` splits on `,` and `&` only — never on
  `/`, which would reduce "Films/Games" to "Films".
- **Lossless needs two signals.** lofty names the container family, not the codec, so ALAC hides in an
  `Mp4` that reads as lossy by name while a stray tag can give a lossy file a bit depth. `isLossless()`
  ORs the container name against `bitDepth >= 16`; on the files actually present the two agree on all
  314.

Track count uses `albumTrackCount()` rather than `albumBy(...).tracks.length`, because the grouping
sorts every album's tracks to answer a question that only needs a count.

---

### D-068 — The mini player has two shapes, chosen in Settings
The owner supplied two references: the current lyric-sheet card, and a compact pill with the cover as
a spinning vinyl. Both now exist, chosen under Settings → Look → Mini player, **defaulting to the
card** because that is the one the original reference shows.

Worth recording about the pill:
- **The window changes shape with the widget.** 360×330 for the card, 340×122 for the pill. The mini
  document calls `setSize` itself rather than routing a command through Rust, and it seeds the initial
  shape from `localStorage` — the settings store instance in that window reads the same file — so
  reopening in the pill shape does not flash it at card size for a quarter of a second first. Later
  changes ride the existing `player-state` snapshot on a `style` field, which is the same trick
  `liked` already uses: no second event channel for one string.
- **Only the record turns.** The grooves and the spindle sit above the artwork and stay still, because
  concentric rings are rotationally symmetric — animating them would cost a repaint to show nothing.
  The spin is `paused` rather than removed when playback stops, so the disc halts where it is instead
  of snapping back to the top of its rotation.
- **Translucent has a floor.** The panel is translucent and the text is not, as asked, but the alpha
  was raised off the initial 0.72 because this window floats over an unknown wallpaper and a white
  desktop came through strongly enough to sink the accent artist line.
- **The scrubber seeks.** A bar with a knob that does nothing is a lie, so it emits a fraction and the
  main window converts it against the live duration. It is excluded from the window-drag handler, or
  pressing it would move the window instead of seeking.

---

### D-069 — The backdrop turns continuously instead of oscillating
The owner's complaint was that the fullscreen backdrop was "totally static". It was animating — ±1.6°
over 52s, alternating — which is about 0.12°/s and genuinely below the threshold of perception, so the
complaint was correct.

Now the art layer turns a full 360° every 190s (~1.9°/s) under a 44s scale-and-sway breathe on a
different period, so the two never repeat in step and it drifts rather than ticks.

Two non-obvious parts, both recorded in the component:
- **Continuous, not `alternate`.** An oscillation has to stop, reverse and visibly turnaround; on a
  heavily blurred image that stall reads as a stutter. A constant rotation has no seam.
- **The layer is a 150vmax square.** That is the smallest square guaranteed to still cover the window
  at any angle and any aspect ratio, since the viewport diagonal is at most √2·max(vw,vh) ≈ 141vmax.
  Verified geometrically against all four corners at -74° mid-rotation. The rotation sits on a wrapper
  around all layers so a cross-fade between two tracks turns them together instead of dissolving
  between two different angles, and so it costs one composited transform rather than one per layer.

Measured 60.6fps with the rotation running, so the aesthetic cost nothing. Reduced-motion and Low
Power kill both animations, as they did before.

---

### D-070 — Liquid glass is specified by three measured numbers, not by adjectives
The owner supplied a screenshot of **Echo Music** (github, Android) and said "copy the liquid glass in
from this, exactly like this, do not change". Reproducing a look from an adjective is what produced the
previous three wrong passes, so the reference was measured in pixels first
(`System.Drawing` over the capture) and the tokens were set to hit those numbers:

| What | Reference | Noctra after |
| --- | --- | --- |
| Backdrop → pane interior | 14.7 → 41.9 (**+27**) | 16.9 → 41.5 (**+25**) |
| Interior → side rim | **+24** | **+22** |
| Interior → top rim | **+40** | **+37** |

Three things the measurement settled that arguing from taste had not:

1. **The pane is neutral, not saturated.** The reference's interior measures sat 0.05 even over a
   chromatic cover — a heavy blur plus a light grey veil pulls colour *toward* grey. Noctra's global
   token was running `saturate(2.15)`, which is the actual reason the rail read as a red slab. It is
   now 1.28, and `--glass-brighten` went 1.08 → 0.74 so the veil has something to lift.
2. **The blur is enormous relative to the pane.** ~5-7% of viewport width; no detail survives. 44px →
   72px. This is also what stops a vivid cover bleeding its hue into every surface.
3. **A rim is a *lift*, not a highlight.** `rgba(255,255,255,0.62)` on the top arc rendered as a
   197-luminance hairline against a 49-luminance interior — see BUG-042.

**Detachment is the other half of the look, and it is structural.** Every glass surface in the
reference floats inside the window with a gap on all sides and content scrolling *behind* it; a flush
pane has nothing to refract at its boundary. So `.frame` stopped being a two-column grid, the rail and
mini-player are positioned against the window, and `.content` fills it. The clearance each view needs
is applied once from `app.css` rather than per view — see BUG-043 for why that had to outrank the
scoped styles.

The nav's selected row follows the reference too: **ink brightness only, no plate** (D-035's rule,
restated by a reference that draws Home white and Library grey with nothing behind either). The old
active plate painted accent text on an accent-tinted pill at **1.25:1**, which was the worst number in
the whole app.

Deliberate deviations, because Noctra is a desktop window and Echo is a phone:
- The rail keeps its vertical list and a large corner radius rather than becoming a stadium — a
  stadium only works on a two-item horizontal bar.
- The mini-player keeps the scrubber and the full control row. The reference pill has neither, but
  removing them would delete features the owner asked for in earlier phases.

Verified by rendered-pixel audit on Home, Library, Now Playing, Lyrics and Settings: **0 contrast
failures** on the last four, and 1 on Home/Library, which is the pre-existing accent-on-red now-playing
row (BUG-044), not a glass regression.

**This pass was still not enough, and D-073 records why:** the rim lift was measured correctly but drawn
as a 1.5px line, which produces no refraction, and the +27 interior lift it targeted turned out to be a
property of the bright cover behind the reference pane rather than of the pane itself.

---

### D-071 — True word-level lyrics: Tier 1 sources, and the LRCLIB claim in D-033/D-065 was wrong

The owner chose **Tier 1** from the word-sync research note: embedded tags and local files first, LRCLIB
as the only online source, no other provider, and under no circumstances the generated-timing pattern
Spicy Lyrics calls "Experimental Word Sync". Tier 2 (Musixmatch RichSync, NetEase/QQ/KuGou syllable data
through reverse-engineered endpoints) stays explicitly opt-in and was not built.

**The correction, because it changes what is buildable:** D-033, D-065 and BUG-034 all state that LRCLIB
has no word timing. That is wrong. Re-measured against the live API, every `/api/get` and `/api/search`
response carries a **`hasWordSync`** boolean and a **`lyricsfile`** YAML document, and on records where
that flag is set the document contains genuine per-word `start_ms`/`end_ms`. Measured coverage: **3 of 760
sampled records** online, and in this library 3 songs of 314 (King Gnu "AIZO", Katy Perry "Dark Horse",
Neoni "DARKSIDE"). The trap is that the *same* record's `syncedLyrics` is still line-level — so reading
only that field, which is what Noctra did, makes the word data invisible and the old conclusion look true.

Verified from real data, not a fixture: 亜咲花 "SHINY DAYS" (id 32713056) gives 窓 27446→28070 (624ms),
を 28070→28315 (245ms), 開 28315→28483 (168ms) — 404 timed words spanning 86ms to 3616ms. Held syllables
and rapid runs in the same line, which is the entire point of the request.

What the lookup is now: **embedded tag + sidecar (`.lrc`, enhanced `.lrc`, TTML) → disk cache → LRCLIB**,
and the winner is chosen by *sync level* (word > line > plain) with the source order breaking ties, because
"prefer word/syllable synchronized, then line, then unsynchronized" is a binding requirement and a local
static tag must not demote a track that has timed lyrics online. In this library 195 of 314 files carry a
`lyrics=` Vorbis comment and sampled values are untimed prose, so that ordering is load-bearing rather
than theoretical.

Everything is normalised to **milliseconds**, which is what the renderers already consumed; the unit is
read from each source's own field names (`start_ms`, `mm:ss.frac`, TTML `begin="…s"`), never inferred.
Timestamps in frame units are refused rather than converted, because their length depends on a `frameRate`
this build does not chase.

Validation is a gate, not a log line: word timestamps must exist, start ≤ end, fit inside the track
duration, and be *distinct per word*. A line whose word durations are identical and equal to the line span
divided by the word count is rejected outright — that signature is `lineDuration / numberOfWords`, whoever
produced it. A rejected candidate falls to the next level; it is never repaired with an offset.

Two things the word work forced out of the existing code, both filed in BUGS.md: the cache stored
`syncedLyrics`, so a word-timed track silently came back line-level on the next play (BUG-056), and static
lyrics were assigned `time = index * 1000`, which made untimed words scroll and sweep as though synced
(BUG-057). Untimed words now render as a plain column.

Testing note, stated because it is the honest limit: the fullscreen word path was measured in the running
app over CDP against real LRCLIB word data — seeked to five positions in both directions and the rendered
`.word.now` matched the timestamp range every time, playback advanced it from `audio.currentTime`, pausing
frozen it. LRCLIB throttles to 503 above roughly one request per half second, so the client now spaces its
own calls; and the embedded-tag command cannot be exercised until the app is rebuilt, because it is new
Rust.

---


### D-072 — Premium came from scales, not from a new look
Asked to make the UI "super premium" and "stand out", the tempting move is a new palette or a new
style. Measured instead: `app.css` already had a considered token layer, but it had **no type scale,
no elevation scale, no motion scale and no icon sizes**, and the result was 21 distinct font sizes
with half-pixel steps (10.5, 11.5, 12.5, 13.5, 14.5…) and 18 distinct transition durations, each
picked per-component by eye.

The shadow claim needed correcting after the fact. A grep for distinct `box-shadow` values returned
26, which is what this section originally asserted; counting only single-line black elevation
shadows gave 4, of which 2 are focus glows and only 2 were real drift. The 26 was multi-line
composites, inset specular rims and deliberate accent halos all collapsing into one bucket. Same
family of mistake as the audit above: a number that looks precise because it is a count, and is
precise about nothing.

Nobody sees a shadow that is 28px instead of 26px. Everybody sees that no two surfaces sit at the
same height. So:

- **Type** collapsed onto a ~1.2 ratio from 10 (`--fs-2xs`…`--fs-4xl`), 114 declarations across 23
  files moved to it. Every shift is ≤1px, so nothing visibly moved — the change is that the drift
  stopped and the next component has something to reach for.
- **Elevation** became four tiers plus an accent halo, `--elev-1`…`--elev-4`, where the tier states
  how far a surface is from the page. Each carries a negative vertical spread so shadows read as a
  wide soft source rather than a hard card edge.
- **Motion** got role-named durations (`--dur-press` … `--dur-ambient`) so a component says what it is
  doing rather than how long it takes.
- **Focus** was the biggest genuine gap: 8 of 29 style-bearing files had a ring, so most controls
  were invisible to keyboard users. One global `:focus-visible` outline rule replaced all of them,
  with the range thumb and the text fields handled as deliberate exceptions.
- **Entrance cascade** as a `.stagger` utility using `nth-child`, not an index threaded through every
  each block — same result, and it cannot drift out of sync with the markup. 34ms per step, capped at
  ten children. Applied to the artist, album and playlist grids; the Home sections cascade at 60ms.
- **Cards lifted on hover but gained no shadow**, so the artwork moved without leaving the page.

Deliberately NOT done: the design-system generator suggested a fixed brand palette (indigo + play
green) and a Righteous/Poppins pairing. Both were rejected. The accent is derived per-cover and is the
product's identity — a standing green would destroy that — and Poppins is a webfont in an app that
must run with no network at all, where Manrope is already self-hosted and licensed.

**Also fixed, in the audit tool itself:** the contrast sampler reported three hard failures on Home
that did not exist. It takes the brightest sample beside each text element, and beside a list row's
title sits that row's own album thumbnail — bright artwork — so the text was scored against a
photograph rather than the dark backdrop it is on. Samples inside image rects are now rejected, with
a fallback to the unfiltered set when all of them are, because an audit that silently skips what it
cannot measure reports zero failures, which is worse than being wrong.

### D-073 — The rim is a band, not a line, and the veil is bracketed by two measured failures
D-070 got the material's *luminance* right and the owner still said the liquid glass was "not well
implemented", with a screenshot and an arrow at the dead gap left of the mini-player. Both complaints
were correct, and both had a specific cause.

**1. A 1.5px hairline is invisible; the reference's edge is a band ~8-10px deep.** D-070 measured the
rim's *lift* correctly but drew it as one thin line, so the pane had no refraction at all — it read as
a grey capsule with a stroke around it. The edge now draws in four stacked inset layers:
`--glass-rim` (the crisp surface line), `--glass-lens` (an 18px soft band — the actual refraction, and
the thing that was missing), `--glass-dispersion` (a cool fringe just inside, where a real edge splits
light), and `--glass-lip` (a dark inner shadow along the bottom, which is the pane's thickness).

**2. The veil sits between two failures, and finding it meant hitting both.** Cutting `--glass-fill`
from 0.15 to 0.07 let the backdrop's colour through, which is what D-070's transparency finding implies
it should — and the bar then vanished, because unlike Echo's it usually floats over the *empty* part of
the backdrop rather than over a dense grid of covers. It measured only **+9** above the window behind
it: no body, no glass. 0.14 puts the interior lift back to **+20** while keeping the colour.

| What | Reference | D-070 pass | Now |
| --- | --- | --- | --- |
| Backdrop → interior | +27 | +25 | +20 |
| Interior → top rim | +40 | +37 | +43 |
| Interior → side rim | +24 | +22 | +33 |

The part that generalises: **a luminance lift measured off a reference is only valid for the backdrop
it was measured over.** The reference's +27 was a bright teal cover smeared through an almost clear
pane; reproducing +27 with a grey veil over a dark wash produces a painted film instead. In the
reference the colour *is* the content, so the veil has to stay thin and the edge has to do the work.

**3. The pill now spans the full window width** (`left: var(--float-inset)`, was
`calc(var(--rail-w) + var(--float-inset))`) — that is what the arrow was pointing at. A dead gap of
background in the bottom-left made the bar read as a widget parked mid-screen rather than the base
layer of it. The rail already stops at `--bar-h + --float-inset` from the bottom, so the two do not
overlap.

Re-audited on Home at 1920×1009: **1 contrast failure**, still the pre-existing accent-on-red
now-playing row (BUG-044).

**Also noted, not mine:** a parallel pass added `--elev-*`, `--dur-*` and a `--focus-ring` token to
`app.css` but left the older `:focus-visible { outline: 2px solid var(--accent) }` rule further down.
Equal specificity and later in source order, so the new focus-ring token is currently dead code.
Flagged rather than changed, since it is in-flight work.

### D-074 — Corner rounding is a scale, and it is not the same mistake as the removed intensity dials
The owner asked for a radius slider for the player. It partly re-opens D-061, which deleted the glass
blur and colour-intensity dials, so the distinction had to be made explicitly or the next session
deletes this one as a regression.

D-061's reasoning was "nobody lands on a better number than the tuned default by dragging a slider".
That was true of blur and saturation, which have a contrast cliff — push them and text stops being
readable, so the range of defensible values is effectively one value. Corner rounding has no such
cliff: sharp versus soft is a genuine taste axis that costs nothing in legibility, so a control over
it is honest in a way the two removed ones were not.

It scales rather than sets an absolute radius, because the three radii encode depth — artwork 14px,
cards 18px, the floating rail 28px — and one shared number would flatten that hierarchy.
`cornerScale` is a percentage multiplied against `RADIUS_BASE` in the settings store, which is the
single place those numbers live; the Settings UI shows a percentage so it does not duplicate them.
`--radius-pill` is deliberately excluded, since 999px scaled by anything is still a pill or a broken
pill.

Verified by measuring computed `border-radius` on real elements across the range: album art
`.wrap` 0 → 28 → 14px, `.card` 0 → 36 → 18px, the nav rail 0 → 56 → 28px. The first measurement pass
read 0px at every setting and looked like a broken feature; it was not, it was sampling synchronously
after `ui.set()` before Svelte had re-rendered, so the element measured belonged to the outgoing view.
Two animation frames between the change and the read gave the real numbers.

### D-075 — One shared notice surface, because some actions have no panel to report in
Adding an honest outcome to "Delete cached lyrics" (BUG-050) exposed that the app had nowhere to put a
result that isn't an error and isn't tied to a view. Deleting the *current* track's lyrics can speak
through the lyrics column. Deleting a track that is not playing can not — it has no panel at all, and
before this the only option was saying nothing, which is how the bug stayed hidden.

`stores/notice.svelte.ts` is a single auto-clearing line, rendered above the player bar. It stays
small on purpose: it is not a queue, not stacked, not actionable, and it is not a replacement for
view-local state. `lyricsStore.report()` still handles the current-track case because that outcome
belongs in the panel it describes, and Low Power plus `prefers-reduced-motion` drop its entrance
animation like everywhere else.

Two planned features already need it, which is why it is built as one surface rather than inline: the
error auto-skip needs to name the track that failed (D-076/Phase 15), and bulk actions need to report
"Removed 12 of 14" honestly rather than rounding up.

### D-076 — The mini card gets its own taskbar entry so the hover preview shows two windows
The owner showed Spotify's taskbar flyout rendering two thumbnails side by side — the full player and
the mini player as separate window previews — and asked for the same.

Noctra already has both windows, so this was never a capability question. The mini card was declared
with `"skipTaskbar": true`, which removes its taskbar button, which leaves Windows exactly one window
to thumbnail. Set to `false` and the flyout gets a second preview.

Why they group into one button rather than producing two buttons: no explicit `AppUserModelID` is set
anywhere in this project, so Windows groups by executable path. Both windows belong to the same
`noctra.exe`, so they collapse under a single taskbar button whose hover shows one thumbnail per
window — which is the behaviour the reference screenshot exhibits.

Two consequences worth knowing rather than discovering:
- The second thumbnail only appears **while the mini card is open**. The window is declared
  `visible: false` and is shown/hidden by `toggle_mini`, so a hidden window contributes no preview.
  That matches the reference, where the mini player's preview exists only when it is up.
- The card now appears in **Alt+Tab**. That is the standard trade for having a taskbar button at all.
  It is arguably correct — the card is a real, independently movable window you might want to switch
  to — but it is a change in behaviour beyond the taskbar, so flagging it.

Verified as far as it can be without a human eye: the key name is genuinely honoured rather than
silently ignored, because `WindowConfig` is `#[serde(rename_all = "camelCase", deny_unknown_fields)]`,
so an unrecognised field would fail the config parse at build time rather than default quietly. The
config parses and the app builds with the key present. The flyout itself still needs one manual hover,
for the standing reason recorded under BUG-054.

### D-077 — The favourite is the centrepiece of the sleeve, and the glow comes from the row receding
The owner supplied three references — Noctra's own mini card against two Spotify + spicetify
fullscreen shots — and asked for the heart to be far larger, animated, and for the reference's
button treatment to be copied exactly.

Four separate things turned out to be needed, and only the first two are about the heart:

1. **Size.** The fullscreen favourite was a 19px glyph parked in a glass orb on the side rail; the
   card's was 96px. The reference holds the heart at roughly two fifths of the sleeve, so it is now
   168px centred on the artwork in fullscreen and 146px on the card. At that scale the icon set's
   2.15 stroke grows with the viewBox into a heavy rope, so both override `stroke-width` to 1.25.
2. **Animation.** `heart-pop` already existed in `app.css` and was wired into exactly one surface —
   the bottom mini-player bar. Fullscreen and the card had none, which is what "no animation to it"
   meant. Rather than scale the small pop up, the large surfaces get `heart-pop-lg`: a shorter
   overshoot (1.26 rather than 1.4), four settling beats instead of three, and no rotation. At 150px
   the rotation reads as cartoonish and the larger overshoot pushes the shape outside the sleeve.
   Centring uses the `translate` property, deliberately, so `transform` stays free for the pop — if
   both wrote `transform` the heart would jump off-centre mid-animation.
3. **The glow is a subtraction.** The reference transport does not light up the pointed-at glyph; it
   drops every sibling to 0.42 opacity, and the live glyph's stillness is what reads as glowing.
   Reproducing only the bright half gives an ordinary hover. Implemented as `.cluster:hover >
   :not(:hover)`, applied to the transport, the orb row and the card's transport. See BUG-055 for why
   the class has to name the cluster rather than hang off the container's hover.
4. **Orb hover.** The reference's fullscreen orb glows because light leaks past the rim. The old hover
   only brightened the accent halo behind the disc, so the ring itself never lit. It now stacks a
   white catch-light, a `0 0 0 1px` rim, an outer white bloom and the accent glow behind it.

Measured, not eyeballed: real CDP hover on the next glyph gave `Next track=1` against
`Shuffle/Previous/Play/Repeat=0.431` mid-transition; a trusted click on each heart sampled
`heart-pop-lg` running at 151ms/167ms with computed `transform` at scale 1.26 and 1.15 respectively.
Screenshot of the orb row shows the hovered orb luminous and its five peers receded, matching the
third reference.

---

### D-078 — The A-B section loop was removed, not hidden

The owner saw the `A–B` chip beside the track time, did not recognise it, and asked what it was and to
remove it if it was not needed. Gone entirely: the chip, the progress bar's right-click loop menu, the
`A` keyboard shortcut, the `loop-range` icon, and the store's `loopA`/`loopB`, `loopArmed`,
`tapLoopPoint`, `markLoopA`, `markLoopB`, `clearLoop` and `enforceLoop`.

Why removal rather than hiding it until armed: it arrived through the feature-batch round
(`docs/plans/noctra-feature-batch.md:53`), not from `noctra-build-prompt.md`, nobody asked for it by name,
and that same line records it as **"Not yet probed"**. A permanent control next to the seek bar for an
untested feature is exactly the kind of clutter that makes an app feel assembled rather than designed.

Recorded so a later session does not re-offer it. If it is wanted again it should be built against a real
use and probed — the parts that need thinking about are the ones it never addressed: a span must not be
inherited by the next track, a seek past B should wrap to A rather than escape, and resume should restore
*with* a loop rather than into one. `repeat` is a separate feature and is untouched.

One side effect handled on the way out: the bar's right-click handler used to call `preventDefault`, so a
bare guard stays on it. Without one, right-clicking the seek bar surfaces the WebView2 browser menu
(Back / Reload / Inspect), which is worse than the menu that was removed.

Verified: `svelte-check` 0 errors / 0 warnings, `vite build` clean, and live over CDP the running app shows
0 `.loop-chip` and 0 `.loop-span` in the DOM with both progress bars still mounted, and `"loopA" in
player === false`.

### D-079 — The artwork is the only ruler: Now Playing and the fullscreen lyrics view are both sized off `--art`
"MAKE EVERYTHING LARGER… THIS EXACTLY THIS SIZE WITH RESPECT TO THE ALBUM ART'S SIZE" — with a
screenshot and a grid drawn on it. This is the fourth time the controls have been called too small, and
each of the first three fixes just raised a number and then drifted straight back. Measuring the
reference settled why: **the ratio was never the problem, the fixed pixels were.**

Both views authored their cover as a literal and every control on it as its own literal. `NowPlaying`
passed `size={420}` with orbs 44, heart 168, transport glyphs 20/23/24, rail 112, title `--fs-3xl`;
`Lyrics` used `size={560}` with orbs 42, glyph 24, transport at the same fixed defaults and a 62px
heart. The cover could not grow with the window, so enlarging it meant touching a dozen unrelated
numbers, and any one left behind made the icons *relatively* smaller than before. That is the loop.

Now each view declares **one** length, `--art`, and everything else is a fraction of it, measured off
the reference against its own cover (590px in that capture):

| | reference | Now Playing | Lyrics view |
| --- | --- | --- | --- |
| favourite heart | 50% of the cover | **50.0%** | **49.6%** |
| top control ring | 8.8% | **8.8%** | **8.8%** |
| its glyph | 4.2% | **4.2%** | **4.2%** |
| play glyph | 8.1% | **8.1%** | **8.1%** |
| skip glyphs | 9.2% | **9.2%** | **9.2%** |
| shuffle / repeat | 5.4% | **5.4%** | **5.4%** |
| seek row width | 94% | **94.0%** | — |

Cover size now tracks the window instead of capping out. At the reference's own 1920×1009 the lyrics
cover renders **585px against the reference's 590**, and the heart, ring, play, skip and auxiliary
glyphs come out 290 / 51 / 47 / 54 / 32px where the reference measures 296 / 52 / 48 / 54 / 32 — within
a pixel or two on every one. Now Playing runs 416px at 1280×800 → 525px at 1920×1009 → 749px at
2560×1440.

**The mechanism, because four components now share it:** `PlayerControls` and `ProgressBar` read their
sizes as `var(--pc-*, default)` / `var(--pb-*, default)` at each use site, and the view sets the
variables on its wrapper. See BUG-061 for the version that did not work — declaring the defaults on
`.transport` itself made them unoverridable by inheritance.

Two costs, both better than the alternative:
- **Now Playing clamps the artist credit to one line and the title to two.** With everything sized off
  `--art`, an unbounded wrap was the one thing that could still overflow the column, and at 1440×900 it
  did — it pushed the cover against the top of the window. The full credit is on the mini-player's
  tooltip and in the library row.
- **The lyrics view's volume rail got a `--art`-relative height** and the Now Playing rail moved
  *inside* the sleeve at its vertical middle, where D-062 already said it belonged; it had drifted to
  outside the right edge, bottom-anchored.

**Process note, because it cost a wasted pass:** the screenshot has a blurred lyric column on its
right edge, which makes it the **fullscreen lyrics view**, not Now Playing. The first pass sized Now
Playing only — which that view genuinely needed anyway — and the error was only caught by capturing the
current state and comparing. Read the whole frame of a reference, including what is beside the panel
being complained about, before choosing a file to edit.

**One pass was not enough.** After scaling the controls, a sleeve-normalised side-by-side against the
reference still showed the *text and seek row* too small — because in `Lyrics.svelte` those live in a
separate `.meta` block below the sleeve, still on fixed `--fs-*` tokens and a hand-rolled 8px bar, and
`.meta` was capped at `min(420px, 100%)`, narrower than the cover above it. **`--art` and all its
fractions therefore moved from `.art-zone` to `.column`**, so the block under the sleeve scales with it
too: title 7.8%, artist 4.4%, time 3.7%, bar height 2.4% (reference measures 15px on a 590px sleeve),
meta width 94%.

Lesson worth keeping: **sizing off the artwork only works if the artwork's variable is defined on an
ancestor of everything that should scale.** Putting it on the sleeve itself silently excluded the text
below it, and the miss was invisible until the two images were overlaid at matched scale.

Verified: 0 contrast failures on the fullscreen, and the mini-player's compact transport is unchanged
(44/19/40/17) — scaling the fullscreen didn't shrink the bar.

### D-080 — The sleeve reference is copied element-for-element, including the liked heart's colour
"just copy reference follow it faithfully." So the remaining differences that D-079 had written off as
feature gaps were built rather than explained away. Four of them, all in the fullscreen lyrics view,
all verified against a **true 1:1 composite** — both frames cropped from their own sleeve corner at
the same offset and placed unscaled side by side, which is the only comparison that can settle a
proportion argument (`scripts/compare-final.png`).

1. **The sleeve's credit row.** `A.R. RAHMAN · Fullscreen · THE HUMMA SONG (FROM…` — album artist left,
   the view's name centre at full brightness, album right, both ends uppercase, bold and dimmed. The
   file's own doc comment had described this since the Spotify-reference pass but **the markup was
   never written**; grepping for it returns nothing. A comment describing a feature is not the feature.
   Left uses `leadArtist`, not `albumCredit` — on a soundtrack that field is the entire billing list
   ("A.R. Rahman & Badshah & Tanishk Bagchi & …"), which ellipsises to mush and shoves the centre
   label off the middle.
2. **The sixth orb.** The reference row is layout · panel · **expand** · library · settings · close,
   and the expand is the filled one because fullscreen is the current view. Added, wired to the album
   view, and lit from here. Row pitch then measured **59.8%** of the sleeve against the reference's
   59.7%.
3. **The liked heart is white, not red — overriding D-036.** Echo distinguishes liked from unliked by
   *fill*: solid white versus a hollow outline, no hue change anywhere. Changed `.heart-lit` in
   `app.css`, which is shared, so the fullscreen sleeve, the Now Playing heart and the desktop card all
   moved together — see [[noctra-mini-fullscreen-parity]]. Now Playing had its own copy of the liked
   colour and its own red bloom, so it had to be changed separately or the two fullscreen surfaces
   would disagree. **Scoped to the big heart on purpose**: the small `.orb-love` glyph in the bar,
   library rows, queue and context menu stay red, because at 18px a hue change is the only thing that
   can carry the state.
4. **Two orb-row deviations.** The disabled layout orb sat at the global `opacity: 0.4` and read as a
   *missing* circle, breaking the row's rhythm — raised to 0.62, still visibly the odd one out so D-015
   holds. And the active orb inherited `.orb-on`, which paints the **track's accent**: the third circle
   glowed red, gold or blue depending on what was playing, while the reference's is a neutral lighter
   pane. Overridden for this row only rather than changing `.orb-on` globally, which shuffle and repeat
   on the bar depend on.

Also brought the title from 7.8% of the sleeve to 7% — the reference's measures ~40px on a 590px cover
and mine was rendering 46px.

Final 1:1 deltas: heart solid white at 50%, six evenly-weighted orbs with a neutral active state,
credits row present, transport 8.1 / 9.2 / 5.4%, seek bar 2.4%, title 41px against ~40px. 0 contrast
failures, 0 type errors.

**Open question this raises, not resolved here:** the layout orb is genuinely inert — it is disabled
and labelled "coming later". It is in the reference, so it was kept. But the standing rule that an
unidentifiable or unwired control gets deleted rather than dimmed argues for dropping it, which would
leave five orbs where the reference has six. Owner's call.

### ⚠ Addendum to D-080 — a concurrent session has since diverged from it
Recorded so the next reader does not assume the numbers above are live. A parallel agent rewrote
`Lyrics.svelte` between 23:25 and 00:12 (41.0KB → 42.3KB, extracting a new `VolumePill.svelte`), and a
clean reload of the running app now measures:

| | D-080 / reference | live now |
| --- | --- | --- |
| sleeve credit row | present | **removed** |
| liked heart | 50% | **42.7%** |
| play glyph | 8.1% | **9.4%** |
| title | 7.0% | **5.8%** |
| six orbs, ring 8.8% | ✓ | ✓ survived |

`.heart-lit { color: #fff }` survived in `app.css`. The 6-orb row survived. The credit row did not —
`class="credits"` is gone from the file.

This was **not re-applied**, deliberately: overwriting it would start an edit war in a tree with no git
and no way to see which direction the owner actually wants. Needs a human call on whether the sleeve
credit row is in or out.

Also unrelated to this work: `src/services/audio/fade.test.ts` (another session's new file) fails
`svelte-check` — `import { … } from "./fade.ts"` needs the extension dropped or
`allowImportingTsExtensions` enabled. Left alone for the same reason.

### D-080 — The reference heart blooms on a different clock from the controls
The owner sent a 40s screen recording of the Spotify + spicy-lyrics fullscreen page and asked for the
mouse reactions to be copied exactly. Frame-stepping it (see the technique note below) showed one thing
no still screenshot can: **the reveal is not one transition**.

Sampling the heart's opacity at half-second steps from 7s to 13s:

| t | 7s | 7.5s | 8s | 8.5s | 9s | 9.5s | 10–12.5s | 13s |
|---|----|------|----|------|----|------|----------|-----|
| heart | faint | faint+ | ~half | near | full | full | full | gone |

The orb row and the transport are already at full strength at 7s while the heart is still arriving, and
it takes roughly 1.5–2s to reach solid white. So the reference runs two timings at once: controls reveal
fast because you are about to click them, and the heart blooms slowly because it is decoration, not a
target. Our shared 240ms reveal collapsed both into one snap, which is why it read as a switch.

Implemented as an asymmetry rather than a single duration: **1500ms with a 120ms lead on the way in**,
declared on the hovered state (the state being transitioned *to* supplies the transition), and **380ms on
the way out**. Fast out is deliberate — a heart still ghosting over the cover after the pointer has left
is worse than one that arrives gradually. `visibility` is delayed to match the fade-out so the element
leaves the tab order only once it is actually invisible. Applied to both the fullscreen `.love` and the
desktop card's `.cover-heart`.

Verified by reading computed style across a real hover: idle reports `opacity 0, duration 0.38s,
visibility-delay 0.38s`; hovered reports `duration 1.5s, delay 0.12s`. A screenshot taken ~250ms into the
hover catches the heart genuinely translucent over the sleeve, which is the frame the reference produces.

Also confirmed from the recording, and already correct in our implementation: the favourite is a **thin
outline at the same large size when unliked** and solid white when liked — it does not grow on like, it
fills. Around 28s the outline state is visible at full size.

**How the video was read** (no ffmpeg on this machine): a `file://` video taints the canvas, so
`getImageData` throws. Serving the same mp4 from a tiny Node server with byte-range support and opening it
over `http://127.0.0.1` makes it same-origin and drawable; seeking to fixed timestamps and compositing
crops into one contact-sheet canvas gives a readable frame series from a single screenshot. Seeking is
slow enough that batching more than ~13 frames per call runs into the CDP tool timeout.

### D-081 — The volume is a glass capsule that fills white, with the speaker living inside it
The owner sent a crop of the reference's volume control and asked for it to be copied in both the
fullscreen view and the desktop card, with the mute-on-click behaviour they demonstrated on the scroll
wheel.

What the reference actually is, versus what we had:

| | before | reference |
|---|---|---|
| shape | frosted channel + a separate round thumb | capsule, no thumb at all |
| readout | thumb position | the edge of the solid white fill |
| speaker | a dim icon *below* the rail | inside the capsule, at its foot, and it is the mute button |
| unfilled | dark channel | liquid glass — you see the artwork through it |

Built as `components/VolumePill.svelte` rather than by extending `Slider`. `Slider`'s vocabulary is
track + fill + thumb, and this control has no thumb and puts a button inside its own track; adding a
slot, a mute callback and a hide-the-thumb flag to a component the progress bar and the lyrics-offset
slider also use would have been three new knobs on a shared API to serve one call site. The transparent
`<input type=range>` still rides on top, so dragging, arrow keys and screen-reader semantics come from
the browser.

Two details worth keeping:

- **The glyph's ink follows the fill.** It is dark because it normally sits on white. When the level drops
  below 7% there is no fill under it any more, so it switches to light — otherwise muting to zero leaves
  an invisible button.
- **Mute is a toggle command, not a value.** The card's snapshot of `muted` can be up to 250ms stale, so
  sending the boolean it believes would write that stale value back over the real one. `mini-command:
  "mute"` is resolved in the main window, which owns the audio element. `muted` was added to the snapshot
  so the card can draw the right glyph.

Sizing is off the same `--art` scale the rest of the fullscreen view uses (`0.046` wide, `0.235` tall),
and the glyph is sized from `--vpill-w` in CSS rather than a JS number, so it keeps its proportion on
both surfaces.

Verified live: fill height tracks the value (`42%` at volume 0.42), the glass shows above the fill, and
clicking the speaker walks `muted` false → true → false with the `aria-label` following. Both the
fullscreen rail and the desktop card render it.

**Amended the same day: the bottom mini-player bar got it too.** The note below this one originally said
the bar keeps its plain horizontal slider because "the capsule is a vertical control". That was a
defensive call, not a real constraint — the owner asked for it anyway and the capsule turned out to
translate directly. `VolumePill` now takes `orientation="vertical" | "horizontal"`: the fill grows from
the left instead of the bottom, the gradient swaps axis, the speaker sits inside at the left end instead
of the foot, and the cursor becomes `ew-resize`. The level is carried as a single `--lvl` custom property
so the fill is pure CSS and one rule set handles both axes.

That also removed the bar's separate mute button — the glyph inside the capsule is the mute control there
as it is on the other two surfaces, which is what makes all three the same object rather than three
similar-looking ones. Verified at volume 0.5: fullscreen `19x98` with a `17x48` fill, card `26x132` with
`24x65`, bar `112x22` with `55x20` — every one reading 49–50% of its own capsule.

The one thing that does **not** transfer to the bar is the sleeve-sized heart: there it is a 22px toolbar
glyph among queue/history/volume, and the outline scaling problem described in D-082 only bites once a
glyph is drawn large. At 22px the 24-unit box magnifies by 0.92x, so the stroke is already thinner than
advertised.

### D-082 — Icon strokes scale with the viewBox, and `vector-effect` only works on the shape
The favourite outline read as "very thick". The cause was not the number: `stroke-width: 1.25` is in
**viewBox units on a 24-unit box**, so the rendered weight is `1.25 × (drawnSize / 24)`. Once the heart
became the centrepiece of the sleeve that same value drew a **~9px rope** on the fullscreen view and a
~7.6px one on the card — two different weights on two surfaces, both far heavier than intended.

**The first fix here was wrong, and the verification that approved it was wrong with it.** Putting
`vector-effect: non-scaling-stroke` on the `<svg>` container looks right and does nothing: `vector-effect`
is a graphics-element property, so it has to be declared on the `<path>`. The probe read
`vectorEffect: "non-scaling-stroke"` back off the `<svg>` and reported success — but a computed style on
an element that cannot act on the property still returns the property, so the measurement confirmed the
declaration rather than the effect. The outline never actually thinned. Corrected by declaring it on
`svg path`, where the same read is meaningful.

Final state, both surfaces: `vector-effect: non-scaling-stroke; stroke-width: 4px` on `svg path`.
Verified against the `<path>` itself — `stroke: "4px"`, `vectorEffect: "non-scaling-stroke"` on a 306px
fullscreen glyph and a 251px card glyph.

The weight landed at 4px after two corrections in opposite directions. `non-scaling-stroke` first made the
outline honest — a fixed CSS-pixel hairline — and 1.5px turned out to be too fine to read against busy
artwork. 4px on a ~300px glyph is a ratio of about 0.013, which is the same proportion measured off the
reference recording, so the number is not taste: it is the reference's weight expressed in pixels that no
longer scale with the sleeve.

Size went to **1.75×** and then back to **1.6×** once it was seen at full size: `--art-heart` is
`0.8` of the artwork (0.5 × 1.6), and the card's `.cover-heart` box is `clamp(192px, 67%, 336px)` — both
fractions of the sleeve, so the rendered pixels move with the window. That is precisely why the stroke had
to stop scaling too.

### D-083 — The heart glyph was redrawn with a pointed base
The owner's read of the shipped silhouette was "a little way too roundy on the bottom half". The old path
was the stock Feather-style heart: `M12 20.2s-7.6-4.6-7.6-9.5A4.1 4.1 …`, whose lower half is a single
smooth `s` curve, so the base is a bowl rather than a point.

Rewritten as six cubics with the apex treated as a genuine corner. The trick is the tangent pair at
`(12, 20.8)`: the left flank arrives with control point `(9.8, 16.6)` and the right flank leaves with
`(14.2, 16.6)`, so the two rays out of the apex are `(±2.2, -4.2)` — an included angle of about 53°.
Setting both controls on the *same* vertical line through the apex would have made the tangents collinear
and the base smooth again, which is the mistake to avoid here.

The cleft is done the same way with a wider angle (about 53° from `±0.6` offsets), so it reads as a notch
without becoming a spike. Each lobe keeps a vertical tangent at the widest point `(±3.4 → 20.6, 9.8)`,
which is what lets the top stay soft while the bottom tapers.

`heart` and `heart-filled` share the one path string, as before — the two states must be the same
silhouette or the toggle reads as two different controls. Verified by rendering: pointed base at 280px on
the sleeve, and still legible at 16–22px in the sidebar, the track rows and the bottom bar.

Two lessons worth keeping:

- **Growing an icon grows its stroke** unless the stroke is decoupled from the scale. `non-scaling-stroke`
  also stops the weight drifting as `--art` resizes the sleeve with the window.
- **A probe must measure the thing that produces the effect.** Reading back a CSS property proves the
  cascade applied, not that the property does anything on that element. When the claim is about pixels,
  measure pixels — or at minimum read the property off the element that actually paints.

### D-084 — The sleeve credit line is gone, and the type is sized for our titles not the reference's
Pointed at on the fullscreen lyrics view: the text was too large to read comfortably, and the artist and
album printed across the top of the sleeve had to go.

**Credit line removed** (`.credits` in Lyrics.svelte, plus `--art-credit`, `--art-credit-gap` and the now
unused `leadArtist` import). The reference does carry one — "TAME IMPALA / Fullscreen / THE SLOW RUSH" —
but its titles are two words. Our library is Bollywood soundtrack billing, so both ends of that line
ellipsised into mush and duplicated information already sitting under the title. Matching the reference
stopped being the right rule the moment the data shape differed.

**Type and transport sized down, identically on both surfaces**: title `0.07`/`0.088` → `0.058`, artist
`0.044`/`0.051` → `0.036`, media `0.032`/`0.041` → `0.028`, time `0.037`/`0.041` → `0.034`, play
`0.108` → `0.094`, skip `0.092` → `0.08`, aux `0.054` → `0.048` (all as fractions of `--art`). NowPlaying
and Lyrics had drifted a full third apart on the title because each round of sizing was applied to only
one of them; they are now set value-for-value from the same numbers.

The reference ratio was ~7.8% for the title and we were at 7%, so this is a deliberate departure from it:
**the ratio was tuned against a reference whose strings are short.** Holding the reference's proportion
while feeding it 60-character billing lists produced type that filled two thirds of the column and
truncated anyway. The size now answers to the longest string the library actually contains.

Also found while checking this view: **Lyrics.svelte was still using the old grey `Slider` for volume** —
the capsule had only gone to the artwork view, the desktop card and the bottom bar. That is exactly the
drift the parity rule exists to prevent, and it is what the "grey pill with a dot" in the screenshot was.
Swapped for `VolumePill` at the same fractions as the artwork view.

Added a light-sleeve rule for the heart while I was in there: `data-art-light` only covered `.orb-bare`,
so a white heart outline on a pale cover had no fallback at all. **Known limitation, not fixed:** the flag
is driven by the *mean* luminance of the whole cover at a 0.55 cutoff, so a busy sleeve with bright
lettering in one band — "KHAMOSHIYAN" above — leaves it off and the transport glyphs still wash out there.
A per-region check or a permanent scrim behind the transport row would fix it properly.

### D-085 — Two icons were redrawn because their detail sat below the set's line weight
The owner asked for a better icon pack. Before changing anything I looked at what the current glyphs
actually are, and the honest answer was that a migration would not have fixed the problem — two specific
shapes were failing for a geometric reason.

**`settings` was a traced gear** whose path was full of `.05` and `h.06` micro-offsets: ten teeth drawn to
be faithful at 24px. It renders at 18–20px in the orb row and the sidebar, where the notches between
teeth are *narrower than the 2.15 stroke that has to draw them*, so it came out as mud. That is not
fixable by tidying the path — a gear's detail is fundamentally below this set's line weight. Replaced with
three fader tracks with knobs at different positions: reads at any size, is a normal preferences mark, and
suits a player that has queue, lyric timing and an EQ behind it.

**`pip` was "a rectangle with a smaller rectangle inside it"**, and it sits two buttons from `layout`,
which is "a rectangle with lines inside it". At 18px those are the same object, so one of the two orb
buttons was unidentifiable. The frame is now broken at the bottom-right and the small panel overlaps the
gap and runs past it, which is the picture-in-picture read.

Both live in `icons.ts`, which is a single shared data file, so every surface picks them up at once — the
one place where the parity rule is free.

Also found: `fullscreen` and `fullscreen-exit` are byte-for-byte the same four corner brackets as the
in-use `expand`, and nothing references them. Left in place rather than deleted, since a fullscreen
toggle is obviously coming and they may be intended for it — but they are dead weight until then.

Verified by rendering the orb row on the fullscreen lyrics view: the fader glyph is unmistakable at that
size where the gear was not, and `pip` no longer reads as a second `layout`.

### D-086 — The UI face is now Outfit, self-hosted, replacing Manrope
> **Superseded by D-087 the same session.** Outfit was an interim step: the owner then asked for
> Bricolage Grotesque and Sora, which produced a better result. The Outfit files were deleted. The
> diagnosis below still stands and is the reason the fallback chain is written the way it is.

The owner called the type "a stupid old unaesthetic font". Worth recording that it was **not** a fallback
failure this time: `document.fonts.check('16px Manrope')` returned `true` and the FontFace set showed
`Manrope:loaded`, so the app really was rendering Manrope. Manrope is simply a humanist grotesque with
narrow, flat letterforms — at the display sizes the Now Playing title uses it reads as generic rather than
designed.

Switched to **Outfit**, chosen for one specific reason rather than general prettiness: it is the closest
free geometric sans to **Circular**, which is the typeface the Spotify reference this whole design is
chasing is actually set in. Round geometric 'o', even-weight high x-height, and a tight fit that holds up
at 40px+ without the letterspacing hacks Manrope needed.

Mechanically identical to how Manrope was wired, so it is a one-line revert:
- `src/fonts/outfit.css` declares two variable `@font-face` blocks (100–900), split by `unicode-range`
  exactly as Google serves them, so the 14.8KB latin-ext file is only fetched when a track needs it.
  `font-display: block`, matching the old sheet — a flash of Segoe UI on first paint is worse than a
  few hundred ms of invisible text on a local file.
- `src/app.css` imports it in place of `manrope.css` and leads the stack with `"Outfit"`.
- Both entry points (`main.ts`, `mini.ts`) import `app.css`, so the desktop card picked it up with no
  separate change — the one place the parity rule is free.

**Deliberately left in the stack's second slot: nothing.** The old comment in this file records that
"Inter" once sat first and was never loaded, silently dropping the whole app to Segoe UI. Listing
Manrope as a fallback after removing its `@font-face` would recreate exactly that smell, so it is out.
`manrope.css` and `manrope-var.woff2` are still on disk (24.8KB) purely so the swap can be undone in one
line; delete them once the new face is agreed.

Neither face covers Devanagari or Telugu, so the Indic lyric lines that several tracks in this library
carry keep falling through to the system stack unchanged — this is not a regression introduced here, but
it is a real gap if the lyrics typography ever needs to look deliberate rather than whatever Windows
supplies.

Verified live: `document.fonts.check('700 16px Outfit')` is `true` and `getComputedStyle(body)` starts
with `Outfit` in **both** webviews; the FontFace set shows `Outfit:loaded` for latin and `Outfit:unloaded`
for latin-ext, which is the unicode-range split working as intended.

### D-087 — The heart base has been changed three times, and the constraint is not round-vs-pointy

D-083 replaced the shipped soft-based heart with six cubics and a hard 53° apex, on a report that the
lower half was "a little way too roundy". That version is now reverted, on a report that it is "way too
pointy in the bottom half and ugly". Both complaints describe the same curve at opposite ends.

So the shape is back to `M12 20.2s-7.6-4.6-7.6-9.5A4.1 …` — the rounded bowl base — and the actual
requirement is not "rounder" or "pointier". It is that the base must not read as **either** a bowl or a
spike. The next adjustment should move the apex tangent rays a few degrees off vertical and keep the
flanks continuous, rather than swinging to whichever extreme was rejected most recently.

Two process notes, because the churn itself is the finding:

- **A screenshot of a superseded state is not a request for it.** One of the three changes in this
  sequence was made by a session that was shown the *old* rendering and asked to "change it to this
  shape", and correctly but wrongly restored it. When the image and the current build disagree, the
  disagreement is the thing to resolve first, not the shape.
- **The glyph and the taskbar heart are separate implementations.** `icons.ts` drives the fullscreen
  view, the desktop card, the docked bar, Now Playing and every small liked marker — one edit moves
  all of them. The taskbar thumbnail heart is drawn from a parametric curve in
  `src-tauri/src/taskbar.rs` and was not touched here, so it still has its own silhouette. Parity
  between them has never been established and is not implied by this entry.

Verified live over CDP: `.bigheart` and `.cover-heart` both report the identical reverted path string,
`svelte-check` 0 errors / 0 warnings.

### D-087 — Two faces, two roles: Bricolage Grotesque for display, Sora for UI and body
The owner asked for Bricolage Grotesque and Sora "where each suits best", told me to research it properly
and use my judgement, and approved downloading the binaries into the repo.

**The research decided the split, not taste.** Bricolage Grotesque ships an **optical-size axis (12–96)**
and a width axis (75–100%) — a face whose letterforms are drawn to change with size, which is the
signature of a display cut. The pairing literature is blunt that it serves headings and should be avoided
where running text would find it distracting. Sora has **no optical axis**, only weight 100–800: built to
look the same at every size, which is exactly what chrome needs. So one is a display face and one is a
text face, and the choice of which goes where is forced by the files, not chosen.

**Outfit was dropped rather than kept.** Sora and Outfit occupy the same geometric-UI role; leaving both
in would put two UI faces in one product competing with each other. Two families is the discipline here.

Implementation:
- `src/fonts/fonts.css` — four `@font-face` blocks, both families split by `unicode-range` as Google
  serves them, so the latin-ext files (53KB and 15KB) are only fetched for tracks that need them.
  `font-display: block`, matching what was there before: a flash of Segoe UI on first paint is worse than
  a few hundred ms of invisible text on a local file.
- Two tokens in `:root`: `--font-display` and `--font-ui`. `body` takes `--font-ui`.
- **Headings are assigned globally in `app.css`** (`h1, h2, h3 { font-family: var(--font-display) }`)
  rather than per view. Every screen already uses those elements semantically, so eight separate edits
  would have been eight places to drift — the same failure that hit the heart sizing three times this
  session. Negative tracking is applied with it: Bricolage is drawn looser than Sora and reads as gappy
  at display sizes otherwise.
- `Stats.svelte` `.num` also takes the display face — the largest numerals in the app.

**Verified rather than assumed.** Both families report `loaded` and `body` computes to Sora / `h1` to
Bricolage. The tabular-figure question was checked properly after a first attempt failed: measuring with
a canvas 2D context reported *both* fonts as non-tabular, because **canvas ignores
`font-variant-numeric`** — the probe was bypassing the feature it was testing. Re-measured in the DOM,
where `1111` and `8888` come out identical for both faces, so promoting the stat numerals cannot make the
columns wobble.

**Known gaps, both deliberate:**
- Neither family covers Devanagari or Telugu, so the Indic lyric lines several tracks carry still fall
  through to the system stack. Not a regression — Manrope and Outfit didn't either — but it is the reason
  the lyrics column looks less considered than the rest.
- `manrope.css` and `manrope-var.woff2` (24.8KB) are now orphaned. Left in place because they predate
  this session; they can be deleted.
- Bricolage's latin file is 131KB because it carries the unused width axis. Google can serve an
  opsz+wght-only instance that is materially smaller; the fetch was blocked by a safety check before I
  could swap it in, so the heavier file is what ships.

### D-088 — The heart owns its own hit area, and the dead Layout button is gone

Two fixes from the same screenshot of the fullscreen artwork row.

**The disabled `layout` orb was deleted, not labelled.** It had sat first in the row as
`disabled` with the title "Layout — coming later" — the D-015 convention of showing an unbuilt
control inert rather than fake. It failed that test in practice: the owner could not identify it and
asked what it was. A placeholder that reads as a mystery button is worse than an absent one, so it is
removed. Nothing else in the app used the `layout` glyph. If a layout switcher is ever built it can
take the slot back with something to show for it.

**Clicking the artwork should not favourite the track.** The favourite button is 42% of the sleeve,
centred, so its square hit box covered a large part of the cover and any click near the middle
toggled the like. The button is now `pointer-events: none` and a child `.hit` carries the clicks,
clipped to the heart's own silhouette via a `clipPath` built from the same path string the glyph
draws — so the target cannot drift from the artwork the way a hand-written polygon would.

Two things that nearly made this wrong:

- The first attempt put `pointer-events: none` on the button and did nothing, because the
  hover-reveal rule grants `pointer-events: auto` to the whole button on `.art-zone:hover`, at higher
  specificity. The override has to come after it. `elementFromPoint` caught this; reading the CSS
  would not have.
- `clip-path` on the button itself would have clipped the visible outline too, shaving half the
  stroke off the heart. That is why the clip lives on a dedicated child rather than on the control.

Keyboard activation is untouched — `pointer-events` governs hit testing only, so Enter and Space
still fire the button.

**Verified on the fullscreen view**, with a real `Input.dispatchMouseEvent` hover and
`elementFromPoint` at five points: heart centre and lobe ink hit; top-left corner, the cleft notch
and the bottom-right corner do not. **The desktop card carries the identical change but is not yet
verified live** — the card was closed during the check and the running instance is being driven by
other sessions, so it needs one look with the card open.

### D-088 — "Noctra" is now a Bodoni Moda logotype, chosen from three rendered candidates
The owner wanted the brand mark to look sexy and premium and to stand out.

**Why a serif, stated as reasoning rather than taste:** the UI already runs two sans-serif grotesques —
Bricolage (quirky) and Sora (plain geometric). A third sans, however pretty, would just be a fourth voice
in the same register and would not read as a logo. A wordmark earns its keep by being a different *kind*
of thing from the text around it, so the contrast has to be structural. A Didone — near-vertical stress,
hairline serifs against thick stems — is the opposite of both faces at once, and is the conventional
signal for "premium".

**The candidates were compared rendered, not described.** Bodoni Moda (700 and 500), Italiana (400) and
Syne (700 and 800) were drawn side by side at 34px in the live app, on a temporary overlay that was
removed immediately after the screenshot:

- **Bodoni Moda 700** — chosen. Full thick/thin drama, and heavy enough to survive at the sidebar's real
  ~18px.
- Bodoni Moda 500 — more refined, but reads thin rather than elegant at UI scale.
- Italiana 400 — the most "fancy" of the set and genuinely beautiful, but too delicate to hold a 22px
  lockup; it wants poster sizes.
- Syne 700/800 — distinctive, but reads art-gallery/tech, not luxury, and 800 gets clumsy.

Sizing notes in `Sidebar.svelte`: a Didone's whole appeal is its contrast, and that only survives if the
weight is pushed and the size sits slightly above body scale, so 700 at 1.18× `--fs-lg` with positive
tracking to keep the hairline serifs from colliding.

`--font-brand` in `app.css` is the single switch. All three families stay registered in
`fonts/brand.css`, so re-running the comparison is one line — and because a browser only fetches a
`@font-face` it is actually asked to render, Italiana and Syne cost **nothing** at runtime. Total shipped
font payload is Bodoni 46KB + Sora 49KB + Bricolage 185KB, split by unicode-range.

Still open: `manrope-var.woff2` is orphaned, and Bricolage carries an unused width axis (131KB where an
opsz+weight-only instance would be materially smaller) because that re-fetch was blocked by a safety
check.

### D-089 — Credits footer on the Settings page, and the one command that opens a browser
The owner asked for a credits block with their name and handles, and for the parts an About section
usually carries that they could not name. What the convention actually holds, gathered from how apps
ship this: **version, who made it, where to find them, what it is built from, and what leaves the
machine.** All five are now on the page, and every one of them is true of this app rather than
boilerplate:

- **Signature** — Bodoni lockup, "Made with ♥ by Soutrik Debnath", version pill. The version is read
  from `app_version`, so it cannot drift from `Cargo.toml` into a hardcoded string.
- **Instagram / GitHub / Telegram** — each row opens in the default browser. They point at the *profiles*,
  not at a repository: the code is not published yet, so an issues or "star on GitHub" link would 404.
- **Built with / Type** — Svelte, Tauri and Lofty (MIT), and the five shipped faces (OFL 1.1). This is
  the attribution those licences actually ask for, and it doubles as the acknowledgements list.
- **Privacy** — no account, no analytics, no crash reports. Verified rather than asserted: `lrclib.net`
  is the only external host anywhere in `src/`.

**`open_url` uses `ShellExecuteW`, not `cmd /c start` and not `tauri-plugin-opener`.** `start` hands the
URL to a command processor, which is one quoting bug away from executing something; the plugin is a new
Rust crate *and* a new npm package *and* a new capability entry. `ShellExecuteW` needs none of that —
`Win32_UI_Shell` is already compiled for the taskbar buttons, so this adds no dependency at all. The
command accepts `https://` only and refuses whitespace and control characters, because the same API
handed a `file://` or a UNC path launches Explorer or runs a program instead of showing a page.

**The heart is the app's traced glyph, not a ❤️ emoji**, in `--love` like everywhere else. An emoji
renders in whatever face the OS picks, ignores the accent system, and would be the only glyph on the
page nobody drew to this set's weight.

Measured, not eyeballed, because the backdrop drifts and a single frame is not the worst case: four
timed captures on the reddest cover in the library, taking the *minimum* ratio per element. Wordmark
13.7, made-with 9.7, labels 13.6, hints 9.5, version pill 5.6, copyright 6.4, handle 6.3 — all over the
4.5 text floor. The heart first measured **3.57** with a red glow behind it, which is the predictable
failure of glowing in the same hue as the cover you are sitting on; switching it to the app's standard
tight dark shadow took it to 4.18, which is above the 3:1 floor for a graphic and it stays decorative
next to the words either way.

### D-090 — The credits footer animates, with the author's portrait rather than a fetched GIF
The ask was "fetch a cool gif from online and put a really small one beside my name… or maybe my
image, you suggest what will be better." Suggested better, and it is their face.

**Three reasons a fetched GIF loses here.** (1) *The app makes no network request at runtime* — that is
the same rule that has fonts downloaded at build time and committed (`fonts/brand.css` says so out
loud). A hotlinked GIF would also make the footer lie about itself: the Privacy row directly below it
claims the lyric lookup is the only thing that ever leaves the machine. (2) *Licence.* A Giphy or Tenor
GIF is not licensed for redistribution inside a shipped app, and this is going on GitHub — the same
trademark reasoning as D-004. (3) *A GIF cannot take the accent.* It is a fixed bitmap, so it would be
the one moving thing in the app that ignores the per-track colour system.

**What shipped instead:** a 34px portrait wearing a conic-gradient story-ring — the gesture belonging
to the very app the Instagram row below links to, which is the joke — that **turns only while a track
is playing**. That is why it is a state and not a decoration: the small figure in the footer listens to
the same song you do, and stops when you stop. Ring colour is `--accent-rgb`, so it is red on a red
cover and blue on a blue one. `prefers-reduced-motion` kills the rotation, and only a 40px box
transforms, so this is the cheapest moving thing in the window.

**The portrait was built, then removed at the owner's request.** A story-ring avatar went in (GitHub photo
first, then their own image, cropped in a webview canvas to a 256px square — 4.4 MB down to 17 KB, because
this machine has no ImageMagick), and the verdict was "do not use any kind of picture, keep it simple". The
markup, the `.face` CSS, the `credit-ring` keyframes and the asset file are all deleted and `src/assets/`
no longer exists. **The credits are text plus the heart glyph. Do not re-add a portrait.** The ring-angle
measurements in the next paragraph describe code that is gone; they are kept only as the record of how that
kind of animation is verified.

Measured rather than watched: ring angle read off the computed transform of `::before` at 1.1s
intervals while playing — **245.3° → 333.3° → 62.7°**, i.e. ~88° a step against the 80° a 4.5s turn
implies — and **0°** with the `spinning` class gone once paused. `npm run build` emits
`dist/assets/credits-avatar-BJFOONqN.jpg`, so the import is not a dev-server-only path.

If a GIF is still wanted: drop the file in `src/assets/` and it is a one-line swap of the `<img src>`.
The ring stays, because the ring is the part that means something.

### D-089 — The app reopens on the last track, armed and paused
The owner asked for either a random track or the last one played at startup, and picked the latter.

**No new player API was needed.** `player.select()` already routes through `moveTo`, whose contract is
"while playing it starts immediately, while paused it only arms it". On a cold start nothing is playing,
so selecting the remembered track lands on it with the transport showing play — which is what the user
asked for ("dont play it but give me the song").

Stored as `lastTrackId` in the settings object rather than as a path. An id is what the library is keyed
on, so a track that has been moved, renamed or deleted simply fails the lookup at startup and the session
begins clean, instead of pointing the player at a file that no longer exists.

**The ordering of the two effects is the only subtle part, and it is a trap worth stating.** The writer
must not run before the reader. On a cold start `player.index` defaults to `0`, so an ungated writer
would immediately store the first track of the library over the remembered id before the restore effect
ever read it. A `restored` flag closes that: the writer returns early until the restore has happened, and
because it reads the flag it re-runs the moment it flips. The writer is also guarded on `player.current`
existing, so an empty library mid-startup cannot wipe the memory either.

Verified end to end against the running app, not by reading the code: armed a track that was not the
first in the library (`a7e3b96348`, "The Humma Song"), confirmed `lastTrackId` hit `localStorage` —
settings flush synchronously, so no debounce to wait out — then paused, reloaded, and the app came back on
the same id with `playing: false` and `position: 0`.

**Position is now restored too**, and it took two passes because the first two attempts each failed for a
different reason:

1. Gating the seek on `player.duration` was wrong. That is `reportedDuration || current.duration`, and the
   fallback comes from the library's **tag** data, so it is non-zero the instant a track is armed — long
   before the element has loaded. The seek fired, `engine.seek` reported the deck's actual `currentTime`
   straight back (still 0 on an unloaded deck), and the position silently reset itself.
2. Re-gating on `reportedDuration` inside a component effect then never fired at all, because an armed
   track that has never been played reports no duration — the element is not loaded until something
   starts. A component effect waiting on that transition loses the race against whatever begins playback.

**The fix is structural, not a timing patch.** The pending offset moved into the player store
(`armResume`, a private `pendingResume`, a public `resuming`) and the seek is applied by the engine's own
`duration` callback — the first moment a seek is guaranteed to hold. `moveTo` clears it, so a resume cannot
carry across a track change and jump the new song to an offset measured against the old one's length. The
scrub bar is set to the saved offset immediately, so the UI never reads 0:00 for a track about to start at
1:28.

Writes are throttled **by value rather than by a timer**: `position` ticks about fifteen times a second and
every `settings.set` re-serialises and rewrites the whole object, so a write happens only once the live
position is two seconds away from what is stored. No clock, no teardown, stops on its own when playback
pauses, and held off entirely while a resume is pending.

Verified end to end: injected a known id + 88s into storage and reloaded synchronously so a concurrent
session could not intervene; startup showed "One Dance" at 1:28 with `playing: false` and the stored value
intact; pressing play resumed at 88 and read 89 a moment later.

**Collision note:** another session added an `onLaunch: "resume" | "shuffle"` setting with its own branch in
the same effect while this was in progress. The two compose correctly — shuffle returns before
`armResume`, so a fresh pick never inherits a stale offset — but that block is now jointly authored and
should be re-read before editing. (That session also opened a second `### D-089`; the numbering has
collided.)

### D-091 — The heart is re-traced from the owner's outline, and the tracer now reports its own error
The owner supplied a clean traced outline (dark line on white) and asked for just the shape, with
nothing else touched. D-087's shape came from a lower-quality reference and read wrong at both ends of
the size range, which is what this replaces.

**The tracer had one real defect, and it was invisible.** It resampled the outline at a fixed 44 points
by arc length, and arc-length resampling shaves exactly the two features a heart is recognised by: the
cleft and the apex. Measured against the new 941px reference, 44 samples lost 13px of notch and 7.5px
of point — the old glyph's blunted bottom was that bug, not a bad reference. So `trace-heart.mjs` now
evaluates the beziers it just emitted and reports `fitMeanPx`, `fitMaxPx`, `apexCutPx` and `cleftCutPx`,
and `SAMPLES` is an environment argument rather than a constant. 80 is the floor: mean 0.14px off a
941px outline, worst 3px, apex within 0.1px, notch within 0.5px. More is not better — 110 samples scored
worse on the notch than 80, because whether a sample lands exactly on a corner is phase-dependent.

Fit is measured to the outline **polyline**, not to its vertices. Vertex distance in steep sections
where samples sit tens of pixels apart reports that spacing as if it were shape error, which is how the
first version of this instrument claimed a 32px defect that did not exist.

The reference is now checked in at `scripts/heart-reference.webp`, because a comment that says "re-run
the tracer" is worthless once the original upload has been garbage-collected. Re-running it reproduces
the shipped path byte-for-byte.

**What did not change**, per the instruction: sizes, stroke weight, colours, the glow, the crack
animation, and the `#heart-hit` clip transform. That transform maps the 24-grid onto the element box
independently of any one path, so it followed the new silhouette without being touched — confirmed live
rather than assumed: the glyph's ink measures norm 0.199..0.800 x 0.238..0.801 of its box, and the clip
covers 0.199..0.800 x 0.237..0.807. Clicking body, apex and both lobes registers; the notch, the corners
and the area beside the point do not.

`heart` and `heart-filled` remain one string, and `scripts/heart-render-check.mjs` now fails loudly if
they ever diverge.

### Known divergence, not touched here
The taskbar thumbnail heart is a separate implementation: `heart_polygon()` in `src-tauri/src/taskbar.rs`
is the classic implicit curve (`16 sin^3 t`, `13cos t − 5cos 2t − …`), not this traced outline, so the
Windows hover preview and the in-app control are two different hearts. Changing it means editing Rust and
rebuilding, which the owner has not asked for; logged so it is a decision and not an oversight.

### D-092 — Mini surfaces match the fullscreen by RATIO, not by pixel size
"the mini player must be the same too… make it exactly like it is in the full screen mode."

Taken literally that is impossible: the sleeve is 435–585px and the bar is a 90px strip, so copying the
fullscreen's absolute fractions gives a 6px play glyph. What actually makes two rows of controls look
like the same player is the **ratio between them**, so that is what was matched. The fullscreen draws
play ÷ skip = **1.40×**; the mini surfaces were at 1.17×, 1.41× and — in the desktop card's pill
variant — **0.93×, where the primary control was the smallest mark on the row**.

| surface | play ÷ skip before | after |
| --- | --- | --- |
| bottom bar | 28 ÷ 24 = 1.17 | **34 ÷ 24 = 1.42** |
| desktop card, lyric sheet | 26 ÷ 22 = 1.18 | **31 ÷ 22 = 1.41** |
| desktop card, vinyl pill | 13 ÷ 14 = 0.93 | **19 ÷ 14 = 1.36** |

Hit boxes grew with the glyph rather than being squeezed by it — the bar's play disc went 48 → 52 and
the card's `.pp` box 38 → 44 — so a bigger mark never means a tighter target.

**One deliberate non-match:** the bar's shuffle/repeat stay at 20 instead of dropping to the sleeve's
0.66 × skip. They had already been raised off 17 in an earlier pass precisely because they read as
underfed, and shrinking them to satisfy a ratio nobody complained about would undo a fix for a
cosmetic tidy-up. The hierarchy is exact on the pair the owner actually pointed at.

Verified live over CDP: bar boxes 46/46/**52**/46/46 with glyphs 20/24/**34**/24/20, card 22/**31**/22,
row width 252px inside the bar's centre column. 0 type errors.

### D-093 — The lyrics view is rebalanced: smaller sleeve, centred lyric column
The owner's screenshot showed two faults at once: the left half read too large, and the lyric lines
sat flush against the left edge of the right half with roughly 700px of dead space to their right.

**The dead space was the real problem, and it made the sleeve look bigger than it is.** `.line` was
`text-align: left` with `width: fit-content`, so a 500px line in a 994px column left the entire right
hand side of the panel empty. The panel's own shadow pool is a radial gradient centred at 50%, so the
words were sitting off to one side of the only thing on screen that was already centred. The reel and
the untimed `.static` block now both take `align-items: center`, which puts every line — and the pool
behind it — on the column's centre. Measured: the active line's centre is 1343 against a column centre
of 1343.

`.line` also carried `margin-left: -14px`, which existed purely to stop the hover plate from shifting
a flush-left column when its padding appeared. On a centred column the padding is symmetric, so that
margin would now slide every plate 14px off its own centre. Removed.

**The sleeve came down 10%** (`--art` from `min(58vh, 34vw)` capped at 780 to `min(53vh, 32vw)` capped
at 700), which is what "a little too big" asks for. The 32vw factor is chosen so the cover still fits
inside its 40% grid track at narrow window sizes — the track does not grow to its contents, so a wider
measure would overflow rather than push the column.

**The cap had to be changed in `NowPlaying.svelte` too, and that is not scope creep.** The two views are
a pair the owner toggles between with one orb, and the sleeve measure is the one thing they share. With
only the lyrics view lowered, the album view's 749px cover would have become *larger* than the lyrics
view's 700px at this window size — the sleeve would visibly jump every time the pair was switched, in
the opposite direction to the one that was fixed. Both now cap at 700, and at 1920x1007 they land at
524 and 534, a 2% difference where before the same two views differed by 11%.

### D-094 — The on-state dot is gone, and "play similar" becomes a standing mode
Two asks in one: the 4px dot under shuffle and repeat read as unpremium, and the bottom bar needed a
play-similar switch — off means a plain library shuffle, on means the run stays in the seed's
neighbourhood.

**The dot is deleted, not restyled.** An active bare orb now carries a saturated accent ink plus a
three-layer bloom, and an inactive one drops to 50% alpha.

The first attempt at this failed and is worth keeping on record, because the reasoning was sound and
the result was useless. The ink was left on `--accent-text` — the token floored at 4.5:1 for body text —
on the grounds that a lit glyph should not trade legibility for colour, and the colour was put entirely
into the glow. The owner's verdict: "i cant even distinguish them if they're on or not." Two things were
wrong with the reasoning. A 20px glyph is a non-text UI component and only has to clear 3:1, so the
4.5:1 floor was spending budget the control did not need to spend. And the accent is sampled from the
cover: the track this was checked on has `--accent-rgb: 149 164 178`, a near-grey, so mixing 58% of it
toward white produced a colour within a hair of the white ink. Hue alone cannot carry this state, on
this library, ever.

So the state is now carried by lightness first and hue second: `--accent-lit` at 78% accent (more chroma
where the cover has any to give) against an off state at 0.5 alpha, with the bloom on top. Measured in
the running app — on: `oklab(0.775 -0.008 -0.019)` with three filter layers; off:
`rgba(247, 247, 250, 0.5)` with none. `.orb-bare:hover` outranks the on-state rule, so hovering an
active control used to repaint it white at exactly the moment you look to check it; the on state now
holds its colour through hover and keeps the lift as the feedback.

One consequence to be aware of: the favourite heart in the bar is dimmed when the track is unliked,
because it reports `aria-pressed` like every other toggle. Liked stays red via `.orb-love`.

`.orb-bare.orb-times::after` (the ×3 repeat count) survives, and had to be given its own positioning:
it was leaning on the deleted dot rule for `position/left/bottom`.

**A comma cost a long detour, so it is worth recording.** `filter` is a space-separated list;
writing `drop-shadow(a), drop-shadow(b)` parses, appears verbatim in the CSSOM, matches the element,
and is then invalid at computed-value time — so the declaration silently becomes `none`. Every probe
said the rule was applied and the computed style said otherwise. The failing test was injecting the
same declaration four ways and watching only the comma version come back `none`.

**The mode is a rolling pool, not a bigger queue.** `ensureSimilar` seeds `[current, ...similarTo(current)]`
and, as the playhead reaches the last five, appends another batch drawn from the track *actually
playing now* — so an hour in the music is still related to what you are hearing rather than to the
first choice. Appending rather than rebuilding is the whole design: `order` stays stable behind the
playhead, so "previous" still walks back through what you actually heard. When nothing in the library
is related, it falls through to an ordinary shuffle instead of stopping; a radio that dies reads as
broken. Turning on "play a random track" releases the mode, because the two intents are opposite.

**Measured, not assumed.** With shuffle on and the mode off, eight hops visited 6 distinct genre tags
and matched the seed's on 1 of 8. With the mode on, 4 distinct and 4 of 8 matching the seed — and
normalising the library's duplicated tags (`Filme/Videospiele` and `Films/Games` are the same genre in
two localisations) gives 3 of 8 against 6 of 8. The picker is genuinely wired to the button.

**The glyph changed shape, as asked.** `sparkle` moved from `paths` to `filled`: a straight-sided
four-point star stroked at 2.15 fills its own short spikes solid at 15–22px, which is the same finding
that made the transport filled. The arms are now quadratic, pinched to 52% of the tip radius at the
waist, with a satellite star at the same ratio so the pair reads as one object. Committing to the mode
turns the mark a quarter revolution up from small; releasing it does not animate, because a flourish on
the way out reads as the app being sorry to see it go.

**Not done:** the switch lives only on the bottom bar. The fullscreen transport has shuffle and repeat
but not this, so the mode cannot be changed from that view.

### D-095 — A lyric line arrives instead of appearing

The owner asked for the line change in fullscreen to feel like something, "subtle but cool", with a
glow named as the idea. A line becoming active already cross-faded, because `.line` transitions
`opacity`/`filter`/`transform` over 420ms as the depth of field moves — so the swap was smooth but
anonymous: nothing marked the moment the song moved on.

**A one-shot arrival on top of the existing transition, not a replacement for it.** `line-arrive` runs
320ms on `.line.active` only, and moves just `opacity`, `transform` and `filter` so it never touches
layout. The line arrives compressed and dim (0.985, 0.68, blurred 2.5px), overshoots past its resting
size and glow (1.018, white drop-shadow at 22px/0.42), then settles. 320ms rather than the cross-fade's
420ms because the reel turns every few seconds and an arrival still running when the next one starts
reads as flicker, not rhythm.

**The light sweep was considered and skipped.** A specular pass across the new line is the obvious
"cool" choice and it is the one thing this view must not do: the owner sees it hundreds of times per
session, and the frequency rule beats the idea. The glow carries the meaning — it says *this line,
now* — so it is the part that stays even when the movement is removed.

**The 100% stop is load-bearing.** The resting look is set by `depth(0)` inline on the element, and an
animation that ends on a different value than the element's own style snaps the moment it is removed.
The keyframe's final filter repeats that inline list function-for-function — `blur(0px)` then three
`drop-shadow`s, the white one at 12px/0.22 — because `filter` only interpolates between matching
sequences. Change `depth()` and this has to change with it. Measured after `finish()`: computed equals
inline, no snap.

**Reduced motion and Low Power keep the bloom and drop the scale**, via `line-arrive-reduced`, a
200ms opacity fade.

**Verified on a real flip, not on a mock.** Sampling the live element every 16ms across a boundary
recorded `svelte-1y5ihd8-line-arrive` at `currentTime` 0 → 50 → 83 → 117 → 184ms with `playState`
running, opacity 0.68 → 1, scale 0.985 → 1.018 → 1.007, and the white shadow's alpha climbing
0 → 0.34 → 0.42 before the settle. A photograph of the held peak shows the halo plainly without the
words losing their edge.

**Three probe traps, all of which produced a false result before they were understood.**
`requestAnimationFrame` starves when the webview is not compositing, so a frame sampler must use
`setTimeout`. Other live sessions navigate `ui.view` mid-run, which unmounts the reel and makes every
sample read `null` — the probe now re-asserts the view and counts thefts instead of assuming a stable
DOM. And `.line.active` is legitimately absent both before the first timestamp and for a frame during
a swap, which nearly produced a bug report claiming the resting glow had gone missing: the reading was
a stale element caught mid-handover, not a regression.

### D-096 — The bar's right cluster stops trailing off into the middle

The owner pointed at the bottom bar's right-hand group — heart, play-similar, queue, sleep, desktop
card, volume — and asked for the icons closer together and the whole group pulled right, because it
"creates a bad impression". They also handed over the judgement call on spacing, so the fix is not just
a smaller number.

**The crowding was structural, not a gap value.** The bar is a three-column grid, and the right column
was `minmax(200px, 1fr)` — 290px at this width — holding ~385px of content. `justify-content: flex-end`
pinned the cluster's right edge and let the surplus spill left, through the 20px column gap, until the
heart sat 15px from the transport row. Tightening the gap alone would have left the overflow in place.
The middle track is now `auto` and the sides split the rest, so the transport is centred by construction
rather than by the coincidence of `1fr 2fr 1fr` — measured transport centre 640 against window centre
640 — and the right track carries a 380px floor so the cluster can never spill into the transport again.
When the window does get tight it is the title column that shrinks, because it is the one that truncates.

**Icon pitch 24px → 16px, by shrinking the box, not by cheating the gap.** Optical spacing between two
bare glyphs is `gap + (box − glyph)`, so the equal-box rule from before still governs: the boxes went
42 → 38 and the gap 4 → 0, which puts the 22px glyphs 16px apart on a 38px pitch and keeps every click
target comfortably above the row's own rhythm. 38px is the number that made the five read as one group
hugging the volume instead of five controls drifting apart.

**One orb was quietly breaking the rhythm, and only measurement caught it.** The pitch came back
38, 38, 40, 40. The sleep timer carries `width: auto` so it can grow around its countdown label, and an
auto box on a 22px glyph with 9px of padding measures 42 while its neighbours measured 38. The padding
now arrives only with the label, via `.sleep:has(.count)`, and the resting box is pinned to the shared
`--orb-size`. All five measure 38 with a uniform 38px pitch.

**The volume gets a group break, not more of the same gap.** The five marks before it are momentary
commands and it is a continuous control; giving them the identical 0 gap flattened the row into one
undifferentiated line. 16px of box separation reads as ~24px of air from the last glyph — enough to say
*different kind of thing* without opening a hole in the bar.

**Capture hazard worth remembering:** the queue panel overlays the bar's right end, so a screenshot taken
while it is open photographs a heart and a wall. Close it, capture, and put it back — it was open when I
found it, and it is open now.

### D-097 — Noctra gets a real app icon; the one shipped was Tauri's scaffold default
> **REJECTED AND REVERTED the same day.** The owner's verdict on the crescent was "EWWW PLEASE REVERT
> BACK TO THE PREVIOUS ICON". `src-tauri/icons/` was restored from `HEAD` (verified by md5 against the
> committed blob) and the installer rebuilt with the original mark. **The scaffold icon stays. Do not
> redesign Noctra's branding again unprompted** — and note that `docs/icon/noctra-icon.svg` is the
> rejected design, left in place but not to be regenerated from. The rest of this entry stands only as a
> record of how the measurements were taken.

Provenance first: `git rev-list --max-parents=0 HEAD` is `9c8e3ee`, and every file in
`src-tauri/icons/` was added by that commit with one timestamp (15:50). So the amber-and-cyan
two-ring mark was never a Noctra design — it is what `create-tauri-app` ships. Same reasoning as
D-004: another product's mark is a legal problem, not a style choice.

**"Give the installer an icon" and "refine the app icon" are one job.** Explorer, the taskbar and
the setup executable all read `icon.ico`, which `tauri icon` generates from a single master. There is
no separate installer badge to design.

**Colour, chosen from the app rather than from taste.** The brand reference's "Luxury Premium"
pairing is near-black + gold, which happens to already be Noctra: `--bg` is `#0a0a0e` and the default
`--accent` is `#d6b27a`, a champagne gold. The icon uses exactly those. The old mark's cyan appears
nowhere in the palette — part of why it read as generic.

**The mark is a crescent with a bead at the end of its arm** — night (*nocturne*) plus a record's
spindle / a note head. Two circles and nothing else, because `icons.ts` already documents the lesson:
detail narrower than the set's line weight collapses at 18px, which is how the gear got replaced by a
mixer.

Measured, not eyeballed:
- **16px.** Rendered the real 16-pixel raster and blew it up 8x with smoothing off (`docs/icon/preview.html`).
  The first version failed this — the mark was too small inside the plate and the crescent's tip poked
  past the bead as a stray spike. Enlarged the crescent (r300→r330), re-centred the group, and moved the
  bead onto the tip so the arm terminates in it. Crescent and bead now resolve as two shapes at 16px.
- **Contrast.** The deepest gold stop `#9a6a2f` against the darkest plate `#06060a` measured **4.31:1** —
  fine for a graphic (3:1) but it was the weakest edge, sitting exactly where the plate is darkest.
  Lifted to `#a3743a` → **4.93:1**, keeping the metal shading instead of flattening it.

**Overrode the brand rulebook on one point, deliberately.** Its logo rules say no gradients, no
shadows, no transparency. Those exist for a logo a non-designer drops on a letterhead at 10mm over an
unknown background. An app icon carries its own plate, so it never lands on anything but itself, and
every platform convention (macOS, Fluent, Material) expects lighting and depth — that is what premium
means at this size. Gradients stay in the icon. **Consequence:** a flat single-colour variant is still
owed for docs or a web page, and does not exist yet.

**Toolchain, since this machine has no ImageMagick or Python imaging:** the master is
`docs/icon/noctra-icon.svg`, rasterised by headless Edge (`--headless=new --screenshot
--default-background-color=00000000`), then `npm run tauri icon` generates all formats. The generator
also emits Android and iOS icon sets; deleted, this is a Windows-only app.

**Build profile changed: `lto = true` → `lto = "thin"`.** Fat LTO made a full release build ~95
minutes on this machine, which makes icon and Rust iteration impractical. Thin LTO keeps the
cross-crate inlining that matters, for a slightly larger exe. `codegen-units = 1` kept.
Warm rebuild since: **~10 minutes.**

**Two facts about installer icons, both measured, neither obvious.** The NSIS `setup.exe` does **not**
pick up the app icon on its own — it ships wearing NSIS's own globe until `bundle.windows.nsis.installerIcon`
(and `uninstallerIcon`) point at `icons/icon.ico`. That was found by extracting the icon back out of the
built file with `ExtractAssociatedIcon`, not by trusting the config; the app binary had been correct the
whole time, which is why "the installer icon is the same file as the app icon" is wrong. And an **`.msi` can
never carry its own icon** — it is not a PE executable, so Explorer draws the icon for the `.msi` file type
for every MSI on the machine. Tauri exposes icon keys only under `nsis`, which confirms there is no knob.
`bundle.targets` is therefore now `["nsis"]`: one installer, and it is the one that can look right.

### D-098 — Shuffle and "play similar" now show the queue they actually build
The owner's complaint: turning shuffle on did not produce an auto queue, and the queue panel's contents
should obviously follow the play-similar switch.

**The feature was never missing; it was invisible.** `ensureOrder()` has always built the full play
sequence the moment shuffle flips — a permutation of the library, or the similar pool once that mode
exists. But `order` was a plain `private` field, not `$state`, and nothing rendered it. The queue panel
showed `player.queueTracks`, which is only what you have hand-added. So a working 313-track shuffled
run sat in a field no component could see, and the panel said "Nothing queued."

Made visible in three moves: `order` is now `$state`, `set shuffle` and `set similar` call
`ensureOrder()` eagerly instead of leaving it to the next step (a lazily-built order means the panel is
empty at exactly the moment you flip the switch that should fill it), and a new `upNext` getter exposes
the remaining run with the explicit queue's ids filtered out — the queue wins the next step, so listing
a song twice would show it coming up twice.

**Two lists, two labels, one honest difference.** The hand queue stays draggable and removable. The
derived run gets its own label naming where it came from — "Similar to this song", "Shuffled library" or
"In library order" — and is read-only on purpose: reordering derived picks would be undone by the next
step, and "removing" one is the block action, which already lives on the track menu. Its ink is dimmed
so a 313-row list cannot read as something the listener built.

Measured live: shuffle on with similar off gives 313 rows labelled "Shuffled library"; flipping similar
gives 30 rows labelled "Similar to this song" and a different set. The header used to read "0 songs ·
0:23 left" beside a full pane, so it now says "Nothing queued · 313 songs up next" when the hand queue
is empty.

**Cost, measured rather than assumed.** 313 rows cost one 175ms frame on opening the panel, then nothing
per frame. Lazy artwork holds: 57 images resolved and stayed at 57 after three seconds, so the off-screen
majority waits for scroll instead of firing 313 embedded-artwork reads at once. Left uncapped — the list
truncating would reintroduce the exact confusion this removes, and the owner has said explicitly that
looks outrank frames here.

### D-099 — The bar floats off the taskbar, and the scrubber gets a floor

The owner annotated two gaps on the bottom bar: the capsule sitting almost on the taskbar, and nothing
under the scrubber inside it. "Increase both by just a bit" — so the change is air, not geometry, and the
horizontal length they had already waved off stayed untouched.

**Measured first: both gaps were the same 13–14px.** The pill stood 14px off the window edge
(`--float-inset`) and its scrubber ended 13px above the pill's own floor. Two identical numbers, which is
why the whole thing read as one object pressed against the bottom of the screen rather than a capsule
floating in a margin.

**The outer gap is now its own token.** `--float-inset-bottom: 20px` applies to the bar alone. Raising
`--float-inset` itself would have moved the sidebar rail's left and top edges too, and the rail floats
against window chrome where there is nothing to collide with — only the bottom edge has a taskbar to
clear. `--bar-h` is derived from the new token rather than doubled, so `--pad-bottom` and the rail's stop
line keep following the bar's real footprint (measured: the rail still clears the bar by 28px).

**The inner gap needed the pill to grow, not the content to move.** 88px of capsule held 74px of content,
so the scrubber was resting on the glass floor no matter where the rail was nudged. `--miniplayer-h` ends
at 100px: scrubber-to-floor 13 → 17, 11px above the transport, album thumb at 20px above and below.
Slightly more air below the content than above it is deliberate — optical centring wants the extra
breathing room at the bottom.

**The follow-up nitpick, same lever.** The owner then pointed at the transport-to-scrubber gap, which
measured 10px against the 17px the scrubber had just been given. `.centre`'s row gap went 4 → 8, and the
pill grew another 4px in the same move — otherwise the new gap is paid for out of the floor air, which is
the exact thing the previous fix bought. The visible distance from the 52px play disc to the rail is the
row gap plus 4px of hit box above the rail, so 8px there measures 14px. The centre column's vertical
rhythm now runs 11 / 14 / 17 / 20 from top to taskbar: progressive, with nothing sitting on anything.

**Not touched:** the bar's width. The owner flagged it as looking long, then answered their own question
("nah thats still acceptable, u dont need to change it"), so it stays full-bleed between the insets.

### D-100 — The queue drawer became the rail's twin instead of a rectangle dropped on top
The owner annotated the bottom-right corner: the queue "feels disconnected and broken and bad UI design".

**The cause was a broken rule of this app's own making.** `app.css` states it plainly above the float
tokens: *"The reference detaches every glass surface — nothing is flush to an edge."* The rail and the
transport bar both obey it, at `--float-inset` with a `--radius-float` capsule. The queue pane was
`top: 0; right: 0; bottom: 0` with square corners and a single hairline down its left edge. So the
window had two floating pills and one flush slab, and the slab read as a different class of object that
had fallen on top of them rather than as part of the same system.

Fixed by giving it the rail's geometry to the pixel: `top: var(--float-inset)`,
`right: var(--float-inset)`, `bottom: calc(var(--bar-h) + var(--float-inset))`,
`border-radius: var(--radius-float)`, and the local `border-left` deleted because `glass-strong` already
carries the rim. `overflow: hidden` so the scrolling body actually clips at the new corners — without it
the first row painted over the rounded bottom.

Measuring the alignment rather than eyeballing it: drawer top y=14 against rail y=14, drawer bottom
863 against rail 863, right inset 14 against the rail's left 14, and the drawer's bottom clears the bar's
top by 28px. The two side panes now close the window as one pair.

This also settles the question BUG-067 left open. There the pane was pulled off the bar with
`--pad-bottom`, which fixed the unreachable volume control but used the *content* clearance rather than
the *pane* inset, so it stopped 18px higher than the rail and still had square corners — a floating
rectangle rather than a floating capsule.

### D-101 — Native `prompt`/`confirm` replaced by the app's own dialog
The owner's screenshot: creating a playlist raised an OS box headed **"localhost:1420 says"**. That is
`window.prompt`, rendered by WebView2 rather than by this app — unstyleable, off the type scale, and
advertising a web origin from software that never leaves the machine.

**Eight call sites, not one.** `prompt` had been used for the repeat count, the sleep minutes, the
bookmark label and three playlist name prompts, and `confirm` for two playlist deletions. Fixing only
the one in the screenshot would have left seven more waiting to be found.

Added `stores/dialog.svelte.ts` + `components/Dialog.svelte`, following the two overlay surfaces the app
already owns: one mounted instance driven by a store, like `ContextMenu` and `Notice`, rather than a
component per caller. Promise-based so the call sites read the same as the `prompt()` they replace, with
`null` on cancel kept distinct from "typed nothing".

It reuses the existing language rather than inventing one: `glass-strong`, `--radius-float` (measuring
29.4px on screen, the same capsule as the rail and the queue drawer), shared `.btn` / `.btn-primary` /
`.btn-danger`, and the same pill-input treatment as the lyrics search field.

**Three details that are easy to get wrong and were checked, not assumed:**
- The bookmark prompt's blank answer is meaningful — an unlabelled mark is still a mark — so the store
  takes `allowEmpty` instead of gating every field on non-empty text.
- A `<form>` cannot carry `role="dialog"` (a11y error), and a `role="dialog"` needs `tabindex="-1"`. The
  dialog is a div wrapping a form, so Enter still submits implicitly and the buttons stay `type="button"`.
- `MenuItem.onSelect` was typed `() => void | boolean`, which rejected every async handler. Fixed on the
  contract, not at eight call sites: a promise means "close the menu", because the dialog is modal on top
  and the old `return false` existed only to hold the menu open while a blocking native prompt ran.

Verified end to end in the running app: dialog renders with the field focused, OK disabled while empty,
typing enables it, Escape closes and creates nothing, the create path makes a playlist, and the delete
path shows `Delete "Dialog Probe"?` with the danger treatment and removes it — the probe was deleted, so
nothing invented was left in the library.

### D-102 — The mini card's five hover-growth faults, and a `:has()` that lies
The owner's list against the desktop mini card: the artwork took over on any hover, the card's own text
stayed visible behind it, long titles were cut with no way to read them, the playing lyric line sat high
or low instead of centred, and the time slider "appears broken and glitchy".

**`:has()` matched and still did not paint — so the trigger is JS state now.** The obvious fix for the
trigger was `.card:has(.art:hover) .cover`. Every selector test said it worked: `art.matches(':hover')`
true, `card.matches(':has(.art:hover)')` true, and `document.querySelector()` with the *exact compiled
selector from the CSSOM* returned the cover element. `getComputedStyle` still reported `scale(0.17)`. The
selector engine and the style engine disagreed, so the cover never grew. Rather than fight a webview
invalidation bug, `coverOpen` is now a `$derived` over two `pointerenter`/`pointerleave` flags.

**Two flags, not one, and the second is load-bearing.** The grown cover paints over the thumbnail, so the
pointer that summoned it is no longer over `.art` the instant the growth starts. A single
"is-the-thumb-hovered" test collapses the cover under the cursor, which reopens it, which collapses it.
`artHot` arms it, `coverHot` holds it, and leaving the cover clears both so the only way back in is
across the thumbnail again — otherwise one accidental thumb-hover would leave the cover a pointer-move
away from dropping onto the lyric sheet.

**The slider was a units bug, not a rendering bug.** Every other `seek:` emit on this channel sends a
0..1 fraction, and `railPreview` is one of those — but the display computed `(fraction / duration) * 100`.
Grabbing the bar therefore collapsed the fill to ~0% and formatted the elapsed label as 0:00 for the whole
drag. That is the entire "broken and glitchy" report. Fixed with a `shownPos` derived that scales the
fraction back to seconds. The rest was rebuilt to the `ProgressBar` spec it was meant to match: a
translucent inset rest instead of an accent bar with a 42% black wash over it, a `scaleX` fill instead of
an animated `width` with a 250ms transition fighting 15Hz position updates, a playhead that appears on
drag and keyboard focus only, and `touch-action: none`.

**Why it is a mirror and not the shared component:** `ProgressBar` reaches for the `player` store, and
`engine.ts` constructs its `AudioEngine` singleton at module scope. Importing it into the mini webview
would start a second audio element in a window whose only job is to relay commands to the first one.

**The lyric line had two centres and neither was the middle.** The reel pinned the active line at 30% of
the viewport while the fade mask ran 8%–78%, whose middle is 43%. And the clamp forbade the padding the
first and last lines need to reach any centre at all, so the line rode the top edge early in a song and
the bottom edge late — the "sometimes up, sometimes down". Now 50%, a symmetric 14%–86% mask, and half a
viewport of reel padding at each end, measured in JS because percentage padding resolves against the
inline axis.

**Long titles** scroll left to the end and back on hover, driven by a measured `--over` rather than a
character guess. The first version added its 2px of slack unconditionally, so every title "overflowed" by
exactly the padding and short ones ticked two pixels; the slack is now only applied when it actually
overflows.

Verified live against the running mini window: hovering the lyric panel and the title both leave the cover
at `scale(0.17)`; hovering the thumbnail adds `cover-open`, the cover computes `matrix(1,0,0,1,0,0)`, and
the head and lyric sheet fade to opacity 0; the active line measures **off by 0px** from the viewport
middle with 144px of reel padding; a 294px title that fits reports no scrolling class and keeps its
ellipsis. **Not verified live: the rail drag.** The mini window was being driven by another session the
whole time — it switched to the pill style mid-test and remounted on every track change — so the press
and drag sequence never landed on a stable cover. The units fix is unambiguous in code and the build and
typecheck are clean, but the drag itself is unconfirmed and needs one look.

### D-103 — The pill mini-player is deleted, and so is the setting that chose it

"REMOVE THAT SETTING OF CARD OR PILL AND REMOVE THE PILL MINIPLAYER ENTIRELY ITS SHIT." The owner's
call, on their own widget, stated twice — so this is a deletion, not a redesign, and nothing was kept
"just in case".

**What went.** `MiniStyle` ("card" | "pill") is gone from the settings store along with its default and
its normalise line; the Card/Pill segmented control is gone from Settings → Appearance; the `style`
field is gone from the `player-state` snapshot and from `windowBridge`, which no longer needs the
settings import at all; and `MiniApp.svelte` lost its whole `{:else}` template branch and the 233 lines
of pill CSS (vinyl, grooves, spindle, scrub, ptrans). The size map collapsed to one `CARD_SIZE`
constant, so the card no longer resizes itself in response to a preference.

**The deletion had to be checked, not just cut.** The pill's stylesheet used bare `.track` and `.fill`
selectors, and the card renders a `.fill` too — so removing the block could have stripped the card's
scrubber styling. It does not: the card's fill is scoped under `.cover-prog .fill`, defined well above
the pill section. The pill's `.scrub` also appeared in `drag()`'s exclusion selector
(`closest("button, .scrub")`), which is now dead — the card's own seek stops propagation instead — so
that selector went back to `closest("button")` rather than being left as a fossil.

**A stale preference cannot strand anyone.** Someone who had chosen the pill still has
`miniStyle: "pill"` in localStorage. It is simply never read now, and the size effect always asks for
406×394, so the widget comes up as a card. Verified live on the running card webview: 406×394, `.card`
present, `.pill` absent, current track rendering.

**Left as found:** the bottom bar's pill shape and `VolumePill` are unrelated to this and untouched —
the owner's complaint was about the desktop widget's two shapes, not the bar.

**Concurrent-session note.** Another session edited `MiniApp.svelte` while I was in it: a
`svelte-ignore a11y_no_static_element_interactions` appeared at the `.cover` div mid-check, which is why
one typecheck run reported a warning that the next run did not. Their suppression is intact and the
final check is clean.

### D-104 — Album cards light up in their own colour, not the theme's

The owner asked for a hover glow on the Albums grid, explicitly *from the cover's colours* rather than
the current UI accent, with the small play button matching — and flagged the button's legibility as part
of the ask. "A subtle change."

**The complaint was already true of the play button.** `.album-play` was `background: var(--accent)`,
which is the *currently playing track's* colour. So hovering a bright orange record while a cool blue
song was loaded painted a blue button on it, which is the opposite of the effect being asked for. Each
card now carries its own `--album-accent-rgb`, resolved from the artwork it actually displays via the
existing `getAccent` — which caches by URL and dedupes concurrent calls, so twelve cards cost twelve
48×48 scans, once.

**One soft halo and a hairline rim, no second layer.** A wider second glow at this saturation reads as
coloured fog, and there are twelve of these on screen at once. The ordinary drop shadow stays in the
hover stack so the card does not lose its grounding when it lights up.

**The legibility request turned out to need real arithmetic, not a tweak.** `--on-accent` is a fixed
near-black, and that is safe only because the theme accent is tuned before it ships. A per-cover accent
is not: `pickAccent` floors the brightest channel at 178, which still permits a saturated red at WCAG
luminance 0.10 — measured at **2.86:1** under the fixed dark ink, a genuine failure on the AIZO cover.
So `inkFor()` was added to the palette module, which owns the colour contract.

**The first version of that rule was measurably worse than the second.** Thresholding the accent's
luminance at 150 leaves 3.07:1 on the current twelve covers, because the threshold is a guess at exactly
the ratio it is being used to protect. Comparing the accent against both candidate inks and taking the
winner raises the floor to **4.50:1**, and all twelve now clear the 3:1 bar for non-text UI. Ink is dark
on 11 of them and light on 1 — chosen per cover, not by a constant.

**Verified on rendered output, not by reading the CSS:** with the albums grid scrolled into view and a
forced hover, the Aaja Nachle card lifts with a warm gold halo and a gold button carrying a dark glyph,
while its neighbours stay unlit. `prefers-reduced-motion` drops the lift and keeps the light, and
`:focus-visible` gets the same treatment as `:hover` so the effect is not mouse-only.

### D-105 — The liquid-glass gap is optical and adaptive, not luminance — and WebView2 can close the optical half

Task #34 asked how far Noctra's glass actually is from Apple's Liquid Glass. D-070 and D-073 had already
matched the *luminance* of a reference pane (backdrop → interior +25, rim lift +22/+37) and the owner
still called it "not well implemented", so the remaining distance had to be named precisely rather than
described. Two sources were read rather than remembered: the HIG "Materials" page (Apple's own JSON
endpoint, since the HTML is JS-gated) and the WWDC25 "Meet Liquid Glass" transcript, which is where the
layer names come from.

**What Apple says the material is made of, and what Noctra has:**

| Apple's layer | Noctra today | Gap |
| --- | --- | --- |
| **Lensing / refraction** — "dynamically bends, shapes and concentrates light in real time"; the primary defining property | Nothing. Blur + veil + four stacked rim *shadows* (`--glass-rim/lens/dispersion/lip`) | The whole of it. This is the named thing the material is |
| **Highlights** — light sources produce speculars that track geometry, travel around the silhouette on interaction | A static 1.5px `inset 0 1.5px 0` top line | Present but frozen |
| **Shadows** — adaptive: "increases the opacity of its shadow when it is over text, lowers it over a solid light background" | One fixed `--glass-shadow` | Directional, not adaptive |
| **Adaptivity** — tint and dynamic range shift continuously so controls stay legible; can flip light/dark on its own | Global, one-shot: `blur.ts` normalises the backdrop to luminance 84 for every surface | Per-surface adaptation is missing |
| **Size-dependent thickness** — bigger glass simulates a thicker material with deeper shadows and stronger lensing | Identical rim on the 26px volume rail and the 380px sidebar | Missing |
| **Scroll edge effects** — content dissolves into the background as it passes under glass | Only the lyrics reel has a mask fade | Missing on every scroller that runs under a pane |
| **Fluidity / morphing** — states shape-shift rather than cross-fade; materialize by modulating lensing, not opacity | Mini card grows with a `transform` transition (D-094) — the right instinct, one instance | Mostly missing |
| **Accessibility response** — reduce-transparency and increase-contrast change the material | `grep` for `prefers-reduced-transparency`, `prefers-contrast`, `forced-colors` across `src/`: **zero hits** | Absent |

**Two of Apple's usage rules are currently broken here, not just unmet.** "Don't use Liquid Glass in the
content layer" and "always avoid glass on glass" — `.glass` is applied in 11 components, including
`EmptyState.svelte` (content layer) and `Dialog`/`ContextMenu`/`CommandPalette`/`QueuePanel`, which all
stack glass over the glass rail and bar.

**The blocking question from the Phase 6 plan is now answered by measurement, not by a blog post.**
`scripts/lg-probe.mjs` injects six swatches into the running app and photographs them;
`scripts/lg-probe-sample.ps1` reads the pixels. The filter is a constant-red `feColorMatrix` rather than
a displacement, because an absent displacement is indistinguishable from flat artwork while a red swatch
can only mean the filter ran. On the shipped WebView2 runtime (Chrome/153.0.0.0):

| Case | Mean RGB | Verdict |
| --- | --- | --- |
| `backdrop-filter: url(#f)` | 255,0,0 | **Applies.** Real refraction is possible here |
| `blur(24px) url(#f)` | 255,0,0 | Composes with the existing filter stack |
| under an ancestor with `transform` | 255,0,0 | Survives a composited ancestor |
| under an ancestor with any `filter` | 32,39,58 | **Killed** — a filtered ancestor becomes the backdrop root |
| `url(#f)` + `mask-image` gradient | top 203,14,24 / bottom 100,35,36 | Maskable, so refraction can be confined to a rim band |

So the constraint for Phase 6 is structural, not capability-based: no glass pane may ever sit inside an
ancestor that carries a `filter`, and the normal map has to be generated per geometry and masked to the
edge band. Both are already what the plan predicted; the unknown is gone.

**Ranked by what a viewer notices per unit of work** — recorded so the next pass does not re-derive it:
1. Scroll-edge dissolves, concentric radii (`r_outer = r_inner + inset`, the four `--radius-*` tokens are
   independent today), and `prefers-reduced-transparency`/`prefers-contrast` fallbacks. Pure CSS, no
   risk to the measured contrast numbers, and the accessibility one is a requirement rather than polish.
2. Adaptive shadow and tint per surface — the luminance data already exists in `palette.ts`/`blur.ts`.
3. Size-dependent thickness — parametrise the existing rim band by pane height.
4. Lensing — the defining property and the expensive one: normal-map generator, refcounted SVG filter
   registry, a sharper than 180px backdrop source, and a frame-cost measurement, because this is the
   item most likely to trade away the 60fps the mini card just won.
5. Pointer-travelling speculars and interaction illumination. Gimmick risk; Apple ties them to device
   motion and touch, which a desktop player has less reason to fake.

---

### D-106 — Albums and Artists join the rail, sharing one lit tile

The owner asked for "a section of albums then artist on the left side of the ui", consistent with the
per-cover glow from D-104. Asked which of two very different readings they meant — nav entries, or real
scrollable lists inside the capsule — they chose **two nav entries**.

**Rail order is Home, Library, Albums, Artists, Playlists, Favorites, Statistics, Settings.** Icons come
from the existing set: `disc` and `mic`, both already drawn, so nothing new was invented. Both pages are
thin: `groupAlbums` and `groupArtists` already existed in `services/collections`, and `ui.openAlbum` /
`ui.openArtist` already routed to the existing detail pages, so the nav entries mostly wire up what was
already reachable only by scrolling Home.

**One tile, four surfaces.** The per-cover colour, the ink choice and the glow were living inside Home's
scoped CSS. Copying them into two new grids would have meant three independent copies of the contrast
arithmetic, so they moved into `components/MediaCard.svelte` and Home's album grid now uses it too. Home
lost ~110 lines of CSS and its own accent-resolution effect; the rendering is unchanged, verified by
screenshot after the refactor.

**Lazy colour resolution is load-bearing, not an optimisation.** Home caps at twelve albums; the Albums
page is all **267**. Each tile needs a canvas scan to find its colour, so resolving on mount would decode
a large part of the library to tint tiles that are off screen. An `IntersectionObserver` action sets
`seen` 240px before a tile enters the viewport, and only then does `getAccent` run. Measured on the live
page: 267 tiles present, **32 resolved**, and all 32 distinct — so the laziness works and no two covers
are being given the same colour. Contrast floor across the resolved tiles is **4.41:1**.

**The glow went up a level on request.** "Wayy too subtle." One halo at 0.45 alpha with a negative spread
measured as barely-there light, so the hover is now three layers: a 1.5px near-opaque ring for a definite
lit edge, a 22px halo carrying the hue, and a 54px low-alpha wash so the space around the cover reads as
coloured. The ordinary drop shadow stays in the stack so the tile keeps its grounding while lit.

**The eight-row rail does not fit the 900×600 floor, and that was checked rather than assumed.** Content
needs 467px; the rail has 438px there. Tightening the row rhythm would have changed the look of the rail
at every window size to survive the rarest one, so the list scrolls only when it has to
(`overflow-y: auto`, thin scrollbar). At the current size `scrollHeight` equals `clientHeight` — no
scrollbar, no visual change.

**Two things deliberately left alone:**
- Home's Top Artists row still rings in `var(--accent)` — the *playing track's* colour, the same mistake
  D-104 fixed for albums. MediaCard's `round` variant would fix it, but that row's size and centring are
  tuned, and reshaping it was not in the approved design. It is now the only surface still doing this.
- `EmptyState`'s `icon` prop was a hand-maintained list of four names, which broke the moment a new page
  wanted `disc`. Widened to `IconName`, which `Icon` already defines.

### D-107 — Library becomes three facets over one search box

The owner asked Library to hold "3 sections of songs, albums and artists", to look premium, and told me
to make the styling calls myself.

**Facets, not stacked sections.** Library is a hand-windowed list — 314 rows, ~24 mounted at a time, and
the file's own comment says that windowing exists because mounting every row is expensive. Stacking three
full sections in one page scroll would have thrown that away and put 314 rows, 267 albums and 164 artists
in the DOM at once. So the header and the switch stay fixed and the body swaps: **Songs 314 / Albums 267 /
Artists 164**. Verified after the change that the Songs facet still mounts 24 rows, not 314.

**One search box drives all three.** Grouping runs off the filtered set, so typing "gorillaz" narrows the
album and artist facets too — measured at 2 songs / 2 albums / 2 artists, showing *Demon Days* and *New
Gold*. This needed `library.matches()`: `library.filtered` returns `StoredTrack`s, which have no resolved
`artwork`, and `groupAlbums` needs the full `Track`. The alternative was copying the field list into
Library, which is how you end up with two definitions of "matches" that drift. `haystack`'s parameter went
from `StoredTrack` to the structural subset it actually reads.

**Active state is lightness, not hue.** The selected facet lifts to full ink on a lighter plate and its
icon goes from line to fill. An accent-coloured active tab would fail on the covers where the accent lands
dark, and this app's accent changes with every track.

**Albums and Artists scroll inside their own pane** rather than growing the page, so the frame matches the
song list. `content-visibility: auto` with a `contain-intrinsic-size` per variant is what lets the Albums
facet mount all 267 tiles cheaply — it belongs on the tile, not on one parent's grid, so the rail's Albums
and Artists pages get it too.

**A screenshot caught a defect the numbers could not.** The tiles were named `.card`, which collides with
a *global* `.card` in `controls.css` — "solid raised content card", complete with background, border,
radius and elevation. Every tile silently picked up a plate. Invisible on the square album tiles, where
the artwork covers it, and obvious on the circular artist tiles, where it showed as a grey rounded square
behind each circle. Renamed to `.mcard`; computed style now reads `rgba(0,0,0,0)` / `0px none` /
`box-shadow: none`. Svelte's scoped CSS does not protect against a global rule matching the same class
name — the scope attribute only raises specificity, it does not fence the selector.

### D-108 — The rail rows come back out; Library's facets are the browse surface

Once Library carried Songs / Albums / Artists, the owner asked to remove the Albums and Artists entries
from the left rail. That makes D-106's rail half moot, and the two standalone pages it existed to feed
had no other way in, so both went.

**What was removed:** the two `items` rows and their `disc` / `mic` icon union entries in `Sidebar.svelte`,
`"albums" | "artists"` from the `View` union, their imports and branches in `App.svelte`, and
`views/Albums.svelte` / `views/Artists.svelte` themselves — deleting them was checked by grepping for
every remaining reference first, and the only hits left were Library's own local `Facet` type, which is
unrelated to the router.

**What stands from D-106:** `MediaCard`, the per-cover glow, the lazy palette resolution and the
`EmptyState` icon widening. Library's facets and Home's album grid both consume the card, so the
component earns its keep without the rail entries.

**The scroll guard went too.** `overflow-y: auto` on the rail existed because eight rows need 467px
against 438px at the 900×600 floor. Six rows need 377px, which leaves 61px of headroom, so the rule was
protecting a case that no longer exists and it was removed rather than left as insurance.

### D-109 — The card's lyric blur now scales to the card's own type

"LESSEN THE BLUR IN MINIPLAYER FOR LYRICS NOT IN FOCUS."

**The setting was never wrong; it was applied to the wrong surface.** `lyricsBlur` was tuned against the
fullscreen reel, where a non-active line renders at 46px. The card's non-active lines render at 15.5px.
`blur()` is in pixels, so the same number removes roughly three times as much of a 15.5px glyph as it does
of a 46px one — the card read as muddy while the fullscreen read as depth of field, using one setting.

**Fixed by scaling rather than by adding a second control.** `CARD_BLUR_SCALE = 15.5 / 46` is applied to
the setting inside the card's `depth()`, so the card gets the *perceived* defocus the setting was designed
for instead of the same raw number. A separate "card blur" slider would have asked the owner to tune two
controls to agree, and the ratio between them is not a taste question — it is the two type sizes.

**Measured on the live card:** far-field blur went from 5.5px to **1.85px**, the second neighbour to
1.02px and the near neighbour to 0.69px, on 15.5px type. Photographed: the non-active lines are readable
and the far field still softens, so the depth-of-field cue survives.

**Verified against the running card window, which took some doing.** The card was hidden, so the first two
captures returned a stale surface showing "Connecting…" — a hidden WebView2 does not repaint. Its mirror
`ui.miniOpen` was also false, which stops the bridge pushing snapshots, so the reel was empty after the
reload regardless. Shown, measured, photographed, then hidden again and the original track restored and
paused, as it was found.

### D-110 — Home's Top artists finally lights in its own cover colour

"THE GLOW AND COLOR EFFECT I PREVIOUSLY MENTIONED ISN'T PRESENT HERE THOU", with a screenshot of Home's
artist row. This is the surface D-104 and D-106 both flagged as deliberately left behind; leaving it was
the right call at the time, but it was always going to read as an omission, and now it is closed.

**What it was doing.** The row hovered with `inset 0 0 0 2px var(--accent)` — the *currently playing
track's* colour. So all eight artists shared one ring, and that ring changed when the song changed, which
is precisely the complaint that started D-104.

**Fixed by moving the row onto `MediaCard` rather than by patching the ring.** The row is now eight round
cards, and Home lost its `.artist`, `.artist-art` and `.artist-name` rules — 55 lines. The lazy per-cover
palette resolution, the ink choice, the three-layer halo and the `z-index` raise all came with it for free,
which is the argument for having extracted the card in the first place.

**One new prop, not a new component.** The artist row shows a play-count pill where the Library artists
facet shows a plain track count, so `MediaCard` gained an optional `chip` string rendered with the existing
global `.chip` class. Round titles also moved from `--fs-sm` to `--fs-base`, because Home's sizing was the
tuned one and the Library facet had inherited the smaller value.

**Measured:** eight tiles, eight distinct cover colours — `207 48 44`, `178 50 43`, `238 56 40`,
`102 107 178`, `178 123 162`, `184 148 108`, `178 82 28`, `12 71 205` — against a theme accent of
`241 206 108`. Previously all eight would have measured that same gold. The `184 148 108` entry is
`pickAccent`'s last-resort warm neutral, correctly used on a cover with no saturated colour to find.

**Photographed:** the Amit Trivedi tile glows blue, matching his cover, while the "13 plays" pill beside it
still sits in the app's gold-tinted glass — the two colours are visibly independent, which is the whole
point.

### D-090 — The card title became a carousel instead of a slide that jumped back

The owner asked for "a long space after the end of the name of the song, and then a continuation of the
start of the name". The ticker already translated past the end of the name and then by `--gap` of blank,
so the gap existed — but it was a single copy, so when the animation restarted the name *teleported onto
the left edge* rather than arriving from the right one. That is not a carousel; it is a slide with a
return trip hidden in the blank.

The name is now laid out twice, one period apart, and the animation runs exactly one period
(`titleText + gap`). At the wrap the second copy is standing in the pixels the first just vacated, so
there is nothing to see. The duplicate is `display: none` until the hover that starts the loop, because
parked off the right edge at rest it would turn the honest `Title…` into `Title  Title…`.

**Measured, not asserted.** Hovered the real element over CDP and compared the two copies' painted rects
against the animated distance: laid-out period **879.83px** vs `--period` **880px**, so the wrap is
invisible to within 0.17px. Sampling the traveller 26 times across 17.5s gave purely right-to-left
motion with the wrap landing where the maths said it would. Hovering off reports `loopDisplay: none`,
`loopPainted: false`, `text-overflow: ellipsis`, `translateX: 0` — one name, from its first letter.

Two supporting changes: the width now comes from `getBoundingClientRect()` rather than `offsetWidth`,
because `.pass` has to stay an inline element or the resting ellipsis stops rendering; and the header
contrast fix is in BUG-076.

### D-111 — The play bar's lit buttons glow less, and the bloom became one token

"THE GLOW ON THE BUTTONS ... CAN BE A LITTLE MORE SUBTLE GLOW THAN IT IS NOW", naming shuffle, repeat and
the desktop-card toggle on the bar.

**What was cut, and where.** The on-state bloom was three layers at 3px/0.95, 10px/0.8 and 26px/0.5. It is
now 2px/0.6, 8px/0.4 and 16px/0.22. The wide halo took the hardest hit — both reach and alpha — because it
is the layer that makes the control shout across the bar, while the tight rim was left comparatively alone
since that is what keeps the letterform edged rather than fuzzy.

**The state still reads, and that was the constraint.** On and off is carried by lightness first: an
unpressed bare glyph sits at `rgba(247,247,250,0.5)` and a pressed one at `--accent-lit`. The glow is the
second signal, not the first, so reducing it cannot make the state ambiguous — which is the standing rule
that hue alone never carries on/off, because the accent is per-cover and can land nearly grey.

**Fixed a duplication while I was there, not as an aside.** The identical three-layer filter existed twice
— `app.css` `.orb-bare.orb-on` and `MiniPlayer.svelte` `.orb-bare.lit`, because the queue and sleep buttons
report state through a different class. The comment at the second site admitted they were "kept in step by
hand". It is now `--orb-lit-glow`, defined once and referenced by both, so the two cannot drift.

**Verified, including the failure mode this app has been bitten by before:** `filter` is a space-separated
list, not a comma list, and a comma parses into the CSSOM while being invalid at computed-value time. Read
back through `getComputedStyle` on a live lit button, the token resolves to all three drop-shadows with the
new alphas intact. Screenshot of the bar with shuffle on shows a contained pink edge beside the unlit
repeat glyph — visibly on, no longer blooming.

### D-112 — Romanisation covers four Indic scripts, and it replaces the line instead of sitting under it

Two instructions in one: make romanise work for "Hindi, Bengali and other languages whichever is possible",
and when it is on, do not show the original script at all — swap the line.

**The scope was chosen from this library, not from Unicode.** Scanned the 253 cached `.lrc` files the app has
already collected: 3818 lines carry Indic script, and they sit in exactly four blocks — Devanagari (Hindi and
Marathi), Bengali, Gurmukhi (Punjabi) and Gujarati. That is the real need, so that is what got a table. Tamil,
Telugu, Kannada and Malayalam are absent from the library and need verified tables of their own rather than an
offset remap; Japanese, Korean and Chinese need a dictionary, not a rule. All of them stay as written, because
a wrong reading teaches the wrong words.

**One state machine, four tables.** Every script here descends from Brahmi and shares the machinery: a bare
consonant carries an inherent vowel, a matra replaces it, a halant kills it, an anusvara tails the syllable. What
differs is the letters and the inherent vowel itself — Devanagari and Gurmukhi read a bare consonant as "a",
Bengali reads it as "o", so `কামনা` is "komona" and `भोलेनाथ` is "bholenath". That is why `inherent` is a table
field rather than a constant. The blocks are *nearly* codepoint-parallel — Bengali is Devanagari + 0x80 at every
position I checked — but Gurmukhi breaks the pattern where the script merged or dropped a letter, so each table
is written out in full instead of derived.

**Replace, and what it costs.** A romanised line cannot carry word-level highlighting: the timed word list
belongs to the original script and there is no reliable map from "hamma" back onto the third word of "हम्मा". So
those lines fall back to line-level sync and the sweep gradient goes with them, since the sweep runs off the same
word clock. Turning the setting off brings the karaoke back. Both the fullscreen sheet and the desktop card do
this identically — surfaces are separate implementations here, so one-sided behaviour is the bug pattern, not the
exception.

**Measured, on both windows, against the app's own store:** with the setting off, all 22 lines of the current
Hindi track are Devanagari; with it on, 22 of 22 render Latin and 0 characters of Indic script survive anywhere
in the rendered lines. The engine was then run across the whole cached corpus: 3806
romanisable lines, 0 Indic characters left in the output.

### D-100 — The Lossless seal is now the owner's own mark, tinted by inheritance

The badge beside the word "Lossless" was a hand-drawn rounded square with three bars in it. The owner
supplied their own mark and asked for it in its place, at the size and **exactly** the colour of the word.

**The colour was already wrong before the swap.** `.ll` set `color: var(--text-dim)` while the line it
sits on is `--text-faint` — the seal rendered a step brighter than its own label, in both surfaces. The
Lyrics column's comment even claimed it inherited the faint colour while the code did the opposite. The
override is gone, so there is now nothing that could drift.

**Tinted through a mask, not drawn as an image.** The supplied mark is 464×338 black ink on white with no
alpha channel, so it cannot be recoloured directly: a luminance mask would make the paper opaque and an
alpha mask would make the whole rectangle opaque. So the asset is generated once — ink to opaque, paper to
transparent, thresholded so an antialiased edge becomes partial alpha rather than a hard step — and
trimmed to its own ink box (400×253) so no phantom margin shrinks the glyph. `LosslessMark.svelte` paints
it with `background: currentColor` behind `mask-image`, which is what makes the colour match structural
rather than a value kept in sync by hand.

**One component, not two copies.** The provenance line exists in the now-playing header and the lyrics
column as separate implementations, which is the pattern that has repeatedly let a fix land in one and not
the other. Both now import the same component.

**Sized in `em`.** The line's font size comes from `--art-media`, which scales with the artwork, so a fixed
pixel height would match at one window size and drift at every other. It settled at `0.94em` — 22.2 × 14.0
against a 14.94px font — after the owner asked for a little smaller, with `.ll`'s gap cut from 6px to 3px
(6.4px of visible space from the last letter, measured with a Range against the text rather than box to
box). `vertical-align: middle` replaced the hand-picked `-2px`, and it measured **1.0px low**.

**I called that 1px invisible and shipped it. The owner spotted it immediately.** It is not a rounding
error to be waved off — a mark sitting visibly below the baseline of its own label is exactly the kind of
slop that gets the whole surface dismissed. Corrected with `top: -0.07em` on the mark itself, in `em` so it
scales with the line, re-measured at **-0.02px**. Lesson: when my own instrument reports a real offset,
fix the offset instead of adjudicating whether it is small enough to ignore.

**Known limit, measured rather than assumed.** The mark's hairline strokes are ~4–6px wide in the 400px
source, so at this size they land sub-pixel and read faint while the thick ribbons read clearly. A probe at
13 / 16 / 20 px confirmed 13 was too scruffy and ~16 is where it reads. A dilation variant to fatten the
hairlines was prepared but not yet compared — the dev window's debug port went down mid-test.

**Verified:** computed colour of the line and the seal are byte-identical (`rgba(247, 247, 250, 0.6)`), the
old `<svg>` glyph is gone from both surfaces, the dead `lossless` entry was removed from `icons.ts`,
`svelte-check` 0/0 and the build bundles the asset at 18.69 kB.

### D-113 — The lyric reel's hold band was wide enough to look broken

The owner pointed out that the sung line is supposed to sit in the vertical middle of the screen, and
that the reel was not auto-scrolling. Both complaints traced to one number.

**`HOLD_BAND` was 0.3 of the viewport height.** On the 927px fullscreen column that is 278px of slack —
the active line could sit almost a third of the screen off centre and the reel would correctly refuse to
move. Measured: the sung line held 119px below centre and the column never budged.

**Why it reads as "auto-scroll is broken" rather than "the reel is holding still":** a line change that
lands inside the band produces *no motion at all*. From the sofa, the reel simply not responding is
indistinguishable from the reel being broken. The band's rationale — a column that re-centres on every
line never rests, it creeps for the whole song — is sound, but 0.3 bought stillness at the cost of the
one thing the view is for.

**Set to 0.06** (~56px, about one line of slack): the active line is unmistakably the middle line, and a
line change now actually moves the column. The Schmitt trigger that prevents a glide cancelling itself
halfway is untouched, and the band stays a fraction rather than pixels because the two surfaces are 927px
and 288px.

**The tests were the interesting part.** Four of them failed immediately, and all four had baked
`0.3 * view` into literal pixel drifts — `-480` with a comment saying "inside a band of 0.3 * 400 = 120".
So retuning the constant read as four broken invariants instead of one deliberate change. Rather than
patch four sets of magic numbers, `HOLD_BAND` is now exported and the tests derive their drifts from it,
which is what they were always asserting. 91/91 pass.

**Not verified on screen.** The app instance is shared with other live sessions and the track was swapped
out from under three consecutive measurements — one returned zero line changes across 29s of advancing
playback, which turned out to be another session changing the song, not a fourth bug. The unit tests
cover the behaviour; a look with the owner's own playback still wants doing.

## Implemented

### Design system rebuilt on the reference (this round)
`app.css` tokens and glass surfaces rewritten, plus a new `src/controls.css` holding the shared
primitives: `.btn` / `.btn-primary` / `.btn-danger` (flat, no gradient, motion hover), `.card` (solid
raised content surface), `.row` / `.row-title` / `.row-thumb` (one definition replacing four drifting
copies), `.chip`, `.rank`, `.section-title`, and a `.rise` entrance.

- **Zero gradients on any control.** Verified by grep: the only gradients left in the app are the
  backdrop scrim and the lyric column's edge mask, both of which are legibility, not decoration.
- **Sliders are drawn, not native.** `components/Slider.svelte` stacks a track, fill and thumb and
  lays a transparent `<input type=range>` over them, so keyboard and screen-reader behaviour still
  come from the browser. This kills the white flash on track change and the shrunken vertical thumb.
- **Wheel changes volume** on the mini-player slider, the artwork rail and anywhere over the lyric
  column.
- **Liked is red ink with no ring**, and pops on the way in only.
- **Media glyphs are filled**; stroke weight 2.15; type scale up.
- Mouse side buttons map to previous / next.

Verified by screenshot on a red cover and a white one: Home hero, Top Artists circles, charts, Albums
grid, Statistics page and the fullscreen lyrics all render with readable text.

### Fullscreen lyrics, second pass
Bare artwork until hover, then the orb row, transport and the favourite + volume rail. The line being
sung is large, white and in sharp focus; everything else carries a 0.7px blur so it recedes without
becoming unreadable. Clicking any line seeks to it. When romanisation is on, the line is *replaced* by the
Latin reading rather than paired with it — see D-112.

### Home, Statistics, universal shuffle, smart shuffle, auto-scan
See D-041 through D-045. Home is `views/Home.svelte`, statistics is `views/Stats.svelte` (also
reachable from the sidebar), `player.shuffleAll()` is the universal shuffle, `player.playSimilar()` is
the weighted one, and `library.refresh()` / `startAutoScan()` handle new files.

---

`views/Lyrics.svelte` — a full-bleed view that replaces the shell, matching references 01–03:
artwork on the left with nothing on it until you hover, then the orb row, the transport inside its
bottom edge and the favourite + vertical volume down the right; time/progress/title underneath.
Lyrics on the right, the current line large and bold and left-aligned, what has gone before dimmer,
what is coming up dim and right-aligned. The scroll is a `translateY` on the list with a 620ms ease,
never a jump, and the column is masked at both ends.

`services/lyrics/lrc.ts` parses line LRC and enhanced per-word tags; `services/lyrics/lyrics.ts`
does local → disk cache → LRCLIB with a `Find lyrics` button for the miss case. `save_lyrics` /
`load_lyrics` Rust commands keep the cache as real `.lrc` files under the app config dir rather than
in web storage, with the cache key validated to a plain identifier so a hostile fingerprint cannot
write outside the directory.

Verified live against the running app: lyrics matched the playing track (45–66 lines parsed), the
active line rendered white at 43.5px, and the word reveal progressed — 13 of 15 words lit at 11.0s
into a line starting at 10.33s, resetting to 7 of 15 in the next line at 13.0s.

### Shuffle and repeat are real now (Phase 5, partial)
`player.shuffle` / `player.repeat` drive a play order in the store: identity order when shuffle is
off, a Fisher-Yates permutation with the current track pinned to the front when it is on, so
flipping shuffle mid-song does not jump you somewhere else. Repeat is off / all / one; at the end of
a run with repeat off it **stops** rather than silently wrapping, because a player that loops when
you asked for "off" is lying about the setting. All three persist through the settings store.
Keyboard: S, R, L (lyrics), Esc, Ctrl+F (search).

### Settings page is real
Look (glass blur, colour intensity, extra dimming, low power), Playback (shuffle, repeat segmented
control, lyric timing offset), Music library (each root with its track count and a remove that does
not touch files), About (live Rust bridge call, lyrics source, reset). Verified by using it: the
values written to `localStorage` were read back and applied.

### Viewability
See D-034. The blown-out white window in the owner's screenshot is gone on both a white sleeve
("I Don't Care") and a busy mid-tone one ("Meherbaan"), with the colour still flooding the window.
Text tokens went up (faint 0.48 → 0.6, dim 0.72 → 0.82) and a tight dark text shadow is applied
globally, which buys contrast without another veil over the art.

### Controls
Sizes up across the board (38 / 44 / 52 / 58 px tiers), the transport lost its rings (D-035), the
pause bars moved from 1 unit apart to 3.4 so they stop reading as one blob, hover is now a soft
accent bloom instead of a thickened white ring, and liked is red (D-036). The accent-filled
"Add folder" button with dark ink became a glass pill with an accent edge on hover.

### Taskbar glyph quality
Rendered at 64px instead of 32 so the shell only ever downscales — the previous row read as blurry
and pixelated because it was being scaled up.

### Fixed while here
- **Lyrics race.** A slow LRCLIB answer for the previous track could land after a fast one for the
  current track and paint the wrong words. Reproduced for real: the store showed "The Humma Song"
  lyrics while "I Don't Care" was playing. Requests now carry a sequence number and a stale one is
  discarded.
- **Reel centreing never fired.** Storing DOM nodes in `$state` made Svelte 5 deep-proxy them, so
  the measured element was a proxy rather than the laid-out node and the offset silently stopped
  updating. Plain array instead, and `offsetTop` rather than `getBoundingClientRect`, because the
  rect already includes the transform being computed — measuring it feeds back on itself.
- **`playback error` now shows the real sentence.** The wording is what distinguishes a rejected
  source from a decode failure, and until now the bar only said "playback error".
- `main.ts` exposed only `{player, ui}` on the dev handle despite the handoff claiming `library`;
  added engine, library, favorites, settings and lyricsStore.

### Formats verified, not assumed
Swept the library by extension — 308 FLAC, 4 MP3, 2 M4A — and played a sample of each. All started,
none errored, steady state 445–670 ms.

---

### Windows taskbar thumbnail buttons — `src-tauri/src/taskbar.rs`
The native hover-preview row: **previous, play/pause, next, favourite**.

- `CoCreateInstance(CLSID_TaskbarList)` → `ITaskbarList3` → `HrInit` → `ThumbBarAddButtons`, all on
  the window thread from Tauri's `setup` hook.
- The four glyphs are rasterised in code (D-032); no `.ico` assets ship.
- The window procedure is subclassed with `SetWindowLongPtrW(GWLP_WNDPROC)`; the previous procedure
  is kept as `Option<fn>` so a null return is a value rather than undefined behaviour.
- `WM_COMMAND` with `HIWORD(wParam) == THBN_CLICKED` routes `LOWORD(wParam)` out as a
  `taskbar-command` event; `src/services/taskbar.ts` turns it into real store calls.
- `ThumbBarUpdateButtons` swaps the play/pause and heart glyphs from `taskbar_set_playing` and
  `taskbar_set_favorite`, both `async` so `run_on_main_thread` cannot deadlock the way BUG-011 did.
- Buttons are re-added on the broadcast `TaskbarCreated` message, because Explorer rebuilds its
  taskbar and the old buttons vanish silently.

**Verified by automation:** all four ids drive real state. Posting the exact message the shell sends
(`WM_COMMAND`, `wParam = MAKEWPARAM(id, 0x1800)`) paused playback (id 2, `isPlaying` true → false),
advanced the track (id 3, index 111 → 112, "Barbaad" → "Starboy"), and wrote the current track's id
into the favourites store (id 4). `HrInit` and `ThumbBarAddButtons` both returned S_OK, and the glyph
update commands resolve without rejection on every play/pause. The rasteriser's output was checked
by rendering all six glyphs as ASCII — ring, bar+triangle pair, play, pause and both hearts are
correct and optically centred.

**Not yet verified: that a human eye sees the row.** Every synthetic-hover route available
(`SetCursorPos`, stepped `SendInput` through the raw input stream, 1.6–2.5s dwell) failed to make
Windows 11 open the flyout, so nothing could be captured. That is a limitation of the harness, not
evidence the feature is broken — but the row has not been *looked at* yet, and this project does not
mark things confirmed on inference. Needs one manual hover.

### Visual glass pass
- **One control system.** `.orb` and its modifiers now live in `app.css` (D-030) and are used by the
  Now Playing orb row, the transport, the mini-player bar and the Library header. The per-component
  button styles are gone.
- **Glass tiers.** `.glass` gained the specular sheen it was missing; added `.glass-panel` for
  bounded cards and `.glass-pill` for search and chip surfaces. Applied to the Library header, the
  empty-state card, the Now Playing volume rail and the error banner.
- **Transport over the artwork** gets a soft glass smudge rather than the bare halo it uses on the
  flat bar (D-031), which is what keeps it legible on a near-white cover.
- **Album art** now cross-fades *and* scales slightly on track change, which the spec asked for and
  was never built.
- Accent glow on the progress fill, an accent edge-light on the active nav item, accent-tinted
  hover/active states on library and home rows, and a specular hairline on every thumbnail.
- Verified against the two hardest covers in the library: the red "The Humma Song" art and the
  near-white "lovely" cover. Text and controls stay readable on both.

### Favourites core, pulled forward from Phase 5
`src/stores/favorites.svelte.ts` (D-028, D-029) plus a heart on the Now Playing art and in the
mini-player bar, and `views/Favorites.svelte` now lists real tracks instead of a placeholder. The
taskbar ♡ needed something honest to toggle.

### Fixed while here
- `favorites.svelte.ts` initially imported `$app/environment`, which is a SvelteKit module and does
  not exist in this plain-Vite app (D-011). Removed; the guard was pointless in a webview anyway.

---

### Phase 0 — Toolchain
Installed via winget: Node.js v24.19.0 (npm 11.17.0), rustup with `stable-x86_64-pc-windows-msvc`
(rustc/cargo 1.98.1), and VS 2022 Build Tools 14.44 with the C++ workload plus Windows SDK
10.0.26100. Verified by compiling and running a native Rust binary, which proves the MSVC linker
chain end to end rather than just proving the installer exited 0.

### Phase 1 — Visual foundation
- **Shell** — `App.svelte` composes a persistent backdrop, sidebar, view outlet and mini-player.
  Views switch on a store value; no router.
- **Sidebar** — Home / Library / Playlists / Favorites / Settings with an active state.
- **Backdrop** (`BlurredBackground.svelte`) — stacked layers, newest appended and faded in over the
  previous one, so a track change cross-fades without ever holding two live blurs. Drift animation
  is `transform` only, 52s alternate. A two-part scrim keeps text readable without killing the
  colour. Honours `prefers-reduced-motion`.
- **Blur service** (`services/artwork/blur.ts`) — downscales artwork to 180px, blurs once, returns
  a JPEG data URL. Results are cached by source and concurrent requests for the same source share
  one computation, so a double render can't trigger two blurs.
- **Now Playing** (`views/NowPlaying.svelte`) — 400px cover with rounded corners and a static
  accent-tinted shadow, hover-reveal control cluster, vertical volume slider, title/album,
  transport row.
- **Mini-player** (`MiniPlayer.svelte`, `PlayerControls.svelte`, `ProgressBar.svelte`) — bottom bar
  with thumbnail, metadata, compact transport and volume; expands into Now Playing.
- **Accent propagation** — the active track's accent is published as `--accent-rgb` in a
  `$effect`, so consumers re-tint through a 500ms CSS transition instead of each one re-rendering.
  This is the mechanism Phase 4's interpolated palette will drive.
- **Home** — lists the three demo tracks; selecting one really changes the active track, which
  exercises the cross-fade, re-blur and accent shift together.
- **Honest empty states** — Library (Phase 3), Playlists and Favorites (Phase 5). Settings reports
  the Rust crate version over a real `app_version` command, which is what verifies the JS↔Rust
  bridge.

Verified: `npm run build` succeeds, `svelte-check` reports 0 errors and 0 warnings, and the Rust
side compiles (`noctra.exe`, 7m54s first build). The app was launched with `npm run tauri dev` and
the running window was captured directly via Win32 `PrintWindow` with `PW_RENDERFULLCONTENT` —
which is what surfaced BUG-004 and BUG-005, neither of which any build step could catch.

Confirmed working in the live window: real embedded artwork renders; selecting a track switches the
active item, re-blurs the backdrop, and interpolates the accent from gold (Skyfall) to crimson
(AM) across the sidebar, title, play button and background at once; the mini-player reflects the
same state; the vertical volume slider renders vertically via `writing-mode`; and the hover-reveal
cluster appears over the artwork with the three unbuilt controls correctly disabled.

### Phase 2 — Real audio playback
- **Engine** (`services/audio/engine.ts`) — the only code that touches an `HTMLMediaElement`, and
  only one element exists for the whole app. Owns load/play/pause/seek/volume/mute and translates
  media events into a typed callback set. `MediaError` codes are mapped to sentences rather than
  surfaced as `undefined`.
- **Store** (`stores/player.svelte.ts`) — holds *what should be playing*; the engine holds *how*.
  `duration` prefers the element's decoded value and falls back to the scanned tag until metadata
  arrives. `previous()` restarts the current track when more than 3s in, matching every other
  player's convention. A non-empty `error` field is rendered by both Now Playing and the
  mini-player, so nothing fails quietly.
- **Seekable progress bar** — pointer drag with commit-on-release (seeking per move would spam the
  decoder with range requests), plus keyboard seeking. The fill moved from animated `width` to
  `transform: scaleX()`, because width forces a layout pass every tick and the performance budget
  forbids that.
- **Keyboard shortcuts** (`services/audio/shortcuts.ts`) — space toggles, left/right seek
  (shift = 30s), up/down volume, M mutes. The handler yields to any focused `button`, `input`,
  `a[href]` or `[role="slider"]` so a key never fires twice. Note that a native `<button>` has an
  *implicit* role, so matching `[role="button"]` alone would have missed it.
- **Rust** — `read_tags` and `extract_artwork` commands backed by `lofty` 0.25. These were pulled
  forward from Phase 3 to diagnose BUG-008 and are the real thing, not throwaways.
- **Demo set** — rebuilt around files that actually play; see BUG-008.

Verified against the running app over CDP: after a trusted click, position tracked wall clock
(3.3s → 6.3s across 3 real seconds), a seek to 50% landed on exactly 154 of 307s and playback
resumed from there, and the reported duration came from the decoded audio rather than the tag.

### Phase 2b — Streaming audio protocol (fixes BUG-008)
- **`src-tauri/src/audio_protocol.rs`** — registers `noctra-audio://`, which streams a local file
  to the webview and, for FLAC, fills in an empty `PICTURE` block MIME string on the bytes it
  serves. Files on disk are never modified.
- Serving a patched header means logical byte offsets no longer match physical ones, so range
  requests are translated by `delta`. Verified byte-for-byte against the source file at three
  offsets, and a mid-file seek on Skyfall landed on 143.2s for a 143s target.
- **`services/audio/sourceUrl.ts`** — builds URLs via `convertFileSrc(path, "noctra-audio")`, which
  handles the platform-specific form. Hand-writing `noctra-audio://...` fails silently on Windows.
- **`--disable-features=CalculateNativeWinOcclusion`** set in `tauri.conf.json` so a covered window
  is not treated as hidden (D-020).

Verified end to end in the running app: Skyfall, Do I Wanna Know?, Akuma no Ko and The Humma Song
(FLAC) plus Meherbaan (MP3) all report correct durations; a trusted UI click on Play starts audio
and position advances in real time (2.2 → 4.7 → 7.1 across 7.5 seconds) with no error state.

### Phase 2c — Buffering fix, glass, fullscreen, desktop card
- **First-play latency 9497ms → 802ms.** Root cause was a one-time ~8.6s audio output pipeline
  init in the webview, not file I/O, not the protocol, not `preload`. Proven by warming the network
  path first (56ms) and still seeing 8620ms on the first play, then 402ms on the second.
  `engine.warmUpOutput()` now plays a quarter second of runtime-generated silence at launch.
  See BUG-010, including the two wrong diagnoses that preceded this one.
- **Protocol throughput.** Cached parsed plans per path, cut the head probe from a flat 4MB to a
  64KB start that only grows for real FLAC, and capped responses at 2MB so a range request can't
  allocate a whole file. Measured 15.3 MB/s and 2MB in 221ms.
- **Glass token system** in `app.css` (`--glass-*`, `.glass`, `.glass-strong`) applied to the nav
  rail, mini-player bar, Now Playing control orbs and the desktop card. The specular top hairline
  is what makes it read as glass rather than translucency. Deliberately *not* applied to the
  full-window background — that stays a pre-blurred bitmap, since a live full-window
  `backdrop-filter` is the one thing that will not hold frame rate on the target hardware.
- **Backdrop is now a real colour wash.** Brightness/saturation baked into the one-time blur plus a
  much lighter scrim; Skyfall now floods the window with teal instead of reading as black.
- **Fullscreen rebuilt to the reference:** transport inside the bottom of the artwork, thin
  outlined glass orbs across the top revealed on hover, vertical volume with a speaker glyph on the
  right edge, time/progress/time directly under the art, title and artist beneath.
- **Mini-player button exists** in that orb row and is wired to `toggle_mini`.
- **Desktop card:** `mini.html` Vite entry, `MiniApp.svelte`, and `services/windowBridge.ts`
  (main window pushes a snapshot at 4Hz rather than at the store's 15Hz; commands come back as
  `mini-command`). A `?mini=1` query flag does not work because Tauri percent-encodes it into the
  path and 404s — hence the separate entry.
  **The window itself is not appearing yet — see BUG-011. Not claimed working.**

Verified by screenshot: main window glass, colour-wash backdrop, four real library tracks, and the
Now Playing layout above.

### Windows system media controls — implemented via Media Session
`src/services/mediaSession.ts` populates `navigator.mediaSession`, which Chromium maps onto Windows
SMTC: artwork, title, artist, album, playback state, and working prev/play/next/seekto from the
Windows media flyout, Win+G and the lock screen. Handlers call into the same store, so system and
app can never disagree. Position is pushed at 1Hz rather than the store's 15Hz.

**CORRECTION — my earlier claim here was wrong, and the user proved it with screenshots.**
I stated that Windows 11 does not render taskbar thumbnail toolbar buttons
(`ITaskbarList3/4::ThumbbarAddButton`) and that no app could show them. It does, and they do: the
user supplied three Windows 11 captures of the hover preview with a live window thumbnail plus a
working ⏮ ▶ ⏭ (♡) button row — Media Player, Spotify and Noctis. That is direct evidence against
my recollection, so the recollection loses. The API works on Windows 11 24H2 (build 26200).

So the taskbar controls are a real, achievable feature, not a Windows 11 limitation. It needs
unsafe Win32 in Rust: `ITaskbarList4` from `CLSID_TaskbarList`, `HrInit`, `ThumbBarAddButtons` with
`THUMBBUTTON` entries, `HICON`s for the glyphs, and handling `WM_COMMAND` / `THBN_CLICKED` on the
window procedure (button index arrives in `LOWORD(lParam)`) — plus updating icons when the track or
play state changes. Tracked as a task; not yet implemented.

What was built stands on its own merits regardless: `src/services/mediaSession.ts` wires Windows
SMTC via Media Session, which covers the media flyout, Win+G and the lock screen. The two are
complementary, not alternatives — SMTC is the system-wide control surface, the thumbnail toolbar is
the per-window one.

The one part of the original request that genuinely has no native equivalent: a `favorite` action is
not a Media Session action Chromium supports, so the ♡ can appear in the **thumbnail toolbar**
(it's just a button we own) but not in the system-wide SMTC UI.


### Phase 4 (partial) — Real per-track accent colour
`src/services/artwork/palette.ts` extracts a dominant colour from each cover once, cached per
artwork URL, and `App.svelte` publishes it as `--accent-rgb`. Consumers transition their own colour,
so the whole UI interpolates between palettes rather than hard-cutting. The next track's palette is
prefetched during playback.

**This fixed a regression I introduced in Phase 3.** `fromLibrary()` gave every scanned track the
same hardcoded accent, so all 314 songs themed identically and the dynamic-colour system looked
broken. It was never a Phase 4 nicety — it was the app's headline feature, silently dead.

Two extraction details that mattered:
- Picking the most **saturated** cluster, not the most common one. A plain mode almost always
  returns a background or near-black, which reads as "nothing happened."
- A **brightness floor**. Dark covers produced unusable accents — Skyfall gave `4 61 61` and Akuma
  no Ko `35 38 32`, effectively invisible against the dark UI. Scaling until the peak channel
  reaches 178 keeps the hue while making every accent usable.

Verified live across five library tracks: `207 48 44` red, `11 178 178` teal, `160 178 148` sage,
`178 118 37` amber, `213 176 110` gold — all distinct, all visible.

Still outstanding from Phase 4: an explicit fps measurement on the low-end target.

### Multi-folder library
`pickAndScan()` now **appends** by default, with "Add folder" and "Replace" in the Library header.
Tracks dedupe on the path-derived id, already-scanned roots are refused, and `removeRoot()` drops a
folder's tracks without touching files.
The request describes a taskbar hover thumbnail with ⏮ ▶ ⏭ ♡ buttons. That is
`ITaskbarList3::ThumbbarAddButton`, a Windows 7/10-era API; **Windows 11 does not render taskbar
thumbnail toolbar buttons**, so there is no native way to produce that UI on this OS, and the spec
explicitly forbids faking it with a custom window.

The native path that does exist on Windows 11 is **SMTC via the W3C Media Session API**, which
Chromium/WebView2 implements: `navigator.mediaSession.metadata` plus action handlers surface in the
Windows global media controls (Win+G, lock screen, the taskbar media flyout) with title, artist,
album, artwork, playback state and previous/play/next — and a `favorite` action handler maps to the
like button. It is driven by the same audio element, so it stays in sync automatically.
Not yet implemented.

---

### Lyric motion — the reel is now driven, not transitioned

Owner report: *"the text lyric follow up also feels sloppy (esp in the miniplayer, even in the
fullscreen)"* and *"the text when in highlight that animation feels sloppy and cheap also (like the
text enlargement that animation doesn't seem smooth)"*, plus a refined centring rule — the first lines
of a song must stay where they naturally sit instead of being pulled to the middle, and the last lines
must settle below the middle but well short of the bottom edge.

**The follow.** `.reel` had `transition: transform`, which measures its target once, at the moment the
class changes — while the column is still animating font size. The reel therefore glided to a position
that was already stale and got yanked again on the next line. That is the sloppiness. Both surfaces
now have no transform transition on the reel at all; instead `src/services/lyrics/reelFollow.ts` drives
it from `requestAnimationFrame`, re-measuring every frame against exponential smoothing
(`y += (t - y) * (1 - exp(-dt / TAU))`, `TAU = 105ms`). Being frame-rate independent matters here
because the drop-back is `exp`-shaped rather than a fixed step, so a hitch cannot teleport the column.
It parks once both the reel and the layout have been still for `CALM` frames (`SNAP = 0.35px`), and
re-arms on a resize or a new column. A track change goes through `jump()`, which **arms** rather than
applies — landing instantly on a new song is right, gliding the length of the reel is not, and applying
on the call would have measured the previous track's DOM.

Shared module, deliberately store-free: the card must not import anything that pulls in `engine.ts`,
whose module-level `AudioEngine` singleton would create a second audio element.

**The arrival bloom.** The active line was fighting itself: the `line-arrive` keyframe animated
`transform: scale()`, and so did the depth ramp's inline `transform: scale(d.scale)` on the same
element. One of them always won. The keyframe now animates the **independent `scale` property**, which
composes with `transform` by multiplication rather than competing with it.

**The clamp.** `REEL_TOP = 0.2`, `REEL_BOTTOM = 0.22` of the measured viewport height, written in px
(percentage padding resolves against the *inline* axis, so `padding-block: 20%` on the card would have
been 20% of its width). Two real defects were found here by measurement rather than by looking, both
logged as BUG-074 and BUG-075: the custom properties were being wiped every frame by Svelte's
whole-attribute style write, and the padding was cached against a window-resize listener that cannot
see internal layout changes.

**Verified on the running app, both webviews:**

- Reel transition computes to `all 0s` on both surfaces — no CSS transition left to fight the follow.
- Natural line change, card: 38.67px travelled, **0** backwards frames, biggest single-frame step
  5.33px, no overshoot, settled at 523ms. Fullscreen: 95.68px, 0 backwards frames, biggest step
  27.66px, no overshoot, settled at 597ms.
- Arrival trace, card, across a real line change: font-size 15.5 → 23.0px **monotonically** (no dips),
  independent `scale` 0.95 → peak 1.0120 → 1.0000 → `none`, inline `transform` matrix `.a`
  0.935 → 1.000 concurrently (they multiply), opacity 0.77 → 1.00.
- Filter interpolation confirmed rather than assumed: `blur(1.67px)` → the active line's
  `blur(0) drop-shadow() drop-shadow() drop-shadow()` produces **8 distinct computed values across 8
  samples**, with the blur easing 1.53 → 0.77 → 0.0 and the shadows' alphas rising in step. The
  filter-effects spec calls for mismatched function lists to be discrete; Chromium 153 pads the
  shorter list instead, so the glow fades in. The "mismatched lists are discrete" theory was written
  up, probed, and disproved before any code was changed for it.
- Clamp distribution, projected from real DOM geometry across all 54 lines and identical on both
  surfaces: line 0 at **23%**, line 1 at 34–35%, line 2 at 47–50%, lines 3–50 free at 50%, line 51 at
  54–57%, line 52 at 65–66%, line 53 at **75%**. Bands `{start: 3, free: 48, end: 3}`, min 23%,
  max 75%. Every value sits inside the mask's clear band (14%–86%), so no line ever settles under the
  fade.
- `npm test` 52 pass / 0 fail, including 13 for `reelFollow` against a hand-cranked rAF clock.
  `svelte-check` exit 0.

**Cost.** Blur is the expensive half of the depth of field — a line whose blur changes has to be
re-rastered. `blurBand()` now quantises it to three steps (d1 → 0.37, d2 → 0.55, d ≥ 3 → 1), so an
advancing line re-rasters six layers instead of ten and the far field is left alone. Both surfaces
carry the same rule; it is duplicated rather than shared because the two `depth()` functions differ in
the sizes they return and splitting one from the other would cost more code than it saves.

**Not yet measured:** a clean frame-budget figure. The card gave 263 frames / 5s, median 16.7ms,
p95 33.4ms, worst 83.8ms, but the main window was unfocused and off the lyrics view when its sample
ran, so that half of the reading is discarded rather than reported. R-2 (fullscreen lyrics fps) stays
open on the strength of it.

---

### Phase: global motion audit — "the ui feels sloppy overall"

Asked to make the whole UI smoother and the existing animations better, with no specific surface named.
Rather than guess at what "sloppy" meant, the phase built an instrument that could answer it, then
believed the instrument.

**The instrument.** `scripts/probe-snap-hover.mjs` runs in the page over CDP and, for every mounted
element, compares the properties its `:hover`/`:active` rules change against the properties its
computed `transition` list actually covers. Each gap is a finding: something that moves without being
eased. It clones each rule with `:hover` rewritten to `[data-snap-hover]` — specificity-neutral (both
0,1,0) and source-order-preserving, so the mirrored clone resolves the same cascade winner as the
original. Because Vite injects every statically imported view's CSS regardless of mount state (~680
rules readable from any view), the clone pass verifies the *declaration*; only the `measured` pass
verifies resolved element behaviour, and the two are reported separately so a declaration-only reading
is not mistaken for a live one.

**The driver.** `scripts/sweep-views.mjs` navigates and probes after each hop, because Svelte mounts one
view at a time and a single run reporting `findings: 0` means "this view is clean", not "the app is
clean". Twelve steps: home, library, the Albums facet, an opened album, an opened artist, playlists,
favourites, statistics, settings, the fullscreen player, the lyrics-settings panel behind it, and the
queue drawer with the panel asserted open. Two design points that cost real debugging time to learn
(BUG-084): **one short CDP call per step**, not one held open for the whole sweep — the single-call
version was destroyed mid-run by a Vite HMR reload from a concurrent session; and **every step asserts
that it landed**, on the visible root string plus an optional in-page predicate, because a click on a
selector that matches nothing is a silent no-op and the first version printed nine identical clean rows
while sitting inside the fullscreen player.

**Two new zero-cost surfaces** were found in the library and made permanent steps: AlbumPage
(`page svelte-ajrjj0`) and ArtistPage (`page svelte-1vl9zgk`), reached through Library's Albums and
Artists facets. Both leave **no** `.nav.active` — they are sub-pages, not rail destinations — so the
probe reads `(no nav) / page` and only a predicate can tell them apart from the facet behind them.
Artist is the better of the two for measuring TrackList: the first album in the grid is a Single, so
`album` mounts one row while the largest artist has twenty.

**What it found.** Six real product defects, all the same shape: a property changed on interaction with
nothing easing it. Five have their own entry (BUG-079 through BUG-083); the `.card` shadow below is a
transition list that simply omitted a property, which is BUG-079's lesson without its specificity twist,
so it is folded in there rather than numbered separately. The audit tool's own four defects are BUG-084.

- A component's scoped `transition` **replacing** the shared `.row` primitive's rather than adding to
  it, so the press squeeze and hover border snapped on album, artist, playlist and queue rows while the
  background still eased. Deleted where the scoped list was a redundant subset with identical timing
  (TrackList, QueuePanel), extended where the component genuinely wanted different timing (Favorites
  160ms, Library 140ms) — deleting that one would have been a behaviour change dressed as a cleanup.
- `border-color: transparent` in a hover neutraliser also erasing the divider a Settings row draws for
  itself, because `border-color` is a shorthand for all four sides.
- The card's lyric line missing `text-shadow` from a transition list that had it on the fullscreen
  surface — the two lyric surfaces are separate implementations, so parity has to be checked by
  diffing, not by watching one of them.
- `ArtistPage`/`Playlists` `.card` missing `box-shadow` from their lists, so a lifted card's shadow
  arrived instantly under an eased transform.
- TrackList's index cell swapping `display: none` ↔ `grid` between the track number and the play glyph,
  which is atomic and un-easable; now both share the one 22px cell via `grid-area: 1 / 1` and trade
  opacity, so the swap lasts as long as the hover that caused it.
- The arrival animation and the depth-of-field transition owning the same three properties, which made
  every lyric line drop back at the end of its own bloom; the keyframe now animates the independent
  `scale` property, which composes with the inline `transform` instead of competing with it.

**Verified.** The full sweep reports **12 steps, 12 actually reached, 0 findings, 0 appear-swaps**, with
real coverage behind every zero — Albums facet 1394 elements measured, queue drawer 215, Home 169,
Settings 161, Library 131, lyrics-settings 101, fullscreen player 89, artist 64, album 62, statistics
55, playlists 54, favourites 51. The card runs its own single-step branch and reports 38 elements, 0
findings. `npm test` 52 pass / 0 fail. `svelte-check` 0 errors / 0 warnings.

Spot-checked against rendered pixels rather than accepted from the audit, per the standing rule: the
TrackList crossfade was sampled live on a real AlbumPage row (t=45ms `.n` 0.538 / `.p` 0.462; t=72ms
0.255 / 0.745; settled 0 / 1) with the `.num` cell holding at exactly 21×22 px throughout, so the
crossfade costs no layout shift; the Settings divider reads `dividerStable: true` across a hover cycle;
the card's 26 mounted lyric lines compute a 0.46s `text-shadow` transition.

**Not verified live.** Favorites' `.row` at 160ms and Playlists' `.card` shadow are CSSOM-only — both
views are genuinely empty (0 hearts, 0 playlists) and no content was fabricated or mutated to get a
live reading. PlaylistPage has never been swept, for the same reason. The same shared `.row` primitive
*is* verified live on Library and QueuePanel, so what is outstanding is two site-specific declarations,
not the mechanism.

**Left alone deliberately.** `--dur-press`, `--dur-reveal` and `--dur-ambient` are declared in
`app.css` and never used; `--tap` is the de-facto press idiom everywhere. `MiniApp.svelte:1127` and
`VolumePill.svelte:136,147` ease with `linear` at hardcoded durations. Neither reads as sloppy and
neither was in scope for a smoothness pass — but they are the obvious next targets if a motion-token
cleanup is ever wanted. R-2 (fullscreen lyrics fps) stays open: still no clean frame-budget figure.

### Follow-up: the intro false-highlight (BUG-085)

Sent with a screenshot of "How Long" at 0:03 — "why the fuck even when the music is playing but still
the first lyric line is being highlighted". Reproduced live on "Jeena Jeena", whose first timestamp is
27080 ms: for 27 seconds line 0 carried the sung line's opacity, focus, glow and card size.

`activeLine()` was correct all along (-1 before the first timestamp, so nothing got `.active`). The
fault was `depth()` folding that -1 onto line 0, which put it at distance zero and fired the sung-line
branch. The fold was itself a previous fix — anchoring on -1 literally blurred the whole column open —
so both attempts made the same error in opposite directions by treating "nothing is being sung" as a
position on the ramp.

Now it is not a position: `lineDistance(index, i)` returns `null` while `index < 0`, and each surface
holds an explicit rest state (uniform, sharp, `alpha 0.85`, no glow). Shared helper, two renderers,
because the card and the fullscreen take their size from different places — `depth().size` on one, a
`.line.active` CSS rule on the other — so the same cause produced a bigger line on the card and only a
brighter one fullscreen. Verified on both surfaces either side of the first timestamp, and pinned by a
new `src/services/lyrics/lrc.test.ts` (52 → 57 tests).

**Blocked, not started:** ~~a dot animation during playback~~ — see the next section. The recording was
found: the path the attachment reported (`Videos/Screen Recordings/…`) is not where Windows Snipping
Tool leaves it, and the file was in `AppData/Local/Packages/Microsoft.ScreenSketch_*/TempState/Recordings`
all along, under a different name. Copied to `docs/references/spotify-lyrics-waiting-dots-2026-09-29.mp4`
before the OS cleaned it, the same trap `frames1/` fell into.

---

### The waiting indicator: three dots while nothing is being sung

The rest state from BUG-085 was correct but empty — a column of uniform lines with nothing happening
reads as a screen that has not loaded, not as "playing, no words yet". The reference recording answers
this directly: Spotify puts three dots above the first line for exactly that stretch and removes them
the instant a line is being sung.

**Measured, not eyeballed** — `scripts/measure-dots.mjs` decodes the grabbed frames and clusters bright
blobs, so the numbers below come off pixels at 1918x1078:

- **Three dots, 26px across, 38px centre-to-centre pitch** — so a 12px gap, and a pitch of 1.46
  diameters.
- **Rise of 16px** off a baseline at y 298 to an apex at y 282 — 0.6 diameters.
- **Sequential, not overlapping.** Dot 2 was descending over 0–3s while dot 1 sat flat; dot 3 rose
  4s→8s and fell 8s→12s while both of its neighbours stayed flat at the baseline. One dot in motion at
  a time, travelling left to right, each arc about 4s up and 4s back down.
- **Brightness tracks height** on the dot that is arcing (luminance 150 → 253 across its rise). The two
  flat dots hold 252–253 the whole time, so this is a per-arc fade rather than a standing dim — the
  resting dot is white, and the arcing one arrives.

Implemented on both lyric surfaces, each scaled by *its own* sung line rather than by copying pixels:
the fullscreen sings at 54px against the reference's ~57, so 24px dots on a 36px pitch travelling 15px;
the card sings at 24px, so 11px on 16px travelling 7px. Both keep the measured 1.46 pitch ratio.

**The timing is deliberately NOT the reference's.** Two rounds of owner feedback settled it. The
recording's dots move one at a time, ~8s per arc, needing 24s to cross all three — and "How Long", the
track in the screenshot that started this, has a **2.4 second** intro. A wave that takes 24s to make one
pass is invisible in the window where it is supposed to be read, so it looked stalled rather than
waiting. The conventional travelling wave replaced it: `1.2s ease-in-out infinite`, staggered
`0 / 0.2s / 0.4s`, with the crest at 30% of the cycle and the dot back on the baseline from 60% onward,
so all three are always in motion and the crest visibly runs left to right. The mild `scale(1.1)` at the
crest is the one part of the recording's behaviour kept beyond geometry — its dots measured larger at
the top of an arc than at the bottom.

**Gated on the audio actually running.** `class:shown={waiting}`, where `waiting` is
`timed && lines.length > 0 && index < 0 && playing && !buffering`. The motion is a CSS animation, so it
does not stop when the audio does: left ungated it danced through a pause and through the stall after a
seek or a track change — the owner caught it dancing while the track was buffering. `playing` is the
original ask ("when the music in the song is being played"), and `!buffering` needed the bridge: the
media element lives only in the main window, so `miniSnapshot()` now carries `buffering:
player.isBuffering` and the card's `MiniState` reads it. Absent reads as not-buffering, the safe way to
be wrong.

**Two implementation notes worth keeping.** The row is absolutely positioned inside the reel rather than
flowed into it: the follow measures real line rects every frame, and a row entering and leaving the flow
would shift all of them — and it means the fade-out at the first timestamp cannot move the column. And
the animation is declared on `.waiting.shown .dot`, not on `.dot`, so it is genuinely `none` rather than
running unseen while a line is being sung or the audio is stalled.

The dots are centred on the fullscreen (that column is centred by an earlier decision) and left-aligned
on the card (that column is left-aligned, which is also what the reference does). Copying the reference's
x onto the centred surface would have copied a layout this app does not have.

**Verified on the running app, both surfaces.** Fullscreen on "Let It Happen" during its 28.5s intro:
3 dots, `1.2s`, `ease-in-out`, delays `0s/0.2s/0.4s`, travel `[14.88, 14.99, 14.99]` px — every dot
covering the full designed 15px, which is the wave; the earlier sequential build measured one non-zero
entry out of three. Scale range `1 → 1.1` on all three, crests at 720 / 880 ms so the peak travels.
Card in the same intro: `11px` dots, `1.2s`, same delays, travel `[6.99, 6.99, 6.99]` px, caught
mid-fade at opacity 0.78. Gates: `isBuffering = true` → `shown: false`, opacity 0 on the fullscreen and
on the card through the bridge; paused → same; restored → `shown: true` again. Past the first timestamp
on both: `shown: false`, `animation: none`, `.line.active` present. `svelte-check` 0/0, `npm test` 78/0.

**A separate defect surfaced while verifying — logged as BUG-086.** The card was found dead: "Connecting…",
zero buttons, zero lyric lines, while the main window played normally. Cause measured rather than
assumed: `ui.miniOpen` was `false` in the main window while the card window was up, and every push in
the 250ms loop is gated on that flag, so the card simply stopped being told anything. Forcing the flag
true reconnected it within one tick. The startup `mini_visible` re-derive is meant to prevent exactly
this and did not. Not fixed here — it is pre-existing, it bites after a dev-mode reload rather than in a
shipped build, and the fix touches cross-window lifecycle code another session is in.

### Two more: the stolen wheel and the note glyph that looked like a broken control

Sent with a screenshot of the fullscreen player and a circled question about scrolling. Both turned out
to be deliberate code that was wrong, rather than broken wiring — logged as BUG-088 and BUG-089.

**The wheel.** `Lyrics.svelte` bound `onwheel` on the lyric viewport and mapped it to volume in 4% steps
with `preventDefault()`. Scrolling over the right half of the player turned the knob. The handler was
also blocking the scroll the gesture asked for, in a box that cannot scroll at all — `.lyrics` is
`overflow: hidden` and the reel moves by the follow's `transform`, not by `scrollTop`. Deleted. Nothing
is lost: `VolumePill` already has its own `onwheel` and is on that same screen, which is where the
gesture belongs. Verified by dispatching `deltaY: 400` at `.lyrics` (volume held at `0.273`) and at
`.vpill` (moved to `0.233`), then restoring the volume the test changed.

**The note glyph.** Nothing in Noctra drew that box. LRCLIB writes a bare `♪` into the timed slot of an
instrumental break, and the line is a `width: fit-content; padding: 2px 14px; border-radius: 12px`
button — so one narrow glyph came out as a rounded rectangle with a note floating in it, which reads as
a control that has lost its label. Confirmed against live data: "I WANNA BE YOUR SLAVE" carries U+266A at
95740 ms and 153190 ms and nothing else on those lines.

Now `isInstrumental()` in `lrc.ts` recognises it, and both lyric surfaces render that case as the same
three-dot wave the intro uses, scaled to their own type — 14px dots rising 9px on the fullscreen, 8px
rising 5px on the card — in `currentColor` so the depth ramp reaches them like words, dancing only while
that break is the line being played. Breaks stay clickable, and the button's accessible name went from
"♪" to "Instrumental break". The amplitude is a `--wait-rise` custom property rather than a second
keyframe, since `var()` in a keyframe resolves against the element being animated.

Verified live at 102.25 s on that track: `activeIsMarker: true`, 3 dots at `14px`, `lyric-wait 1.2s` with
delays `0s/0.2s/0.4s`, `noteCharStillPainting: false`, and travel `[8.93, 8.93, 4.64]` px — which also
proves the per-element variable resolves, because the fallback would have measured 15px. A non-active
marker computes `animation-name: none`. The card renders both markers. 4 new tests, including the
boundary that "Na na na ♫" must stay a lyric rather than be swallowed by the detector.

`svelte-check` 0/0, `npm test` 81/0, motion sweep 12/12 with 0 findings and 0 appear-swaps.

### BUG-087 fixed, and the root cause I first logged was wrong

Told to fix all open bugs; BUG-087 (the card going deaf) was the only one still open in `BUGS.md`.

The entry as first written said the startup re-derive of `ui.miniOpen` "ran once and either raced or
Rust answered not-visible". Measured afterwards: **Rust answers not-visible for a window that is
plainly on screen.** `mini_visible` is `is_visible().unwrap_or(false)` nested in another
`unwrap_or(false)`, so it fails closed on any error, and a false answer shuts the push gate on a
visible card.

The first fix tried was a card-side watchdog guarded by `appWindow.isVisible()` — the window itself
knows best. It returned **`false` while the card was the focused, on-screen window**: `visibilityState`
`"visible"`, `hasFocus` `true`, 406x394, body opacity 1, main window unfocused. Instrumenting it proved
the interval was ticking and the starvation gap growing to 30s while `visible: false` blocked every
ask. Both platform visibility queries lie about a transparent always-on-top WebView2 window, so the
guard came out.

What shipped instead is two changes that need no trustworthy truth at all. The startup re-derive is now
one-way — only a `true` answer is acted on, so the query can open the gate but never shut it — and the
card re-sends the existing `sync` command whenever its feed has been quiet for 2s. The main window's
`sync` handler already did the right thing.

Verified by reproducing the failure and then the recovery: pre-fix the card sat frozen at `0:30` for 30+
seconds with the flag stuck down. Post-fix, with the main window stamped by an epoch marker so an HMR
reload could not be mistaken for healing, the flag reopened inside one poll and the clock ran
`3:14 → 3:33`. Shut a third time on a long-mounted card, where the mount `sync` cannot be responsible:
reopened inside 1.2s. Cost accepted: a hidden card asks once per 2s and the main window keeps building a
snapshot — a few field reads, against a card that could otherwise go permanently deaf with no way back.

`npm test` 87/0, `svelte-check` 0/0.

**Not mine, and left uncommitted:** while this was being verified another session put a wheel handler
back on the lyric column — `onwheel={follow.onWheel}`, wired to a new `scroll()`/`pinned` manual-browse
mode in `reelFollow.ts`. That is not BUG-088 returning: it scrolls the text rather than turning the
volume, which is the gesture's correct meaning and the thing my removal made room for. Their
`Lyrics.svelte`, `reelFollow.ts` and `romanize`/`lyrics` edits are deliberately out of my commit, since
that handler depends on their uncommitted module.

---

## Run commands

```bash
# from D:/Noctra Project
npm install
npm run tauri dev      # run the desktop app
npm run tauri build    # produce an installer
```

`tauri build` must run inside the Visual Studio Build Tools shell — plain Git Bash dies in
`tauri-winres` because `rc.exe` is only on PATH there:

```bat
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat" -arch=amd64
cd /d "D:\Noctra Project" && call npm run tauri build
```

Then verify the artifact rather than the exit code: the installer's mtime, size and MD5 must all have
changed. See BUG-094 for the build that reported success and produced nothing.
