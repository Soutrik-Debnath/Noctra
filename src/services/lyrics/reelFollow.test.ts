import { test } from "node:test";
import assert from "node:assert/strict";
import { createReelFollow, HOLD_BAND } from "./reelFollow.ts";

/**
 * The hold band in px for a given viewport.
 *
 * The band tests used to hard-code `0.3 * view` as literal pixel drifts, which meant retuning the
 * constant read as four broken invariants rather than one deliberate change. Deriving the drifts from
 * the exported band keeps each test asserting what it names — hold inside, glide outside, re-attach
 * without yanking — whatever the number is.
 */
const band = (view: number) => view * HOLD_BAND;

/*
   The follow is written against rAF and the two "be still" queries, none of which exist here. A
   hand-cranked clock stands in for all three so a test can state exactly how much time passed
   between frames — which is the whole point, since the smoothing is defined per unit of time and
   not per frame.

   node's test runner gives each file its own process, so installing these on globalThis cannot
   leak into the audio tests.
*/
type Frame = (now: number) => void;

let nextId = 1;
const pending = new Map<number, Frame>();
const timers = new Map<number, { at: number; cb: () => void }>();
let clockNow = 0;
let reducedMotion = false;
let lowPower = false;

(globalThis as Record<string, unknown>).requestAnimationFrame = (cb: Frame) => {
  const id = nextId++;
  pending.set(id, cb);
  return id;
};
(globalThis as Record<string, unknown>).cancelAnimationFrame = (id: number) => {
  pending.delete(id);
};
// The resume-after-browsing contract is a wall-clock timer, not a frame count — a pinned reel is at
// its target, which lets the loop park itself, and a parked loop would never notice a frame budget
// expiring. So the fake clock has to own setTimeout too, or the behaviour it guards is untestable.
(globalThis as Record<string, unknown>).setTimeout = (cb: () => void, ms: number) => {
  const id = nextId++;
  timers.set(id, { at: clockNow + (ms || 0), cb });
  return id;
};
(globalThis as Record<string, unknown>).clearTimeout = (id: number) => {
  timers.delete(id);
};
(globalThis as Record<string, unknown>).matchMedia = (q: string) => ({
  matches: q.includes("reduced-motion") && reducedMotion,
});
(globalThis as Record<string, unknown>).document = {
  documentElement: { hasAttribute: (n: string) => n === "data-low-power" && lowPower },
};

/** Run every frame queued for this tick, at `t` ms on the fake clock, then any timer due by then. */
function tick(t: number) {
  clockNow = t;
  const batch = [...pending.values()];
  pending.clear();
  for (const cb of batch) cb(t);
  for (const [id, timer] of [...timers]) {
    if (timer.at <= t) {
      timers.delete(id);
      timer.cb();
    }
  }
}

/**
 * Drives a follow whose target the test can move at will, and records every value it painted.
 * `seen` is the evidence: the reel's whole job is *how* it gets there, so the intermediates are the
 * thing under test, not just the final number.
 */
function rig(initial: number | null) {
  // A follow that never reaches its park condition leaves a frame queued, so the clock is wiped
  // here rather than trusted to be empty: `pending.size` is the assertion in the parking tests, and
  // it has to be counting this test's frames only.
  pending.clear();
  let target = initial;
  const seen: number[] = [];
  const follow = createReelFollow(
    () => target,
    (y) => seen.push(y),
  );
  return {
    follow,
    seen,
    set(v: number | null) {
      target = v;
    },
    get last() {
      return seen[seen.length - 1];
    },
  };
}

test("the first thing it measures is landed on, not travelled to", () => {
  const r = rig(120);
  r.follow.poke();
  tick(0);
  assert.equal(r.last, 120);
});

test("a new target is closed by a fraction of the distance, not all of it", () => {
  const r = rig(0);
  r.follow.poke();
  tick(0);
  r.set(100);
  tick(16.7);
  assert.ok(r.last > 1, `one frame should make visible progress, got ${r.last}`);
  assert.ok(r.last < 60, `one frame should not arrive, got ${r.last}`);
});

test("it approaches monotonically and never overshoots", () => {
  const r = rig(0);
  r.follow.poke();
  tick(0);
  r.set(100);
  let prev = 0;
  for (let i = 1; i <= 60; i++) {
    tick(i * 16.7);
    const y = r.last;
    assert.ok(y >= prev, `frame ${i} went backwards: ${prev} -> ${y}`);
    assert.ok(y <= 100, `frame ${i} overshot to ${y}`);
    prev = y;
  }
  assert.equal(r.last, 100);
});

test("a target that keeps moving is chased, frame by frame", () => {
  const r = rig(0);
  r.follow.poke();
  tick(0);
  // The column is still growing under the reel for ~460ms after a line change; this is that case.
  for (let i = 1; i <= 20; i++) {
    r.set(i * 5);
    tick(i * 16.7);
    assert.ok(r.last <= i * 5, `frame ${i} overshot the moving target`);
  }
});

