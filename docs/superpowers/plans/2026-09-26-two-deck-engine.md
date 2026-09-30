# Phase 8 Two-Deck Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Noctra's single `HTMLAudioElement` with two long-lived decks so tracks hand off without silence, optionally crossfading over a user-set duration.

**Architecture:** Two pure, unit-tested modules decide *when* to hand off and *what* the volume ramps look like; a `Deck` class wraps one media element and enforces that only the authoritative deck may emit events; `engine.ts` orchestrates the two decks and keeps its existing `EngineEvents` seam so the Svelte store barely changes. The store still owns "what plays next" — the engine never picks a track.

**Tech Stack:** Svelte 5 runes, TypeScript, Vite, Tauri 2 (WebView2/Edge 153). Tests use Node's built-in runner — **no new dependencies**.

**Spec:** `docs/superpowers/specs/2026-09-26-two-deck-engine-design.md` — read it alongside this plan. Section references below (`§5`, `§7`) are to that file.

## Global Constraints

- **No new runtime or dev dependencies.** The app ships with two runtime deps and the owner has explicitly prioritised a small footprint. Tests use `node --test`, available in the installed Node 24.19.
- **`npm run check` (svelte-check) must end every task at 0 errors, 0 warnings.** It is currently at 0/0 and that is a standing gate.
- **Only these files may be edited:** `src/services/audio/*`, `src/stores/settings.svelte.ts`, `src/stores/player.svelte.ts`, plus the single `tsconfig.json` line added in Task 2 Step 0. `src/views/Settings.svelte` is edited in the **final** task only. Another session is actively committing to `NowPlaying.svelte`, `Lyrics.svelte`, `MiniApp.svelte`, `app.css` and `Settings.svelte`.
- **Never suppress a type error to satisfy a gate.** If a mandated import form and the type checker disagree, fix the config (Task 2 Step 0), not the file. `@ts-ignore` and `@ts-expect-error` are not acceptable in this plan's output.
- **Re-read every file immediately before editing it**, and `git status --short` before each commit. Never `git add -A` — stage named files only, or you will commit another session's in-flight work as yours.
- **The repo has no git identity configured.** Either set it once yourself (`git config user.name "soutr"` / `git config user.email "you@example.com"`) or prefix every commit with `-c user.name="soutr" -c user.email="soutr@localhost"`. The commit steps below assume you have set it.
- **UI copy says "seamless", never "sample-accurate"** (`§3`, `§10`).
- **No new visible state in this phase.** The mini window mirrors the main window through `miniSnapshot()`; the owner's standing rule is that mini and fullscreen must not drift. If any indicator is added, it must appear on both surfaces.
- **`§9.2` requires a code comment** justifying the crossfade slider against `PROGRESS.md` D-061, or a later pass deletes it.
- Handoff accuracy is one clock tick (66 ms). Do not add `requestAnimationFrame`; it is frozen for occluded windows (`engine.ts:224-231`).

## Verified facts this plan depends on

Measured on this machine, 2026-09-26, not assumed:

- `node --test` with no argument discovers `*.test.ts` recursively and runs TypeScript directly (type-stripping). **A directory argument fails**: `node --test src` → `Cannot find module .../src`.
- `node --test "src/**/*.test.ts"` works. Use this form — bare discovery also walks `_backup-20260926-164944/`, which contains copies of source files.
- Routing the media element into Web Audio without `crossOrigin` yields `readyState 4` and **zero output** (measured RMS 0.00000 vs 0.15 with it set). Out of scope here, but it is why `resetAudio()` is built in this phase rather than in Phase 9.

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/services/audio/fade.ts` | create | Pure volume-ramp maths and fade-length clamping. No DOM. |
| `src/services/audio/fade.test.ts` | create | Tests for the above. |
| `src/services/audio/handoff.ts` | create | Pure decision function: given playback state, what should happen this tick. Encodes the `§7` fallback table. No DOM. |
| `src/services/audio/handoff.test.ts` | create | Tests for the above. |
| `src/services/audio/deck.ts` | create | One media element + role state machine + the event-ownership gate (`§4.2`). Media element is injected so it can be tested without a browser. |
| `src/services/audio/deck.test.ts` | create | Tests for the above, against a `FakeMedia`. |
| `src/services/audio/engine.ts` | rewrite | Owns two decks, the handoff sequence, the ramp loop, the single volume formula, and the public API. Keeps `EngineEvents` shape plus `handoff()`. |
| `src/stores/settings.svelte.ts` | modify | `gapless` and `crossfadeSec` keys, clamped in `sanitize()`. |
| `src/stores/player.svelte.ts` | modify | `advanceToNext()`, `peekNext()`, arm trigger, `handoff` handler, interaction matrix. |
| `src/views/Settings.svelte` | modify (last) | The two controls. |

---

### Task 1: Test harness

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add the test script**

In `package.json`, change the `scripts` block to add `test` after `check`:

```json
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "node --test \"src/**/*.test.ts\"",
    "tauri": "tauri",
```

- [ ] **Step 2: Create a smoke test that proves discovery and TS stripping**

Create `src/services/audio/smoke.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";

