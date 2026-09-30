/**
 * User playlists: ordered lists of track ids, persisted to `localStorage`.
 *
 * Ids rather than copies of the track data, so a playlist automatically reflects a corrected tag or
 * a new cover after a rescan. The cost is that a deleted file leaves a dangling id, which
 * `tracksFor()` filters out rather than letting a blank row through to the UI.
 */

export type Playlist = {
  id: string;
  name: string;
  trackIds: string[];
  created: number;
  /**
   * Owner-chosen cover. Either `emoji:<char>` or a `data:image/...` URL that has already been
   * downscaled by `playlistCover.ts`.
   *
   * Optional rather than defaulted, so playlists saved before the field existed load untouched.
   */
  artwork?: string;
};

const KEY = "noctra.playlists";

function slug(): string {
  return `pl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

class PlaylistStore {
  lists = $state<Playlist[]>([]);

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.lists = JSON.parse(raw) as Playlist[];
    } catch {
      // A corrupt entry is worth less than booting; start empty rather than blocking launch.
      this.lists = [];
    }
  }

  byId(id: string): Playlist | undefined {
    return this.lists.find((p) => p.id === id);
  }

  /** Names are free-form but unique-ish; callers pass what the user typed. */
  create(name: string, trackIds: string[] = []): Playlist {
    const list: Playlist = {
      id: slug(),
      name: name.trim() || "New playlist",
      trackIds,
      created: Date.now(),
    };
    this.lists = [...this.lists, list];
    this.persist();
    return list;
  }

  rename(id: string, name: string): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    this.lists = this.lists.map((p) => (p.id === id ? { ...p, name: trimmed } : p));
    this.persist();
  }

  /** `null` clears the cover and falls back to the first track's artwork. */
  setArtwork(id: string, artwork: string | null): void {
    this.lists = this.lists.map((p) => {
      if (p.id !== id) return p;
      const next = { ...p };
      if (artwork) next.artwork = artwork;
      else delete next.artwork;
      return next;
    });
    this.persist();
  }

  remove(id: string): void {
    this.lists = this.lists.filter((p) => p.id !== id);
    this.persist();
  }

  /** Appends, skipping ids already present — adding the same song twice is never intended. */
  add(id: string, trackIds: string | string[]): void {
    const list = this.byId(id);
    if (!list) return;
    const incoming = Array.isArray(trackIds) ? trackIds : [trackIds];
    const fresh = incoming.filter((t) => !list.trackIds.includes(t));
    if (fresh.length === 0) return;
    list.trackIds = [...list.trackIds, ...fresh];
    this.lists = [...this.lists];
    this.persist();
  }

  removeTrack(id: string, trackId: string): void {
    const list = this.byId(id);
    if (!list) return;
    list.trackIds = list.trackIds.filter((t) => t !== trackId);
    this.lists = [...this.lists];
    this.persist();
  }

  moveTrack(id: string, from: number, to: number): void {
    const list = this.byId(id);
    if (!list || from === to || from < 0 || to < 0) return;
    const next = [...list.trackIds];
    if (from >= next.length || to >= next.length) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    list.trackIds = next;
    this.lists = [...this.lists];
    this.persist();
  }

  /** Which playlists already hold this track, for the context menu's tick marks. */
  playlistsFor(trackId: string): Playlist[] {
    return this.lists.filter((p) => p.trackIds.includes(trackId));
  }

  private persist(): void {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.lists));
    } catch {
      // Quota or a disabled store: the in-memory lists still work for this session.
    }
  }
}

export const playlists = new PlaylistStore();
