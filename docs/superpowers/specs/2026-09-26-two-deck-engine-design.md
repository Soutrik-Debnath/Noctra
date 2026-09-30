# Phase 8 — Two-deck audio engine: gapless and crossfade

Status: approved design, awaiting implementation
Date: 2026-09-26
Supersedes: `docs/plans/noctra-feature-batch.md` §Phase 8 (lines 194-209), which this refines rather than replaces
Owner decisions: approach A (two media elements, timer-driven handoff); UI flips when the incoming track starts; both gapless and crossfade ship as separate controls

## 1. Problem

Noctra has exactly one `HTMLAudioElement` (`src/services/audio/engine.ts:76`, singleton at `:250`).
Track changes therefore stop the output device, load a new file, and start again — an audible gap
between every pair of songs. Two things are wanted:

- **Gapless** — no silence at a track boundary.
- **Crossfade** — the incoming track starts under the outgoing one, over N seconds.

Both need a second element that is already decoded before the boundary, which means the engine must
own two decks and decide which one is authoritative at any instant.

## 2. Why this is the riskiest change in the app

Two concrete, verified hazards, both silent when they break:

1. **Listening stats inflate.** `player.svelte.ts:396-402` derives listening seconds from position
   deltas (`delta > 0 && delta < 2`) rather than a timer. If both decks emit `position`, seconds get
   counted twice and nothing looks wrong.
2. **Tracks get skipped.** `handleEnded` (`player.svelte.ts:424`) is what advances the run. The
   outgoing deck's `ended` fires *after* the flip, roughly `crossfade` seconds later. Unsupspressed,
   it advances again and drops a track.

The design below makes both structurally impossible rather than guarding them at the call sites.

## 3. Approach chosen, and what was rejected

**Chosen — A: two `HTMLAudioElement`s, timer-driven handoff.** Active deck plus a preloaded standby,
volume ramps on `el.volume`. Handoff lands within one clock tick (~66 ms) of the target. Shipped as
"seamless", never as "sample-accurate".

**Rejected — B: decode to `AudioBuffer`, schedule with `AudioBufferSourceNode`.** The only route to
sample-accurate gapless and automation-precise fades, and wrong for this app: it requires downloading
and decoding a whole track before playback on a machine where audio init already costs ~7 s and a
warm play ~670 ms (`PROGRESS.md` D-038, `BUGS.md` BUG-017); a 3-minute FLAC is ~30-40 MB of float per
buffer; it must decode BUG-008's *patched* bytes rather than the file; and it makes CORS-clean serving
mandatory for all playback. The plan itself calls this "a different engine".

**Rejected — C: two decks, butt-joint only, no overlap.** Smaller change, most of the perceived
benefit. Declined by owner decision in favour of shipping crossfade now.

## 4. Architecture

### 4.1 Deck

A `Deck` class inside `engine.ts` wrapping one `HTMLAudioElement`. It owns:

- the element, created once per deck (two decks are created for the process lifetime and reused;
  decks are never recreated per track, so listeners bind exactly once)
- its own `loadedSource` memo, replacing today's engine-level one
- its own listener set, currently bound at `engine.ts:89-110`
- a `role`: `"active" | "arming" | "fading-out" | "idle"`
- a `ramp`: `0..1` multiplier, `1` when not fading
- derived, not stored: `authoritative` **is** `role === "active"`. Only the authoritative deck may
  emit events, so role stays the single source of truth rather than a second flag that can disagree
  with it

### 4.2 Event ownership — the central rule

`EngineEvents` (`engine.ts:13-22`) keeps its existing shape and gains one member, `handoff()`.

A non-authoritative deck's `position`, `duration`, `playing`, `paused`, `waiting`, `ready` and
`ended` are **swallowed inside the engine and never reach the store**. The only signals a standby
deck produces are:

- internal: `canplay` / `readyState >= 3`, used to decide whether it is armed (not forwarded)
- forwarded: `error` — so a missing next file surfaces rather than silently killing a fade

This single rule is what removes the double-count and the mid-fade skip. No call-site guards needed.

### 4.3 Ownership of decisions

The engine owns sound. The store owns *what plays next*. The engine never picks a track.

Consequences in `player.svelte.ts`:

- Existing advance logic is extracted into one `advanceToNext(reason: "ended" | "handoff")` used by
  both `handleEnded` and the new `handoff` handler, so queue precedence, `stepBy`, `playsLeft`,
  `repeat` modes and run-end behave identically on both paths.
- New **read-only** `peekNext(): number | null` — today `stepBy(1)` consumes, and arming a standby
  deck must not consume. `peekNext` resolves queue-then-order without mutating anything.