// Proves the runner discovers files under src/ and executes TypeScript unmodified.
// Deleted in Task 2 once a real test exists.
test("node --test runs TypeScript under src/", () => {
  const value: number = 2 + 3;
  assert.equal(value, 5);
});
```

- [ ] **Step 3: Run it**

Run: `npm test`
Expected: `tests 1`, `pass 1`, `fail 0`.

If this instead reports `Cannot find module`, the script was written with a directory argument — use the quoted glob exactly as in Step 1.

- [ ] **Step 4: Confirm the type-check gate still holds**

Run: `npm run check`
Expected: `0 errors, 0 warnings`. If svelte-check reports errors about `node:test`, `@types/node` is missing from `tsconfig.json` `types` — it is already there at line 15, so check that before adding anything.

- [ ] **Step 5: Commit**

```bash
git add package.json src/services/audio/smoke.test.ts
git commit -m "test: add node --test harness with zero new dependencies"
```

---

### Task 2: `fade.ts` — ramp maths and clamping

**Files:**
- Modify: `tsconfig.json` (one line — Step 0)
- Create: `src/services/audio/fade.ts`
- Create: `src/services/audio/fade.test.ts`
- Delete: `src/services/audio/smoke.test.ts`

**Interfaces:**
- Produces: `Ramp`, `clampFadeSeconds(requested: number, duration: number): number`, `rampAt(elapsed: number, fadeSeconds: number): Ramp`

- [ ] **Step 0: Let the type checker accept `.ts` import specifiers**

`node --test` resolves ESM specifiers literally, so a test **must** import `./fade.ts` with the extension. `svelte-check` rejects that with `TS5097` unless the project opts in. Add one line to `compilerOptions` in `tsconfig.json`, next to the existing `"noEmit": true` (which is the precondition for this flag):

```json
    "allowImportingTsExtensions": true,
```

Verify: `npm run check` → `0 errors, 0 warnings`, and `npm test` still runs. Do **not** instead write `from "./fade"` (Node cannot resolve it) and do **not** suppress the error in the test file.

- [ ] **Step 1: Write the failing tests**

Create `src/services/audio/fade.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampFadeSeconds, rampAt } from "./fade.ts";

test("a fade longer than half the track is clamped to half", () => {
  assert.equal(clampFadeSeconds(12, 20), 10);
});

test("an exact half is allowed", () => {
  assert.equal(clampFadeSeconds(10, 20), 10);
});

test("a short requested fade passes through unchanged", () => {
  assert.equal(clampFadeSeconds(4, 200), 4);
});

test("no usable duration or requested value means no fade", () => {
  assert.equal(clampFadeSeconds(6, 0), 0);
  assert.equal(clampFadeSeconds(6, Number.NaN), 0);
  assert.equal(clampFadeSeconds(0, 200), 0);
  assert.equal(clampFadeSeconds(-3, 200), 0);
});

test("the ramp starts full out and silent in", () => {
  assert.deepEqual(rampAt(0, 8), { out: 1, in: 0 });
});

test("the ramp is symmetric at the midpoint", () => {
  assert.deepEqual(rampAt(4, 8), { out: 0.5, in: 0.5 });
});

test("the ramp ends silent out and full in", () => {
  assert.deepEqual(rampAt(8, 8), { out: 0, in: 1 });
});

test("elapsed time outside the window is clamped, not extrapolated", () => {
  assert.deepEqual(rampAt(-2, 8), { out: 1, in: 0 });
  assert.deepEqual(rampAt(99, 8), { out: 0, in: 1 });
});

test("a zero-length fade is an instant handoff, never a division by zero", () => {
  assert.deepEqual(rampAt(0, 0), { out: 0, in: 1 });
  assert.deepEqual(rampAt(5, 0), { out: 0, in: 1 });
});

test("non-finite input answers as 'no fade' rather than NaN or a hang", () => {
  assert.deepEqual(rampAt(Number.NaN, 8), { out: 0, in: 1 });
  assert.deepEqual(rampAt(4, Number.NaN), { out: 0, in: 1 });
  assert.deepEqual(rampAt(4, Number.POSITIVE_INFINITY), { out: 0, in: 1 });
});

test("gain always stays inside the documented 0..1 contract", () => {
  const cases: Array<[number, number]> = [
    [-5, 8], [0, 8], [4, 8], [8, 8], [99, 8], [Number.NaN, 3], [1, Number.POSITIVE_INFINITY],
  ];
  for (const [e, f] of cases) {
    const { out, in: gain } = rampAt(e, f);
    for (const v of [out, gain]) {
      assert.ok(Number.isFinite(v) && v >= 0 && v <= 1, `rampAt(${e}, ${f}) produced ${v}`);
    }
  }
});

