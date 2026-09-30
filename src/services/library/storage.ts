/**
 * Library persistence, behind a deliberately small interface.
 *
 * The rest of the app only ever sees `load` and `save`. Today those are a JSON file written by
 * Rust; when a library grows past a few thousand tracks, the same two functions can be re-pointed
 * at `tauri-plugin-sql` without any caller changing. That seam is the only reason this file
 * exists — see the spec's "do not build SQLite in Phase 1–3" constraint.
 */
import { invoke } from "@tauri-apps/api/core";

export type StoredTrack = {
  id: string;
  path: string;
  title: string;
  artist: string;
  albumArtist: string;
  album: string;
  genre: string;
  year: number;
  trackNo: number;
  discNo: number;
  duration: number;
  artworkPath: string | null;
  codec: string;
  bitrate: number;
  sampleRate: number;
  bitDepth: number;
};

type LibraryShape = { roots: string[]; tracks: StoredTrack[] };

export const libraryStorage = {
  async load(): Promise<LibraryShape | null> {
    return (await invoke<LibraryShape | null>("load_library")) ?? null;
  },

  async save(roots: string[], tracks: StoredTrack[]): Promise<void> {
    await invoke("save_library", { roots, tracks });
  },
};
