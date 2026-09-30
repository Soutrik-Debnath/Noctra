import { SvelteSet } from "svelte/reactivity";

/**
 * Favourite tracks, keyed by the path-derived track id.
 *
 * Deliberately its own store rather than a field on the library: the scanned library is rewritten
 * wholesale on every rescan, so anything stored there would not survive adding a folder.
 *
 * Persistence is `localStorage`, not the Rust library file. It is a few hundred short strings that
 * only the webview cares about, and `load_library`/`save_library` are typed around tracks.
 */

const KEY = "noctra.favorites";

class FavoritesStore {
  ids = new SvelteSet<string>();
  loaded = false;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) for (const id of JSON.parse(raw) as string[]) this.ids.add(id);
    } catch {
      // A corrupt entry is worth less than the list itself; start empty rather than blocking boot.
    }
    this.loaded = true;
  }

  has(id: string): boolean {
    return this.ids.has(id);
  }

  toggle(id: string): boolean {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.persist();
    return this.ids.has(id);
  }

  count(): number {
    return this.ids.size;
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify([...this.ids]));
    } catch {
      // Quota or a disabled store: the in-memory list still works for this session.
    }
  }
}

export const favorites = new FavoritesStore();
