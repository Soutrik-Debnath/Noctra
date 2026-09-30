/**
 * Playback engine — the only place that touches an audio element.
 *
 * Kept deliberately separate from the Svelte store: this module owns *how* sound happens, the
 * store owns *what should be playing*. Components talk to the store, never to this directly.
 *
 * There are two long-lived decks now (`deck.ts`), and the two jobs stay split: `handoff.ts` decides
 * *when* to change over, `fade.ts` does the gain maths, and this file is the only thing that talks
 * to an element. One deck is authoritative at any instant and it is the only one anyone can hear
 * events from, which is what makes the two hazards in spec §2 structurally impossible rather than
 * call-site guards: a standby deck cannot feed the position clock, and the outgoing deck's `ended`
 * cannot advance the run a second time mid-fade.
 *
 * Local files reach the webview through Noctra's own `noctra-audio://` scheme, which streams the
 * bytes and repairs a FLAC tag quirk that otherwise makes Chromium reject the file outright. See
 * `src-tauri/src/audio_protocol.rs` and BUG-008.
 */
import { localFileUrl } from "./sourceUrl";
import { Deck, type DeckEvent, type MediaLike } from "./deck";
import { clampFadeSeconds, rampAt } from "./fade";
import { decideHandoff } from "./handoff";

export type EngineEvents = {
  position: (seconds: number) => void;
  duration: (seconds: number) => void;
  playing: () => void;
  paused: () => void;
  ended: () => void;
  waiting: () => void;
  ready: () => void;
  /**
   * The MediaError code arrives on the deck event (a deck's element is private) and is turned into
   * this message here, so the store still only ever deals in words.
   */
  error: (message: string) => void;
  /**
   * A handoff completed: the incoming deck is now the audible one and the store should advance to
   * the track it was standing in for. Emitted after `duration` and `position(0)`, never twice.
   *
   * Optional until the store binds it — the seam exists so a track can change without an `ended`,
   * and requiring the handler in the same commit that introduces it would not compile against the
   * store as it is today.
   */
  handoff?: () => void;
};

/** Progress poll rate. ~15Hz is smooth to the eye and cheap; the native `timeupdate` at 4Hz steps. */
const CLOCK_INTERVAL_MS = 66;

/** Gain recomputation rate while a handoff is crossing over. Two decks must not be summed at unity. */
const RAMP_TICK_MS = 25;

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function describeError(code: number | null): string {
  switch (code) {
    case 1:
      return "Playback aborted";
    case 2:
      return "Network error reading the file";
    case 3:
      return "The file is corrupt or its format is unsupported";
    case 4:
      return "This file cannot be played — the format is unsupported, or the asset protocol is not permitted to read it";
    default:
      return "Unknown playback error";
  }
}

/**
 * A short buffer of digital silence as an object URL.
 *
 * Used only to wake up the audio output pipeline. Built at runtime rather than embedded as
 * base64 so there is nothing to keep in sync.
 */
function silenceUrl(seconds = 0.25): string {
  const rate = 8000;
  const samples = Math.floor(rate * seconds);
  const buf = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buf);
  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) v.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, "RIFF");
  v.setUint32(4, 36 + samples * 2, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, "data");
  v.setUint32(40, samples * 2, true);
  // Sample bytes are already zero, which is silence.
  return URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
}

class AudioEngine {
  /** Created once and reused for the life of the process: roles swap, decks do not (spec §4.1). */
  private readonly decks: [Deck, Deck];
  private activeIndex = 0;
  private handlers: EngineEvents | null = null;
  private clock: ReturnType<typeof setInterval> | 0 = 0;
  private rampTimer: ReturnType<typeof setInterval> | 0 = 0;
  private warmProbe: HTMLAudioElement | null = null;

  private fadeStartedAt = 0;
  private fadeSeconds = 0;
  /** Where the ramp clock stood when a pause froze it, so resume continues instead of restarting. */
  private fadeElapsedAtPause = 0;
  /** `beginHandoff` awaits the incoming deck, so the flip itself is not atomic. */
  private handoffInFlight = false;
  /** Bumped by every disarm, so a handoff that was starting when it happened can notice and stop. */
  private handoffEpoch = 0;

  private userVolume = 1;
  private muted = false;
  private gapless = true;
  private crossfadeSec = 0;

