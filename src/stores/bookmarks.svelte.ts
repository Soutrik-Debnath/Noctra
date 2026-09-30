/**
 * Saved moments inside a track — "the drop", "the chorus", "where the lyric lands".
 *
 * Distinct from a favourite, which marks the whole song: this marks a position in it, so you can
 * jump back to the part you actually wanted. Nothing is written to the audio file; the marks live
 * beside the favourites list in web storage, keyed by the path-derived track id so they survive a
 * rescan and stay with the file rather than with its position in a list.
 */

const KEY = "noctra.bookmarks";
/** Per track. A song with forty marks stops being a set of highlights and becomes a nuisance. */
const MAX_PER_TRACK = 24;

export type Bookmark = { at: number; label: string };

type Store = Record<string, Bookmark[]>;

function load(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Store = {};
    for (const [id, list] of Object.entries(parsed)) {
      if (!Array.isArray(list)) continue;
      out[id] = list
        .filter((b): b is Bookmark => {
          const o = b as Partial<Bookmark>;
          return typeof o?.at === "number" && Number.isFinite(o.at) && o.at >= 0;
        })
        .map((b) => ({ at: b.at, label: typeof b.label === "string" ? b.label : "" }))
        .sort((x, y) => x.at - y.at);
    }
    return out;
  } catch {
    // A corrupt entry is worth less than the marks themselves; start empty rather than blocking boot.
    return {};
  }
}

class BookmarkStore {
  private data: Store = load();
  /** Reactive mirror, replaced wholesale so Svelte 5 sees the change. */
  all = $state<Store>(this.data);

  for(id: string): Bookmark[] {
    return this.all[id] ?? [];
  }

  count(id: string): number {
    return this.for(id).length;
  }

  /** Returns false when the mark would be a duplicate of one already there. */
  add(id: string, at: number, label = ""): boolean {
    const seconds = Math.max(0, Math.round(at * 10) / 10);
    const existing = this.for(id);
    // Two marks within half a second are the same moment clicked twice.
    if (existing.some((b) => Math.abs(b.at - seconds) < 0.5)) return false;
    const next = [...existing, { at: seconds, label: label.trim() }].sort((a, b) => a.at - b.at);
    this.data[id] = next.slice(-MAX_PER_TRACK);
    this.all = { ...this.data };
    this.persist();
    return true;
  }

  remove(id: string, at: number) {
    const remaining = this.for(id).filter((b) => b.at !== at);
    if (remaining.length === 0) delete this.data[id];
    else this.data[id] = remaining;
    this.all = { ...this.data };
    this.persist();
  }

  clear(id: string) {
    delete this.data[id];
    this.all = { ...this.data };
    this.persist();
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      // Quota or a disabled store: the marks still work for this session.
    }
  }
}

export const bookmarks = new BookmarkStore();
