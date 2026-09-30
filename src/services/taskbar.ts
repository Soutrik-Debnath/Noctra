import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { player } from "../stores/player.svelte";
import { favorites } from "../stores/favorites.svelte";
import { leadArtist } from "../data/track";

/**
 * Bridge to the native Windows taskbar thumbnail toolbar.
 *
 * The buttons themselves are drawn by the shell from `HICON`s made in Rust (see
 * `src-tauri/src/taskbar.rs`); this file only routes clicks and pushes glyph state. Commands are
 * fire-and-forget because a glyph that lags one frame is not worth blocking playback on.
 */

let wired = false;

const appWindow = getCurrentWindow();

export async function startTaskbarBridge(): Promise<void> {
  if (wired) return;
  wired = true;

  await listen<string>("taskbar-command", (event) => {
    switch (event.payload) {
      case "prev":
        void player.previous();
        break;
      case "toggle":
        void player.toggle();
        break;
      case "next":
        void player.next();
        break;
      case "favorite": {
        const id = player.current?.id;
        if (id) favorites.toggle(id);
        break;
      }
    }
  });
}

export function syncTaskbarPlaying(playing: boolean): void {
  void invoke("taskbar_set_playing", { playing });
}

export function syncTaskbarFavorite(favorite: boolean): void {
  void invoke("taskbar_set_favorite", { favorite });
}

/**
 * "Track — Artist" in the shell's own labels: the taskbar tooltip, the hover thumbnail header and
 * Alt+Tab all read the window title, so leaving it as "Noctra" makes every song look identical
 * there. The lead name is used rather than the full credits tag so the label stays short.
 */
export function syncWindowTitle(): void {
  const title = player.current?.title?.trim() ?? "";
  if (!title) {
    void appWindow.setTitle("Noctra");
    return;
  }
  const artist = leadArtist(player.current.artist ?? "");
  void appWindow.setTitle(artist ? `${title} - ${artist}` : title).catch(() => {});
}
