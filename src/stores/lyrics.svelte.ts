import { getLyrics, type LyricsQuery } from "../services/lyrics/lyrics";
import type { Lyrics } from "../services/lyrics/lrc";

/**
 * The lyrics for whichever track is loaded.
 *
 * Kept out of the player store on purpose: playback must never wait on this. A slow or failed
 * lookup leaves the song playing and the lyrics panel saying so.
 */
class LyricsStore {
  status = $state<"idle" | "loading" | "ready" | "none" | "error">("idle");
  lyrics = $state<Lyrics | null>(null);
  message = $state("");

  /**
   * Bumped on every request so a slow answer for the previous track cannot land after a fast one
   * for the current track and paint the wrong words. Without this the race is real and easy to hit:
   * skipping quickly between two songs shows one while playing the other.
   */
  private seq = 0;

  async load(query: LyricsQuery, force = false): Promise<void> {
    const mine = ++this.seq;

    this.status = "loading";
    this.message = "";
    // Drop the outgoing track's words immediately. Leaving them up while the new set loads is what
    // made the scroll jump to a line that was never going to be sung: the active index was being
    // computed against the previous song's timings.
    this.lyrics = null;

    try {
      const result = await getLyrics(query, force);
      if (mine !== this.seq) return; // a newer request has already gone out
      if (result.ok) {
        this.lyrics = result.lyrics;
        this.status = result.lyrics.lines.length ? "ready" : "none";
      } else {
        this.lyrics = null;
        this.status = result.reason.startsWith("No lyrics") ? "none" : "error";
        this.message = result.reason;
      }
    } catch (e) {
      if (mine !== this.seq) return;
      this.status = "error";
      this.message = e instanceof Error ? e.message : String(e);
    }
  }

  clear() {
    this.seq++;
    this.status = "idle";
    this.lyrics = null;
    this.message = "";
  }

  /**
   * Land on an empty lyrics panel that says why, used by the manual cache actions.
   *
   * `clear()` leaves the status idle, which renders nothing at all — so "Saved lyrics removed" and
   * "Nothing was saved for this track" would both look like the panel simply went blank. Bumping the
   * sequence also abandons an in-flight lookup, or it would come back and overwrite the report with
   * words for a cache entry that was just deleted.
   */
  report(message: string) {
    this.seq++;
    this.status = "none";
    this.lyrics = null;
    this.message = message;
  }
}

export const lyricsStore = new LyricsStore();
