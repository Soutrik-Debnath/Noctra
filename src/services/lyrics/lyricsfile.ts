/**
 * LRCLIB's `lyricsfile` payload.
 *
 * Why this exists: `syncedLyrics` is line-level and always will be, but the same API response carries
 * a YAML document with the record's real structure, and on a `hasWordSync` record that document has
 * per-word timings. Reading `lyricsfile` is the only way genuine word data reaches Noctra from a
 * legitimate source. Measured live: 3 of 760 sampled records had it, and every one was 亜咲花 —
 * "SHINY DAYS" (id 32713056) — so coverage is thin, which is the expected Tier 1 outcome rather than a
 * bug. Without this file the word timings are invisible: that record's own `syncedLyrics` is line-only.
 *
 * Units come from the field names, which say `start_ms` / `end_ms` / `duration_ms` — milliseconds, and
 * not the `mm:ss.xx` form the LRC path uses. Verified against a live response rather than assumed.
 *
 * The YAML reader below covers the subset LRCLIB emits (block maps, block sequences, plain and quoted
 * scalars, block scalars) rather than taking a dependency for one field of one provider. Anything it
 * cannot parse yields no timings, and the caller then falls back to `syncedLyrics` — a miss, never a
 * guess.
 */

import type { Line, Word } from "./lrc";

type Yaml = string | number | boolean | null | YamlNode | Yaml[];
type YamlNode = { [key: string]: Yaml };

export type LyricsFile = {
  lines: Line[];
  /** Stated track length in ms, used for track matching. 0 when the document does not say. */
  durationMs: number;
  title: string;
  artist: string;
  album: string;
  /** True when at least one line carries more than one timed word. */
  hasWords: boolean;
};

/** A line of a YAML block, with its indentation and the text after it. Blank lines are dropped. */
type Row = { indent: number; text: string };

function rows(raw: string): Row[] {
  const out: Row[] = [];
  for (const line of raw.split(/\r?\n/)) {
    // A tab in the indentation of a YAML block is an error, not a style choice.
    if (!line.trim() || line.trimStart().startsWith("#") || /^\t/.test(line)) continue;
    const indent = line.length - line.trimStart().length;
    out.push({ indent, text: line.trim() });
  }
  return out;
}

function scalar(text: string): Yaml {
  if (text === "" || text === "~" || text === "null") return null;
  const first = text[0];
  if (first === '"' || first === "'") return unquote(text);
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  if (text === "true" || text === "false") return text === "true";
  return text;
}