- `history.recordStart(newId)` moves into `advanceToNext` so it fires exactly once per advance.
- `sleep.stopAfterCurrent` cancels the armed handoff (see §7).

### 4.4 Engine API

| Member | Behaviour |
|---|---|
| `play(source)`, `pause()`, `seek(s)`, `setVolume(v)`, `setMuted(m)` | Unchanged signatures; operate on the active deck (volume/mute on both, §6) |
| `prepare(source)` | Arm the standby deck: `preload = "auto"`, set src, begin decoding. Idempotent — same source twice is a no-op. **Returns immediately and does nothing when gapless is off and crossfade is 0** (§9.3) |
| `crossfadeTo(seconds)` | Schedule the handoff for the armed standby at `activeDuration - seconds`. Replaces any earlier schedule |
| `cancelHandoff()` | Disarm; release the standby deck. Used by manual navigation, sleep, and settings changes |
| `resetAudio()` | Tear down both decks and rebuild a single clean active deck at the saved position. The escape hatch, shared with Phase 9 |
| `get isFading(): boolean` | For the UI and for tests |

## 5. Handoff sequence

Trigger evaluation rides the existing 66 ms clock (`CLOCK_INTERVAL_MS`, `engine.ts:25`). Jitter is
therefore ±66 ms, which is the honest limit of approach A.

1. **Arm.** When `remaining <= crossfadeSec + 6 s`, the store calls `peekNext()` and
   `engine.prepare(nextSource)`. The 6 s lead keeps two live streams from coexisting for a whole
   track; it is a named constant `ARM_LEAD_SEC = 6`.
2. **Gate.** At `active.currentTime >= activeDuration - crossfadeSec`, if the standby is not
   `readyState >= 3`, abort (§7). Otherwise proceed.
3. **Start.** `standby.currentTime = 0`, `standby.play()`.
4. **Flip.** In the same tick, in this order — order matters, see §5.1:
   1. outgoing deck: `authoritative = false`, role `standby` → but keep playing for its ramp
   2. incoming deck: `authoritative = true`, role `active`
   3. emit `duration(newDuration)`
   4. emit `position(0)`
   5. emit `playing()`
   6. emit `handoff()` — the store runs `advanceToNext("handoff")`
5. **Ramp.** Over `crossfadeSec`, outgoing `ramp: 1 → 0`, incoming `ramp: 0 → 1`, recomputed on a
   25 ms interval (`RAMP_TICK_MS = 25`) through `applyDeckVolumes()` (§6).
6. **Release.** When outgoing `ramp` reaches 0: `pause()`, `src = ""`, `load()`, role `idle`. This
   returns the stream and the protocol's plan entry to being single-use.

With `crossfadeSec = 0`, steps 4-6 collapse to: start incoming, flip, pause and release outgoing
immediately. That is the gapless-only path — butt-joint, no ramps.

### 5.1 Why duration precedes position

`player.duration` is `$derived(reportedDuration || current.duration)` (`player.svelte.ts:381`). If
`position(0)` landed before `duration`, Windows SMTC (`services/mediaSession.ts`, `setPositionState`)
and the progress bar could momentarily observe `position > duration`. Emitting duration first keeps
that invariant true at every observable instant.

## 6. Volume model

`el.volume` is the only gain available, and it is shared with user volume and mute. There must be
exactly one formula, applied to both decks:

```
effectiveDeckVolume = userVolume × deck.ramp        (clamped 0..1)
deck.muted          = globalMuted
```

- `setVolume()` and `setMuted()` call `applyDeckVolumes()`, which retargets **both** decks. Changing
  volume mid-fade must not snap either ramp.
- No ramp may write `el.volume` directly. This is also the seam where Phase 7 ReplayGain multiplies
  in, and where Phase 9's pre-amp sits below it — both must stay below user volume, never push
  `el.volume` past 1.
- Ramping `el.volume` is a per-element gain, not a re-encode.

## 7. Failure and fallback — silence is never acceptable

| Condition | Action |
|---|---|
| Standby not `readyState >= 3` at the gate | Abort the fade. Active deck plays to its true end and emits a normal `ended`. Result: today's behaviour with a small gap, never a hole |
| Standby errors (missing/unreadable file) | Same abort. Error is stored and surfaced only when the real advance happens, not during the fade |
| Handoff aborted | `cancelHandoff()` releases the standby deck; the next arm window retries |
| `crossfadeSec >= duration / 2` | `crossfadeTo()` clamps the *effective* fade to `duration / 2` at schedule time, inside the engine. The stored setting is never rewritten, so raising the sleeve size or picking a longer track does not silently change the user's value |
| `duration` unknown (0) at gate time | No fade; fall through to `ended` |
| Any exception inside the ramp loop | Hard-cut outgoing to 0, adopt incoming, log via `error` — one deck must always be audible |

