/**
 * Lyrics parsing, serialising and validation.
 *
 * Three shapes come in and one model comes out:
 *   `[00:20.52] line of text`                      — line level, what LRCLIB's `syncedLyrics` returns
 *   `[00:20.52] <00:20.520,00:22.100>word ...`     — enhanced LRC, word level
 *   `<p begin="00:00:20.520">…<span begin=…/>`     — TTML, line or word level
 *
 * Everything is normalised to **milliseconds** internally, because that is what the renderers already
 * speak (`player.position * 1000`) and what the timing offset setting is stored in. Each provider's
 * unit is read from its own field names rather than assumed: LRC stamps are `mm:ss.frac`, LRCLIB's
 * `lyricsfile` says `start_ms`/`end_ms`, and an ID3v2 SYLT frame declares its unit per frame.
 *
 * `level` is the load-bearing field. It says what the *source* actually supplied, so a line-synced
 * file can never be rendered as though it were word-synced. Nothing here invents a timestamp:
 * `wordLevel` used to be the only flag, and static lyrics got `time = index * 1000` upstream, which
 * made untimed words scroll on a schedule that existed nowhere. See BUG-019, BUG-028 and BUG-034 for
 * what an invented word timeline cost — three reports of words landing where they were not sung.
 */

export type SyncLevel = "word" | "line" | "plain";

export type Word = { text: string; start: number; end: number };

/**
 * One lyric line.
 *
 * `end` is the line's real end *only when the source states it* (TTML `end`, LRCLIB's `lyricsfile`
 * `end_ms`). It stays null when the source gives only a start, because the next line's start is an
 * approximation of when this line stops being sung — the tail of the gap is a breath, not a word.
 */
export type Line = { time: number; text: string; words: Word[] | null; end: number | null };

export type Lyrics = {
  lines: Line[];
  /** What the source genuinely supplied. Drives the renderer; never promoted for a better show. */
  level: SyncLevel;
  source: "lrclib" | "local file" | "cache" | "embedded tag";
};

/** `[mm:ss.xx]`, `[mm:ss.xx.xxx]` or `[mm:ss:xx]`, each optionally repeated for one lyric line. */
const TIMESTAMP = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;

