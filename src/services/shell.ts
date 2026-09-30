/**
 * Small wrappers over the Rust commands that touch the OS shell.
 *
 * Failures are surfaced through the player's error channel rather than thrown: nothing here is on
 * the playback path, and a reveal that could not run should not look like the song broke.
 */
import { invoke } from "@tauri-apps/api/core";
import { player } from "../stores/player.svelte";

/** Open File Explorer with the track's file selected. */
export async function revealInExplorer(path: string): Promise<void> {
  if (!path) return;
  try {
    await invoke("reveal_in_explorer", { path });
  } catch (e) {
    player.error = `Could not reveal the file: ${String(e)}`;
  }
}

/** Open an https link in the user's default browser. */
export async function openExternal(url: string): Promise<void> {
  try {
    await invoke("open_url", { url });
  } catch (e) {
    player.error = `Could not open the link: ${String(e)}`;
  }
}