test("it parks itself once it has arrived and the layout has stopped moving", () => {
  const r = rig(0);
  r.follow.poke();
  tick(0);
  r.set(80);
  for (let i = 1; i <= 120 && pending.size > 0; i++) tick(i * 16.7);
  assert.equal(pending.size, 0, "the loop should have stopped requesting frames");
  assert.equal(r.last, 80);
});

test("jump() lands on the next measurable frame instead of travelling", () => {
  const r = rig(0);
  r.follow.poke();
  tick(0);
  r.set(500);
  r.follow.jump();
  tick(16.7);
  assert.equal(r.last, 500);
});

test("a jump armed while there is nothing to measure still lands when the column arrives", () => {
  // A track change: the reel is told to land before the new song's lines exist. The arm has to
  // survive, or the new column would be travelled to from wherever the old one left the reel.
  const r = rig(null);
  r.follow.poke();
  tick(0);
  r.follow.jump();
  tick(16.7);
  assert.equal(r.seen.length, 0, "nothing was measurable, so nothing should have been painted");
  r.set(-240);
  tick(33.4);
  assert.equal(r.last, -240);
});

test("a column that never becomes measurable parks the loop instead of spinning at 60Hz", () => {
  // Untimed lyrics have no sung line to follow. The loop must give up rather than measure the DOM
  // forever for the length of the song.
  const r = rig(null);
  r.follow.poke();
  for (let i = 1; i <= 40; i++) tick(i * 16.7);
  assert.equal(pending.size, 0);
  assert.equal(r.seen.length, 0);
});

test("poke() restarts a loop that had parked", () => {
  const r = rig(null);
  r.follow.poke();
  for (let i = 1; i <= 40; i++) tick(i * 16.7);
  assert.equal(pending.size, 0);
  r.set(10);
  r.follow.poke();
  tick(50);
  assert.equal(r.last, 10);
});

test("destroy() stops the loop", () => {
  const r = rig(0);
  r.follow.poke();
  r.follow.destroy();
  assert.equal(pending.size, 0);
});

test("reduced motion lands on the target rather than easing into it", () => {
  reducedMotion = true;
  try {
    const r = rig(0);
    r.follow.poke();
    tick(0);
    r.set(100);
    tick(16.7);
    assert.equal(r.last, 100);
  } finally {
    reducedMotion = false;
  }
});

test("low power does the same", () => {
  lowPower = true;
  try {
    const r = rig(0);
    r.follow.poke();
    tick(0);
    r.set(100);
    tick(16.7);
    assert.equal(r.last, 100);
  } finally {
    lowPower = false;
  }
});

test("a long gap between frames does not teleport the reel", () => {
  // A backgrounded window returning after seconds hands rAF one huge delta. Clamped, so the reel
  // still eases in instead of arriving whole in a single frame.
  const r = rig(0);
  r.follow.poke();
  tick(0);
  r.set(100);
  tick(9000);
  assert.ok(r.last > 0, "the clamped frame should still make progress");
  assert.ok(r.last < 50, `a 9s frame should be clamped, got ${r.last}`);
});

/*
   Manual browsing. The wheel is the only way to read a line you have already passed, and both lyric
   surfaces are `overflow: hidden` on purpose — the mask fade and the pinned active line depend on it —
   so there is no native scroller for the wheel to act on. The reel therefore needs a user term of its
   own, and it has to survive the playhead rather than fight it.

   `travel` and `view` are the reel's own geometry: how far it can move, and how tall the window is.
   The sign convention is the reel's — `measure()` returns [-travel, 0], so scrolling back to read an
   earlier line is a POSITIVE delta.
*/
function scrollRig(opts: { base: number; travel?: number; view?: number }) {
  pending.clear();
  let base = opts.base;
  const travel = opts.travel ?? 2000;
  const view = opts.view ?? 400;
  const seen: number[] = [];
  const follow = createReelFollow(
    () => base,
    (y) => seen.push(y),
    () => ({ travel, view }),
  );
  return {
    follow,
    seen,
    setBase(v: number) {
      base = v;
    },
    get last() {
      return seen[seen.length - 1];
    },
  };
}

test("a wheel scroll moves the column on the frame it arrives, not eased", () => {
  // Direct manipulation. The smoothing exists to hide the playhead re-measuring a column that is
  // still changing height; applying it to the reader's own wheel makes the text feel rubbery.
  const r = scrollRig({ base: -400 });
  r.follow.poke();
  tick(0);
  assert.equal(r.last, -400);
  r.follow.scroll(-250);
  tick(16);
  assert.equal(r.last, -650);
});

test("the playhead cannot drag a column the reader is holding", () => {
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  r.follow.scroll(-900);
  tick(16);
  assert.equal(r.last, -1300);
  r.setBase(-900);
  for (let t = 32; t < 400; t += 16) tick(t);
  assert.equal(r.last, -1300);
});