test("clampFadeSeconds rejects an infinite duration like any other non-finite value", () => {
  assert.equal(clampFadeSeconds(6, Number.POSITIVE_INFINITY), 0);
  assert.equal(clampFadeSeconds(Number.POSITIVE_INFINITY, 200), 0);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module .../fade.ts` (or a TS resolution error). That is the expected red state.

- [ ] **Step 3: Implement**

Create `src/services/audio/fade.ts`:

```ts
/** Per-deck multipliers during a handoff. Both are 0..1 and are applied below user volume. */
export type Ramp = { out: number; in: number };

/**
 * A fade longer than half the track means the incoming and outgoing decks are the same song's
 * tail and head, which is not a crossfade. The caller's stored setting is never rewritten — this
 * only bounds one schedule (spec §7).
 */
export function clampFadeSeconds(requested: number, duration: number): number {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(requested, duration / 2);
}

/**
 * Linear equal-gain fade. `fadeSeconds <= 0` is the butt-joint case: an instant swap.
 *
 * Non-finite input answers the same way as "no fade" — full incoming, outgoing released. Anything
 * else is worse than that: `NaN` is falsy, so a defensive `ramp.out || 0` at a call site turns a
 * `NaN` gain into instant silence, and an `Infinity` fade length never reaches its end at all, so
 * the incoming deck would never arrive.
 */
export function rampAt(elapsed: number, fadeSeconds: number): Ramp {
  if (!Number.isFinite(elapsed) || !Number.isFinite(fadeSeconds)) return { out: 0, in: 1 };
  if (fadeSeconds <= 0) return { out: 0, in: 1 };
  const t = Math.max(0, Math.min(1, elapsed / fadeSeconds));
  return { out: 1 - t, in: t };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: `pass 12`, `fail 0`.

- [ ] **Step 5: Remove the smoke test and re-check types**

```bash
rm src/services/audio/smoke.test.ts
npm test && npm run check
```
Expected: 9 passing; `0 errors, 0 warnings`.

- [ ] **Step 6: Commit**

```bash
git add src/services/audio/fade.ts src/services/audio/fade.test.ts
git rm --cached src/services/audio/smoke.test.ts 2>/dev/null || true
git commit -m "feat: pure fade ramp maths and half-duration clamp for two-deck handoff"
```

---

### Task 3: `handoff.ts` — the tick decision function

This module is where `§7`'s fallback rules live, so the rules are testable without a browser and without audio.

**Files:**
- Create: `src/services/audio/handoff.ts`
- Create: `src/services/audio/handoff.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ARM_LEAD_SEC`, `BUTT_JOINT_LEAD_SEC`, `HandoffInput`, `HandoffAction`, `decideHandoff(input: HandoffInput): HandoffAction`

- [ ] **Step 1: Write the failing tests**

Create `src/services/audio/handoff.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { decideHandoff, type HandoffInput } from "./handoff.ts";

const base: HandoffInput = {
  gapless: true,
  fadeSeconds: 6,
  position: 0,
  duration: 200,
  hasNext: true,
  armed: false,
  standbyReady: false,
  fading: false,
};

const at = (position: number, over: Partial<HandoffInput> = {}): HandoffInput => ({
  ...base,
  position,
  ...over,
});

test("with the feature fully off nothing is ever armed - spec §9.3", () => {
  assert.deepEqual(decideHandoff(at(199, { gapless: false, fadeSeconds: 0 })), { kind: "none" });
  assert.deepEqual(decideHandoff(at(0, { gapless: false, fadeSeconds: 8 })), { kind: "none" });
});

test("crossfade without gapless never arms, so the two controls cannot contradict", () => {
  assert.deepEqual(decideHandoff(at(199, { gapless: false, fadeSeconds: 8 })), { kind: "none" });
});

test("an unknown duration falls through to ended", () => {
  assert.deepEqual(decideHandoff(at(10, { duration: 0 })), { kind: "none" });
});

test("nothing queued means nothing to hand off to", () => {
  assert.deepEqual(decideHandoff(at(199, { hasNext: false })), { kind: "none" });
});

test("the standby deck is armed inside the lead window", () => {
  assert.deepEqual(decideHandoff(at(188, { fadeSeconds: 6 })), { kind: "arm" });
});

test("arming happens once: an already armed deck is not re-armed", () => {
  assert.deepEqual(decideHandoff(at(188, { armed: true })), { kind: "none" });
});

test("before the lead window there is nothing to do", () => {
  assert.deepEqual(decideHandoff(at(100, { fadeSeconds: 6 })), { kind: "none" });
});

test("a ready standby at the gate begins the fade", () => {
  assert.deepEqual(
    decideHandoff(at(194, { armed: true, standbyReady: true })),
    { kind: "begin-fade", fade: 6 },
  );
});

test("a not-ready standby at the gate aborts and lets ended run normally - spec §7", () => {
  assert.deepEqual(decideHandoff(at(194, { armed: false, standbyReady: false })), {
    kind: "abort-fade",
  });
  assert.deepEqual(decideHandoff(at(194, { armed: true, standbyReady: false })), {
    kind: "abort-fade",
  });
});

test("a fade already in flight is left alone", () => {
  assert.deepEqual(
    decideHandoff(at(196, { fading: true, armed: true, standbyReady: true })),
    { kind: "none" },
  );
});

test("gapless with no crossfade butt-joints just before the end", () => {
  assert.deepEqual(
    decideHandoff(at(199.95, { fadeSeconds: 0, armed: true, standbyReady: true })),
    { kind: "begin-butt-joint", fade: 0 },
  );
});

test("a butt joint with no ready standby is left to ended, never forced", () => {
  assert.deepEqual(decideHandoff(at(199.95, { fadeSeconds: 0, armed: true })), { kind: "none" });
});

test("position past the reported duration is treated as the gate", () => {
  assert.deepEqual(
    decideHandoff(at(201, { armed: true, standbyReady: true })),
    { kind: "begin-fade", fade: 6 },
  );
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module .../handoff.ts`.

- [ ] **Step 3: Implement**

Create `src/services/audio/handoff.ts`:

```ts
/**
 * How far ahead of the gate the standby deck starts loading. Two live streams is the cost, so this
 * is deliberately short: long enough for Chromium to decode a FLAC behind a patched header, short
 * enough that it is not holding two files for a whole track (spec §5).
 */
export const ARM_LEAD_SEC = 6;

/**
 * A butt joint has to start the incoming deck slightly *before* the outgoing one ends, or the
 * output device idles and you hear the gap the feature exists to remove.
 */
export const BUTT_JOINT_LEAD_SEC = 0.12;

export type HandoffInput = {
  gapless: boolean;
  /** Already clamped by `clampFadeSeconds`. */
  fadeSeconds: number;
  position: number;
  duration: number;
  hasNext: boolean;
  armed: boolean;
  standbyReady: boolean;
  fading: boolean;
};

export type HandoffAction =
  | { kind: "none" }
  | { kind: "arm" }
  /** `fade` is the already-clamped length, so no caller has to recompute it and disagree. */
  | { kind: "begin-fade"; fade: number }
  | { kind: "begin-butt-joint"; fade: number }
  | { kind: "abort-fade" };

const NONE: HandoffAction = { kind: "none" };

/**
 * Pure: one call per position tick, no I/O, no element. Every way this can be wrong is a silent
 * hole in the audio, which is why the rules live here rather than inline in the engine.
 */
export function decideHandoff(input: HandoffInput): HandoffAction {
  // Crossfade is a kind of gapless. If gapless is off, no second deck ever exists.
  if (!input.gapless) return NONE;
  // A fade already running is driven by the ramp loop, not by this decision.
  if (input.fading) return NONE;
  // No duration yet, or nothing queued: fall through to `ended` exactly as today.
  if (!Number.isFinite(input.duration) || input.duration <= 0) return NONE;
  if (!Number.isFinite(input.position)) return NONE;
  if (!input.hasNext) return NONE;

  const remaining = input.duration - input.position;
  const fade = input.fadeSeconds > 0;

  // One definition of the gate, evaluated before arming. Arming inside the gate window can never
  // make the standby ready in time, so answering `arm` there would mask §7's abort fallback on every
  // remaining tick and re-open a second stream at exactly the moment to abandon the handoff.
  const gate = fade ? input.fadeSeconds : BUTT_JOINT_LEAD_SEC;
  if (remaining <= gate) {
    if (input.armed && input.standbyReady) {
      return fade
        ? { kind: "begin-fade", fade: input.fadeSeconds }
        : { kind: "begin-butt-joint", fade: 0 };
    }
    // §7 defines an abort for the fade path only; a dropped butt joint falls through to `ended`,
    // which is audibly the same result.
    return fade ? { kind: "abort-fade" } : NONE;
  }

  // Outside the gate: arm early enough that the standby can decode before it is needed. This lead
  // computation is pinned by the "before the lead window there is nothing to do" test, NOT by the
  // §9.1 test — removing it would still answer `arm`, just at position 0.
  const lead = fade ? input.fadeSeconds + ARM_LEAD_SEC : ARM_LEAD_SEC;
  if (!input.armed && remaining <= lead) return { kind: "arm" };
  return NONE;
}
```

Three further assertions belong in the Step 1 block, added after it: `"the default shipped configuration still arms with no crossfade - spec §9.1"` asserting `decideHandoff(at(195, { fadeSeconds: 0 }))` is `{ kind: "arm" }`; `"a butt joint is not armed after its own gate has passed"` asserting `at(199.99, { fadeSeconds: 0 })` is `{ kind: "none" }`; and `"a broken clock position falls through to ended rather than starting a fade"` asserting `at(Number.NaN, { armed: true, standbyReady: true })` is `{ kind: "none" }`.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: `pass 28`, `fail 0` (12 from Task 2 + 16 here).

- [ ] **Step 5: Type check**

Run: `npm run check`
Expected: `0 errors, 0 warnings`.

- [ ] **Step 6: Commit**

```bash
git add src/services/audio/handoff.ts src/services/audio/handoff.test.ts
git commit -m "feat: pure handoff scheduler encoding the fallback rules for two-deck playback"
```

---

### Task 4: `deck.ts` — role state machine and event gate

The single rule that prevents inflated listening stats and skipped tracks (`§4.2`) lives here, where it can be tested directly.

**Files:**
- Create: `src/services/audio/deck.ts`
- Create: `src/services/audio/deck.test.ts`

**Interfaces:**
- Produces: `DeckRole`, `DeckEvent`, `MediaLike`, `Deck`

- [ ] **Step 1: Write the failing tests**

Create `src/services/audio/deck.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { Deck, type MediaLike } from "./deck.ts";

/** Stands in for HTMLAudioElement. Records calls so the gate can be observed. */
class FakeMedia implements MediaLike {
  src = "";
  preload = "";
  volume = 1;
  muted = false;
  currentTime = 0;
  duration = 100;
  readyState = 0;
  error = null as { code: number } | null;
  loads = 0;
  plays = 0;
  pauses = 0;
  private listeners = new Map<string, Array<() => void>>();

  addEventListener(type: string, fn: () => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  removeEventListener() {
    /* not needed by these tests */
  }
  load() { this.loads += 1; }
  play() { this.plays += 1; return Promise.resolve(); }
  pause() { this.pauses += 1; }
  dispatch(type: string) {
    for (const fn of this.listeners.get(type) ?? []) fn();
  }
}

function makeDeck() {
  const media = new FakeMedia();
  const seen: string[] = [];
  const deck = new Deck(() => media, (event) => seen.push(event));
  return { media, deck, seen };
}

test("a new deck is idle, not authoritative, and at full gain", () => {
  const { deck } = makeDeck();
  assert.equal(deck.role, "idle");
  assert.equal(deck.authoritative, false);
  assert.equal(deck.ramp, 1);
});

test("only the active deck's events reach the store - spec §4.2", () => {
  const { media, deck, seen } = makeDeck();
  deck.role = "active";
  media.dispatch("playing");
  media.dispatch("waiting");
  media.dispatch("ended");
  assert.deepEqual(seen, ["playing", "waiting", "ended"]);
});

test("a fading-out deck emits nothing, so ended cannot advance the run twice", () => {
  const { media, deck, seen } = makeDeck();
  deck.role = "active";
  deck.role = "fading-out";
  media.dispatch("ended");
  media.dispatch("paused");
  media.dispatch("durationchange");
  assert.deepEqual(seen, []);
});

test("an arming deck emits nothing either, but tracks readiness internally", () => {
  const { media, deck, seen } = makeDeck();
  deck.role = "arming";
  media.readyState = 4;
  media.dispatch("canplay");
  assert.deepEqual(seen, []);
  assert.equal(deck.ready, true);
});

test("errors are always forwarded, including from a deck nobody can hear", () => {
  const { media, deck, seen } = makeDeck();
  media.error = { code: 4 };
  deck.role = "arming";
  media.dispatch("error");
  assert.deepEqual(seen, ["error"]);
});

test("arming the same source twice does not reload it", () => {
  const { media, deck } = makeDeck();
  deck.arm("http://noctra-audio.localhost/a.flac");
  const first = media.loads;
  deck.arm("http://noctra-audio.localhost/a.flac");
  assert.equal(media.loads, first);
  assert.equal(deck.role, "arming");
});

test("a different source does reload, and clears the ready flag", () => {
  const { media, deck } = makeDeck();
  deck.arm("http://noctra-audio.localhost/a.flac");
  media.readyState = 4;
  deck.arm("http://noctra-audio.localhost/b.flac");
  assert.equal(deck.ready, false);
  assert.equal(media.src, "http://noctra-audio.localhost/b.flac");
});

test("release returns the deck to silence and frees the stream", () => {
  const { media, deck } = makeDeck();
  deck.role = "fading-out";
  deck.ramp = 0.3;
  deck.release();
  assert.equal(deck.role, "idle");
  assert.equal(deck.ramp, 1);
  assert.equal(media.pauses, 1);
  assert.equal(media.src, "");
});

test("volume is user gain times the deck ramp, clamped, and mute survives the ramp", () => {
  const { media, deck } = makeDeck();
  deck.ramp = 0.5;
  deck.applyVolume(0.8, false);
  assert.equal(Number(media.volume.toFixed(3)), 0.4);
  deck.applyVolume(0.8, true);
  assert.equal(media.muted, true);
  deck.ramp = 2;
  deck.applyVolume(1, false);
  assert.equal(media.volume, 1);
});

test("startAtZero puts the deck at the top of the track and plays it", async () => {
  const { media, deck } = makeDeck();
  deck.role = "arming";
  media.currentTime = 40;
  await deck.startAtZero();
  assert.equal(media.currentTime, 0);
  assert.equal(media.plays, 1);
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module .../deck.ts`.

- [ ] **Step 3: Implement**

Create `src/services/audio/deck.ts`:

```ts
import type { EngineEvents } from "./engine";

export type DeckRole = "active" | "arming" | "fading-out" | "idle";

export type DeckEvent = keyof EngineEvents;

/** The subset of HTMLAudioElement this module uses, so tests can inject a fake. */
export interface MediaLike {
  src: string;
  preload: string;
  volume: number;
  muted: boolean;
  currentTime: number;
  readonly duration: number;
  readonly readyState: number;
  readonly error: { code: number } | null;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const EVENT_BY_MEDIA_TYPE: Record<string, DeckEvent> = {
  play: "playing",
  pause: "paused",
  ended: "ended",
  waiting: "waiting",
  canplay: "ready",
  error: "error",
  durationchange: "duration",
  loadedmetadata: "duration",
};

/**
 * One media element plus the role that decides whether anyone may hear about it.
 *
 * Only the authoritative deck forwards events. That single rule is what stops the two silent
 * failures in the spec: a standby deck feeding the position clock would double-count listening
 * time, and the outgoing deck's `ended` would advance the run a second time mid-fade.
 */
export class Deck {
  role: DeckRole = "idle";
  /** 0..1 fade multiplier. Never touches the element directly; use `applyVolume`. */
  ramp = 1;
  loadedSource: string | null = null;

  get authoritative(): boolean {
    return this.role === "active";
  }

  get ready(): boolean {
    return this.media.readyState >= 3;
  }

  get currentTime(): number {
    return this.media.currentTime;
  }

  get duration(): number {
    return Number.isFinite(this.media.duration) ? this.media.duration : 0;
  }

  private readonly media: MediaLike;

  constructor(
    private factory: () => MediaLike,
    private forward: (event: DeckEvent, payload?: unknown) => void,
  ) {
    this.media = factory();
    this.media.preload = "metadata";
    for (const [type, event] of Object.entries(EVENT_BY_MEDIA_TYPE)) {
      this.media.addEventListener(type, () => this.onMediaEvent(type, event));
    }
  }

  private onMediaEvent(type: string, event: DeckEvent) {
    // One gate, one rule: a deck nobody is listening to says nothing, except on error. Readiness
    // needs no tracking here - `ready` reads the element directly.
    if (!this.authoritative && event !== "error") return;
    if (event === "duration") {
      const d = this.duration;
      if (d > 0) this.forward("duration", d);
      return;
    }
    this.forward(event);
  }

  /** Load a source if it is not already the loaded one. Returns whether a load happened. */
  arm(url: string): boolean {
    if (this.loadedSource === url) return false;
    this.loadedSource = url;
    this.role = "arming";
    this.ramp = 1;
    this.media.preload = "auto";
    this.media.src = url;
    this.media.load();
    return true;
  }

  async startAtZero(): Promise<void> {
    this.media.currentTime = 0;
    await this.media.play();
  }

  pause(): void {
    this.media.pause();
  }

  /** `media` is private on purpose — the engine must not reach through the deck. */
  play(): Promise<void> {
    return this.media.play();
  }

  applyVolume(userVolume: number, muted: boolean): void {
    this.media.volume = Math.max(0, Math.min(1, userVolume * this.ramp));
    this.media.muted = muted;
  }

  release(): void {
    this.role = "idle";
    this.ramp = 1;
    this.loadedSource = null;
    this.media.pause();
    this.media.src = "";
    this.media.load();
  }
}
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: `pass 38`, `fail 0`.

Note: `Deck` imports `EngineEvents` from `./engine` as a **type-only** import, which Node's type stripper removes at runtime — so the test file never loads the engine. If you change it to a value import, the tests will start failing to resolve `./engine`.

- [ ] **Step 5: Type check**

Run: `npm run check`
Expected: `0 errors, 0 warnings`.

- [ ] **Step 6: Commit**

```bash
git add src/services/audio/deck.ts src/services/audio/deck.test.ts
git commit -m "feat: deck role state machine gating all non-authoritative events"
```

---

### Task 5: Rewrite `engine.ts` around two decks

**Files:**
- Modify: `src/services/audio/engine.ts` (whole file)

**Interfaces:**
- Consumes: `Deck` (Task 4), `decideHandoff`/`ARM_LEAD_SEC` (Task 3), `clampFadeSeconds`/`rampAt` (Task 2).
- Produces: `EngineEvents` **plus** `handoff: () => void`; `engine.prepare(source)`, `engine.crossfadeTo(seconds)`, `engine.cancelHandoff()`, `engine.resetAudio()`, `engine.isFading`, and unchanged `play/pause/seek/setVolume/setMuted/duration/bind/warmUpOutput/cancelWarmUp`.

- [ ] **Step 1: Re-read the file, then confirm nothing else changed it**

```bash
git status --short src/services/audio/engine.ts
```
Expected: no output. If the other session has touched it, stop and reconcile before proceeding.

- [ ] **Step 2: Preserve the parts that must not change**

Keep verbatim from the current file: `EngineEvents` (add `handoff`), `CLOCK_INTERVAL_MS = 66`, `inTauri`, `describeError`, `silenceUrl`, `warmUpOutput`, `cancelWarmUp`, and the rAF rationale comment at lines 224-231. These encode measured behaviour (the ~7 s device init, D-038) — do not "simplify" them.

- [ ] **Step 3: Add the deck fields and single forwarder**

```ts
import { Deck, type DeckEvent, type MediaLike } from "./deck";
import { clampFadeSeconds, rampAt } from "./fade";
import { decideHandoff } from "./handoff";

const RAMP_TICK_MS = 25;

class AudioEngine {
  private readonly decks: [Deck, Deck];
  private activeIndex = 0;
  private handlers: EngineEvents | null = null;
  private clock: ReturnType<typeof setInterval> | 0 = 0;
  private rampTimer: ReturnType<typeof setInterval> | 0 = 0;
  private fadeStartedAt = 0;
  private fadeSeconds = 0;
  private handoffInFlight = false;
  private userVolume = 1;
  private muted = false;
  private gapless = true;
  private crossfadeSec = 0;
  private pendingSource: string | null = null;
  private pendingError = "";

  private get active(): Deck { return this.decks[this.activeIndex]; }
  private get standby(): Deck { return this.decks[1 - this.activeIndex]; }

  constructor() {
    const make = (): MediaLike => new Audio() as unknown as MediaLike;
    const forward = (event: DeckEvent, payload?: unknown) => {
      const h = this.handlers;
      if (!h) return;
      if (event === "duration") (h.duration as (n: number) => void)(payload as number);
      else (h[event as keyof EngineEvents] as () => void)();
    };
    this.decks = [new Deck(make, forward), new Deck(make, forward)];
    this.decks[0].role = "active";
  }
```

Both `DeckEvent` and `MediaLike` are **type-only** imports, which is what lets `deck.test.ts` run without loading the engine — Node's type stripper removes them. The `forward` cast is deliberate: the store's `duration` handler is the only one taking an argument.

- [ ] **Step 4: Route `play` and `ensureLoaded` through the active deck**

`play(source)` becomes: `cancelWarmUp()`, then `this.active.arm(url)` (idempotent — a replay after pause does not reload), then `this.active.role = "active"`, then `await this.active.play()` inside the existing try/catch with the `NotAllowedError` message unchanged. **Do not reach for `deck.media` anywhere in the engine — it is private; the deck exposes `play`, `pause`, `arm`, `startAtZero`, `applyVolume` and `release`.** Replace the old `ensureLoaded` with the deck's own memo. `arm()` takes a URL, so call `localFileUrl(source)` at the call site exactly as `engine.ts:177` does today, and keep the `!inTauri` error branch unchanged.

- [ ] **Step 5: Implement `prepare`, `crossfadeTo`, `cancelHandoff`**

```ts
  /** Arm the standby deck for the next source. Does nothing when the feature is off (§9.3). */
  prepare(source: string): void {
    if (!this.gapless) return;
    this.pendingSource = source;
    this.pendingError = "";
    this.standby.arm(inTauri ? localFileUrl(source) : source);
  }

  crossfadeTo(seconds: number): void {
    this.crossfadeSec = Math.max(0, seconds);
  }

  cancelHandoff(): void {
    this.pendingSource = null;
    this.pendingError = "";
    // stopRamp resets both ramps to 1, so nothing is left sitting at reduced gain.
    this.stopRamp();
    // After a flip the incoming deck is already `active`, and the outgoing one is whatever still
    // holds `fading-out`. Releasing it is the whole of "cancel a fade in progress" — and no second
    // `handoff()` is emitted here, because the store already advanced at the flip.
    const fadingOut = this.decks.find((d) => d.role === "fading-out");
    if (fadingOut) fadingOut.release();
    else if (this.standby.role !== "idle") this.standby.release();
  }
```

- [ ] **Step 6: Evaluate the handoff on every tick**

In `startClock()`, the interval body becomes:

```ts
    this.clock = setInterval(() => {
      this.handlers?.position(this.active.currentTime);
      this.evaluateHandoff();
    }, CLOCK_INTERVAL_MS);
```

```ts
  private evaluateHandoff(): void {
    // `beginHandoff` awaits `startAtZero`, so without this latch the next 66 ms tick can decide
    // "begin-fade" a second time and flip both decks twice.
    if (this.handoffInFlight) return;
    const action = decideHandoff({
      gapless: this.gapless,
      fadeSeconds: clampFadeSeconds(this.crossfadeSec, this.active.duration),
      position: this.active.currentTime,
      duration: this.active.duration,
      hasNext: this.pendingSource !== null,
      armed: this.standby.loadedSource !== null,
      standbyReady: this.standby.ready,
      fading: this.rampTimer !== 0,
    });
    if (action.kind === "begin-fade") this.beginHandoff(action.fade);
    else if (action.kind === "begin-butt-joint") this.beginHandoff(0);
    else if (action.kind === "abort-fade") this.cancelHandoff();
    // "arm" is deliberately unhandled here: the engine never chooses a track. Arming is the
    // store's decision (Task 6 step 4), because only the store knows what comes next.
  }
```

- [ ] **Step 7: Implement the flip and the ramp loop**

```ts
  private async beginHandoff(fade: number): Promise<void> {
    const outgoing = this.active;
    const incoming = this.standby;
    this.handoffInFlight = true;
    try {
      try {
        await incoming.startAtZero();
      } catch {
        return this.cancelHandoff();
      }

      // Order matters: duration before position keeps position <= duration at every observable
      // instant, which SMTC and the progress bar both rely on (spec §5.1).
      outgoing.role = "fading-out";
      incoming.role = "active";
      this.activeIndex = this.decks.indexOf(incoming);
      this.handlers?.duration(incoming.duration);
      this.handlers?.position(0);
      this.handlers?.playing();
      this.handlers?.handoff();
      this.pendingSource = null;

      if (fade <= 0) {
        outgoing.release();
        return;
      }
      this.fadeSeconds = fade;
      this.fadeStartedAt = performance.now();
      this.startRamp();
    } finally {
      this.handoffInFlight = false;
    }
  }

  private startRamp(): void {
    if (this.rampTimer) return;
    this.rampTimer = setInterval(() => this.tickRamp(), RAMP_TICK_MS);
  }

  private tickRamp(): void {
    const { out, in: gain } = rampAt(
      (performance.now() - this.fadeStartedAt) / 1000,
      this.fadeSeconds,
    );
    this.active.ramp = gain;
    const outgoing = this.decks.find((d) => d.role === "fading-out");
    if (outgoing) outgoing.ramp = out;
    this.applyDeckVolumes();
    if (out <= 0) {
      this.stopRamp();
      outgoing?.release();
    }
  }

  private stopRamp(): void {
    if (this.rampTimer) clearInterval(this.rampTimer);
    this.rampTimer = 0;
    for (const d of this.decks) d.ramp = 1;
    this.applyDeckVolumes();
  }
```

- [ ] **Step 8: One volume formula, and pause/seek semantics**

```ts
  private applyDeckVolumes(): void {
    for (const d of this.decks) d.applyVolume(this.userVolume, this.muted);
  }

  setVolume(v: number) { this.userVolume = Math.max(0, Math.min(1, v)); this.applyDeckVolumes(); }
  setMuted(m: boolean) { this.muted = m; this.applyDeckVolumes(); }
```

`pause()` must freeze the ramp loop rather than let it run against paused decks (spec §8):

```ts
  pause() {
    this.active.pause();
    if (this.rampTimer) { clearInterval(this.rampTimer); this.rampTimer = 0; }
    for (const d of this.decks) if (d.role === "fading-out") d.pause();
  }
```

Resume continues the ramp from the frozen multipliers rather than restarting it: in `play()`, after the active deck is playing, if any deck still has role `fading-out`, set
`this.fadeStartedAt = performance.now() - (1 - this.active.ramp) * this.fadeSeconds * 1000` and call `startRamp()`.

`seek()` calls `this.cancelHandoff()` first, then keeps its existing clamp and seeks the active deck (spec §8).

Wrap the body of `tickRamp()` in `try` / `catch` that calls `this.cancelHandoff()` on failure. That is spec §7's last row: if the ramp itself throws, hard-adopt the incoming deck so one deck is always audible, rather than leaving both at reduced gain.

- [ ] **Step 9: `resetAudio`, gapless setter, and `isFading`**

```ts
  get isFading(): boolean { return this.rampTimer !== 0; }
  setGapless(on: boolean): void { this.gapless = on; if (!on) this.cancelHandoff(); }
```

`resetAudio()` releases both decks, replaces deck 0 with a fresh `Deck` at role `active`, restores position by seeking it, and re-emits `duration`/`position`. It is the escape hatch Phase 9's graph also needs.

- [ ] **Step 10: Verify the off-path guarantee**

Run: `npm test && npm run check`
Expected: all tests pass; `0 errors, 0 warnings`.

Then start the app (`npm run tauri dev`) and run, against the main window:

```bash
node scripts/cdp-eval.mjs "(() => { const e = window.__noctra.engine; return { roles: e.decks.map(d => d.role), sources: e.decks.map(d => d.loadedSource) }; })()"
```

Expected with defaults (`gapless: true, crossfadeSec: 0`): exactly one non-null `loadedSource` early in a track. With `gapless` set to `false` in Settings: **only ever one non-null source, at any point in the track** — that is acceptance gate 10.

- [ ] **Step 11: Commit**

```bash
git add src/services/audio/engine.ts src/services/audio/handoff.ts src/services/audio/handoff.test.ts src/services/audio/deck.ts
git commit -m "feat: two-deck engine with gated events, ramp loop and single volume formula"
```

---

### Task 6: Store integration

**Files:**
- Modify: `src/stores/settings.svelte.ts`
- Modify: `src/stores/player.svelte.ts`

**Interfaces:**
- Consumes: `engine.prepare`, `engine.crossfadeTo`, `engine.cancelHandoff`, `engine.setGapless`, `EngineEvents.handoff`, `settings.value.gapless`, `settings.value.crossfadeSec`.
- Produces: `player.advanceToNext(reason)`, `player.peekNext()`.

- [ ] **Step 1: Add the two settings keys**

In `DEFAULTS` add `gapless: true,` and `crossfadeSec: 0,` with the type entries. In `sanitize()` add, next to the existing numeric clamps:

```ts
    gapless: typeof v.gapless === "boolean" ? v.gapless : DEFAULTS.gapless,
    // Crossfade is a taste axis with no contrast cliff, so unlike the deleted blur/dim sliders
    // (D-061) this one is defensible: every value is plainly audible. Keep this note if you
    // change the range - spec §9.2.
    crossfadeSec: clampNumber(v.crossfadeSec, 0, 12, DEFAULTS.crossfadeSec),
```

Use whatever clamp helper the file already uses for `lyricsOffset`; if it inlines `Math.max/Math.min`, match that style rather than adding a helper.

- [ ] **Step 2: Extract `advanceToNext`**

Move the body of `handleEnded` (`player.svelte.ts:424-453`) into `advanceToNext(reason: "ended" | "handoff")`, keeping every branch and comment intact. `handleEnded` becomes `this.advanceToNext("ended")`. Add `history.recordStart(this.current.id)` inside it if it is not already covered by `play()` — check `play()` at `:460-467` first and do not double-record.

- [ ] **Step 3: Add `peekNext`**

```ts
  /** What would play next, without consuming it. Arming a deck must not advance the run. */
  peekNext(): number | null {
    // Same queue-then-order resolution as stepBy, but read-only.
    if (this.queue.length > 0) {
      const at = this.tracks.findIndex((t) => t.id === this.queue[0]);
      return at === -1 ? this.stepByPeek(1) : at;
    }
    return this.stepByPeek(1);
  }
```

Implement `stepByPeek(delta)` as a copy of `stepBy` with every mutation removed. Do **not** refactor `stepBy` to call it in this task — one change per task.

- [ ] **Step 4: Arm, hand off, and wire the matrix**

In the constructor's `engine.bind({...})` add:

```ts
      handoff: () => this.advanceToNext("handoff"),
```

In the `position` handler, after `this.position = s`, add the arm decision — the store owns "what's next", the engine only owns sound:

```ts
        if (settings.value.gapless) {
          const remaining = this.duration - this.position;
          const lead = settings.value.crossfadeSec + 6;
          if (remaining <= lead && !this.armedNext) {
            const at = this.peekNext();
            if (at !== null) {
              this.armedNext = at;
              engine.prepare(this.tracks[at].source);
            }
          }
        }
```

Add `private armedNext: number | null = null;` to the class, and reset it to `null` in `advanceToNext`, `moveTo`, `playFrom` and `select`. Add `engine.crossfadeTo(settings.value.crossfadeSec)` and `engine.setGapless(settings.value.gapless)` to `settings.apply()`'s call path or a `$effect` in the store, and `engine.cancelHandoff()` at the top of `next()`, `previous()`, `moveTo()`, `playFrom()`, `select()` and `seek()`. That `$effect` must call `engine.cancelHandoff()` **before** re-applying the two setters — changing either value invalidates an already-armed deck, and an armed deck holding the old next-track is how spec §8's "Settings changed" row goes wrong. Reset `this.armedNext = null` in the same `$effect`. In `handleEnded`'s `repeat === "one"` and `stopAfterCurrent` branches, call `engine.cancelHandoff()` before the existing logic (spec §8).

- [ ] **Step 5: Manual matrix — the gates that cannot be unit-tested**

With the app running, verify each and record the result in `PROGRESS.md`:

- [ ] Gate 2 — two tracks with a 6 s fade: `localStorage["noctra.history"]` seconds ≈ audible seconds, not doubled
- [ ] Gate 3 — 10 automatic handoffs: 10 tracks play, in order, queue consumed once each
- [ ] Gate 6 — pause mid-fade: both decks freeze, resume continues, no jump
- [ ] Gate 7 — seek mid-fade: incoming deck adopted, no double audio
- [ ] Gate 8 — manual next mid-fade: no crossfade, no lost track
- [ ] Gate 9 — sleep stop-after-current mid-fade: stops at the true end
- [ ] Gate 12 — across a handoff, Windows media controls show the new title with `position <= duration`, and the mini window updates within 250 ms

- [ ] **Step 6: Commit**

```bash
git add src/stores/settings.svelte.ts src/stores/player.svelte.ts
git commit -m "feat: player store arms the standby deck and advances on handoff"
```

---

### Task 7: Audio-level verification

**Files:**
- Create: `scripts/handoff-probe.mjs` (throwaway, not shipped in `src/`)

- [ ] **Step 1: State-level silence check (gate 1a)**

Using `scripts/cdp-eval.mjs`, sample `player.isBuffering` and `player.position` at 20 ms across a boundary with `crossfadeSec: 0`. Expected: `isBuffering` never flips true, position advances monotonically, no stall over 66 ms.

- [ ] **Step 2: Analyser tap (gate 1b) — test-only**

Attach `createMediaElementSource` to the active deck with an `AnalyserNode`, log RMS at 25 ms across the boundary, and require no near-zero window. **This tap is permanent per element, so it changes the path it measures — it exists only in this script and must never be added to `src/`.** Also do one human listen across three consecutive album tracks.

- [ ] **Step 3: Two-stream protocol check (gate 11)**

Set the outgoing track to a FLAC with an empty PICTURE MIME (the BUG-008 patch path) and a 6 s fade. Confirm both `noctra-audio://` streams are served and the patched file plays through its own handoff. Watch `audio_protocol.rs`'s per-path plan map for interference.

- [ ] **Step 4: Fallback check (gate 5)**

Delete the armed next file during the lead window. Expected: the current track plays to its true end and advances normally. No silence.

- [ ] **Step 5: Commit the probe and record results**

```bash
git add scripts/handoff-probe.mjs PROGRESS.md
git commit -m "test: measured handoff gates for the two-deck engine"
```

---

### Task 8: Settings controls, and the docs

`src/views/Settings.svelte` is in the other session's live wave. This task is last and isolated for that reason.

- [ ] **Step 1: Re-read and check for in-flight edits**

```bash
git status --short src/views/Settings.svelte
```
If it is modified, stop and coordinate — do not overwrite another session's work.

- [ ] **Step 2: Add both controls in the Playback section**

Follow the existing row idiom (`label` + `.hint` + control, `Settings.svelte:368`), as a `role="switch"` toggle and a native range, matching `:100-110` and `:196` exactly. Copy for the toggle is `Gapless playback` / hint `Start the next track without a gap.` The slider is `Crossfade` / `0-12` / step `0.5` with a `{player crossfade}s` readout in `--accent-text`, and its hint must say it is seamless, not sample-accurate.

- [ ] **Step 3: Verify**

Run: `npm run check && npm test`
Expected: `0 errors, 0 warnings`; all tests pass. Then confirm both controls round-trip through `localStorage["noctra.settings"]` and that writing garbage into that key yields clamped values after reload.

- [ ] **Step 4: Record the phase in the process docs**

`PROGRESS.md` gets a Phase 8 entry with the measured gate results and the D-061 justification. `BUGS.md` gets an entry for any gate that failed and was fixed.

- [ ] **Step 5: Commit**

```bash
git add src/views/Settings.svelte PROGRESS.md BUGS.md
git commit -m "feat: gapless and crossfade controls in Settings, with phase results recorded"
```

---

## Out of scope

ReplayGain (Phase 7), the EQ graph (Phase 9), per-album crossfade opt-out, waveform seeking, and any change to the Rust protocol handler — including the unbounded plan cache noted in `§11`, which is pre-existing.
