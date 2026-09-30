/**
 * Dropping audio files onto the window.
 *
 * Uses Tauri's own drag-drop events rather than DOM `drop` handlers: the webview hands the browser
 * a synthetic drag containing no usable file paths for a real OS file, so `dataTransfer` would give
 * nothing to work with. Rust resolves the paths and `scan_paths` reads them the same way the folder
 * scanner does, so a dropped track is indistinguishable from a scanned one.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { appDataDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { library } from "../stores/library.svelte";
import { player } from "../stores/player.svelte";
import type { StoredTrack } from "./library/storage";

/** True while files are hovering over the window, so the shell can show a target. */
export const dropActive = { over: false };

export async function startDragDrop(): Promise<() => void> {
  let unlisten: (() => void) | null = null;
  try {
    unlisten = await getCurrentWebview().onDragDropEvent((event) => {
      const kind = event.payload.type;
      if (kind === "enter" || kind === "over") {
        dropActive.over = true;
        return;
      }
      if (kind === "leave") {
        dropActive.over = false;
        return;
      }
      if (kind === "drop") {
        dropActive.over = false;
        void ingest(event.payload.paths);
      }
    });
  } catch {
    // Not running under Tauri (a plain browser tab during development): nothing to hook.
    return () => {};
  }
  return () => unlisten?.();
}

async function ingest(paths: string[]): Promise<void> {
  const audio = paths.filter((p) => /\.(mp3|flac|wav|m4a|mp4|aac|ogg|oga|opus)$/i.test(p));
  if (audio.length === 0) {
    library.error = "No playable audio files in that drop.";
    return;
  }
  try {
    const cacheDir = `${await appDataDir()}/artwork`;
    const found = await invoke<StoredTrack[]>("scan_paths", { paths: audio, cacheDir });
    if (found.length === 0) {
      library.error = "Those files could not be read.";
      return;
    }
    const added = library.importTracks(found);
    // Play the first dropped file immediately — dropping a song onto a player means "play this".
    if (added.length > 0) player.playFrom(added[0].id);
  } catch (e) {
    library.error = `Could not add the dropped files: ${String(e)}`;
  }
}
