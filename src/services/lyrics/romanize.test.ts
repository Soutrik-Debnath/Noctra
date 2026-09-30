import { test } from "node:test";
import assert from "node:assert/strict";
import { needsRomanisation, romanise } from "./romanize.ts";

const INDIC = /[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF]/;

/**
 * Every letter below exists as two independent Unicode spellings that render identically: the
 * precomposed codepoint (ज़ as U+095B) and the base letter plus a combining dot (ज U+091C + U+093C).
 * They are *not* canonical equivalents, so `normalize("NFC")` and `normalize("NFD")` convert neither
 * way and no normalisation pass will ever reconcile them. A table key typed on the wrong side is a
 * dead entry — a two-codepoint string in a table looked up one codepoint at a time — and it fails
 * silently. Real files in this library contain both spellings, so both are pinned here by codepoint.
 */
const BOTH_SPELLINGS: [label: string, composed: string, decomposed: string][] = [
  ["dev QA", "\u0958", "\u0915\u093C"],
  ["dev KHHA", "\u0959", "\u0916\u093C"],
  ["dev GHHA", "\u095A", "\u0917\u093C"],
  ["dev ZA", "\u095B", "\u091C\u093C"],
  ["dev DDDHA", "\u095C", "\u0921\u093C"],
  ["dev RHA", "\u095D", "\u0922\u093C"],
  ["dev FAA", "\u095E", "\u092B\u093C"],
  ["beng RRA", "\u09DC", "\u09A1\u09BC"],
  ["beng YYA", "\u09DF", "\u09AF\u09BC"],
  ["gur SHA", "\u0A36", "\u0A38\u0A3C"],
  ["gur LLA", "\u0A33", "\u0A32\u0A3C"],
  ["gur ZA", "\u0A5B", "\u0A1C\u0A3C"],
  ["gur FAA", "\u0A5E", "\u0A2B\u0A3C"],
];

for (const [label, composed, decomposed] of BOTH_SPELLINGS) {
  test(`${label} romanises from either spelling`, () => {
    const fromComposed = romanise(composed);
    const fromDecomposed = romanise(decomposed);
    assert.doesNotMatch(fromComposed, INDIC, `spelled composed, "${label}" leaked through as "${fromComposed}"`);
    assert.doesNotMatch(fromDecomposed, INDIC, `spelled with a combining dot, "${label}" leaked through as "${fromDecomposed}"`);
    assert.equal(fromComposed, fromDecomposed, `${label}: the two spellings must not read differently`);
  });
}

/**
 * Four lines from the cached corpus, each with its nukta letter written as an escape so the test is
 * pinned to the composed spelling the files actually use. Every one of them leaked script before the
 * tables were corrected.
 */
const ZA = "\u095B";
const FAA = "\u095E";
const NUKTA_LINES = [
  `तेरे नाम पे मेरी ${ZA}िन्दगी लिख दी, मेरे हमदम`,
  `दहली${ZA} पे मेरे दिल की जो रखे हैं तूने कदम`,
  `सच्ची सी हैं ये तारी${FAA}ें, दिल से जो मैंने करी हैं`,
  // The dot filed after the halant: ख U+0916, halant U+094D, nukta U+093C.
  "मैं परेशां परेशां, \u0916\u094D\u093Cवाहिशों का समां",
];

for (const line of NUKTA_LINES) {
  test(`a nukta line romanises with no script left in it: ${line.slice(0, 12)}`, () => {
    const out = romanise(line);
    assert.doesNotMatch(out, INDIC, `left "${[...(out.match(INDIC) ?? [])].join(" ")}" in ${out}`);
  });
}

test("the dot may be filed outside the halant it belongs inside", () => {
  // "ख़्वाहिश" puts the nukta *after* the halant even though it modifies the consonant: U+0916 U+094D
  // U+093C. The reading must match the ordinary ख U+093C U+094D order.
  assert.equal(romanise("\u0916\u094D\u093C\u0935\u093E\u0939\u093F\u0936"), romanise("\u0916\u093C\u094D\u0935\u093E\u0939\u093F\u0936"));
  assert.equal(romanise("\u0916\u094D\u093C\u0935\u093E\u0939\u093F\u0936"), "khvahish");
});

test("Devanagari readings match what a singer would file under", () => {
  assert.equal(romanise("भोलेनाथ"), "bholenath");
  assert.equal(romanise(`${ZA}िन्दगी`), "zindagi");
  assert.equal(romanise("ॐ"), "om");
  // The inherent vowel is silent at a word end, so "bholenatha" and "hama" are both wrong.
  assert.equal(romanise("हम"), "ham");
});

test("each script carries its own inherent vowel", () => {
  // The same consonant pair read two ways: Bengali's inherent is "o", Devanagari's is "a".
  assert.equal(romanise("জন"), "jon");
  assert.equal(romanise("जन"), "jan");
  assert.equal(romanise("জল"), "jol");
  assert.equal(romanise("আমি তোমার হই"), "ami tomar hoi");
  // The same cluster again — "pra" and "pro" — and the blocks' nominal 0x80 offset does not even hold
  // for this letter (प is U+0926, প is U+09AA), which is why the tables are written out, not derived.
  assert.equal(romanise("প্রতিমা"), "protima");
  assert.equal(romanise("प्रतिमा"), "pratima");
  assert.equal(romanise("ਹਮ"), "ham");
  assert.equal(romanise("ਮੈਂ ਤੇਰੀ"), "main teri");
  assert.equal(romanise("હું તારો"), "hun taro");
});

test("a line is only romanised when there is enough of a supported script in it", () => {
  assert.equal(needsRomanisation("तूने कदम"), true);
  assert.equal(needsRomanisation("Jeena Jeena"), false);
  assert.equal(needsRomanisation("I sing 一 二 三"), false);
  // Unsupported scripts are left alone rather than guessed at, so the line stays as written.
  assert.equal(romanise("日本語の歌詞"), "日本語の歌詞");
});
