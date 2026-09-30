/**
 * Cross-window bridge between the main window and the floating mini-player.
 *
 * The main window is the only place an audio element exists, so it is authoritative. It pushes a
 * snapshot over Tauri events and the card just renders it; button presses come back as commands.
 *
 * Snapshots are pushed on a 250ms timer rather than reactively. The player store's position updates
 * around 15 times a second, and serialising an event across the process boundary at that rate for
 * a card nobody is measuring to the frame is pure waste.
 */
import { emit, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { player } from "../stores/player.svelte";
import { ui } from "../stores/ui.svelte";
import { lyricsStore } from "../stores/lyrics.svelte";
import { favorites } from "../stores/favorites.svelte";

const PUSH_INTERVAL_MS = 250;

export function miniSnapshot() {
  return {
    title: player.current.title,
    artist: player.current.artist,
    album: player.current.album,
    artwork: player.current.artwork,
    position: player.position,
    duration: player.duration,
    playing: player.isPlaying,
    /**
     * The media element's `waiting`/`canplay` state, which only the main window can see. The card's
     * waiting dots have to stop on a stall: their motion is a CSS animation, so it keeps running when
     * the audio has stopped, and dots dancing over a frozen clock say the opposite of the truth.
     */
    buffering: player.isBuffering,
    accent: player.accent,
    /** Carried on the existing snapshot so the card's heart reflects reality without a second event. */
    liked: favorites.has(player.current.id),
    volume: player.volume,
    /** The card's volume pill draws its speaker glyph differently when muted, so it has to know. */
    muted: player.muted,
  };
}

/** Open or close the desktop card, keeping `ui.miniOpen` in step with what Rust actually did. */
export async function toggleMiniWindow(): Promise<void> {
  try {
    ui.miniOpen = await invoke<boolean>("toggle_mini");
  } catch (e) {
    ui.miniOpen = false;
    player.error = `Could not open the mini-player: ${String(e)}`;
  }
}

/**
 * Sent once per lyric change rather than on the 250ms tick — pushing fifty lines four times a
 * second across a process boundary for a card that already has them is pure waste.
 */
function pushLyrics(): void {
  const l = lyricsStore.lyrics;
  if (!l) return;
  void emit("lyrics-state", {
    // `words` travels with the line, or the desktop card can only ever show line-level highlighting —
    // and it would fall behind the fullscreen view on a word-timed file.
    lines: l.lines.map((x) => ({ time: x.time, text: x.text, words: x.words })),
    level: l.level,
  });
}

/** Run the main-window half of the bridge. Returns a teardown function. */
export function startMainBridge(): () => void {
  let stopped = false;

  // Re-derive the mirror before the timers read it. Reloading this window resets `ui.miniOpen` to
  // false while an already-visible card stays on screen, and every push below is gated on that flag
  // — so without this the card freezes in place and never hears about a track or style change.
  //
  // One-way on purpose. `mini_visible` answers `is_visible().unwrap_or(false)`, so it reports false
  // both when the window is genuinely hidden and whenever the command is unavailable or errors — and
  // measured against this particular window the query cannot be trusted even in the success path (the
  // card's own `appWindow.isVisible()` returned false while it was the focused, on-screen window).
  // Writing the flag from a false answer is therefore what closes the gate on a card that is plainly
  // visible, which is BUG-087. Only a yes is acted on; a card that is really shut is healed by its own
  // close command, and a card that goes unheard asks again from its watchdog.
  void invoke<boolean>("mini_visible")
    .then((visible) => {
      if (!stopped && visible) ui.miniOpen = true;
    })
    .catch(() => {
      /* No mini window declared: leave the flag at its default and let the card stay closed. */
    });

  const timer = setInterval(() => {
    if (stopped || !ui.miniOpen) return;
    void emit("player-state", miniSnapshot());
  }, PUSH_INTERVAL_MS);

  // Re-send the words whenever they change while the card is open, and once on open.
  let lastLyrics: unknown = null;
  const lyricsTimer = setInterval(() => {
    if (stopped || !ui.miniOpen) return;
    if (lyricsStore.lyrics === lastLyrics) return;
    lastLyrics = lyricsStore.lyrics;
    pushLyrics();
  }, 500);

  const unlisten = listen<string>("mini-command", async (event) => {
    // The scrubber reports a fraction of the track rather than a position, because the card is
    // working from a snapshot that is up to 250ms old and has no business computing seconds.
    if (event.payload.startsWith("seek:")) {
      const f = Number(event.payload.slice(5));
      if (Number.isFinite(f) && player.duration > 0) {
        player.seek(Math.min(1, Math.max(0, f)) * player.duration);
      }
      return;
    }
    // Same reasoning for the card's volume pill: it drags a 0–1 thumb, the main window owns the
    // actual audio element and the persisted setting.
    if (event.payload.startsWith("vol:")) {
      const v = Number(event.payload.slice(4));
      if (Number.isFinite(v)) player.setVolume(Math.min(1, Math.max(0, v)));
      return;
    }
    switch (event.payload) {
      case "toggle":
        void player.toggle();
        break;
      case "next":
        void player.next();
        break;
      case "prev":
        void player.previous();
        break;
      case "mute":
        // A toggle, not a set: the card's own copy of the mute state can be up to 250ms stale, and
        // sending the boolean it believes would write that stale value back over the real one.
        player.setMuted(!player.muted);
        break;
      case "favorite": {
        const id = player.current?.id;
        if (id) favorites.toggle(id);
        break;
      }
      /*
         The card's orb row. The fullscreen surface has always had Library / album view / Settings /
         Close on the sleeve and the card only had Close, so the two read as different products. These
         raise the main window as well as routing it — a card that changed the view behind an
         unfocused main window would look like nothing happened at all.
      */
      case "show-library":
      case "show-fullscreen":
      case "show-settings": {
        const win = getCurrentWindow();
        void win.unminimize().catch(() => {});
        void win.show().catch(() => {});
        void win.setFocus().catch(() => {});
        if (event.payload === "show-library") ui.set("library");
        else if (event.payload === "show-settings") ui.set("settings");
        else ui.openFullscreen();
        break;
      }
      case "sync":
        /*
           The card just (re)loaded and has nothing. Its document can restart independently of this
           one — a Vite full reload, or the window being recreated.

           Restoring the mirror is the part that matters. The 250ms push below is gated on
           `ui.miniOpen`, and that flag is only re-derived from OS truth when *this* window starts up.
           So a card that reloads on its own leaves the mirror false, the gate closed, and the card
           frozen on the single frame pushed here — correct title and artwork, but a clock stuck at
           0:00 and no lyric movement, which is what "the mini player is glitchy" had been describing.
           A card that just asked for state is by definition on screen.
        */
        ui.miniOpen = true;
        lastLyrics = null;
        pushLyrics();
        void emit("player-state", miniSnapshot());
        return;

      case "close":
        // Hide the actual window as well as the mirror. Clearing only `ui.miniOpen` left the card on
        // screen with every push below gated off, so it sat there frozen on the last frame it had.
        ui.miniOpen = false;
        lastLyrics = null;
        void invoke("hide_mini").catch(() => {});
        return;
    }
    if (ui.miniOpen) void emit("player-state", miniSnapshot());
  });

  return () => {
    stopped = true;
    clearInterval(timer);
    clearInterval(lyricsTimer);
    unlisten.then((f) => f());
  };
}