  /** The URL sitting on the standby deck, awaiting a handoff. Nothing else may call it "up next". */
  private pendingSource: string | null = null;
  /**
   * The boundary we have given up on. `decideHandoff` is level-triggered and answers `abort-fade`
   * on every tick until state changes, and the store may keep calling `prepare()` with the same
   * source — without this the standby would be released and re-loaded every 66 ms.
   */
  private abandonedSource: string | null = null;
  /** A standby that failed to load. Kept so the failure is still explained when it matters (§7). */
  private failedSource: string | null = null;
  private failedCode: number | null = null;
  /** Whether the authoritative deck is currently producing sound, for `resetAudio` to restore. */
  private wasPlaying = false;
  /** Position `resetAudio` is trying to land on, applied once the new deck can be seeked. */
  private restoreAt: number | null = null;

  private get active(): Deck {
    return this.decks[this.activeIndex];
  }

  private get standby(): Deck {
    return this.decks[1 - this.activeIndex];
  }

  constructor() {
    // Each deck is told which slot it occupies, so a payload-bearing event can be routed by *which*
    // deck sent it. That is not a second authoritativeness check — `Deck` already owns that one.
    const forwarder = (index: number) => (event: DeckEvent, payload?: unknown) =>
      this.forward(index, event, payload);
    this.decks = [
      new Deck(() => this.newMedia(), forwarder(0)),
      new Deck(() => this.newMedia(), forwarder(1)),
    ];
    this.decks[0].role = "active";
  }

  /**
   * The element factory handed to `Deck`. Declared `MediaLike` on purpose: the assignment is
   * checked here, so `HTMLAudioElement` drifting away from what a deck needs is a compile error
   * rather than a runtime surprise — no `as unknown as` covering it up.
   */
  private newMedia(): MediaLike {
    return new Audio();
  }

  /** `inTauri ? localFileUrl(source) : source`, in one place so arming and playing cannot differ. */
  private toUrl(source: string): string {
    return inTauri ? localFileUrl(source) : source;
  }

  bind(handlers: EngineEvents) {
    this.handlers = handlers;
  }

  /**
   * The single seam between the decks and the store.
   *
   * Whether a deck may speak at all is decided inside `Deck`, and is not re-decided here — this
   * function is reached only by decks that were allowed to talk. What happens here is routing:
   * payloads get unwrapped, the clock follows the audible deck, and a standby's failure is kept to
   * ourselves instead of reaching the store's error handler, which would pause the interface while
   * a perfectly healthy track is still playing (spec §7).
   */
  private forward(index: number, event: DeckEvent, payload: unknown) {
    const h = this.handlers;
    // Events can fire before the store has bound its handlers.
    if (!h) return;
    const deck = this.decks[index];

    switch (event) {
      case "position":
      case "handoff":
        // Never emitted by a deck: position is polled by the clock, and `handoff` is emitted by the
        // flip. Listing them keeps this exhaustive instead of quietly swallowing a new event later.
        return;
      case "duration": {
        const seconds = typeof payload === "number" ? payload : deck.duration;
        h.duration(seconds);
        this.tryRestore(deck);
        return;
      }
      case "error": {
        const code = typeof payload === "number" ? payload : null;
        if (deck.authoritative) h.error(describeError(code));
        else if (deck.role === "arming" && deck.loadedSource) {
          this.failedSource = deck.loadedSource;
          this.failedCode = code;
          this.abandonHandoff();
        }
        // A fading-out deck that trips cannot break the handoff — the incoming deck is already
        // audible — so that error is dropped rather than pausing the UI over live audio.
        return;
      }
      case "playing":
        this.wasPlaying = true;
        this.startClock();
        h.playing();
        return;
      case "paused":
        this.wasPlaying = false;
        h.paused();
        this.stopClock(deck);
        return;
      case "ended":
        this.wasPlaying = false;
        this.stopClock(deck);
        h.ended();
        return;
      case "waiting":
        h.waiting();
        return;
      case "ready":
        h.ready();
        this.tryRestore(deck);
        return;
    }
  }

