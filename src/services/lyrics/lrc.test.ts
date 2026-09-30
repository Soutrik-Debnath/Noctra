import { test } from "node:test";
import assert from "node:assert/strict";
import { activeLine, isInstrumental, lineDistance, type Line } from "./lrc.ts";

const line = (time: number, text = "x"): Line => ({ time, text, words: null, end: null });

// "Jeena Jeena" as LRCLIB actually delivers it: a 27-second instrumental intro before line 0.
// Captured live off the running app at position 5.15s, which is where the defect was spotted.
const LONG_INTRO = [line(27080), line(36260), line(44050), line(49030)];

test("activeLine reports no sung line before the first timestamp", () => {
  assert.equal(activeLine(LONG_INTRO, 0), -1);
  assert.equal(activeLine(LONG_INTRO, 5153), -1);
  assert.equal(activeLine(LONG_INTRO, 27079), -1);
  assert.equal(activeLine(LONG_INTRO, 27080), 0);
});

test("nothing is at distance zero while no line is being sung", () => {
  // The whole defect: the depth ramp collapsed "no sung line" onto line 0, so line 0 took the d === 0
  // branch and was rendered with the sung line's full opacity, focus, glow and (on the card) size for
  // the entire intro. Every line has to be *off* the ramp while index is -1, not one of them on it.
  for (let i = 0; i < 8; i++) assert.equal(lineDistance(-1, i), null);
});

test("distance is measured from the sung line, either side", () => {
  assert.equal(lineDistance(0, 0), 0);
  assert.equal(lineDistance(0, 3), 3);
  assert.equal(lineDistance(7, 3), 4);
  assert.equal(lineDistance(7, 11), 4);
});

test("the ramp engages on the first timestamp, not before it", () => {
  // The boundary the two functions share: the instant activeLine finds a line, that line becomes the
  // anchor. A ramp that anchors earlier is the bug again; one that anchors later blanks the column.
  const before = activeLine(LONG_INTRO, 27079);
  const at = activeLine(LONG_INTRO, 27080);
  assert.equal(lineDistance(before, 0), null);
  assert.equal(lineDistance(at, 0), 0);
  assert.equal(lineDistance(at, 1), 1);
});

test("an empty lyric list is not the same as an intro", () => {
  assert.equal(activeLine([], 5000), -1);
  assert.equal(lineDistance(-1, 0), null);
});

test("a bare note glyph is an instrumental break, not a lyric", () => {
  // Straight out of the live library: "I WANNA BE YOUR SLAVE" carries U+266A in the timed slots at
  // 95740 ms and 153190 ms, and nothing else on those lines.
  assert.equal(isInstrumental("♪"), true);
  assert.equal(isInstrumental("♫"), true);
  assert.equal(isInstrumental("♪ "), true);
  assert.equal(isInstrumental("🎵"), true);
});

test("an empty line counts as a break", () => {
  assert.equal(isInstrumental(""), true);
  assert.equal(isInstrumental("   "), true);
  assert.equal(isInstrumental("\t"), true);
  assert.equal(isInstrumental(null as unknown as string), true);
  assert.equal(isInstrumental(undefined), true);
});

test("words are never mistaken for a break", () => {
  // The boundary that matters: a detector aimed at instrumental markers must not swallow a real line
  // that happens to carry a note among its words, or the karaoke disappears mid-song.
  assert.equal(isInstrumental("♪ Sing it now"), false);
  assert.equal(isInstrumental("Na na na ♫"), false);
  assert.equal(isInstrumental("I cannot vanish, you will not scare me"), false);
  assert.equal(isInstrumental("."), false);
  assert.equal(isInstrumental("0"), false);
});
