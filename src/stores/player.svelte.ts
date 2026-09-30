import { engine } from "../services/audio/engine";
import { localFileUrl } from "../services/audio/sourceUrl";
import { library } from "./library.svelte";
import { history } from "./history.svelte";
import { blocked } from "./blocked.svelte";
import { settings, REPEAT_CYCLE, type RepeatMode } from "./settings.svelte";
import { sleep } from "./sleep.svelte";
import { fisherYates, pickRandom } from "../utils/shuffle";
import { creditedArtists, leadArtist, type Track } from "../data/track";

/**
 * Playback state — *what* should be playing. The engine in services/audio decides *how*.
 *
 * The playable list is the scanned library, and nothing else. There is deliberately no demo or
 * sample fallback: an empty library is a real state with a real empty screen, not something to
 * paper over with tracks that point at files that do not exist.
 */

/** Used until the artwork palette has been extracted for a track. */
const DEFAULT_ACCENT = "184 148 108";

/**
 * Seconds before the end at which the standby deck is allowed to start loading the next track.
 *
 * A floor, not a fixed window — a long crossfade still gets `crossfadeSec + 6`. Sized from the
 * measured cold load (8.7–13.7s for a local FLAC through `noctra-audio://`) with room for a slower
 * disk, because a preload that arrives after the boundary is a preload that never happened.
 */
const STANDBY_LEAD_FLOOR = 22;

/** Stand-in for "nothing is loaded". Every field empty so no view has to null-check. */
const EMPTY_TRACK: Track = {
  id: "",
  title: "",
  artist: "",
  albumArtist: "",
  album: "",
  genre: "",
  year: 0,
  trackNo: 0,
  discNo: 0,
  codec: "",
  bitrate: 0,
  sampleRate: 0,
  bitDepth: 0,
  artwork: "",
  source: "",
  duration: 0,
  accent: DEFAULT_ACCENT,
};

function fromLibrary(): Track[] {
  return library.tracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    albumArtist: t.albumArtist ?? "",
    album: t.album,
    genre: t.genre ?? "",
    year: t.year ?? 0,
    trackNo: t.trackNo ?? 0,
    discNo: t.discNo ?? 0,
    codec: t.codec ?? "",
    bitrate: t.bitrate ?? 0,
    sampleRate: t.sampleRate ?? 0,
    bitDepth: t.bitDepth ?? 0,
    artwork: t.artworkPath ? localFileUrl(t.artworkPath) : "",
    source: t.path,
    duration: t.duration,
    accent: DEFAULT_ACCENT,
  }));
}

class PlayerStore {
  index = $state(0);
  isPlaying = $state(false);
  /** True while the element is buffering after a seek or track change. */
  isBuffering = $state(false);
  position = $state(0);
  /** From the audio element's own metadata; 0 until it reports. */
  reportedDuration = $state(0);
  /** Seconds to jump to once the armed track reports a real length. Not reactive: nothing renders it. */
  private pendingResume = 0;
  volume = $state(settings.value.volume);
  muted = $state(settings.value.muted);
  /** Non-empty means playback failed; the UI shows this rather than failing quietly. */
  error = $state("");

  /**
   * Shuffle and repeat live in settings rather than as local state, so they survive a restart and
   * the Settings page can show the same value the player is using.
   */
  get shuffle(): boolean {
    return settings.value.shuffle;
  }
  set shuffle(v: boolean) {
    settings.set("shuffle", v);
    // Force the order to be rebuilt on the next step: off→on needs a permutation, on→off needs the
    // identity order back. Rebuilt here rather than lazily so the queue panel can show what is coming
    // the moment the switch is thrown — the owner reads an empty "next up" as the feature not working.
    this.orderFor = "";
    this.ensureOrder();
  }

  /**
   * "Play similar" as a standing mode.
   *
   * The one-shot on Home queues a run and is done with it. This is the switch the owner asked for:
   * leave it on and every advance — including the ones shuffle picks at random through the rest of the
   * library — is drawn from the neighbourhood of whatever is playing now.
   */
  get similar(): boolean {
    return settings.value.similar;
  }
  set similar(v: boolean) {
    settings.set("similar", v);
    this.orderFor = "";
    this.ensureOrder();
  }

