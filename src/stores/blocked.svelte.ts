import { SvelteSet } from "svelte/reactivity";
import { leadArtist, type Track } from "../data/track";

/**
 * "Never play this again" — a list of things Noctra will not put into a play order on its own.
 *
 * Distinct from removing a track from the library, which deletes the database entry, and from
 * deleting the file. The song stays browsable and playable when you choose it; it just stops
 * turning up in shuffle, in an autoplay run, or in "Play similar". That distinction is the whole
 * point of the feature, so it gets its own store rather than a flag on the track.
 *
 * Two kinds of entry, because the frustration is usually about one of two things: one song, or a
 * whole artist. Artist matching uses the *lead* name — the same rule the Home and Statistics
 * grouping uses — because the `artist` tag in a real library is a credit list, and blocking
 * "A.R. Rahman, Anu Malik" should not silently unblock every song where that pair appears in a
 * different order.
 */

const KEY = "noctra.blocked";

type Blocked = { tracks: string[]; artists: string[] };

class BlockStore {
  trackIds = new SvelteSet<string>();
  artists = new SvelteSet<string>();

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<Blocked>;
        for (const id of parsed.tracks ?? []) this.trackIds.add(id);
        for (const name of parsed.artists ?? []) this.artists.add(name);
      }
    } catch {
      // Start empty rather than blocking boot, same as favourites.
    }
  }

  /** Whether playback should step past this track on its own. */
  hides(track: Track): boolean {
    if (this.trackIds.has(track.id)) return true;
    return this.artists.has(leadArtist(track.artist));
  }

  toggleTrack(id: string): boolean {
    if (this.trackIds.has(id)) this.trackIds.delete(id);
    else this.trackIds.add(id);
    this.persist();
    return this.trackIds.has(id);
  }

  toggleArtist(name: string): boolean {
    const lead = leadArtist(name);
    if (this.artists.has(lead)) this.artists.delete(lead);
    else this.artists.add(lead);
    this.persist();
    return this.artists.has(lead);
  }

  artistBlocked(name: string): boolean {
    return this.artists.has(leadArtist(name));
  }

  unblockTrack(id: string) {
    this.trackIds.delete(id);
    this.persist();
  }

  unblockArtist(name: string) {
    this.artists.delete(leadArtist(name));
    this.persist();
  }

  clear() {
    this.trackIds = new SvelteSet();
    this.artists = new SvelteSet();
    this.persist();
  }

  get size(): number {
    return this.trackIds.size + this.artists.size;
  }

  private persist() {
    try {
      const value: Blocked = { tracks: [...this.trackIds], artists: [...this.artists] };
      localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
      // Quota or a disabled store: the in-memory list still works for this session.
    }
  }
}

export const blocked = new BlockStore();
