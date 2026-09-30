/**
 * TTML lyrics parsing (local `.ttml` / `.tt` sidecars).
 *
 * TTML is the one interchange format that states a line's *end* rather than only its start, and it
 * carries per-word timing inside `<span>` elements, so it can arrive at word level legitimately. It is
 * read because Tier 1 lists it, not because any file in this library has been found using it.
 *
 * Units are taken from the expression itself: a clock time (`00:00:20.520`) is read to the millisecond
 * and an offset (`12.5s`, `300ms`) is converted by its suffix. A `frame`/`t` expression is **refused**
 * rather than converted, because the real duration of a frame depends on `frameRate`, which lives in a
 * `<tt>` attribute this parser does not chase — guessing it is exactly the "do not assume the unit"
 * rule. A refused time means the line falls out of the result and the lookup moves on down the
 * hierarchy, which is the honest outcome.
 */

import type { Line, Word } from "./lrc";

/**
 * `hh:mm:ss.mmm` — a clock time with a fractional second. The separator is what distinguishes it from
 * `hh:mm:ss:ff`, which counts frames and is unreadable without `frameRate`, so the colon form is
 * matched here and then refused in `ttmlTime` rather than being treated as a fraction.
 */
const CLOCK = /^(\d{1,3}):(\d{2}):(\d{2})(?:([.:;])(\d{1,4}))?$/;

/** `300ms`, `12.5s`, `2min` — the TTML offset form. */
const OFFSET = /^(\d+(?:\.\d+)?)(ms|s|min)$/;

const COMMENT = /<!--[\s\S]*?-->/g;

/** `<p>` or `<span>` opening tags may carry `begin`/`end`, or `begin`/`dur`. */
const BEGIN = /\b(?:begin|t)="([^"]+)"/i;
const END = /\bend="([^"]+)"/i;
const DUR = /\bdur="([^"]+)"/i;

/** A TTML time expression in milliseconds, or null when the unit is not one this file understands. */
export function ttmlTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const text = value.trim();

  const clock = CLOCK.exec(text);
  if (clock) {
    // `hh:mm:ss:ff` and `hh:mm:ss;ff` count frames. Their real length depends on `frameRate`, which
    // lives on the `<tt>` element, so they are refused here rather than read as a fraction — treating
    // 15 frames as 15ms would be a fabricated timeline that happens to look well-formed.
    if (clock[4] !== ".") return null;
    const h = Number(clock[1]) * 3_600_000;
    const m = Number(clock[2]) * 60_000;
    const s = Number(clock[3]) * 1000;
    // `.520` is 520ms; a shorter fraction is still a decimal of a second, so it scales rather than
    // being read as a fixed-width field.
    const frac = clock[5];
    const scaled = frac ? Number(frac) / 10 ** frac.length : 0;
    return h + m + s + Math.round(scaled * 1000);
  }

  const offset = OFFSET.exec(text);
  if (offset) {
    const amount = Number(offset[1]);
    if (!Number.isFinite(amount)) return null;
    return offset[2] === "ms" ? Math.round(amount) : Math.round(amount * (offset[2] === "s" ? 1000 : 60_000));
  }

  return null;
}

function attrs(open: string): { begin: number | null; end: number | null } {
  const begin = BEGIN.exec(open)?.[1];
  const endRaw = END.exec(open)?.[1];
  const durRaw = DUR.exec(open)?.[1];
  const start = ttmlTime(begin);
  const stop = ttmlTime(endRaw);
  const span = ttmlTime(durRaw);
  // `dur` is only usable next to a known start, and a zero-length element carries no timing.
  const end = stop !== null ? stop : start !== null && span !== null ? start + span : null;
  return { begin: start, end: end !== null && end > 0 ? end : null };
}

/** Text of an element with its markup removed, `<br>` included. */
function textOf(inner: string): string {
  return inner
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Word-level spans inside a line.
 *
 * Requires at least two timed spans, so a line that merely emphasises one word in italics is not
 * mistaken for karaoke data — the same guard the enhanced-LRC path uses.
 */
function wordsOf(inner: string): Word[] | null {
  const found = [...inner.matchAll(/<span([^>]*)>([\s\S]*?)<\/span>/gi)];
  if (found.length < 2) return null;

  const words: Word[] = [];
  for (const f of found) {
    const { begin, end } = attrs(f[1]);
    const text = textOf(f[2]);
    if (begin === null || !text) continue;
    words.push({ text, start: begin, end: end ?? 0 });
  }
  if (words.length < 2) return null;

  // TTML karaoke frequently omits the last span's end; the next span's start is the only stated
  // boundary available, so ends come from ends-or-successors and never from an even split.
  for (let i = 0; i < words.length; i++) {
    if (words[i].end <= words[i].start) {
      words[i].end = words[i + 1]?.start ?? Number.MAX_SAFE_INTEGER;
    }
  }
  return words;
}

export function parseTtml(raw: string): Line[] {
  const body = raw.replace(COMMENT, "");
  const out: Line[] = [];

  for (const f of body.matchAll(/<p([^>]*)>([\s\S]*?)<\/p>/gi)) {
    const { begin, end } = attrs(f[1]);
    if (begin === null) continue; // no stated time — it cannot be synced
    const words = wordsOf(f[2]);
    const text = (words ? words.map((w) => w.text).join(" ") : textOf(f[2])).trim();
    if (!text) continue;
    out.push({
      time: begin,
      text,
      words,
      end: end !== null && end > begin ? end : words ? lastFiniteEnd(words) : null,
    });
  }

  return out.sort((a, b) => a.time - b.time);
}

function lastFiniteEnd(words: Word[]): number | null {
  const end = words[words.length - 1]?.end;
  return end !== undefined && end < Number.MAX_SAFE_INTEGER ? end : null;
}