function unquote(text: string): string {
  const quote = text[0];
  const end = text.lastIndexOf(quote);
  if (end <= 0) return text.slice(1); // unterminated: use what there is rather than failing the line
  const inner = text.slice(1, end);
  if (quote === "'") return inner.replace(/''/g, "'");
  return inner
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function parseValue(list: Row[], i: number, keyIndent: number): [Yaml, number] {
  const row = list[i];
  const rest = row.text.slice(row.text.indexOf(":") + 1).trim();

  if (rest === "|" || rest === "|-" || rest === ">" || rest === ">-") {
    // Block scalar: every following line that is indented past the key belongs to the value.
    const parts: string[] = [];
    let j = i + 1;
    for (; j < list.length && list[j].indent > keyIndent; j++) parts.push(list[j].text);
    const joined = rest.startsWith(">") ? parts.join(" ") : parts.join("\n");
    return [rest.endsWith("-") ? joined : joined, j];
  }

  if (rest !== "") return [scalar(rest), i + 1];

  const next = list[i + 1];
  if (!next) return [null, i + 1];
  // A block sequence may sit at the key's own indentation, which is how `lines:` is written.
  if (next.indent > keyIndent || (next.indent === keyIndent && next.text.startsWith("- "))) {
    return parseBlock(list, i + 1, next.indent);
  }
  return [null, i + 1];
}

function parseBlock(list: Row[], start: number, indent: number): [Yaml, number] {
  return list[start]?.text.startsWith("- ") ? parseSequence(list, start, indent) : parseMap(list, start, indent);
}

function parseMap(list: Row[], start: number, indent: number): [YamlNode, number] {
  const node: YamlNode = {};
  let i = start;
  while (i < list.length && list[i].indent === indent && !list[i].text.startsWith("- ")) {
    const colon = list[i].text.indexOf(":");
    if (colon < 0) break;
    const key = unquotedKey(list[i].text.slice(0, colon));
    const [value, next] = parseValue(list, i, indent);
    node[key] = value;
    i = next;
  }
  return [node, i];
}

function parseSequence(list: Row[], start: number, indent: number): [Yaml[], number] {
  const out: Yaml[] = [];
  let i = start;
  while (i < list.length && list[i].indent === indent && list[i].text.startsWith("- ")) {
    const content = list[i].text.slice(2).trim();
    if (content === "") {
      // A dash with nothing after it introduces a nested block.
      const next = list[i + 1];
      if (next && next.indent > indent) {
        const [child, after] = parseBlock(list, i + 1, next.indent);
        out.push(child);
        i = after;
        continue;
      }
      out.push(null);
      i++;
      continue;
    }
    if (content.includes(":")) {
      // `- text: foo` opens a mapping whose remaining keys are indented to the first key, which sits
      // two columns past the dash.
      const colon = content.indexOf(":");
      const key = unquotedKey(content.slice(0, colon));
      const rest = content.slice(colon + 1).trim();
      const node: YamlNode = {};
      const keyColumn = indent + 2;

      if (rest === "") {
        const next = list[i + 1];
        if (next && (next.indent > keyColumn || (next.indent === keyColumn && next.text.startsWith("- ")))) {
          const [child, after] = parseBlock(list, i + 1, next.indent);
          node[key] = child;
          i = after;
        } else {
          node[key] = null;
          i++;
        }
      } else {
        node[key] = scalar(rest);
        i++;
      }
      // Later keys of the same item sit deeper than the dash.
      while (i < list.length && list[i].indent > indent && !list[i].text.startsWith("- ")) {
        const [more, after] = parseMap(list, i, list[i].indent);
        Object.assign(node, more);
        i = after;
      }
      out.push(node);
      continue;
    }
    out.push(scalar(content));
    i++;
  }
  return [out, i];
}

function unquotedKey(key: string): string {
  const trimmed = key.trim();
  return trimmed.startsWith('"') || trimmed.startsWith("'") ? unquote(trimmed) : trimmed;
}

/**
 * Read a `lyricsfile` document into the player's line model.
 *
 * Returns `hasWords` separately from producing word arrays, because "the document has a `words:` key"
 * is not the same claim as "the words are timed" — a line whose words all share one timestamp is
 * line-level data wearing a word label, and `validate()` in `lrc.ts` is what rejects that.
 */
export function readLyricsfile(raw: string): LyricsFile {
  const empty: LyricsFile = { lines: [], durationMs: 0, title: "", artist: "", album: "", hasWords: false };
  if (!raw?.trim()) return empty;

  let doc: Yaml;
  try {
    const list = rows(raw);
    if (!list.length) return empty;
    doc = parseBlock(list, 0, list[0].indent)[0];
  } catch {
    return empty;
  }
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) return empty;

  const metadata = asNode(doc.metadata);
  const result: LyricsFile = {
    lines: [],
    durationMs: asInt(metadata?.duration_ms),
    title: asText(metadata?.title),
    artist: asText(metadata?.artist),
    album: asText(metadata?.album),
    hasWords: false,
  };

  const lines = doc.lines;
  if (!Array.isArray(lines)) return result;

  for (const entry of lines) {
    const node = asNode(entry);
    if (!node) continue;
    const time = asInt(node.start_ms);
    const text = asText(node.text).trim();
    if (!text || time <= 0 && asInt(node.end_ms) <= 0) continue;

    const end = statedEnd(node.end_ms, time);
    const words = wordList(node.words, end);
    result.lines.push({ time, text, words, end });
    if (words && words.length > 1) result.hasWords = true;
  }

  result.lines.sort((a, b) => a.time - b.time);
  return result;
}

/**
 * The document's word list, in milliseconds.
 *
 * `lineEnd` is the line's own stated `end_ms`, and it matters for the last word of a line: there is no
 * following word to borrow a boundary from, but the document does say when the line stops. Leaving that
 * word with a zero-length range is what made a held final syllable unlit in live testing.
 */
function wordList(value: Yaml | undefined, lineEnd: number | null): Word[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;

  const words: Word[] = [];
  for (const entry of value) {
    const node = asNode(entry);
    if (!node) continue;
    const text = asText(node.text);
    const start = asInt(node.start_ms);
    if (!text.trim() || start <= 0 && asInt(node.end_ms) <= 0) continue;
    words.push({ text: text.trim(), start, end: asInt(node.end_ms) });
  }
  if (words.length < 2) return null;

  // A word with no stated end is held until the next word's stated start — the boundary the document
  // does give. The last one falls back to the line's own stated end.
  for (let i = 0; i < words.length; i++) {
    if (words[i].end <= words[i].start) {
      words[i].end = words[i + 1]?.start ?? lineEnd ?? words[i].start;
    }
  }
  return words;
}

function statedEnd(value: Yaml | undefined, start: number): number | null {
  const end = asInt(value);
  return end > start ? end : null;
}

function asNode(value: Yaml | undefined): YamlNode | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as YamlNode) : null;
}

function asInt(value: Yaml | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value) : 0;
}

function asText(value: Yaml | undefined): string {
  return typeof value === "string" ? value : "";
}
