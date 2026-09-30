import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { appDataDir } from "@tauri-apps/api/path";
import { libraryStorage, type StoredTrack } from "../services/library/storage";

/**
 * The scanned music library.
 *
 * Scanning is event-driven: Rust walks the folder on a worker thread and pushes batches of 50,
 * which is what keeps the window responsive with 300+ files. Nothing here blocks.
 */
class LibraryStore {
  tracks = $state<StoredTrack[]>([]);
  roots = $state<string[]>([]);
  scanning = $state(false);
  /** Tracks received so far in the current scan. */
  discovered = $state(0);
  error = $state("");
  query = $state("");
  loaded = $state(false);

  /** Lower-cased haystack built once per track so typing stays instant on a large library. */
  private haystacks = new Map<string, string>();

  filtered = $derived.by(() => {
    const q = this.query.trim().toLowerCase();
    if (!q) return this.tracks;
    return this.tracks.filter((t) => this.haystack(t).includes(q));
  });

  /**
   * Whether a track matches the current query. An empty query matches everything.
   *
   * Public because the album and artist facets need to group the *same* narrowed set, and those live
   * on full `Track`s rather than the stored rows `filtered` returns. Handing out the predicate keeps
   * one definition of what "matches" means; copying the field list would let the two drift.
   */
  matches(track: {
    id: string;
    title: string;
    artist: string;
    album: string;
    albumArtist?: string;
    genre?: string;
  }): boolean {
    const q = this.query.trim().toLowerCase();
    return !q || this.haystack(track).includes(q);
  }

  /**
   * The five fields a search looks at, cached per track id.
   *
   * Typed structurally rather than as `StoredTrack` because the album and artist facets reach it with
   * a full `Track`, which carries resolved artwork and a source on top of the stored row.
   */
  private haystack(track: {
    id: string;
    title: string;
    artist: string;
    album: string;
    albumArtist?: string;
    genre?: string;
  }): string {
    let cached = this.haystacks.get(track.id);
    if (!cached) {
      cached = `${track.title} ${track.artist} ${track.album} ${track.albumArtist ?? ""} ${track.genre ?? ""}`.toLowerCase();
      this.haystacks.set(track.id, cached);
    }
    return cached;
  }

  /** Ids present in `tracks`, so merged scans can dedupe without scanning the array. */
  private ids = new Set<string>();

  /**
   * True when the saved library predates the current tag set. Restore drops the stale rows but
   * keeps the roots, and App triggers `rebuildAll()` so the new fields actually populate rather than
   * sitting empty until the user happens to think of rescanning.
   */
  stale = $state(false);

  async restore(): Promise<void> {
    try {
      const saved = await libraryStorage.load();
      if (saved) {
        const usable = saved.tracks.filter((t) => t.albumArtist !== undefined && t.genre !== undefined);
        this.roots = saved.roots;
        if (usable.length !== saved.tracks.length && saved.roots.length > 0) {
          // Rows written before year/genre/albumArtist/bitrate were read. Reusing them would leave
          // those fields blank forever, so they are dropped and the roots are queued for a rescan.
          this.tracks = [];
          this.ids = new Set();
          this.stale = true;
        } else {
          this.tracks = saved.tracks;
          this.ids = new Set(saved.tracks.map((t) => t.id));
        }
      }
    } catch (e) {
      // A corrupt or unreadable library file must not stop the app launching; the user can rescan.
      this.error = `Could not read the saved library: ${String(e)}`;
    } finally {
      this.loaded = true;
    }
  }

  /** Re-read every root from scratch. Used for a schema upgrade and for pruning deleted files. */
  async rebuildAll(): Promise<void> {
    if (this.scanning || this.roots.length === 0) return;
    this.stale = false;
    const saved = this.roots;
    this.tracks = [];
    this.ids = new Set();
    this.haystacks.clear();
    // Cleared because `scan` refuses a root it already lists — leaving them in place made every
    // folder bail and the rebuild finished with an empty library. Each scan re-adds its own root
    // when it reports done.
    this.roots = [];
    for (const root of saved) {
      await this.scan(root, { append: true });
    }
  }

  /** Ask the OS for a music folder, then scan it. Returns false if the user cancelled. */
  async pickAndScan(replace = false): Promise<boolean> {
    const folder = await open({ directory: true, multiple: false, title: "Choose your music folder" });
    if (typeof folder !== "string") return false;
    await this.scan(folder, { append: !replace });
    return true;
  }