/** `<mm:ss.xxx,mm:ss.xxx>text` — the enhanced per-word form. The end time may be absent. */
const WORD_TAG = /<(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?(?:,(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?)?>([^<]*)/g;

const ms = (min: string, sec: string, frac: string | undefined) => {
  const m = Number(min) * 60_000 + Number(sec) * 1000;
  // `.52` is 520ms and `.523` is 523ms — the fraction is decimal, not a fixed-width field.
  return m + (frac ? Number(frac.padEnd(3, "0").slice(0, 3)) : 0);
};

/** Metadata tags (`[ar:…]`, `[ti:…]`, `[offset:…]`) are not lyrics and must not render. */
function isMetadata(line: string): boolean {
  return /^\[(ar|ti|al|by|id|offset|length|re|ve):[^\]]*\]/i.test(line.trim());
}

export function parseLrc(raw: string): Line[] {
  const out: Line[] = [];

  for (const physical of raw.split(/\r?\n/)) {
    if (!physical.trim() || isMetadata(physical)) continue;

    const stamps = [...physical.matchAll(TIMESTAMP)];
    if (stamps.length === 0) continue;

    const body = physical.slice((stamps.at(-1)?.index ?? 0) + (stamps.at(-1)?.[0].length ?? 0));
    const words = parseWords(body);
    const text = (words ? words.map((w) => w.text).join("") : body).trim();
    if (!text) continue;

    for (const s of stamps) {
      out.push({
        time: ms(s[1], s[2], s[3]),
        text,
        words: words ? withEnds(words) : null,
        // The line ends where its last word does, which the source did state.
        end: words ? lastFiniteEnd(words) : null,
      });
    }
  }

  return sortLines(out);
}

/** Split plain (untimed) text into lines. Every `time` is 0 and `level` is `"plain"` — no schedule. */
export function plainLines(raw: string): Line[] {
  return raw
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter((t) => t)
    .map((text) => ({ time: 0, text, words: null, end: null }));
}

function parseWords(body: string): Word[] | null {
  const found = [...body.matchAll(WORD_TAG)];
  // A line that merely contains a stray `<` is not word-timed; require at least two tags.
  if (found.length < 2) return null;

  const words = found.map((f) => ({
    // Trimmed here rather than in the renderer: real word tags carry their trailing space, and the
    // view puts its own separator between tokens.
    text: f[7].trim(),
    start: ms(f[1], f[2], f[3]),
    // The end time is optional in the tag; `withEnds` fills the gap from the next word.
    end: f[4] !== undefined ? ms(f[4], f[5], f[6]) : 0,
  }));
  return words.some((w) => w.text) ? words : null;
}

/**
 * Fill in missing end times from the next word's start.
 *
 * Real-world word data frequently omits the end (LRCLIB's own `lyricsfile` does on some records, and
 * an ID3v2 SYLT frame has no end at all), and a highlight that never un-lights is worse than no
 * highlight. The value comes from the *following word's own stated start*, which is a fact from the
 * file — not from dividing anything up.
 */
function withEnds(words: Word[]): Word[] {
  for (let i = 0; i < words.length; i++) {
    if (words[i].end <= words[i].start) {
      words[i].end = words[i + 1]?.start ?? Number.MAX_SAFE_INTEGER;
    }
  }
  return words;
}

function lastFiniteEnd(words: Word[]): number | null {
  const end = words[words.length - 1]?.end;
  return end !== undefined && end < Number.MAX_SAFE_INTEGER ? end : null;
}

function sortLines(lines: Line[]): Line[] {
  return lines.sort((a, b) => a.time - b.time);
}

/**
 * Serialise back to (enhanced) LRC for the on-disk cache.
 *
 * The cache used to store `syncedLyrics` verbatim, so a word-timed record came back tomorrow as
 * line-level and silently lost the timing that made it worth having. Writing the word tags keeps the
 * cache lossless and keeps it a plain `.lrc` a person can open and read.
 */
export function toLrc(lines: Line[]): string {
  return lines
    .map((l) => {
      const stamp = `[${clock(l.time)}]`;
      if (!l.words?.length) return `${stamp}${l.text}`;
      return stamp + l.words.map((w) => `<${clock(w.start)},${clock(w.end)}>${w.text}`).join("");
    })
    .join("\n");
}

/** `mm:ss.mmm` — the form `parseLrc` reads at full millisecond precision. */
function clock(atMs: number): string {
  const safe = Math.max(0, Math.round(atMs));
  const m = Math.floor(safe / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  const frac = safe % 1000;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(frac).padStart(3, "0")}`;
}

/**
 * How far through the line being sung we are, 0–1.
 *
 * This drives the sweep on the line being sung, and it is the reason there is no estimated
 * word-by-word mode any more. Both endpoints are facts from the file — the line's own end when it
 * states one, otherwise the next line's start — so the fill moves at the true rate of the singing.
 * Guessing where each word falls inside that interval produced BUG-019, BUG-028 and BUG-034.
 */
export function lineProgress(lines: Line[], index: number, atMs: number): number {
  const line = lines[index];
  if (!line) return 0;
  const statedEnd = line.end !== null && line.end > line.time ? line.end : null;
  const next = statedEnd ?? lines[index + 1]?.time ?? line.time + 4000;
  const span = next - line.time;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (atMs - line.time) / span));
}

export function activeLine(lines: Line[], atMs: number): number {
  let lo = 0;
  let hi = lines.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (lines[mid].time <= atMs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

/**
 * How far line `i` sits from the line being sung, or `null` while nothing is being sung.
 *
 * The `null` is the point. `activeLine` returns -1 before the first timestamp, and folding that into
 * the ramp with `index < 0 ? 0 : index` puts line 0 at distance zero — so the first line of every song
 * renders with the sung line's opacity, focus, glow and card size for the whole intro. On "Jeena
 * Jeena" that is 27 seconds of a line that has not started, sitting there looking like it is.
 *
 * The clamp existed because the alternative was worse in the other direction: anchoring on -1 literally
 * makes line 0 distance 1, so the entire column opens dimmed and blurred and the card reads blank.
 * Both are the same mistake — treating "no sung line" as if it were a position on the ramp. It is not
 * a position, so this returns `null` and each renderer holds a rest state for it.
 */
export function lineDistance(index: number, i: number): number | null {
  return index < 0 ? null : Math.abs(i - index);
}

/**
 * Whether a line is a lyric at all, or just the source's marker for "music, no words".
 *
 * LRCLIB writes a bare `♪` (U+266A) into the timed slot of an instrumental break, and some files use an
 * empty line for the same thing. Neither is text, and rendering one as text is what put a lone narrow
 * glyph inside a line button whose `fit-content` padding turned it into an unlabelled rounded box —
 * which read as a broken control rather than as eight bars of guitar.
 *
 * Both spellings of the note are covered, and the empty string matches, because a line with no words in
 * it is exactly the case this asks about.
 */
const INSTRUMENTAL = /^[\s\u2669\u266A\u266B\u266C\u{1F3B5}\u{1F3B6}]*$/u;

export function isInstrumental(text: string | null | undefined): boolean {
  return INSTRUMENTAL.test(text ?? "");
}

/**
 * Which word of the line is being sung at `atMs`.
 *
 * Range containment, so a word held for 1.5s stays current for 1.5s and three rapid words move on
 * their own timestamps. Returns -1 before the line's first word.
 */
export function activeWord(words: Word[], atMs: number): number {
  for (let i = words.length - 1; i >= 0; i--) {
    if (atMs >= words[i].start && atMs < words[i].end) return i;
  }
  // Nothing contains the time: sit on the last word that has already started rather than blanking.
  for (let i = words.length - 1; i >= 0; i--) {
    if (atMs >= words[i].start) return i;
  }
  return -1;
}

/**
 * Reject anything that is not what it claims to be before the renderer sees it.
 *
 * Returns the level the data actually supports, which may be *lower* than the level it arrived as:
 * a word claim that fails validation comes back as `"line"`, and a line claim with unusable times
 * comes back as `"plain"`. Never the other way round, and never repaired — a guessed offset would be
 * the same invention as `lineDuration / numberOfWords` wearing a different hat.
 */
export function validate(
  lines: Line[],
  durationSec: number,
  claimed: SyncLevel,
): { ok: boolean; level: SyncLevel; reason: string } {
  if (!lines.length) return { ok: false, level: "plain", reason: "no lines parsed" };

  const durationMs = durationSec > 0 ? durationSec * 1000 : 0;
  // Providers round their duration and sidecars outlive re-encodes, so a real overshoot is allowed
  // room rather than being treated as corruption.
  const ceiling = durationMs > 0 ? durationMs + 15_000 : 0;

  let badTimes = 0;
  for (const l of lines) {
    if (!Number.isFinite(l.time) || l.time < 0 || (ceiling > 0 && l.time > ceiling)) badTimes++;
  }
  if (badTimes > lines.length * 0.2) {
    return { ok: false, level: "plain", reason: `${badTimes}/${lines.length} line times out of range` };
  }

  if (claimed !== "word") {
    // Line-level and plain both survive on line checks alone.
    return claimed === "line"
      ? { ok: true, level: "line", reason: "" }
      : { ok: true, level: "plain", reason: "" };
  }

  const verdict = wordLevelIsReal(lines, ceiling);
  if (!verdict.ok) {
    // The words were unusable, but the line starts were fine, so line-level is still honest.
    return { ok: true, level: "line", reason: verdict.reason };
  }
  return { ok: true, level: "word", reason: "" };
}

/**
 * Strip the word arrays when a result has been demoted to line level.
 *
 * The renderer picks per-word highlighting whenever a line carries words, so returning demoted data with
 * its `words` still attached would show timing the validator just refused while the panel said
 * line-level. Demotion has to be visible in the data, not only in the label.
 */
export function demote(lines: Line[], level: SyncLevel): Line[] {
  if (level === "word") return lines;
  return lines.map((l) => ({ ...l, words: null }));
}

/**
 * Is this genuinely word/syllable timing, or line timing dressed up to look granular?
 *
 * Two telltales, both drawn straight from the behaviour the task forbids:
 *  - every word in a line gets the same slot, and that slot is the line's span divided by the word
 *    count. That is `lineDuration / numberOfWords` whoever produced it, and real sung timings never
 *    land on it to within a millisecond across a whole line;
 *  - the words all start at the same instant, which is a line stamp wearing several labels.
 */
function wordLevelIsReal(lines: Line[], ceiling: number): { ok: boolean; reason: string } {
  let usableLines = 0;

  for (const l of lines) {
    const words = l.words;
    if (!words || words.length < 2) continue;

    let distinctStarts = 0;
    let previousStart = -1;
    for (const w of words) {
      if (!Number.isFinite(w.start) || w.start < 0) continue;
      if (ceiling > 0 && w.start > ceiling) continue;
      if (w.end < w.start) continue;
      if (w.start !== previousStart) {
        distinctStarts++;
        previousStart = w.start;
      }
    }
    if (distinctStarts < 2) continue;

    // A line whose words are an even division of its own span is a fabrication, not data.
    const held = words.filter((w) => Number.isFinite(w.end) && w.end > w.start && w.end < Number.MAX_SAFE_INTEGER);
    if (held.length === words.length && evenlySpaced(held, l)) continue;

    usableLines++;
  }

  if (usableLines === 0) return { ok: false, reason: "no line carries distinct word timestamps" };
  return { ok: true, reason: "" };
}

/** Words whose durations are all identical *and* match the line span divided evenly between them. */
function evenlySpaced(words: Word[], line: Line): boolean {
  const durations = words.map((w) => w.end - w.start);
  const first = durations[0];
  if (first <= 0) return false;
  const uniform = durations.every((d) => Math.abs(d - first) <= 1);
  if (!uniform) return false;
  const spanEnd = line.end ?? words[words.length - 1].end;
  const span = spanEnd - line.time;
  // Only call it fabricated when the even split accounts for the whole line, which is the exact
  // signature of the forbidden formula. A genuinely metronomic file whose words do not fill the
  // line is still real timing.
  return Math.abs(span / words.length - first) <= 2;
}