## 8. Interaction matrix

| Action during a fade | Required behaviour |
|---|---|
| `pause()` | **Freeze both decks and both ramps** at their current values. `resume()` continues the ramp. A crossfade that keeps fading while paused reads as a bug |
| `seek()` | Hard-adopt: cut and release the outgoing deck immediately, keep the incoming deck, apply the seek. A seek means "be somewhere else now" |
| Manual `next()` / `previous()` / `select()` / `playFrom()` | **No crossfade.** Switch immediately on the active deck and `cancelHandoff()`. Fading into a track the user deliberately chose is wrong |
| `repeat === "one"` | Plain restart on the active deck, no fade, no standby |
| `repeat === "times"` | `playsLeft` decrements exactly once, inside `advanceToNext` |
| `repeat === "all"` | Unchanged; only affects `stepBy` at run end |
| `sleep.stopAfterCurrent` | `cancelHandoff()` immediately, so "stop after this song" cannot be skipped by an armed fade |
| Settings: gapless or crossfade changed | `cancelHandoff()`; re-armed on the next window with the new values |
| Shuffle toggled mid-fade | No special case — the standby source is already chosen; the next arm uses the new order |
| End of run, nothing queued | No standby armed; `ended` advances to `stopAtEnd()` as today |

## 9. Settings and persistence

In `src/stores/settings.svelte.ts`, following the existing `DEFAULTS` / `sanitize()` / `apply()`
pattern (`:58`, `:104-120`, `:122-159`), stored in the same `noctra.settings` blob:

| Key | Type | Range | Default |
|---|---|---|---|
| `gapless` | boolean | — | `true` |
| `crossfadeSec` | number | 0-12, step 0.5 | `0` |

### 9.1 Defaults are deliberate

Gapless on by default removes silence between tracks, which is what almost every listener wants and
carries no audible side effect. Crossfade defaults to **0**, so nothing about how the app currently
sounds changes until the user deliberately raises the slider.

### 9.2 The slider clears D-061

`PROGRESS.md` D-061 deleted two sliders because "nobody lands on a better number than the shipped
default by dragging a slider". D-074 reopened that for corner rounding on the grounds that
sharp-vs-soft is a real taste axis with no contrast cliff. Crossfade length is the same kind of
control: plainly audible, no wrong side of a cliff, personal. **This justification must appear in a
code comment**, or a future pass deletes the control as a regression.

### 9.3 The guarantee that protects today's playback

When `gapless === false && crossfadeSec === 0`:

- `prepare()` returns immediately without touching the standby element
- the standby element never receives a `src`, never loads, never streams
- the only audible deck is the active one, and advance happens through `ended` exactly as today

This makes the feature provably additive. It is an acceptance gate (§12), not an aspiration.

## 10. Accepted consequences

Stated so nobody rediscovers them as a bug:

- **Handoff is ~66 ms accurate, not sample-accurate.** A few ms of gap or overlap at the boundary.
  Labelled "seamless" in UI copy, never "sample-accurate".
- **The outgoing track is under-credited by the fade length.** With flip-at-start, its last
  `crossfadeSec` seconds are heard underneath the next song and are not credited to it. This is
  arguably correct — you did not listen to them alone — and it is *not* to be compensated with
  fudged numbers.
- **The outgoing track's lyrics and progress disappear at the flip.** Inherent to flip-at-start,
  which was the chosen behaviour.
- **Albums with intentional continuity** (live records, classical, mixed sets) will crossfade badly.
  There is no per-album or per-track opt-out in this phase; the global default of 0 s is the
  mitigation. Per-album opt-out is listed as future work.
- **Two concurrent `noctra-audio://` streams** exist for up to `crossfadeSec + 6` seconds. See §11.

## 11. Protocol concurrency — what is verified and what is not

Verified by reading `src-tauri/src/audio_protocol.rs`:

- Plans are cached **per path** in `Mutex<HashMap<String, Arc<Plan>>>` (`:48`), so two different
  files get two independent entries; the mutex guards map access, not streaming.
- `MAX_CHUNK = 2 MB` (`:37`) is a per-response body size chosen to keep memory flat, **not** a cap on
  how much of a track can be streamed. Range requests are served normally (`:260-263`).
- Every response, including 4xx/5xx, carries `ACCESS_CONTROL_ALLOW_ORIGIN: *` (`:256-259`).