  /**
   * Scan a folder. With `append`, results merge into what is already loaded and folders already
   * scanned are skipped, so adding a second music directory is additive rather than destructive.
   *
   * Resolves when the scan has actually finished, not when it was handed to Rust. The worker thread
   * reports over events, so a caller that awaits this in a loop gets every folder rather than
   * having all but the first rejected by the `scanning` guard above.
   */
  async scan(root: string, { append = false }: { append?: boolean } = {}): Promise<void> {
    if (this.scanning) return;

    const normalised = root.replace(/\\/g, "/").replace(/\/$/, "");
    if (append && this.roots.includes(normalised)) {
      this.error = `Already in your library: ${normalised}`;
      return;
    }

    this.scanning = true;
    this.error = "";
    if (!append) {
      this.tracks = [];
      this.haystacks.clear();
      this.ids.clear();
      this.roots = [];
    }
    this.discovered = this.tracks.length;

    let settle: () => void = () => {};
    const finished = new Promise<void>((resolve) => {
      settle = resolve;
    });

    const unlisteners = await Promise.all([
      listen<StoredTrack[]>("library://batch", (event) => {
        // Dedupe on the path-derived id: rescanning an overlapping or nested folder must not
        // produce the same track twice.
        const fresh = event.payload.filter((t) => !this.ids.has(t.id));
        for (const t of fresh) this.ids.add(t.id);
        this.tracks.push(...fresh);
        this.discovered = this.tracks.length;
      }),
      listen<number>("library://done", async () => {
        this.scanning = false;
        this.discovered = this.tracks.length;
        if (!this.roots.includes(normalised)) this.roots.push(normalised);
        await this.persist();
        settle();
      }),
      listen<string>("library://error", (event) => {
        this.scanning = false;
        this.error = event.payload;
        settle();
      }),
    ]);

    try {
      await invoke("scan_folder", { root, cacheDir: `${await appDataDir()}/artwork` });
    } catch (e) {
      this.scanning = false;
      this.error = String(e);
      unlisteners.forEach((f) => f());
      return;
    }

    await finished;
    unlisteners.forEach((f) => f());
  }

  /** Drop a folder's tracks from the library without touching the files themselves. */
  async removeRoot(root: string): Promise<void> {
    const normalised = root.replace(/\\/g, "/").replace(/\/$/, "");
    this.roots = this.roots.filter((r) => r !== normalised);
    const keep = this.tracks.filter((t) => !t.path.startsWith(normalised));
    this.ids = new Set(keep.map((t) => t.id));
    this.tracks = keep;
    await this.persist();
  }

  async removeTrack(id: string): Promise<void> {
    this.tracks = this.tracks.filter((t) => t.id !== id);
    await this.persist();
  }

  /**
   * Merge externally-read tracks — dropped files or a future import — without touching the roots.
   *
   * Returns what actually landed, in the caller's order, so the caller can tell "added 3 of 5" from
   * "nothing, they were already here" instead of assuming success.
   */
  importTracks(incoming: StoredTrack[]): StoredTrack[] {
    const added = incoming.filter((t) => t.id && !this.ids.has(t.id));
    if (added.length > 0) {
      for (const t of added) this.ids.add(t.id);
      this.tracks = [...this.tracks, ...added];
      void this.persist();
    }
    return added;
  }

  /**
   * Re-scan every known folder to pick up files added since the last scan.
   *
   * `scan()` already dedupes on the path-derived id and refuses a root it already has, so a refresh
   * is the same call with append on — new files land, existing ones are skipped. Deleted files are
   * not pruned here; that is a separate, deliberately rarer operation because it has to be sure a
   * missing file is missing and not just on an unmounted drive.
   */
  async refresh(): Promise<number> {
    if (this.scanning || this.roots.length === 0) return 0;
    const before = this.tracks.length;
    for (const root of this.roots) {
      await this.scan(root, { append: true });
    }
    return this.tracks.length - before;
  }

  /**
   * Start watching for new music.
   *
   * Re-scanning on window focus plus a slow timer is the honest low-cost version of a file watcher.
   * A real `notify`-based watcher in Rust would catch changes while the app is in the background,
   * but it means a second source of truth for what is on disk and a whole set of debounce bugs;
   * nobody adds forty files a minute to a music folder.
   */
  startAutoScan(getInterval: () => number): () => void {
    const onFocus = () => {
      if (document.visibilityState === "visible") void this.refresh();
    };
    let timer = setInterval(() => void this.refresh(), Math.max(60_000, getInterval()));
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      timer = 0 as unknown as ReturnType<typeof setInterval>;
    };
  }

  private async persist(): Promise<void> {
    try {
      await libraryStorage.save(this.roots, this.tracks);
    } catch (e) {
      this.error = `Library scanned but could not be saved: ${String(e)}`;
    }
  }
}

export const library = new LibraryStore();
