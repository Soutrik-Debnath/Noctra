export type View =
  | "home"
  | "library"
  | "playlists"
  | "favorites"
  | "settings"
  /** Reached by expanding the mini-player, not from the sidebar. */
  | "nowplaying"
  /** Full-bleed lyrics over the artwork, the reference's headline screen. */
  | "lyrics"
  /** Library and listening statistics. */
  | "stats"
  /** Drill-down pages. Which album/artist/playlist is held in `param`. */
  | "album"
  | "artist"
  | "playlist";

class UiStore {
  view = $state<View>("home");
  /**
   * Parameter for the drill-down views: an album key, an artist name, or a playlist id. Kept beside
   * `view` rather than in a router because there is no history to maintain — back always returns to
   * Library, and a URL scheme would be a lot of machinery for a desktop window.
   */
  param = $state("");
  /** Mirrors whether the floating desktop card window is open. */
  miniOpen = $state(false);
  /**
   * Where to land when the fullscreen is dismissed. There is no history stack, so this is the one
   * entry the fullscreen needs: opening it from an album and closing it back onto that album is
   * what makes it feel like a layer over the app rather than a page you get lost in.
   */
  returnTo = $state<View>("home");
  /** The queue panel slides over the content area rather than replacing it. */
  queueOpen = $state(false);

  set(view: View, param = "") {
    this.view = view;
    this.param = param;
  }

  /** Drill into an album, artist or playlist from a card, a row or the command palette. */
  openAlbum(albumKey: string) {
    this.set("album", albumKey);
  }

  openArtist(artist: string) {
    this.set("artist", artist);
  }

  openPlaylist(id: string) {
    this.set("playlist", id);
  }

  /** Back from a drill-down. Library is where the album/artist lists live. */
  back() {
    if (this.view === "album" || this.view === "artist" || this.view === "playlist") {
      this.set("library");
    }
  }

  toggleQueue() {
    this.queueOpen = !this.queueOpen;
  }

  /**
   * Open the one fullscreen surface — artwork on the left, lyrics on the right.
   *
   * This used to be two destinations: a Now Playing view with just the artwork, and a separate
   * Lyrics view reached from its own button. The owner asked for one, which is the right call,
   * because the second was a strictly smaller version of the first.
   */
  openFullscreen() {
    if (this.view === "lyrics") return;
    if (this.view !== "nowplaying") this.returnTo = this.view;
    this.set("lyrics");
  }

  closeFullscreen() {
    this.set(this.returnTo || "home", this.view === this.returnTo ? this.param : "");
  }

  /** The window itself is created and destroyed in Rust; this only tracks intent for the UI. */
  toggleMini() {
    this.miniOpen = !this.miniOpen;
  }
}

export const ui = new UiStore();