**Not verified, and required by §12:** two streams have never run concurrently. The BUG-008 FLAC
header patch (`scan_flac`, `:99-155`) shifts logical offsets by `delta` and has only ever served one
file at a time.

Separately, and pre-existing: the plan cache is **unbounded** — every path ever served retains its
patched prefix (probe window up to `MAX_PROBE = 8 MB`, `:35`) for the life of the process. Two decks
make this marginally worse but do not cause it. Not in scope here; recorded so it stops being a
surprise.

## 12. Acceptance gates

All must pass before this is called done. "It plays" is not verification.

1. **Silence test**, in two parts, because "no audible gap" is an audio property and the cheap way to
   observe it is a state property:
   - **State-level, non-perturbing.** Across the boundary with `gapless on, crossfade 0`, assert no
     `waiting` event fires, `player.isBuffering` never flips true, and the position clock advances
     monotonically with no stall longer than one 66 ms tick. This catches the real failure mode
     without touching the signal path.
   - **Audio-level.** A temporary `AnalyserNode` tap logging RMS at 25 ms, requiring no window of
     near-zero output spanning the boundary. This tap is **test-only instrumentation, never shipped**:
     `createMediaElementSource` is permanent per element, so the tap measurably changes the path it is
     measuring and cannot be the shipped behaviour. Plus one deliberate human listen across three
     consecutive album tracks.
2. **Stats are not doubled.** Play two tracks with a 6 s crossfade, then compare
   `noctra.history` seconds against actual audible seconds. Must not exceed them.
3. **No skipped track.** Across 10 automatic handoffs, exactly 10 tracks play, in the expected order,
   with the queue consumed once each.
4. **`ended` is suppressed.** Assert the outgoing deck's `ended` never reaches the store while fading.
5. **Fallback works.** Delete or corrupt the armed next file mid-fade-window: playback must continue
   to the true end of the current track and advance normally. No silence.
6. **Pause during fade** freezes both ramps; resume continues them; no volume jump.
7. **Seek during fade** adopts the incoming deck with no double audio.
8. **Manual next during fade** produces no crossfade and no lost track.
9. **Sleep stop-after-current** cancels the handoff and stops.
10. **Off-path identity.** With `gapless off, crossfade 0`, assert the standby element never receives
    a `src`, and behaviour matches the pre-change build.
11. **Two-stream protocol test.** With a FLAC as the outgoing track, confirm both concurrent
    `noctra-audio://` range streams are served correctly and the patched-header file still plays
    through its own crossfade.
12. **SMTC and mini window.** Across a handoff, Windows media controls show the new title and a legal
    `position <= duration`, and `miniSnapshot()` reflects the new track within its 250 ms push.
13. `npm run check` (svelte-check) stays at **0 errors, 0 warnings**.
14. Live verification uses the existing CDP harness (`scripts/cdp-eval.mjs`, port 9223). Note the
    documented traps: media started via `element.click()` from `Runtime.evaluate` lacks user
    activation, so use the `--click` trusted-input path for anything autoplay-sensitive.

## 13. Files

**Changed:** `src/services/audio/engine.ts` (deck class, handoff, ramps, API — the bulk of the work),
`src/stores/player.svelte.ts` (`advanceToNext`, `peekNext`, `handoff` handler, arm trigger),
`src/stores/settings.svelte.ts` (two keys + `sanitize` clamps + comment for §9.2).

**Read-only review, expected to need no edit:** `src/services/mediaSession.ts`, `src/services/taskbar.ts`,
`src/services/windowBridge.ts`, `src/components/ProgressBar.svelte`, `src/MiniApp.svelte`.

**Deliberately not touched:** the A-B section loop does not exist in this app — an earlier research
pass cited `enforceLoop` at `player.svelte.ts:160-164`, which is actually the shuffle play-order
builder, and no such symbol exists anywhere in `src/`. Do not write code for it.

### 13.1 Concurrent-session constraint

Another session is actively editing `src/views/NowPlaying.svelte`, `src/views/Lyrics.svelte`,
`src/MiniApp.svelte` and `src/app.css`, and is committing to the same repository. Agreed working mode:
this work stays inside the audio files. The two new settings need a control row in
`src/views/Settings.svelte`, which is in that session's wave, so it is scheduled **last**, with the
file re-read immediately beforehand and committed immediately afterwards as its own commit.

## 14. Out of scope

ReplayGain / loudness normalisation (Phase 7), the parametric EQ and its graph (Phase 9 — though
reusing two long-lived decks makes its permanent `createMediaElementSource` attach a one-time cost per
deck, which is why `resetAudio()` lives here), per-album crossfade opt-out, waveform seeking, and any
change to the library scan or the Rust protocol handler.