test("a browsed column is clamped to the ends of the reel", () => {
  const r = scrollRig({ base: -400, travel: 2000 });
  r.follow.poke();
  tick(0);
  r.follow.scroll(-99999);
  tick(16);
  assert.equal(r.last, -2000, "cannot scroll past the last line");
  r.follow.scroll(+99999);
  tick(32);
  assert.equal(r.last, 0, "cannot scroll past the first line");
});

test("a small scroll does not snap straight back to the sung line", () => {
  // Without this the feature would be unusable: the reader nudges 50px and the follow recentres.
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  r.follow.scroll(-50);
  for (let t = 16; t < 600; t += 16) tick(t);
  assert.equal(r.last, -450);
});

test("when the sung line comes back into view the reel stops being pinned", () => {
  // Scrolled far enough that the active line is off screen, then the playhead catches up to the
  // reader. Control returns, but under the hold band returning is not the same as moving.
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  r.follow.scroll(-900);
  tick(16);
  r.setBase(-1300 + Math.round(band(400) * 0.5));
  for (let t = 32; t < 1500; t += 16) tick(t);
  assert.equal(r.last, -1300, 're-attached without yanking');
  // Prove it really is attached again: a breach of the band now moves it, where pinned it would not.
  r.setBase(-1900);
  r.follow.poke();
  for (let t = 1516; t < 3000; t += 16) tick(t);
  assert.equal(r.last, -1900);
});

test("jump() drops the browse offset, so a seek or a new song re-attaches", () => {
  const r = scrollRig({ base: -400 });
  r.follow.poke();
  tick(0);
  r.follow.scroll(-900);
  tick(16);
  r.setBase(-500);
  r.follow.jump();
  tick(16);
  assert.equal(r.last, -500);
});

/*
   "Only move when it must."

   Centring the active line on every change means the column is never still: it drifts a few pixels
   every few seconds for the whole song, which is the restless motion the owner asked to lose. The reel
   should hold its position while the sung line is still comfortably readable, and glide only once the
   line has drifted far enough that it genuinely has to.

   The band is a fraction of the viewport, so the same rule gives ~7 lines of slack in the 927px
   fullscreen column and ~3 in the 288px card.
*/
test("the column holds while the sung line is still comfortably in view", () => {
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  assert.equal(r.last, -400);
  r.setBase(-400 - Math.round(band(400) * 0.5)); // half the band: still comfortably in view
  for (let t = 16; t < 900; t += 16) tick(t);
  assert.equal(r.last, -400, "must not chase a line that is already readable");
});

test("it glides only once the line has drifted out of the band", () => {
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  const want = -400 - Math.round(band(400) * 2); // twice the band: it genuinely has to move
  r.setBase(want);
  for (let t = 16; t < 1500; t += 16) tick(t);
  assert.equal(r.last, want);
});

test("a jump re-centres even when the line is inside the band", () => {
  // A new song or a seek is not drift — the reader asked to be somewhere, so land on the line.
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  const want = -400 - Math.round(band(400) * 0.5);
  r.setBase(want);
  for (let t = 16; t < 600; t += 16) tick(t);
  assert.equal(r.last, -400, "the hold should have kept it put");
  r.follow.jump();
  tick(16);
  assert.equal(r.last, want);
});

test("handing control back does not yank the column to centre", () => {
  // Consistent with the hold: resuming the follow must not itself be an unrequested move.
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  r.follow.scroll(-900);
  tick(16);
  r.setBase(-1300 + Math.round(band(400) * 0.5)); // inside the band -> re-attaches without moving
  for (let t = 32; t < 900; t += 16) tick(t);
  assert.equal(r.last, -1300, "stays where the reader left it");
  r.setBase(-2000); // now it genuinely has to move
  r.follow.poke();   // what the surfaces do on a line change; a held loop has parked itself
  for (let t = 916; t < 2400; t += 16) tick(t);
  assert.ok(r.last !== -1300, "following has resumed");
});

test("a small scroll hands control back once the reader stops, instead of pinning forever", () => {
  // The regression: `wasOutside` only latches past half a viewport, so a modest scroll never tripped
  // it and the release branch could not fire. The column stayed pinned for the rest of the song.
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  r.follow.scroll(-100); // 100px, well inside view/2 = 200 -> wasOutside stays false
  for (let t = 16; t < 3000; t += 16) tick(t);
  assert.equal(r.last, -500, "holds where the reader put it");
  for (let t = 3016; t < 5400; t += 16) tick(t); // the 4s clock expires at 4000
  assert.equal(r.last, -400, "returns to the sung line and resumes following");
});

test("each further scroll restarts the hold, so nobody is pulled away mid-gesture", () => {
  const r = scrollRig({ base: -400, view: 400 });
  r.follow.poke();
  tick(0);
  r.follow.scroll(-100);
  for (let t = 16; t < 3000; t += 16) tick(t);
  r.follow.scroll(-60); // new deadline at 7000, not 4000
  for (let t = 3016; t < 5000; t += 16) tick(t);
  assert.equal(r.last, -560, "still the reader's, past the original clock");
  for (let t = 5016; t < 8600; t += 16) tick(t);
  assert.equal(r.last, -400, "hands back four seconds after the last gesture");
});
