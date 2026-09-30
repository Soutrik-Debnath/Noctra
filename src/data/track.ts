/**
 * A single playable track, as read from the user's own files.
 *
 * Every field originates in Rust: `lofty` reads the tags and embedded artwork during the scan, and
 * `scan.rs` streams the result back as `ScannedTrack`. Nothing here is invented or fetched — the
 * spec forbids generated placeholder artwork, and an absent tag stays absent (empty string) so the
 * UI can say "Unknown" rather than make something up.
 */
export type Track = {
  id: string;
  title: string;
  artist: string;
  /**
   * The album-level credit. On compilations and multi-artist soundtracks the per-track `artist`
   * varies while this stays fixed, which is why grouping an album by `artist` fragments it.
   */
  albumArtist: string;
  album: string;
  genre: string;
  year: number;
  trackNo: number;
  discNo: number;
  /** Container/codec reported by lofty, e.g. "FLAC" or "MP3( IDv2 )". */
  codec: string;
  /** Bits per second, 0 when the property is unavailable. */
  bitrate: number;
  /** Hertz, 0 when unavailable. */
  sampleRate: number;
  /** Bits per sample, 0 for lossy formats where the concept does not apply. */
  bitDepth: number;
  /** Absolute path, resolved through the noctra-audio protocol at play time. */
  source: string;
  /** Served from the extracted embedded artwork, "" when the file has none. */
  artwork: string;
  duration: number;
  /** Accent as "r g b"; replaced by the extracted artwork palette once loaded. */
  accent: string;
};

/**
 * First billed name. An `artist` tag is usually a credits list — "A.R. Rahman, Badshah, Tanishk
 * Bagchi" — so grouping or labelling on the raw string turns one artist into many. Splitting on
 * comma, `&`, "feat" and "vs" and taking the first token is what every other player does.
 */
export function leadArtist(raw: string): string {
  return raw.split(/,\s*|&|\s+feat\.?\s+|\s+vs\.?\s+/iu)[0].trim();
}

/**
 * Every name in a credit list, lowercased.
 *
 * `leadArtist` answers "who is this filed under"; this answers "who is on it". A soundtrack cue
 * credited to "A.R. Rahman, Badshah, Tanishk Bagchi" shares real DNA with a Badshah track, and
 * reading only the lead name throws that link away — which is why "Play similar" kept missing the
 * songs that obviously belong. Weighted below a lead match so it widens the net without reordering
 * the top of it.
 */
export function creditedArtists(raw: string): Set<string> {
  return new Set(
    raw
      .split(/,\s*|&|\s+feat\.?\s+|\s+vs\.?\s+/iu)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s.length > 1),
  );
}

/** The credit to show under an album: album artist when tagged, else the track's own lead name. */
export function albumCredit(t: Track): string {
  return t.albumArtist.trim() || leadArtist(t.artist) || "Unknown artist";
}

/**
 * The leading genre, from a tag that is frequently a whole list.
 *
 * Real tags in this library read "Films/Games & Film Scores & Bollywood" and
 * "Filme/Videospiele, Filmmusik, Bollywood". Splitting on `,` and `&` only — never on `/` — is what
 * keeps "Films/Games" intact instead of reducing it to "Films".
 */
export function primaryGenre(raw: string): string {
  const first = raw.split(/[,;&]+/u)[0]?.trim() ?? "";
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

/** lofty names the container family, not the codec, so these are the lossless ones by name. */
const LOSSLESS_CONTAINER = /^(flac|alac|wav|aiff?|ape|wv|wavpack|shorten|tta|pcm)$/iu;

/**
 * Whether the file is bit-exact rather than perceptually coded.
 *
 * The container name and the sample depth are OR'd rather than one or the other because each is
 * wrong alone: ALAC hides inside an `Mp4` container that reads as lossy by name, and a lossy file
 * can carry a stray bit-depth tag. In this library every FLAC reports 16 and every MP3/M4A reports
 * 0, so the two signals agree on everything that is actually here.
 */
export function isLossless(t: Track): boolean {
  return LOSSLESS_CONTAINER.test(t.codec.trim()) || t.bitDepth >= 16;
}

/**
 * The one-line provenance under the artist: "Alternative · 2015 · 2 tracks · Lossless".
 *
 * Every part is optional because the tags are not reliable — 159 of these 314 files carry no year
 * and 40 no genre. A part that is missing is dropped rather than rendered as a hole, so the line
 * degrades to "Lossless" or to nothing at all rather than showing "· · 1 tracks ·".
 */
export function mediaLine(t: Track, trackCount: number): string {
  const parts: string[] = [];
  const genre = primaryGenre(t.genre);
  if (genre) parts.push(genre);
  if (t.year > 0) parts.push(String(t.year));
  if (trackCount > 1) parts.push(`${trackCount} tracks`);
  if (isLossless(t)) parts.push("Lossless");
  return parts.join(" · ");
}
