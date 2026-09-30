/**
 * A transient line of feedback for actions that have no panel to speak through.
 *
 * Most results have a natural home — deleting the current track's saved lyrics can show in the lyrics
 * column itself. The ones that do not are the ones that used to fail silently: clearing a cache entry
 * for a track that is not playing, or skipping past a file that would not decode. Rather than give
 * each of those its own ad-hoc message state, they report here.
 *
 * Auto-clears, because a notice that hangs around becomes a stale claim about something the user has
 * long since moved past.
 */

const SHOW_MS = 4200;

class NoticeStore {
  text = $state("");
  /** "info" is neutral; "bad" is for something the user should know went wrong. */
  tone = $state<"info" | "bad">("info");

  private timer: ReturnType<typeof setTimeout> | null = null;

  get visible(): boolean {
    return this.text !== "";
  }

  say(text: string, tone: "info" | "bad" = "info") {
    this.text = text;
    this.tone = tone;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismiss(), SHOW_MS);
  }

  dismiss() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.text = "";
  }
}

export const notice = new NoticeStore();
