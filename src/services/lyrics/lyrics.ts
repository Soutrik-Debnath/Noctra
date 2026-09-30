import { invoke } from "@tauri-apps/api/core";
import {
  demote,
  parseLrc,
  plainLines,
  toLrc,
  validate,
  type Line,
  type Lyrics,
  type SyncLevel,
} from "./lrc";
import { parseTtml } from "./ttml";
import { readLyricsfile } from "./lyricsfile";

/**
 * Lyrics lookup — Tier 1 of the word-sync plan: local files and LRCLIB, and nothing else online.
 *
 * Order is embedded tag + sidecar `.lrc`/TTML → disk cache → LRCLIB, with every candidate validated
 * before it is used and the *sync level* deciding the winner. Locals go first and win even under
 * `force`, because they are the user's own files; replacing something they deliberately placed with a
 * remote guess is the wrong default, and a local enhanced-LRC or `lyricsfile` record is one of the two
 * routes by which real per-word timings can reach the player at all.
 *
 * The level is not decoration. A track whose only source is line-level is shown line-level and says so,
 * because the alternative is an invented word timeline — and three separate bug reports (BUG-019,
 * BUG-028, BUG-034) are the record of what that looked like in this app.
 *
 * LRCLIB is the online fallback because it is a documented public API with no key and
 * `Access-Control-Allow-Origin: *`, so the webview can call it directly and no Rust proxy is needed.
 * Third-party scrapers were considered and rejected: no official API, they break silently, and Musixmatch
 * RichSync / NetEase / QQ / KuGou syllable data is only reachable through reverse-engineered endpoints,
 * which is Tier 2 and needs its own go-ahead.
 */

const API = "https://lrclib.net/api";
/** LRCLIB publishes no numeric limit but asks for sequential requests with a gap. */
const USER_AGENT = "Noctra/0.1 (offline desktop player)";
/**
 * Measured on this build: two requests a second apart is fine, anything denser starts returning 503.
 * The gap is not politeness, it is what keeps the fallback usable.
 */
const REQUEST_GAP_MS = 450;

export type LyricsQuery = {
  title: string;
  artist: string;
  album: string;
  duration: number;
  /** Absolute path to the audio file, used to find a sidecar and an embedded tag. "" when unknown. */
  path?: string;
};

/**
 * The one way a lyrics query is built, from the scanned tag duration.
 *
 * Not the decoded duration. `fingerprint` rounds it, so a tag reading 214 and a decoder reading
 * 214.6 hash to two different cache files — and the load path used the decoded value while both
 * delete paths used the tag value. "Delete saved lyrics" therefore removed a file that had never
 * been written and still reported success. See BUG-050.
 *
 * The tag duration is also the only one available for a track that is not playing, which the
 * right-click menu can be pointed at, so it is the only value that can serve as the key.
 */
export function lyricsQuery(t: {
  title: string;
  artist: string;
  album: string;
  duration: number;
  source: string;
}): LyricsQuery {
  return { title: t.title, artist: t.artist, album: t.album, duration: t.duration, path: t.source };
}

/**
 * A stable id for a track's lyrics.
 *
 * Title+artist+duration rather than the file path, so the same song sitting in two folders shares one
 * cache entry and a rename of the file does not throw the cache away.
 */