  /**
   * Wake the audio output pipeline up during startup so the user never feels it.
   *
   * Measured on this machine: `warmUpOutput()` itself takes ~6.8 seconds, and a real play started
   * immediately afterwards takes ~670ms. That is the one-time output-device initialisation, paid by
   * whichever element renders sound first. Doing it here against a quarter second of silence moves
   * it behind app launch, where it is invisible.
   *
   * Requires the autoplay policy to allow a gesture-less start; see `additionalBrowserArgs` in
   * tauri.conf.json. If it is ever blocked, this fails silently and only the first real play is
   * slow again — it can never break playback.
   *
   * Deliberately uses its own throwaway probe: it must never touch a deck, because a deck is now a
   * long-lived object whose element is the one the handoff logic is watching.
   */
  async warmUpOutput(): Promise<void> {
    if (!inTauri || this.warmProbe) return;
    const url = silenceUrl();
    const probe = new Audio();
    this.warmProbe = probe;
    try {
      probe.preload = "auto";
      probe.volume = 0;
      probe.src = url;
      await probe.play();
      await new Promise<void>((resolve) => {
        const done = () => {
          probe.pause();
          probe.src = "";
          resolve();
        };
        probe.addEventListener("ended", done, { once: true });
        // Belt and braces: if "ended" never arrives, still let go after the buffer should be done.
        setTimeout(done, 900);
      });
    } catch {
      /* Autoplay blocked or device unavailable — first real play is simply slow, nothing breaks. */
    } finally {
      if (this.warmProbe === probe) this.warmProbe = null;
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Stop warming up. Called the moment the user asks for real playback.
   *
   * Without this the two contend for the same pipeline and the user's play takes as long as the
   * warm-up would have — measured at 7.2s for a click made one second after launch. Aborting hands
   * the initialisation to the play the user actually started instead of making them queue behind a
   * silent buffer they never asked for.
   */
  cancelWarmUp() {
    const probe = this.warmProbe;
    if (!probe) return;
    this.warmProbe = null;
    probe.pause();
    probe.src = "";
  }

  /**
   * Start, resume, or restart the given source on the active deck.
   *
   * `arm()` is idempotent per URL, so the ordinary resume-after-pause path costs nothing: the deck
   * already holds that file and is not reloaded. A *different* URL here is a deliberate move to
   * another track, and spec §8 is clear that a track the user chose never crossfades, so any
   * handoff in flight is dropped first.
   */
  async play(source: string) {
    if (!inTauri) {
      this.handlers?.error("Audio needs the desktop app — run `npm run tauri dev`, not a browser.");
      return;
    }
    this.cancelWarmUp();
    const url = this.toUrl(source);
    const deck = this.active;

    if (deck.loadedSource !== url) {
      // A *different* URL is a deliberate move to another track, and spec §8 is clear that a track
      // the user chose never crossfades. It also deserves a fresh attempt at a boundary that was
      // abandoned earlier. A resume of the same track does neither: pausing and unpausing near the
      // end must not throw away the standby that is already decoded and waiting.
      this.cancelHandoff();
      this.abandonedSource = null;
    }
    // A failure recorded against some other track is history by now; only this file's own can matter.
    if (this.failedSource !== url) {
      this.failedSource = null;
      this.failedCode = null;
    }

    // Read before `arm`, which is a no-op when the URL already matches and would hide that fact.
    const alreadyHolding = deck.loadedSource === url;
    // A suspended crossfade (paused mid-fade, then resumed) keeps its frozen gains; anything else
    // starts the deck at unity.
    const resumingFade = this.decks.some((d) => d.role === "fading-out");
    deck.arm(url);
    deck.role = "active";
    if (!resumingFade) deck.ramp = 1;

    if (alreadyHolding && this.failedSource === url) {
      // Nothing will reload this file, so no fresh error event is coming: say what we were told.
      const code = this.failedCode;
      this.failedSource = null;
      this.failedCode = null;
      this.handlers?.error(describeError(code));
    }

    this.applyDeckVolumes();
    try {
      await deck.play();
    } catch (e) {
      // A rejected play() is almost always the browser autoplay policy or an unreadable source.
      this.handlers?.error(
        e instanceof DOMException && e.name === "NotAllowedError"
          ? "The webview blocked autoplay. Press play again."
          : `Could not start playback: ${String(e)}`,
      );
      return;
    }

    if (resumingFade && this.fadeSeconds > 0) {
      // Continue from the frozen gains rather than restarting the crossover (§8). The pause recorded
      // where the ramp clock stood, which is the only honest place to carry on from: working it out
      // from the incoming deck's gain instead gives the complement of the elapsed time, so resume
      // lands on the wrong side of the fade and the volume jumps by the difference.
      this.fadeStartedAt = performance.now() - this.fadeElapsedAtPause * 1000;
      this.startRamp();
    }
  }

  /**
   * Arm the standby deck for the next source, so it is decoded before the boundary.
   *
   * Idempotent per source, and refuses arming the engine disagrees with — `decideHandoff` has no
   * view of pause, seek, manual navigation, `repeat: "one"`, sleep or settings changes, so the
   * store gates the call (spec §8) and this is the engine's own half of the same safety. A refused
   * arm leaves `pendingSource` alone, which is what makes the handoff unbeginable.
   */
  prepare(source: string): void {
    // §9.3: with the feature off the standby element must never be given a src at all.
    if (!this.gapless) return;
    // While a crossover is running or frozen, the second deck is the one crossing out: arming it
    // would yank it out of the ramp mid-flight and leave a deck at the wrong gain.
    if (this.isFading) return;
    const url = this.toUrl(source);
    if (url === this.abandonedSource) return;
    // A track crossfaded into itself is the same song's head over its own tail, and repeat-one
    // restarts on the active deck. Either way there is nothing to hand off to.
    if (url === this.active.loadedSource) return;
    this.pendingSource = url;
    // The standby is the one place buffering ahead is correct: it has the whole current track to
    // finish loading, and nothing is waiting on it. See `Deck.arm`'s `bufferAhead`.
    this.standby.arm(url, true);
  }

  /**
   * How long the crossover should be. The stored setting is never rewritten; the clamp against the
   * current track's duration happens per tick in `evaluateHandoff`, which is also what §7's
   * "`crossfadeSec >= duration / 2`" row asks for.
   */
  crossfadeTo(seconds: number): void {
    this.crossfadeSec = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  }

  setGapless(on: boolean): void {
    this.gapless = on;
    // Settings changes disarm: re-armed on the next window with the new value (§8).
    if (!on) this.cancelHandoff();
  }

  /** Disarm and release whatever the standby deck is holding. Safe to call at any time, repeatedly. */
  cancelHandoff(): void {
    this.pendingSource = null;
    // Anything in the middle of starting a flip checks this and stands down, so a seek or a manual
    // move cannot be overtaken by the handoff it just cancelled.
    this.handoffEpoch += 1;
    // stopRamp resets both gains to 1, so nothing is left sitting at reduced volume.
    this.stopRamp();
    // After a flip the incoming deck is already `active` and the outgoing one still holds
    // `fading-out`; releasing it is the whole of "cancel a fade in progress". No second `handoff()`
    // is emitted here, because the store already advanced at the flip.
    const fadingOut = this.decks.find((d) => d.role === "fading-out");
    if (fadingOut) fadingOut.release();
    else if (this.standby.loadedSource !== null) this.standby.release();
  }

  /**
   * Give up on this boundary once, for all of them.
   *
   * `abort-fade` is level-triggered: it is answered on every remaining tick, and re-arming the file
   * that just failed would reload it every 66 ms. The first call latches the source, so the current
   * track plays to its true end and advances through `ended` exactly as it did before two decks
   * existed. The latch clears at the next track.
   */
  private abandonHandoff(): void {
    const url = this.pendingSource ?? this.standby.loadedSource;
    if (url === null) return;
    this.abandonedSource = url;
    this.cancelHandoff();
  }

  /** The escape hatch: throw both elements away and keep one clean active deck at the same place. */
  resetAudio(): void {
    const url = this.active.loadedSource;
    const at = this.active.currentTime;
    const resume = this.wasPlaying;
    this.cancelHandoff();
    for (const d of this.decks) d.release();
    this.abandonedSource = null;
    this.failedSource = null;
    this.failedCode = null;
    // The only place a Deck is replaced. Phase 9 needs it because `createMediaElementSource` is
    // permanent per element; the new deck has no graph attached to it.
    const fresh = new Deck(() => this.newMedia(), (event, payload) =>
      this.forward(0, event, payload),
    );
    fresh.role = "active";
    this.decks[0] = fresh;
    this.activeIndex = 0;
    if (!url) {
      this.applyDeckVolumes();
      return;
    }
    fresh.arm(url);
    fresh.role = "active";
    this.restoreAt = Number.isFinite(at) && at > 0 ? at : null;
    this.applyDeckVolumes();
    // The point of the reset is to leave sound where it was, so a reset that found the user playing
    // resumes. A refused start is reported rather than left as a silent, apparently playing app.
    if (resume) {
      fresh.play().catch(() => this.handlers?.error("Could not resume playback — press play."));
    }
  }

  /** True while a crossover is running *or* frozen by a pause — for the UI and for tests. */
  get isFading(): boolean {
    return this.rampTimer !== 0 || this.decks.some((d) => d.role === "fading-out");
  }

  pause() {
    // A flip is a promise to start sound, and the user has just asked for the opposite. Disarming it
    // here means a pause landing inside `startAtZero` cannot leave a track playing that the store
    // believes is paused: the handoff notices the epoch below, gives up, and the old deck stays.
    this.handoffEpoch += 1;
    this.active.pause();
    // Freeze the ramp rather than let it keep running against paused decks (spec §8). Deliberately
    // not `stopRamp()`: that resets the gains to 1 and resume would jump the volume.
    if (this.rampTimer) {
      clearInterval(this.rampTimer);
      this.rampTimer = 0;
      this.fadeElapsedAtPause = (performance.now() - this.fadeStartedAt) / 1000;
    }
    for (const d of this.decks) if (d.role === "fading-out") d.pause();
  }

  /** Hard-adopt, then move: a seek means "be somewhere else now", so no crossover survives it. */
  seek(seconds: number) {
    if (!Number.isFinite(seconds)) return;
    this.cancelHandoff();
    const deck = this.active;
    const max = deck.duration;
    deck.seekTo(Number.isFinite(max) && max > 0 ? Math.min(seconds, max - 0.05) : seconds);
    this.handlers?.position(deck.currentTime);
  }

  setVolume(v: number) {
    this.userVolume = Math.max(0, Math.min(1, v));
    this.applyDeckVolumes();
  }

  setMuted(m: boolean) {
    this.muted = m;
    this.applyDeckVolumes();
  }

  get duration(): number {
    return this.active.duration;
  }

  /**
   * The one volume formula in the app (spec §6): `userVolume × deck.ramp`, clamped, both decks,
   * mute alongside. Nothing else may write `el.volume`, and this is where ReplayGain (Phase 7) and
   * the EQ pre-amp (Phase 9) multiply in — both below user volume, never past 1.
   */
  private applyDeckVolumes(): void {
    for (const d of this.decks) d.applyVolume(this.userVolume, this.muted);
  }

  /**
   * Progress is polled on a timer rather than driven by requestAnimationFrame.
   *
   * rAF is the obvious choice and it is the wrong one here: Chromium freezes rAF for hidden or
   * fully occluded pages, so the progress bar would stall the moment Noctra went behind another
   * window — while audio kept playing. A timer still runs when hidden (throttled to roughly 1Hz,
   * which is fine for a bar nobody is looking at) and runs at full rate when visible.
   *
   * The same tick is also where the handoff is judged, so the crossover lands within one 66 ms
   * step of the boundary and inherits that throttling: hidden behind another window it drifts to
   * roughly one decision a second, which is late but never wrong — the gate is a window, and the
   * deck still hands off.
   */
  private startClock() {
    if (this.clock) return;
    this.clock = setInterval(() => {
      this.handlers?.position(this.active.currentTime);
      this.evaluateHandoff();
    }, CLOCK_INTERVAL_MS);
  }

  private stopClock(deck: Deck = this.active) {
    if (this.clock) {
      clearInterval(this.clock);
      this.clock = 0;
    }
    // Land on the true position rather than the last polled value.
    this.handlers?.position(deck.currentTime);
  }

  private evaluateHandoff(): void {
    // `beginHandoff` awaits the incoming deck, so without this latch the next tick can decide
    // "begin-fade" a second time and flip both decks twice.
    if (this.handoffInFlight) return;
    const action = decideHandoff({
      gapless: this.gapless,
      fadeSeconds: clampFadeSeconds(this.crossfadeSec, this.active.duration),
      position: this.active.currentTime,
      duration: this.active.duration,
      // Only a source that really is sitting on the standby deck counts as up next.
      hasNext: this.pendingSource !== null && this.standby.loadedSource === this.pendingSource,
      armed: this.standby.loadedSource !== null,
      standbyReady: this.standby.ready,
      fading: this.isFading,
    });
    if (action.kind === "begin-fade") void this.beginHandoff(action.fade);
    else if (action.kind === "begin-butt-joint") void this.beginHandoff(0);
    else if (action.kind === "abort-fade") this.abandonHandoff();
    // "arm" is deliberately unhandled: the engine never chooses a track (spec §4.3). Only the store
    // knows what comes next, so only the store calls `prepare()`.
  }

  /**
   * The flip: start the incoming deck, make it the authoritative one, then ramp.
   *
   * `fade <= 0` is the gapless-only butt joint — start, flip, release the outgoing deck, no ramps.
   */
  private async beginHandoff(fade: number): Promise<void> {
    const outgoing = this.active;
    const incoming = this.standby;
    const epoch = this.handoffEpoch;
    this.handoffInFlight = true;
    try {
      // The incoming deck must be silent before it starts. `arm()` leaves its gain at 1, and the
      // outgoing deck is still at 1, so playing first would sum two full-volume tracks: +6 dB, a
      // clipped join, and not the crossover in spec §5 step 5. A butt joint has no ramp to run, so
      // it takes the full gain immediately instead.
      incoming.ramp = fade > 0 ? 0 : 1;
      this.applyDeckVolumes();
      try {
        await incoming.startAtZero();
      } catch {
        // §7: never a hole. The outgoing deck is still playing; drop the handoff and let `ended`
        // do what it has always done.
        return this.abandonHandoff();
      }
      // A seek, a pause or a manual move during that await released the decks and chose a different
      // ending. Starting the flip now would adopt a deck with nothing loaded — silence.
      if (epoch !== this.handoffEpoch) return;

      // Order is spec §5 step 4 and §5.1: role out, role in, duration, position(0), playing, and
      // `handoff` last so the store's advance happens against a UI that already looks like the new
      // track. Duration before position keeps `position <= duration` true at every observable
      // instant, which SMTC and the progress bar both rely on.
      outgoing.role = "fading-out";
      incoming.role = "active";
      this.activeIndex = this.decks.indexOf(incoming);
      this.wasPlaying = true;
      this.startClock();
      this.handlers?.duration(incoming.duration);
      this.handlers?.position(0);
      this.handlers?.playing();
      this.handlers?.handoff?.();
      this.pendingSource = null;
      this.abandonedSource = null;
      if (this.failedSource !== null && this.failedSource !== incoming.loadedSource) {
        this.failedSource = null;
        this.failedCode = null;
      }

      if (fade <= 0) {
        outgoing.release();
        return;
      }
      this.fadeSeconds = fade;
      this.fadeStartedAt = performance.now();
      this.startRamp();
    } finally {
      this.handoffInFlight = false;
    }
  }

  private startRamp(): void {
    if (this.rampTimer) return;
    this.rampTimer = setInterval(() => this.tickRamp(), RAMP_TICK_MS);
  }

  private tickRamp(): void {
    let outgoing: Deck | undefined;
    try {
      const { out, in: gain } = rampAt(
        (performance.now() - this.fadeStartedAt) / 1000,
        this.fadeSeconds,
      );
      this.active.ramp = gain;
      outgoing = this.decks.find((d) => d.role === "fading-out");
      if (outgoing) outgoing.ramp = out;
      this.applyDeckVolumes();
      if (out <= 0) {
        this.stopRamp();
        outgoing?.release();
      }
    } catch {
      // Spec §7's last row: whatever went wrong, hard-adopt the incoming deck so exactly one track
      // is audible, rather than leaving both sitting at reduced gain.
      this.cancelHandoff();
      this.handlers?.error(
        "The crossfade could not be completed; playback continued on the new track.",
      );
    }
  }

  /** Stop ramping and put both decks back at unity gain. */
  private stopRamp(): void {
    if (this.rampTimer) clearInterval(this.rampTimer);
    this.rampTimer = 0;
    this.fadeSeconds = 0;
    for (const d of this.decks) d.ramp = 1;
    this.applyDeckVolumes();
  }

  /**
   * Apply the position `resetAudio` saved, once the rebuilt deck actually has media.
   *
   * Seeking an element with no metadata throws, and the deck exposes no readiness signal to poll
   * before the first event, so the restore waits on the same `duration` / `ready` events the store
   * is driven by. One-shot either way.
   */
  private tryRestore(deck: Deck): void {
    if (this.restoreAt === null) return;
    if (!deck.authoritative || !deck.ready) return;
    const at = this.restoreAt;
    this.restoreAt = null;
    deck.seekTo(at);
    this.handlers?.position(deck.currentTime);
  }
}

/**
 * Two decks for the whole app, swapped rather than recreated.
 *
 * More than two would fight over the output device and multiply the concurrent
 * `noctra-audio://` streams; one cannot hand off without silence.
 */
export const engine = new AudioEngine();
