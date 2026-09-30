/**
 * Album and artist groupings, derived from the loaded library.
 *
 * These were previously recomputed inline in Home and Stats with slightly different keys each time,
 * which is how one album ended up as several entries. Grouping lives here so every surface agrees.
 */
import type { Track } from "../data/track";
import { leadArtist } from "../data/track";
import { albumKey } from "./trackMenu";

export type AlbumGroup = {
  key: string;
  title: string;
  artist: string;
  year: number;
  genre: string;
  artwork: string;
  tracks: Track[];
  duration: number;
};

export type ArtistGroup = {
  name: string;
  tracks: Track[];
  albums: AlbumGroup[];
  artwork: string;
};

/** Sort key for tracks inside an album: disc first, then number, so multi-disc sets stay in order. */
function byDiscThenTrack(a: Track, b: Track): number {
  if (a.discNo !== b.discNo) return a.discNo - b.discNo;
  if (a.trackNo !== b.trackNo) return a.trackNo - b.trackNo;
  return a.title.localeCompare(b.title);
}

export function groupAlbums(tracks: Track[]): AlbumGroup[] {
  const map = new Map<string, AlbumGroup>();
  for (const t of tracks) {
    const album = t.album.trim();
    if (!album) continue;
    const key = albumKey(t);
    const existing = map.get(key);
    if (existing) {
      existing.tracks.push(t);
      existing.duration += t.duration;
      if (!existing.artwork && t.artwork) existing.artwork = t.artwork;
      if (!existing.year && t.year) existing.year = t.year;
      if (!existing.genre && t.genre) existing.genre = t.genre;
    } else {
      map.set(key, {
        key,
        title: album,
        artist: albumCreditOf(t),
        year: t.year,
        genre: t.genre,
        artwork: t.artwork,
        tracks: [t],
        duration: t.duration,
      });
    }
  }
  const out = [...map.values()];
  for (const a of out) a.tracks.sort(byDiscThenTrack);
  return out.sort((a, b) => a.title.localeCompare(b.title));
}

function albumCreditOf(t: Track): string {
  return t.albumArtist.trim() || leadArtist(t.artist) || "Unknown artist";
}

export function albumBy(tracks: Track[], key: string): AlbumGroup | undefined {
  return groupAlbums(tracks).find((a) => a.key === key);
}

/**
 * How many tracks this one's album holds in the loaded library.
 *
 * A plain count rather than `albumBy(...).tracks.length`: the grouping sorts every album's tracks
 * and builds a full index, which is worth paying for on the album page and is pure waste when the
 * only question is "how many".
 */
export function albumTrackCount(tracks: Track[], t: Track): number {
  const key = albumKey(t);
  let n = 0;
  for (const x of tracks) if (albumKey(x) === key) n++;
  return n;
}

export function groupArtists(tracks: Track[]): ArtistGroup[] {
  const map = new Map<string, Track[]>();
  for (const t of tracks) {
    const name = leadArtist(t.artist) || "Unknown artist";
    const bucket = map.get(name);
    if (bucket) bucket.push(t);
    else map.set(name, [t]);
  }
  const out: ArtistGroup[] = [];
  for (const [name, list] of map) {
    const albums = groupAlbums(list).sort((a, b) => b.tracks.length - a.tracks.length);
    out.push({ name, tracks: list, albums, artwork: list.find((t) => t.artwork)?.artwork ?? "" });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function artistBy(tracks: Track[], name: string): ArtistGroup | undefined {
  return groupArtists(tracks).find((a) => a.name === name);
}

/** A single disc/EP/song label, derived the way listeners expect rather than from a tag. */
export function albumKind(album: AlbumGroup): string {
  const n = album.tracks.length;
  const runtime = album.duration / 60;
  if (n >= 12 || runtime >= 45) return "Album";
  if (n >= 4 || runtime >= 15) return "EP";
  return "Single";
}
