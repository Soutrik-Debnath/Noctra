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