export function fingerprint(q: LyricsQuery): string {
  const key = `${q.title.toLowerCase().trim()}|${q.artist.toLowerCase().trim()}|${Math.round(q.duration)}`;
  // FNV-1a: small, dependency-free, and collision risk is irrelevant for a cache key.
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

type Candidate = { lines: Line[]; level: SyncLevel; source: Lyrics["source"] };

/**
 * Diagnostics, off by default. Turn on with `localStorage.setItem("noctra.lyrics.debug", "1")` to see
 * which provider answered, what unit it arrived in and what the lookup decided — which is how you tell
 * a bad source from a bad player. Reduced to this one gated line after verification, per the project's
 * convention of shipping no logging.
 */
let debug = (() => {
  try {
    return globalThis.localStorage?.getItem("noctra.lyrics.debug") === "1";
  } catch {
    return false;
  }
})();
export function setLyricsDebug(on: boolean): void {
  debug = on;
}
export function lyricsDebugEnabled(): boolean {
  return debug;
}
function log(...parts: unknown[]): void {
  if (debug) console.log("[lyrics]", ...parts);
}

type LrclibRecord = {
  id?: number;
  name?: string;
  trackName?: string;
  artistName?: string;
  albumName?: string;
  duration?: number;
  syncedLyrics?: string | null;
  plainLyrics?: string | null;
  /** LRCLIB's YAML source document: the only field that can carry per-word timings. */
  lyricsfile?: string | null;
  /** Set by the API itself when that document has word/syllable data. Never inferred here. */
  hasWordSync?: boolean | null;
};

async function api<T>(path: string): Promise<T | null> {
  const res = await fetch(`${API}${path}`, {
    headers: { "User-Agent": USER_AGENT, "X-User-Agent": USER_AGENT },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`LRCLIB responded ${res.status}`);
  return res.json() as T;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Normalised for comparison: lowercase, punctuation gone, and anything inside parentheses or brackets
 * dropped.
 *
 * Dropping the bracketed part is what makes this usable. "Tum Ho (From \"Rockstar\")" against a record
 * titled "Tum Ho (Rockstar)" is the same song, but neither string contains the other once the noise is
 * in the middle — and treating that as a mismatch cost three tracks in a 24-track sample their lyrics
 * entirely, which is a worse outcome than the wrong-song match this guard was added to prevent.
 */
function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[()[\]{}«»"“”]/g, " ")
    .replace(/\b(from|feat|featuring|ft|with|vs|mix|version|edit|remaster|mono|stereo)\b[^a-z0-9]*/g, " ")
    .replace(/[^\p{L}\p{N} ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Does this record belong to the file being played?
 *
 * Applied to the loose `/search` results, which are a free-text query and can land on a cover or a
 * different song with the same hook. Title must agree after normalising, allowing either side to contain
 * the other; artist may agree on one side of a credits list, because a rip that names five people against
 * a record that names the singer is the same track.
 */
function sameTrack(r: LrclibRecord, q: LyricsQuery): boolean {
  const title = norm(r.trackName ?? r.name ?? "");
  const want = norm(q.title);
  if (!title || !want) return false;
  const titlesAgree = title === want || title.includes(want) || want.includes(title);

  const artist = norm(r.artistName ?? "");
  const mine = norm(q.artist);
  const artistsAgree =
    !artist || !mine || artist === mine || artist.includes(mine) || mine.includes(artist);
  return titlesAgree && artistsAgree;
}

function durationGap(r: LrclibRecord, duration: number): number {
  if (!r.duration || !(duration > 0)) return 0;
  return Math.abs(r.duration - duration);
}

/** Tolerance widened for the search endpoint, whose duration is whatever the contributor typed. */
function plausible(r: LrclibRecord, duration: number, strict: boolean): boolean {
  if (!(duration > 0)) return true;
  return durationGap(r, duration) <= (strict ? 5 : 30);
}

/**
 * Turn one LRCLIB record into lyrics, highest level first.
 *
 * `hasWordSync` is the API's own statement that its `lyricsfile` carries per-word timings, so that is
 * the only case in which the YAML is consulted. `syncedLyrics` for the very same record is line-level
 * even then, which is why reading only that field hides the word data completely.
 */
function fromRecord(r: LrclibRecord, q: LyricsQuery): Candidate | null {
  if (r.hasWordSync && r.lyricsfile?.trim()) {
    const file = readLyricsfile(r.lyricsfile);
    if (file.hasWords && file.lines.length) {
      const verdict = validate(file.lines, q.duration, "word");
      log("lyricsfile", {
        unit: "start_ms/end_ms",
        lines: file.lines.length,
        claimed: "word",
        level: verdict.level,
        reason: verdict.reason,
        statedDurationMs: file.durationMs,
        trackDurationMs: Math.round(q.duration * 1000),
      });
      if (verdict.level === "word") return { lines: file.lines, level: "word", source: "lrclib" };
    }
  }

  const synced = r.syncedLyrics?.trim() ?? "";
  if (synced) {
    const lines = parseLrc(synced);
    if (lines.length) {
      const claimed = lines.some((l) => l.words) ? "word" : "line";
      const verdict = validate(lines, q.duration, claimed);
      log("syncedLyrics", { unit: "mm:ss.frac", lines: lines.length, claimed, level: verdict.level });
      if (verdict.level !== "plain") return { lines: demote(lines, verdict.level), level: verdict.level, source: "lrclib" };
    }
  }

  const plain = r.plainLyrics?.trim() ?? "";
  if (plain) return { lines: plainLines(plain), level: "plain", source: "lrclib" };
  return null;
}

/**
 * Local lyrics for one file: embedded tag first, then the sidecar.
 *
 * Each source is read as text and sniffed, because the same tag field and the same sidecar slot are used
 * for plain text, line-stamped LRC and enhanced word-stamped LRC in real libraries.
 */
async function readLocal(path: string, command: string, source: Lyrics["source"], duration: number): Promise<Candidate[]> {
  if (!path) return [];
  let text: string | null = null;
  try {
    text = await invoke<string | null>(command, { path });
  } catch {
    return [];
  }
  if (!text?.trim()) return [];

  const out: Candidate[] = [];
  const xml = looksLikeXml(text);
  const lines = xml ? parseTtmlSafe(text) : parseLrc(text);
  if (lines.length) {
    const claimed: SyncLevel = lines.some((l) => l.words) ? "word" : "line";
    const verdict = validate(lines, duration, claimed);
    if (verdict.level !== "plain") {
      out.push({ lines: demote(lines, verdict.level), level: verdict.level, source });
    } else {
      log(source, "rejected", verdict.reason);
    }
  }
  // Untimed text is still the user's own words, so it is kept as a last resort rather than dropped.
  // But only genuinely untimed text: a file that carries stamps and failed validation must not fall
  // back to printing `[00:12.34]` and `<p begin=` as the lyric line.
  if (!xml && !carriesStamps(text)) {
    const statics = plainLines(text);
    if (statics.length) out.push({ lines: statics, level: "plain", source });
  }
  return out;
}

/** Does this text look like a timed format rather than plain words? */
function carriesStamps(text: string): boolean {
  return /\[\d{1,3}:\d{2}([.:]\d{1,3})?\]/.test(text) || /<\d{1,3}:\d{2}([.:]\d{1,3})?/.test(text);
}

function looksLikeXml(text: string): boolean {
  return /^\s*(<\?xml|<[a-z]*:?tt[\s>])/i.test(text);
}

/** A malformed sidecar must not take the whole lookup down with it; TTML parsing is the only place that can throw. */
function parseTtmlSafe(text: string): Line[] {
  try {
    return parseTtml(text);
  } catch {
    return [];
  }
}

/**
 * Remove Noctra's own cached lyrics for a track.
 *
 * This deletes only the file the app wrote into its cache directory. It never touches the audio file, so
 * lyrics embedded in the user's own tags survive — stripping those would be modifying people's music,
 * which is a different and much more dangerous operation.
 *
 * The result distinguishes "removed it" from "there was nothing to remove" rather than calling both a
 * success. The Rust command used to map a missing file to Ok, and this returned a bare true, so a
 * fingerprint mismatch made the UI announce a deletion that had deleted nothing. See BUG-050.
 */
export type DeleteOutcome = "deleted" | "notCached" | "error";

export async function deleteCache(q: LyricsQuery): Promise<DeleteOutcome> {
  try {
    const result = await invoke<string>("delete_lyrics", { fingerprint: fingerprint(q) });
    return result === "deleted" ? "deleted" : "notCached";
  } catch {
    return "error";
  }
}

export type LyricsResult = { ok: true; lyrics: Lyrics } | { ok: false; reason: string };

const RANK: Record<SyncLevel, number> = { word: 3, line: 2, plain: 1 };

function best(candidates: Candidate[]): Candidate | null {
  let winner: Candidate | null = null;
  for (const c of candidates) {
    // Higher level wins; on a tie the earlier candidate does, which is the order locals are read in.
    if (!winner || RANK[c.level] > RANK[winner.level]) winner = c;
  }
  return winner;
}

export async function getLyrics(q: LyricsQuery, force = false): Promise<LyricsResult> {
  const key = fingerprint(q);

  const local = [
    ...(await readLocal(q.path ?? "", "read_embedded_lyrics", "embedded tag", q.duration)),
    ...(await readLocal(q.path ?? "", "read_sidecar_lyrics", "local file", q.duration)),
  ];
  const timed = local.filter((c) => c.level !== "plain");
  const localBest = best(timed);
  if (localBest) {
    log("chosen", { source: localBest.source, level: localBest.level, reason: "user's own file" });
    return { ok: true, lyrics: { lines: localBest.lines, level: localBest.level, source: localBest.source } };
  }

  /*
     A cached *untimed* answer is provisional, not final.

     LRCLIB is community-edited, so the synced version of a track that had none last month may exist
     today. A plain result used to be written back to the cache like any other, and the next play then
     short-circuited here and never asked again — which is exactly how a song with embedded untimed
     lyrics sat static forever while its timestamps were one request away. Only timed data gets to end
     the search on a cache hit; a static one is kept as a fallback and the network is tried anyway.
  */
  const fallbacks = [...local];
  if (!force) {
    const cached = await fromCache(key, q);
    if (cached && cached.level !== "plain") {
      log("chosen", { source: "cache", level: cached.level, reason: "cache hit" });
      return { ok: true, lyrics: { lines: cached.lines, level: cached.level, source: "cache" } };
    }
    if (cached) fallbacks.push(cached);
  }

  try {
    const found = await fromLrclib(q);
    if (found) {
      // Only a result that passed validation is written, and it is written with its word tags intact:
      // caching `syncedLyrics` alone used to bring a word-timed track back as line-level on next play.
      void invoke("save_lyrics", {
        fingerprint: key,
        text: found.level === "plain" ? found.lines.map((l) => l.text).join("\n") : toLrc(found.lines),
      }).catch(() => {
        /* A failed cache write costs the next launch one extra fetch. It must not break this one. */
      });
      log("chosen", { source: "lrclib", level: found.level, reason: "network" });
      return { ok: true, lyrics: { lines: found.lines, level: found.level, source: "lrclib" } };
    }
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    // A local untimed file is still worth showing when the network is the thing that failed.
    const fallback = best(fallbacks);
    if (fallback) {
      log("chosen", { source: fallback.source, level: "plain", reason: `network failed: ${reason}` });
      return { ok: true, lyrics: { lines: fallback.lines, level: "plain", source: fallback.source } };
    }
    return { ok: false, reason };
  }

  const statics = best(fallbacks);
  if (statics) {
    log("chosen", { source: statics.source, level: "plain", reason: "nothing timed anywhere" });
    return { ok: true, lyrics: { lines: statics.lines, level: "plain", source: statics.source } };
  }
  return { ok: false, reason: "No lyrics found for this track." };
}

/**
 * A cache read is a candidate like any other and can fail validation.
 *
 * Two shapes live here: enhanced/line LRC, which parses to timed lines, and plain text written by an
 * older build or by a static-only lookup, which parses to nothing and is then shown as static. A cache
 * file is never upgraded above what it actually contains.
 */
async function fromCache(key: string, q: LyricsQuery): Promise<Candidate | null> {
  let cached: string | null = null;
  try {
    cached = await invoke<string | null>("load_lyrics", { fingerprint: key });
  } catch {
    // A broken cache file is a miss, not an error — fall through to the network.
    return null;
  }
  if (!cached?.trim()) return null;

  const lines = parseLrc(cached);
  if (lines.length) {
    const claimed: SyncLevel = lines.some((l) => l.words) ? "word" : "line";
    const verdict = validate(lines, q.duration, claimed);
    if (verdict.level === "plain") return null;
    return { lines: demote(lines, verdict.level), level: verdict.level, source: "cache" };
  }
  const statics = plainLines(cached);
  return statics.length ? { lines: statics, level: "plain", source: "cache" } : null;
}

async function fromLrclib(q: LyricsQuery): Promise<Candidate | null> {
  const params = new URLSearchParams({
    track_name: q.title,
    artist_name: q.artist,
    album_name: q.album,
    duration: String(Math.round(q.duration)),
  });

  // `/api/get` needs an exact-ish match (its duration tolerance is ±2s), so a miss is common and falls
  // through to the looser search rather than being treated as "no lyrics".
  const record = await api<LrclibRecord>(`/get?${params}`);
  // The exact-match endpoint is not run through `sameTrack`: the server already matched on title, artist,
  // album and duration together, and re-checking it locally is where the "From \"Movie\"" style of title
  // fell through. The loose search below is the one that needs the guard.
  const direct = record && plausible(record, q.duration, true) ? fromRecord(record, q) : null;
  // Word data is the only result worth stopping on. `/api/get` answers with the record it considers the
  // best title match, which is usually the line-level one, and the word-synced version of the same song
  // is sitting in the search results — so ending here on a line hit is how a track plays with a sweep
  // when its real per-word timestamps were one request away. Live example: Katy Perry "Dark Horse".
  if (direct?.level === "word") return direct;

  await sleep(REQUEST_GAP_MS);
  // A credits-heavy artist tag poisons the query: "Sanjay Leela Bhansali, Arijit Singh Laal Ishq" returns
  // nothing while "Laal Ishq" returns twenty records. The loose retry is what turns those into static
  // lyrics instead of "none found", and `sameTrack` is what stops it accepting Rahat Fateh Ali Khan's
  // record for a track Noctra credits to two other people.
  let found: Candidate | null = direct;
  const queries = [`${q.artist} ${q.title}`, q.title];

  for (let attempt = 0; attempt < queries.length; attempt++) {
    if (found?.level === "word") break;
    if (attempt > 0) await sleep(REQUEST_GAP_MS);
    const results = (await api<LrclibRecord[]>(`/search?${new URLSearchParams({ q: queries[attempt] })}`)) ?? [];
    // Word-synced candidates are evaluated first, so the slower path to better data is still the one
    // taken. Speed is never a reason to pick a source with worse timing.
    const ordered = [...results].sort(
      (a, b) => Number(!!b.hasWordSync) - Number(!!a.hasWordSync) || durationGap(a, q.duration) - durationGap(b, q.duration),
    );

    for (const r of ordered) {
      if (!plausible(r, q.duration, false) || !sameTrack(r, q)) continue;
      const candidate = fromRecord(r, q);
      if (!candidate) continue;
      // Best level wins rather than first answer, and a static answer never displaces a timed one.
      if (!found || RANK[candidate.level] > RANK[found.level]) found = candidate;
      if (found.level === "word") break;
    }
    // A timed answer from the tight query is worth stopping on; a static one is not, because the looser
    // query may still hold the synced version.
    if (attempt === 0 && found && found.level !== "plain") break;
  }
  return found;
}