  get repeat(): RepeatMode {
    return settings.value.repeat;
  }
  set repeat(v: RepeatMode) {
    settings.set("repeat", v);
    this.playsLeft = settings.value.repeatTimes;
  }

  get repeatTimes(): number {
    return settings.value.repeatTimes;
  }

  /** Pick the count and switch to it in one action — there is no use for a number with no mode. */
  setRepeatTimes(n: number) {
    const times = Math.max(2, Math.min(20, Math.round(n)));
    settings.set("repeatTimes", times);
    this.repeat = "times";
  }

  /**
   * Plays of the *current* track still owed in "times" mode.
   *
   * Reset whenever a track starts by choice rather than by the run advancing, because "play this
   * one three times" is about the song you just picked, not a budget spent on the last one.
   */
  private playsLeft = settings.value.repeatTimes;

  /**
   * The sequence of track indices to visit. Rebuilt when the library size, the block list or
   * shuffle changes.
   *
   * Blocked tracks are left out here rather than skipped at the moment of playing: a step that
   * lands on a skip is still visibly a skip, and the run length shown anywhere would be a lie.
   */
  private order = $state<number[]>([]);
  private orderFor = "";

  /** What the current `order` was built from. Any change here means the order must be rebuilt. */
  private orderSignature(): string {
    return `${this.tracks.length}:${blocked.trackIds.size}:${blocked.artists.size}:${this.shuffle}:${this.similar}`;
  }

  private ensureOrder() {
    const n = this.tracks.length;
    const signature = this.orderSignature();
    if (n === 0) {
      this.order = [];
      this.orderFor = signature;
      return;
    }
    if (this.orderFor === signature) return;

    this.order = Array.from({ length: n }, (_, i) => i).filter(
      (i) => !blocked.hides(this.tracks[i]),
    );
    if (this.shuffle) fisherYates(this.order);
    if (this.order.length === 0) {
      // Every track is blocked: fall back to the unfiltered order so "next" does nothing silently.
      this.order = Array.from({ length: n }, (_, i) => i);
      if (this.shuffle) fisherYates(this.order);
    }
    if (this.shuffle) {
      // Pin the current track to the front so flipping shuffle on mid-song does not jump you
      // somewhere else. Only in the shuffled case: applied to the identity order this replaces
      // `[…, 313]` with `[313, 0, 1, …]`, which makes "next" at the end of the library wrap to the
      // first track even with repeat off.
      const at = this.order.indexOf(this.index);
      if (at > 0) {
        this.order.splice(at, 1);
        this.order.unshift(this.index);
      }
    }

    /*
       "Play similar" is a priority, never a subset.

       It used to filter the run down to the neighbourhood of the current track, which is why the queue
       held 31 songs in a 314-song library one minute and the whole library the next — the count changed
       with a transport orb that gave no warning it was doing that. Membership is now always every
       playable track; what the radio controls is only the order, so the next few songs are chosen to fit
       rather than picked at random, and when those run out the library carries on instead of the run
       stopping.

       The cost of building the whole list up front rather than topping it up as it plays: the related
       block is ranked against whatever was playing when the order was built, so late in a long radio run
       the tail is just the library. That is the honest shape of it — a queue that cannot run dry is the
       point, and a tail that stays personal to a song from an hour ago was never really being heard.
    */
    if (this.similar) {
      const here = this.order.includes(this.index) ? this.index : -1;
      const related = this.similarTo(this.current).filter((i) => i !== here && this.order.includes(i));
      const seen = new Set(related);
      const rest = this.order.filter((i) => i !== here && !seen.has(i));
      this.order = [...(here >= 0 ? [here] : []), ...related, ...rest];
    }

    this.orderFor = signature;
  }

