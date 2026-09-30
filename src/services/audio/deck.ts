import type { EngineEvents } from "./engine";

export type DeckRole = "active" | "arming" | "fading-out" | "idle";

export type DeckEvent = keyof EngineEvents;

/** The subset of HTMLAudioElement this module uses, so tests can inject a fake. */
export interface MediaLike {
  src: string;
  preload: string;
  volume: number;
  muted: boolean;
  currentTime: number;
  readonly duration: number;
  readonly readyState: number;
  readonly error: { code: number } | null;
  load(): void;
  play(): Promise<void>;
  pause(): void;
  addEventListener(type: string, listener: () => void): void;
  removeEventListener(type: string, listener: () => void): void;
}

const EVENT_BY_MEDIA_TYPE: Record<string, DeckEvent> = {
  play: "playing",
  pause: "paused",
  ended: "ended",
  waiting: "waiting",
  canplay: "ready",
  error: "error",
  durationchange: "duration",
  loadedmetadata: "duration",
};

/**
 * One media element plus the role that decides whether anyone may hear about it.
 *
 * Only the authoritative deck forwards events. That single rule is what stops the two silent
 * failures in the spec: a standby deck feeding the position clock would double-count listening
 * time, and the outgoing deck's `ended` would advance the run a second time mid-fade.
 */
export class Deck {
  role: DeckRole = "idle";
  /** 0..1 fade multiplier. Never touches the element directly; use `applyVolume`. */
  ramp = 1;
  loadedSource: string | null = null;

  get authoritative(): boolean {
    return this.role === "active";
  }

  get ready(): boolean {
    return this.media.readyState >= 3;
  }

  get currentTime(): number {
    return this.media.currentTime;
  }

  get duration(): number {
    return Number.isFinite(this.media.duration) ? this.media.duration : 0;
  }

  private readonly media: MediaLike;
  private readonly forward: (event: DeckEvent, payload?: unknown) => void;

  // Plain assignments, not constructor parameter properties: this project runs the tests through
  // Node's type stripping, which rejects parameter properties ("ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX").
  constructor(factory: () => MediaLike, forward: (event: DeckEvent, payload?: unknown) => void) {
    this.forward = forward;
    this.media = factory();
    this.media.preload = "metadata";
    for (const [type, event] of Object.entries(EVENT_BY_MEDIA_TYPE)) {
      this.media.addEventListener(type, () => this.onMediaEvent(type, event));
    }
  }

  private onMediaEvent(type: string, event: DeckEvent) {
    // One gate, one rule: a deck nobody is listening to says nothing, except on error. Readiness
    // needs no tracking here - `ready` reads the element directly.
    if (!this.authoritative && event !== "error") return;
    if (event === "duration") {
      const d = this.duration;
      if (d > 0) this.forward("duration", d);
      return;
    }
    if (event === "error") {
      // `media` is private, so the MediaError code only survives if it rides on the event — the
      // store needs it to build the user-facing message (spec §7). No error object reports null.
      this.forward("error", this.media.error?.code ?? null);
      return;
    }
    this.forward(event);
  }

  /**
   * Load a source if it is not already the loaded one. Returns whether a load happened.
   *
   * `bufferAhead` separates the two decks' different jobs. A deck about to be heard should not ask
   * Chromium to pull the whole file first; a deck with a song's worth of runway and nothing else to do
   * should. Measured honestly: this is not the fix for slow first play — a cold 30MB FLAC through
   * `noctra-audio://` takes ~9-12s either way, because throughput on a first read is only a few MB/s.
   * An earlier version of this comment claimed an 18x win from `preload = "metadata"`; that reading was
   * confounded, because the second run used a file the first run had already pulled into cache.
   */
  arm(url: string, bufferAhead = false): boolean {
    if (this.loadedSource === url) return false;
    this.loadedSource = url;
    this.role = "arming";
    this.ramp = 1;
    this.media.preload = bufferAhead ? "auto" : "metadata";
    this.media.src = url;
    this.media.load();
    return true;
  }

  async startAtZero(): Promise<void> {
    this.media.currentTime = 0;
    await this.media.play();
  }

  /**
   * Move the playhead. Clamping to the end of the track stays in the engine, which is the one that
   * knows the duration rule (`duration - 0.05`).
   *
   * A non-finite value is rejected rather than passed on: `currentTime` is a WebIDL `double`, and
   * Chromium throws a `TypeError` when it is given `NaN`, which would take the seek with it.
   */
  seekTo(seconds: number): void {
    if (!Number.isFinite(seconds)) return;
    this.media.currentTime = Math.max(0, seconds);
  }

  pause(): void {
    this.media.pause();
  }

  /** `media` is private on purpose — the engine must not reach through the deck. */
  play(): Promise<void> {
    return this.media.play();
  }

  applyVolume(userVolume: number, muted: boolean): void {
    this.media.volume = Math.max(0, Math.min(1, userVolume * this.ramp));
    this.media.muted = muted;
  }

  release(): void {
    this.role = "idle";
    this.ramp = 1;
    this.loadedSource = null;
    this.media.pause();
    this.media.src = "";
    this.media.load();
  }
}
