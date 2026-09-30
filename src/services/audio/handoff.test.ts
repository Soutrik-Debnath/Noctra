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

test("the default shipped configuration still arms with no crossfade - spec §9.1", () => {
  assert.deepEqual(decideHandoff(at(195, { fadeSeconds: 0 })), { kind: "arm" });
});

test("a butt joint is not armed after its own gate has passed", () => {
  assert.deepEqual(decideHandoff(at(199.99, { fadeSeconds: 0 })), { kind: "none" });
});

test("a broken clock position falls through to ended rather than starting a fade", () => {
  assert.deepEqual(
    decideHandoff(at(Number.NaN, { armed: true, standbyReady: true })),
    { kind: "none" },
  );
});