  /**
   * Explicit user queue, holding track ids rather than indices.
   *
   * Ids because `tracks` is a derived view of the library and its ordering is not stable across a
   * rescan — an index would silently start pointing at a different song. It is consumed from the
   * front and takes precedence over `order`, so there is still exactly one answer to "what plays
   * next".
   */
  queue = $state<string[]>([]);

  /** The queue resolved against the current library. Entries for removed files drop out. */
  get queueTracks(): Track[] {
    const out: Track[] = [];
    for (const id of this.queue) {
      const t = this.tracks.find((x) => x.id === id);
      if (t) out.push(t);
    }
    return out;
  }

  /**
   * What the run will play after the explicit queue: the remaining play order.
   *
   * This is the "auto queue" the transport implies. Turning shuffle on has always permuted `order`, but
   * `order` was private and nothing rendered it, so the queue panel read "Nothing queued" until the
   * listener hand-added something — which made a working feature look like a missing one.
   *
   * Entries already sitting in the explicit queue are skipped: the queue wins the next step, so listing
   * a song twice would show it coming up twice.
   */
  get upNext(): Track[] {
    const at = this.order.indexOf(this.index);
    const rest = at < 0 ? this.order : this.order.slice(at + 1);
    const seen = new Set<string>(this.queue);
    const out: Track[] = [];
    for (const i of rest) {
      const t = this.tracks[i];
      if (!t || seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    return out;
  }

  /** Names where the upcoming picks came from, so the list is not a mystery. */
  get runLabel(): string {
    if (this.similar) return "Similar to this song";
    if (this.shuffle) return "Shuffled library";
    return "In library order";
  }

  /**
   * Where the next "Play next" goes, counting from the front of the queue.
   *
   * Without this, three right-clicks in a row on A, B, C produce `[C, B, A]` — the reverse of the
   * order they were asked for, because every one of them jumps the whole queue. Tracking the slot
   * and advancing it makes the result A, B, C, which is what "play these next" means.
   */
  private nextAt = 0;

  /** `next` puts the track just after the last one you added; otherwise it joins the back. */
  enqueue(id: string, next = false): void {
    if (!this.tracks.some((t) => t.id === id)) return;
    // Adding the song that is already playing would make it come up again the moment it ends.
    if (this.current.id === id) return;
    // The standby may already be holding what used to be next, which is no longer next.
    this.disarm();
    if (!next) {
      this.queue = [...this.queue, id];
      return;
    }
    const list = [...this.queue];
    const at = Math.min(this.nextAt, list.length);
    list.splice(at, 0, id);
    this.nextAt = at + 1;
    this.queue = list;
  }

  removeAt(i: number): void {
    this.disarm();
    this.queue = this.queue.filter((_, at) => at !== i);
    // A manual edit means the user has taken over the ordering; guessing where to resume is worse
    // than going back to the front.
    this.nextAt = 0;
  }

  moveInQueue(from: number, to: number): void {
    if (from === to || from < 0 || to < 0) return;
    const list = [...this.queue];
    if (from >= list.length || to >= list.length) return;
    this.disarm();
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    this.queue = list;
    this.nextAt = 0;
  }

  clearQueue(): void {
    this.disarm();
    this.queue = [];
    this.nextAt = 0;
  }

  /** Take the next queued id, skipping any whose file has disappeared since it was added. */
  private takeQueued(): number | null {
    while (this.queue.length > 0) {
      const [head, ...rest] = this.queue;
      this.queue = rest;
      this.nextAt = 0;
      const at = this.tracks.findIndex((t) => t.id === head);
      if (at >= 0) return at;
    }
    return null;
  }

  /** Next/previous track index, or null when the run is over and repeat will not wrap it. */
  private stepBy(delta: 1 | -1): number | null {
    // The queue wins on the forward step: that is the whole point of adding something to it.
    // Going back walks the play order instead, since replaying the last song means the last song.
    if (delta === 1) {
      const queued = this.takeQueued();
      if (queued !== null) return queued;
    }
    this.ensureOrder();
    const n = this.order.length;
    if (n === 0) return null;
    const at = Math.max(0, this.order.indexOf(this.index));
    const to = at + delta;
    if (to < 0) return this.order[n - 1];
    if (to >= n) return this.repeat === "off" ? null : this.order[0];
    return this.order[to];
  }

  /** Read-only twin of `takeQueued`: the first queued id that still resolves, queue left intact. */
  private peekQueued(): number | null {
    if (this.queue.length === 0) return null;
    // One `tracks` read rather than one per queued id — that getter rebuilds the whole list.
    const tracks = this.tracks;
    for (const id of this.queue) {
      const at = tracks.findIndex((t) => t.id === id);
      if (at >= 0) return at;
    }
    return null;
  }

  /**
   * Read-only `stepBy`. Arming the standby runs on the position clock, so it has to predict the next
   * track without consuming a queue entry or moving the run — a look-ahead that ate the queue would
   * empty it fifteen times a second.
   */
  private stepByPeek(delta: 1 | -1): number | null {
    if (delta === 1) {
      const queued = this.peekQueued();
      if (queued !== null) return queued;
    }
    this.ensureOrder();
    const n = this.order.length;
    if (n === 0) return null;
    const at = Math.max(0, this.order.indexOf(this.index));
    const to = at + delta;
    if (to < 0) return this.order[n - 1];
    if (to >= n) return this.repeat === "off" ? null : this.order[0];
    return this.order[to];
  }

  /** What plays next, without consuming it. Arming a deck must not advance the run. */
  peekNext(): number | null {
    return this.stepByPeek(1);
  }

  /**
   * Decode the next track on the standby deck once the boundary is close enough to be worth it.
   *
   * Every gate that changes *what* comes next lives here rather than in the engine — the engine owns
   * sound, the store owns the run. A paused track has no boundary to cross, and repeat-one,
   * repeat-times and stop-after-current all replay or stop instead of advancing. Arming through any of
   * them would decode a file that is never played and then hand off to the wrong song.
   */
  private armStandby() {
    if (this.armState !== null) return;
    if (!settings.value.gapless || !this.isPlaying) return;
    if (sleep.stopAfterCurrent) return;
    if (this.repeat === "one") return;
    if (this.repeat === "times" && this.playsLeft > 1) return;
    // No duration yet means there is nothing to measure a lead window against.
    if (!(this.duration > 0)) return;
    /*
       The lead window has to cover the cold-load time, not just the fade.

       It used to be `crossfadeSec + 6`, which made gapless hostage to a slider the owner might have at
       zero. Measured cold load for a local FLAC was 8.7–13.7s, so with crossfade off the standby deck
       got 6 seconds of warning for a job that needs at least 9 — the next song was never ready at the
       boundary and every transition stalled, with `gapless` sitting in settings looking enabled. Taking
       the larger of the fade lead and a fixed floor decouples the two: crossfade stays a taste control,
       and the preload gets long enough to actually finish.
    */
    const lead = Math.max(settings.value.crossfadeSec + 6, STANDBY_LEAD_FLOOR);
    if (this.duration - this.position > lead) return;
    const at = this.peekNext();
    if (at === null) {
      this.armState = "none";
      return;
    }
    this.armState = "armed";
    engine.prepare(this.tracks[at].source);
  }

  /**
   * Drop an armed handoff. Everything that changes where we are, or what "next" means, has to call
   * this — otherwise the standby is still holding a track the run has moved past, and the boundary
   * crossfades into the wrong song.
   */
  private disarm() {
    this.armState = null;
    engine.cancelHandoff();
  }

  /**
   * Push the two-deck settings into the engine.
   *
   * Called from an effect in `App.svelte`. Because the two settings are read *here*, that effect
   * subscribes to them and re-runs on any change — which is the point, since cancel has to come
   * first: a standby deck was decoded under the previous values, so changing either one invalidates
   * it. Clearing `armState` lets the next position tick re-arm under the new rule.
   *
   * The guard is what makes the crossfade survive at all. `settings.set()` replaces the whole
   * `$state` object (`this.value = { ...this.value, [key]: v }`), so *any* setting written anywhere
   * re-runs this effect — and it was measured firing every ~2s during playback with the pair still
   * `true/5`. Each of those no-op runs called `cancelHandoff()`, which stops the ramp and snaps both
   * decks back to unity gain, so a 5s crossfade was murdered about a second into itself: the
   * "drops abruptly then fluctuates, then jumps to steady volume with zero ramp" symptom. Only a
   * genuine change may disarm a handoff.
   */
  private lastHandoffPush: string | null = null;

  syncHandoffSettings() {
    const pair = `${settings.value.gapless}/${settings.value.crossfadeSec}`;
    if (pair === this.lastHandoffPush) return;
    this.lastHandoffPush = pair;
    engine.cancelHandoff();
    this.armState = null;
    engine.setGapless(settings.value.gapless);
    engine.crossfadeTo(settings.value.crossfadeSec);
  }

  /**
   * Shuffle and repeat are persisted, so anything that changes them has to write through.
   *
   * `times` is deliberately not in this cycle — it needs a count, and landing on a mode whose
   * behaviour depends on a number you never picked is worse than leaving it to the menu.
   */
  cycleRepeat() {
    const at = REPEAT_CYCLE.indexOf(this.repeat);
    const next = REPEAT_CYCLE[(at + 1) % REPEAT_CYCLE.length];
    this.repeat = next;
  }

  /**
   * The universal shuffle button: jump to a random track now and keep playing randomly from here.
   *
   * One action rather than a toggle, because that is what people mean when they reach for it —
   * "surprise me", not "turn on a flag and then also pick something".
   */
  shuffleAll() {
    const n = this.tracks.length;
    if (n === 0) return;
    // Starting a random run discards the queue: those picks were made against a different intent,
    // and having one interrupt the shuffle a minute later reads as a bug rather than a feature.
    this.queue = [];
    this.nextAt = 0;
    this.shuffle = true;
    // "Surprise me" across the whole library and "keep me in this song's neighbourhood" are opposite
    // intents, so starting a random run has to release the mode rather than quietly ignore it.
    this.similar = false;
    this.ensureOrder();
    // Pick from the shuffled order rather than a random index, so a blocked track cannot be the one
    // the run starts on even though it is no longer in that order.
    const pool = this.order.filter((i) => i !== this.index);
    const at = pickRandom(pool.length > 0 ? pool : this.order);
    if (at === undefined) return;
    void this.moveTo(at);
  }

  /**
   * Candidate pool for "Play similar".
   *
   * Deliberately not a model. The honest offline signals are metadata and what the listener
   * actually plays, and both are free: same album, same artist or a shared genre says the songs are
   * related, and a track you always queue straight after this one says you hear them that way too.
   * The pair counts come from real adjacency in the history log (D-042), which is why they only
   * appear for music you have actually listened to. An embedding model would be heavier than the
   * benefit and cannot run offline on the target hardware.
   */
  private similarTo(seed: Track): number[] {
    const seedTokens = new Set(
      seed.album.toLowerCase().split(/[^a-z0-9]+/u).filter((t) => t.length > 2),
    );
    const seedArtist = leadArtist(seed.artist);
    const seedArtists = creditedArtists(seed.artist);
    const scored = this.tracks
      .map((t, i) => {
        if (i === this.index || blocked.hides(t)) return { i, score: -1 };
        let score = 0;
        if (t.album && t.album === seed.album) score += 6;
        if (seedArtist && leadArtist(t.artist) === seedArtist) score += 4;
        // Credited anywhere on either side counts, at roughly the same weight as a shared genre:
        // enough to pull a Badshah cue into an A.R. Rahman seed, not enough to outrank a real
        // same-artist link.
        else if (
          seedArtists.size > 0 &&
          t.artist &&
          [...seedArtists].some((a) => creditedArtists(t.artist).has(a))
        )
          score += 2;
        else if (t.album) {
          for (const tok of t.album.toLowerCase().split(/[^a-z0-9]+/u)) {
            if (seedTokens.has(tok)) {
              score += 1;
              break;
            }
          }
        }
        if (t.genre && t.genre === seed.genre) score += 2;
        // Counted on its own terms, not as a bonus that only applies when something already matched:
        // "you always play this one right after that one" is a link by itself, and it is the only
        // signal that catches a genuinely related pair sharing no tags at all. Capped so one
        // heavily-looped pairing cannot outweigh a same-album match.
        score += Math.min(4, history.together(seed.id, t.id)) * 0.75;
        if (score === 0) return { i, score: -1 };
        // Familiarity only breaks ties *within* the related set. Added before the gate it would
        // qualify every previously-played track as "similar", which describes your library rather
        // than this song.
        return { i, score: score + Math.min(2, Math.log1p(history.count(t.id))) };
      })
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((s) => s.i);
    // No cap. There was a `.slice(0, 30)` here, which silently truncated a related set down to an
    // arbitrary 31st-of-its-own-length: the `score > 0` gate above already defines what counts as
    // similar, so cutting the survivors off by count just dropped songs that had earned their place.
    // Best-first would make every run start the same three songs. The pool is the similar set; the
    // order through it is left to chance.
    return fisherYates(scored);
  }

  /** Queue a run of tracks similar to the current one, in shuffled order. */
  playSimilar() {
    const pool = this.similarTo(this.current);
    if (pool.length === 0) return this.shuffleAll();
    this.queue = [];
    this.nextAt = 0;
    this.shuffle = true;
    this.order = [this.index, ...pool];
    this.orderFor = this.orderSignature();
    return this.moveTo(this.order[1]);
  }

  /**
   * Whether audio has come up once this session. Until it has, the wait is the audio subsystem
   * starting rather than a slow file, and the UI says so — "Buffering…" over a seven second
   * cold start reads like the app is broken.
   */
  hasStarted = $state(false);

  /** Playable list: the scanned library when populated, otherwise the demo tracks. */
  get tracks(): Track[] {
    return fromLibrary();
  }

  /**
   * A stable empty track rather than `undefined`, because every view reads `player.current.title`
   * directly. With no demo fallback an empty library would otherwise make those reads throw, and
   * guarding a dozen templates is worse than one sentinel that renders as nothing.
   */
  current = $derived(this.tracks[this.index] ?? EMPTY_TRACK);

  /** Prefer the real decoded duration; fall back to the scanned tag until it arrives. */
  duration = $derived(this.reportedDuration || this.current.duration);

  accent = $derived(this.current.accent);

  /**
   * Whether the standby deck has already been considered for the track that is playing.
   *
   * Arming runs off the position clock at about 15Hz, so without this it would re-scan the queue and
   * call `prepare()` on every tick for the whole lead window. `"none"` matters as much as `"armed"`:
   * at the end of a run with repeat off there is nothing to hand off to, and re-discovering that
   * fifteen times a second is the same waste.
   */
  private armState: "armed" | "none" | null = null;

  constructor() {
    engine.bind({
      playing: () => {
        this.isPlaying = true;
        this.isBuffering = false;
        this.hasStarted = true;
        this.error = "";
      },
      paused: () => (this.isPlaying = false),
      waiting: () => (this.isBuffering = true),
      ready: () => (this.isBuffering = false),
      position: (s) => {
        // Listening time is derived from the position clock rather than a separate timer, so a
        // paused or seeked track cannot inflate it.
        const delta = s - this.position;
        if (delta > 0 && delta < 2) history.addSeconds(delta);
        this.position = s;
        this.armStandby();
      },
      duration: (s) => {
        this.reportedDuration = s;
        /*
           A resume armed before the media existed can only be applied here.

           This is why the jump lives in the store rather than in a component effect watching
           `reportedDuration`: the element has no length until something actually loads, so an armed
           track reports 0 for as long as it sits unplayed, and an effect waiting on that transition
           loses the race against whatever starts playback. The engine's own duration callback is the
           first moment a seek is guaranteed to hold.
        */
        if (this.pendingResume > 0 && s > 0) {
          // Clamped short of the end: resuming inside the tail advances to the next track almost
          // immediately, which reads as the app having played the wrong song.
          const at = Math.min(this.pendingResume, s - 3);
          this.pendingResume = 0;
          if (at >= 2) this.seek(at);
        }
      },
      ended: () => this.handleEnded(),
      // The two-deck path: by the time this fires the engine has already flipped and the incoming
      // track is audible, so this only advances the bookkeeping. Calling `play()` here would load
      // the same file a second time and restart it from zero.
      handoff: () => this.advanceToNext("handoff"),
      error: (message) => {
        this.error = message;
        this.isPlaying = false;
        this.isBuffering = false;
      },
    });

    // Keep the element's gain in step with the restored settings from the first frame.
    engine.setVolume(this.volume);
    engine.setMuted(this.muted);
    // Same for the two-deck behaviour, so a restored `gapless: false` is honoured at the first
    // boundary rather than only after the first settings change.
    engine.setGapless(settings.value.gapless);
    engine.crossfadeTo(settings.value.crossfadeSec);
  }

  /**
   * End of a track.
   *
   * Repeat-one replays without moving. Otherwise this walks the play order, and at the end of the
   * run with repeat off it stops rather than silently wrapping — a player that loops the library
   * when you asked for "off" is lying about the setting.
   */
  private handleEnded() {
    this.advanceToNext("ended");
  }

  /**
   * Move the run on to the next track.
   *
   * `reason` is load-bearing, not cosmetic. On `"ended"` the audio has stopped, so this must start the
   * next file. On `"handoff"` the engine has already flipped decks and the next file is *audible* — so
   * calling `play()` would load the same source again and restart it from zero.
   */
  private advanceToNext(reason: "ended" | "handoff") {
    this.armState = null;

    if (reason === "ended") {
      if (this.repeat === "one") {
        this.seek(0);
        void this.play();
        return;
      }
      // Between "one" (this song forever) and "all" (the run forever): this song a set number of
      // times, then on to the next, which then gets the same number of plays.
      if (this.repeat === "times") {
        this.playsLeft -= 1;
        if (this.playsLeft > 0) {
          this.seek(0);
          void this.play();
          return;
        }
        this.playsLeft = settings.value.repeatTimes;
      }
      // Checked before repeat-all on purpose: "stop after this song" is an explicit request to end the
      // run, and honouring it only when the queue happens to be exhausted would be the opposite of it.
      if (sleep.stopAfterCurrent) {
        sleep.setStopAfterCurrent(false);
        return this.stopAtEnd();
      }
    }

    this.position = 0;
    this.reportedDuration = 0;
    const at = this.stepBy(1);
    if (at === null) return this.stopAtEnd();
    this.index = at;
    if (reason === "handoff") {
      // A new track really did start, so it gets a fresh repeat count — the `times` branch above is
      // the only other place that resets it, and a handoff never goes through there.
      this.playsLeft = settings.value.repeatTimes;
      // `play()` is skipped, but the history entry it would have written is still owed.
      history.recordStart(this.current.id);
      return;
    }
    void this.play();
  }

  private stopAtEnd() {
    this.disarm();
    engine.pause();
    this.position = 0;
  }

  async play() {
    this.error = "";
    // Set before the element does anything. The first play of a session can take several seconds on
    // the audio subsystem alone, and without this the interface just sits there looking broken.
    this.isBuffering = true;
    history.recordStart(this.current.id);
    await engine.play(this.current.source);
  }

  pause() {
    // Deliberately no `disarm()`: pausing mid-fade has to freeze both decks and resume where it left
    // off, and throwing the standby away here would turn a pause into a gap on resume.
    engine.pause();
  }

  async toggle() {
    if (this.isPlaying) engine.pause();
    else await this.play();
  }

  /** Moving to another track while playing starts it immediately; while paused it only arms it. */
  private async moveTo(next: number) {
    // A manual move outranks anything already decoded for an automatic boundary.
    this.disarm();
    const wasPlaying = this.isPlaying;
    this.index = next;
    this.position = 0;
    this.reportedDuration = 0;
    // A resume belongs to the track it was armed for; carrying it across a change would jump the new
    // track to an offset measured against the old one's length.
    this.pendingResume = 0;
    this.playsLeft = settings.value.repeatTimes;
    if (wasPlaying) await this.play();
    else engine.pause();
  }

  next() {
    const at = this.stepBy(1);
    if (at === null) return this.stopAtEnd();
    return this.moveTo(at);
  }

  previous() {
    // Restart the current track if we are more than 3s in, the convention everywhere else.
    if (this.position > 3) {
      this.seek(0);
      return;
    }
    return this.moveTo(this.stepBy(-1) ?? this.index);
  }

  select(id: string) {
    const at = this.tracks.findIndex((t) => t.id === id);
    if (at === -1 || at === this.index) return;
    return this.moveTo(at);
  }

  /** Choosing a track from a list always starts it, unlike select() which preserves intent. */
  /**
   * Play a track, optionally seeding up-next from the list it was chosen out of.
   *
   * `context` is what makes clicking track 3 of an album behave like every other player: 4, 5, 6 go
   * into the queue in that list's own order. Without it the play order is the library's index order,
   * so an album plays straight through into whatever happened to be scanned next, and the queue
   * panel stays empty for a list the person can plainly see on screen.
   *
   * Replacing an existing queue is deliberate — starting a new context is a fresh intent, and
   * silently appending an album onto the end of someone's hand-built up-next is the worse surprise.
   */
  // Only the `id` of each entry is read, in order — so a caller holding the library's own
  // StoredTrack view rather than the enriched Track view can pass its list without mapping first.
  playFrom(id: string, context?: readonly { id: string }[]) {
    const at = this.tracks.findIndex((t) => t.id === id);
    if (at === -1) return;
    // This path sets `index` directly rather than going through `moveTo`, so it disarms for itself —
    // and it rewrites the queue below, which is exactly what invalidates an armed standby.
    this.disarm();
    if (context?.length) {
      const from = context.findIndex((t) => t.id === id);
      if (from !== -1) this.queue = context.slice(from + 1).map((t) => t.id);
    }
    // Playing a queued track now must also take it out of the queue, or it comes up again later.
    if (this.queue.includes(id)) this.queue = this.queue.filter((q) => q !== id);
    this.playsLeft = settings.value.repeatTimes;
    if (at !== this.index) {
      this.index = at;
      this.position = 0;
      this.reportedDuration = 0;
    }
    return this.play();
  }

  seek(seconds: number) {
    // Seeking rewrites where the boundary is, so a deck decoded against the old one is stale.
    this.disarm();
    this.position = seconds;
    engine.seek(seconds);
  }

  /**
   * Queue a resume point for the track that is currently armed.
   *
   * The offset is applied by the engine's duration callback, not immediately, because an armed track has
   * no loaded media element yet — seeking one is a no-op that reports `currentTime` 0 straight back.
   *
   * The position is set here as well so the scrub bar shows where playback will actually start. Without
   * it the UI reads 0:00 for a track that is about to begin at 1:28.
   */
  armResume(seconds: number) {
    if (seconds < 2) return;
    this.pendingResume = seconds;
    this.position = seconds;
  }

  /** True while a resume is still waiting on the media to load. Callers use it to hold off writes. */
  get resuming() {
    return this.pendingResume > 0;
  }

  setVolume(v: number) {
    this.volume = v;
    engine.setVolume(v);
    settings.set("volume", v);
    if (v > 0 && this.muted) this.setMuted(false);
  }

  setMuted(m: boolean) {
    this.muted = m;
    engine.setMuted(m);
    settings.set("muted", m);
  }
}

export const player = new PlayerStore();
